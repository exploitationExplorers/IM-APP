import { ref } from 'vue'
import IMSDK, {
  IMEvents,
  IMMethods,
  LoginStatus,
  MessageStatus,
  MessageType,
  OnlineState,
  Platform,
  SessionType,
  ViewType,
} from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import type { UserOnlineState } from '@openim/client-sdk'
import { APP_CONFIG } from '@/config'
import { fetchIMToken, resolveIMGroup, reportSendFailure, type IMTokenResult } from '@/api/im'
import { getToken } from '@/utils/request'
import { useContactStore } from '@/stores/contact'
import type { ChatMessage, Conversation, ConversationPinnedMessage, MessageType as AppMessageType } from '@/types'
import { looksLikeImageUrl, quoteSummaryOf, quoteThumbOf, resolveQuoteType } from '@/utils/format'
import { uploadVoiceViaApi } from '@/utils/mediaApi'
import {
  formatIMNotification,
  imNotificationEventKey,
  isGroupPurgeTipText,
  notificationKindOf,
  GROUP_CREATED_WELCOME_TEXT,
} from '@/utils/im-notification'
import { effectiveGroupAtType, GroupAtType, highlightTagsOf } from '@/utils/group-announcement'
import {
  parseVideoMeta,
  videoSnapshotTime,
  downloadRemoteVideoForCover,
  preferRemoteMediaUrl,
  isRemoteMediaUrl,
  listThumbnailUrl,
} from '@/utils/chatMedia'
import { devLog, devWarn } from '@/utils/devLog'
import { isAndroid, isApp } from '@/utils/platform'
import { isOSSStorageUrl } from '@/utils/storage-url'
import type { PlusResolveLocalFile } from '@/types/plus-io'
import { preserveForwardMedia } from '@/api/forward'
import { mayContainForwardMedia, snapshotFromMessage, withForwardSnapshot } from '@/utils/forwardSnapshot'
import {
  describeNativeCreateResult,
  inferNativeMessageType,
  isNativeCreateResultError,
  slimQuotedMessage,
} from '@/utils/quotePayload'
import { groupRetention, retentionSeq } from '@/utils/groupRetention'
import { getAppSdkDataDir } from '@/utils/openimDataDir'

/** @openim/client-sdk LogLevel：H5 WASM 登录参数 */
const H5_SDK_LOG_LEVEL = import.meta.env.DEV ? 3 : 5 // Warn : Silent
/** openim-uniapp-polyfill LogLevel：App 原生 InitSDK */
const APP_SDK_LOG_LEVEL = import.meta.env.DEV ? 3 : 2 // Warn : Error
const APP_SDK_LOG_STDOUT = import.meta.env.DEV

/** OpenIM 会话目标，发消息时决定填 recvID 还是 groupID */
export interface IMTarget {
  conversationId: string
  sessionType: number
  /** 单聊对方的 OpenIM 用户 ID */
  recvId: string
  /** 群聊的 OpenIM 群 ID */
  groupId: string
}

const env = (import.meta as ImportMeta & { env: Record<string, string> }).env

/** OpenIM：同一 SDK 实例上重复 Login 会返回这个错误，语义是已登录而不是失败 */
const LOGIN_REPEAT_CODE = 10102

/** 标准运行基座不含第三方原生插件，App 聊天必须用包含 OpenIM 的自定义调试基座 */
const APP_NATIVE_PLUGIN_MISSING =
  'App 端缺少 OpenIM 原生插件，请用自定义调试基座运行'

function hasAppNativeIMSDK(): boolean {
  if (!isApp()) return true
  try {
    const sdk = uni.requireNativePlugin('Tuoyun-OpenIMSDK') as { initSDK?: unknown } | null
    return typeof sdk?.initSDK === 'function'
  } catch {
    return false
  }
}

function assertAppNativeIMSDK(): void {
  if (!hasAppNativeIMSDK()) {
    throw new Error(APP_NATIVE_PLUGIN_MISSING)
  }
}

/** 当前登录的 OpenIM 用户 ID，消息里的 sendID 就是它 */
export const imUserId = ref('')

const IM_USER_ID_RE = /^[0-9a-f]{32}$/
const BUSINESS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * OpenIM 用户 ID → 业务用户 UUID。
 * 后端用去掉连字符的 UUID 作为 OpenIM userID，这里做反向还原。
 */
export function businessUserIdFromIM(openIMUserID: string): string {
  const normalized = openIMUserID.trim().toLowerCase()
  if (BUSINESS_UUID_RE.test(normalized)) return normalized
  if (!IM_USER_ID_RE.test(normalized)) return ''
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`
}

/** 业务 UUID 和 OpenIM 的 32 位 id 看成同一个用户 */
export function sameBusinessUserId(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const left = businessUserIdFromIM(a) || a.replace(/-/g, '').toLowerCase()
  const right = businessUserIdFromIM(b) || b.replace(/-/g, '').toLowerCase()
  return left.replace(/-/g, '').toLowerCase() === right.replace(/-/g, '').toLowerCase()
}

/** 发给 OpenIM 的用户/群 id 不能带横线，带横线的账号会直接被拒发 */
function toOpenIMID(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (BUSINESS_UUID_RE.test(normalized)) return normalized.replace(/-/g, '')
  return id.trim()
}

/** 单聊会话 id 是 si_对方_自己。会话上缺 userID 时从这里把接收人补回来 */
export function peerIdFromSingleConversation(conversationId: string, selfId: string): string {
  if (!conversationId.startsWith('si_')) return ''
  const parts = conversationId.slice(3).split('_').filter(Boolean)
  if (parts.length < 2) return ''
  const self = toOpenIMID(selfId)
  return parts.map(toOpenIMID).find((id) => id && id !== self) || ''
}

let tokenExpireAt = 0
let loginPromise: Promise<string> | null = null
/** 退出登录时递增，作废进行中的 IM 登录，避免旧账号登录完成后把会话写回来 */
let loginEpoch = 0
let boundAccessToken = ''
/** Logout/Login 串行执行。并发 Logout 会把 SQLite 关掉，发送里的 GetGroups 就报 database is closed */
let sessionChain: Promise<void> = Promise.resolve()
let sessionDepth = 0
/** 本地库已经关掉时，下一次登录不能走「状态仍是已登录就跳过 Login」 */
let forceNextLogin = false
/** 同一用户进程内只 InitSDK 一次。重复 InitSDK 会把正在用的本地库关掉 */
let appSdkReadyUserId = ''
let closedDbRecovery: Promise<void> | null = null

function enqueueSession<T>(task: () => Promise<T>): Promise<T> {
  if (sessionDepth > 0) return task()
  const run = sessionChain.then(async () => {
    sessionDepth += 1
    try {
      return await task()
    } finally {
      sessionDepth -= 1
    }
  })
  sessionChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * SDK 是否已真正连上 OpenIM 服务端。
 * 光本地缓存(imUserId/tokenExpireAt)有效还不够——服务端掉线时 SDK 会断连，
 * 此时直接调会话接口会被 SDK 拒成 errCode=10004(Resource load not complete)。
 * 只有收到 OnConnectSuccess 才认为可用。
 */
let connected = false

/**
 * 服务端数据是否已同步完成本轮。
 * Login / 重连后 SDK 会异步拉会话与离线消息；未完成时读本地库会缺消息。
 * 由 OnSyncServerStart/Finish/Failed 维护，供 waitForSync 短路与 UI 刷新判断。
 */
let serverSyncReady = false

/** 断线后还在排队的发送，连上就立刻继续，不用干等满退避时间 */
const reconnectWaiters = new Set<() => void>()

function wakeReconnectWaiters() {
  reconnectWaiters.forEach((fn) => fn())
  reconnectWaiters.clear()
}

function waitToRetrySend(attempt: number, epoch: number): Promise<boolean> {
  const ms = Math.min(8000, 2000 * 2 ** attempt)
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reconnectWaiters.delete(wake)
      resolve(ok && epoch === loginEpoch)
    }
    const wake = () => finish(true)
    const timer = setTimeout(() => finish(true), ms)
    if (!connected) reconnectWaiters.add(wake)
  })
}

/**
 * 清空本地登录缓存，下次 ensureIMLogin 会强制重新登录。
 * 触发场景：被其它端踢下线、token 在服务端过期、或需要重新握手时。
 */
function resetLoginCache() {
  imUserId.value = ''
  groupRetention.setOwner('')
  tokenExpireAt = 0
  connected = false
  serverSyncReady = false
  boundAccessToken = ''
}

export function invalidateIMLoginCache() {
  resetLoginCache()
}

function invalidatePendingLogin() {
  loginEpoch += 1
  resetLoginCache()
  wakeReconnectWaiters()
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function forceSdkLogout(): Promise<void> {
  try {
    const status = await getSdkLoginStatus()
    if (status === LoginStatus.Logout) return
  } catch {
    // 未初始化或查询失败时仍尝试 Logout，原生侧可能还挂着上一个账号
  }
  await imCall(IMMethods.Logout).catch(() => undefined)
}

/**
 * 聊天是否交给 OpenIM SDK。旧的自研 WS 通道已下线，
 * 只有显式设成 false 才会关闭聊天能力（用于排查问题）。
 */
export function shouldUseOpenIM(): boolean {
  return env.VITE_OPENIM_ENABLED !== 'false'
}

function currentPlatformId(): number {
  if (!isApp()) return Platform.Web
  return uni.getSystemInfoSync().platform === 'ios' ? Platform.iOS : Platform.Android
}

/**
 * 统一 asyncApi 的返回形态：多数方法返回 { errCode, data } 信封，
 * createXxxMessage 这类同步方法直接返回结果本身。
 * 失败时 polyfill reject 的是 { errCode, errMsg } 裸对象，转成 Error 才能带到 UI。
 */
async function imCall<T>(method: IMMethods, ...args: unknown[]): Promise<T> {
  assertAppNativeIMSDK()
  let raw: unknown
  try {
    raw = await IMSDK.asyncApi(method, IMSDK.uuid(), ...args)
  } catch (e) {
    throw toIMError(e, method)
  }
  if (raw && typeof raw === 'object' && 'errCode' in raw) {
    const envelope = raw as { errCode: number; errMsg?: string; data?: T }
    if (envelope.errCode !== 0) throw toIMError(envelope, method)
    if ('data' in envelope) raw = envelope.data
  }
  // iOS 创建消息可能返回 JSON 字符串或只读桥接对象，不能直接补写属性。
  // 在所有 createXxxMessage 的出口解析并复制，图片/视频等后续加工也使用普通对象。
  if (isApp() && /^create.*Message/.test(method)) {
    return copyNativeCreatedMessage(raw) as T
  }
  return raw as T
}

/** iOS 桥接对象是只读的，展开复制会抛 Attempted to assign to readonly property。先变成普通 JSON。 */
function plainNativeRecord(obj: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(obj))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* 不能整体序列化时再逐字段读 */
  }
  const plain: Record<string, unknown> = {}
  let keys: string[] = []
  try {
    keys = Object.keys(obj)
  } catch {
    keys = []
  }
  for (const key of keys) {
    try {
      plain[key] = obj[key]
    } catch {
      /* 单个只读字段跳过 */
    }
  }
  return plain
}

function copyNativeCreatedMessage(raw: unknown): MessageItem {
  let obj = unwrapRawMessage(raw)
  // 部分基座把创建结果再包一层 message / Message
  if (obj && !pickString(obj, ['clientMsgID', 'ClientMsgID', 'clientMsgId'])) {
    const nested = unwrapRawMessage(obj.message ?? obj.Message)
    if (nested) obj = nested
  }
  const clientMsgID = obj && pickString(obj, ['clientMsgID', 'ClientMsgID', 'clientMsgId'])
  // 个别基座创建引用消息只带回 *Elem，不带 contentType（图片/视频/语音都遇到过）。
  // 只认 quoteElem/textElem 会把这些全判成无效，必须按 elem 全量反推。
  const contentType = obj ? inferNativeMessageType(obj) : 0
  if (!obj || !clientMsgID || contentType <= 0) {
    devWarn('[im] 原生创建消息结果无效', describeNativeCreateResult(raw))
    throw new Error('原生 SDK 创建消息结果无效')
  }
  // 保留完整媒体元素及原生扩展字段，不用展示层的归一化逻辑裁剪待发消息。
  const plain = plainNativeRecord(obj)
  return {
    ...plain,
    clientMsgID,
    contentType,
    groupID: pickString(obj, ['groupID', 'GroupID']),
    recvID: pickString(obj, ['recvID', 'RecvID']),
    sessionType: Number(obj.sessionType ?? obj.SessionType ?? 0),
    status: messageStatusOf(obj),
  } as MessageItem
}

/**
 * OpenIM 调用失败。code 用 SDK / 服务端数字码，重试只看码，不看文案。
 * 本地等待回调超时没有 SDK 码，用 SEND_WAIT_TIMEOUT。
 */
class IMCallError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'IMCallError'
    this.code = code
  }
}

/** 本地发送等待超时，不是 OpenIM 的码 */
const SEND_WAIT_TIMEOUT = -1

/**
 * 只重试传输层失败。白名单来自 OpenIM SDK：
 * 10000 网络 / 长连接断开，10001 网络超时，10003 上下文超时，
 * 10004 资源还没加载完，10005 SDK 把断连和本地库异常包在这个码里。
 * 业务拒绝（5001、1002 无权限）不在里面，直接失败。
 */
const RETRYABLE_SEND_CODES = new Set<number>([10000, 10001, 10003, 10004, 10005, SEND_WAIT_TIMEOUT])

/** 长连接没了，重试前要等 OnConnectSuccess，不能按「还连着」立刻再打 */
const DISCONNECT_CODES = new Set<number>([10000])

/**
 * 同一条 clientMsgID 不可再 send：
 * - 10204：SDK MsgRepeatError「Only failed messages can be resent」（首发其实已成功/仍在发送时重试会撞这个）
 * - 1003：部分服务端 DuplicateKey / 历史码
 * 命中应视为已发出，不能上报「发送失败」。
 */
const DUPLICATE_SEND_CODES = new Set<number>([10204, 1003])

function isDuplicateSendError(err: unknown): boolean {
  if (err instanceof IMCallError && DUPLICATE_SEND_CODES.has(err.code)) return true
  const text = err instanceof Error ? err.message : String(err || '')
  return /\b10204\b/.test(text) || /Only failed messages can be resent/i.test(text)
}

function toIMError(raw: unknown, method: IMMethods): Error {
  if (raw instanceof IMCallError) return raw
  if (raw instanceof Error) return raw
  if (typeof raw === 'string') return new Error(`${raw}（${method}）`)
  const { errCode, errMsg, errDlt } = (raw || {}) as {
    errCode?: number
    errMsg?: string
    errDlt?: string
  }
  const code = typeof errCode === 'number' && Number.isFinite(errCode) ? errCode : 0
  const detail = `${method} errCode=${errCode ?? 'unknown'}`
  const hint = [errMsg, errDlt].filter(Boolean).join(': ')
  return new IMCallError(code, hint ? `${hint}（${detail}）` : `IM 调用失败（${detail}）`)
}

/** OpenIM 侧操作者不在群内（已退群 / 被踢 / 成员状态不同步） */
export function isNotInGroupIMError(err: unknown): boolean {
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err
        ? JSON.stringify(err)
        : String(err || '')
  return (
    /errCode=1002\b/.test(text) ||
    /NoPermissionError/i.test(text) ||
    /not in group/i.test(text) ||
    /op user not in group/i.test(text)
  )
}

/**
 * 发送失败给用户看的文案。
 * 服务端 webhook 拒绝原因是英文码（not_friend / blocked），后台能翻译，
 * 客户端以前直接吞掉或弹原文，用户只看到红叹号。
 */
export function friendlySendFailMessage(err: unknown): string {
  const text =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err
        ? JSON.stringify(err)
        : String(err || '')
  const lower = text.toLowerCase()

  if (/\bnot_friend\b/.test(lower) || /chat is not allowed/.test(lower)) {
    return '对方还不是你的好友，无法发送消息'
  }
  if (/\bblocked\b/.test(lower)) {
    return '对方已把你拉黑，无法发送消息'
  }
  if (/\bmember_muted\b/.test(lower)) {
    return '你已被禁言，暂时无法发送消息'
  }
  if (/\bgroup_muted\b/.test(lower)) {
    return '全员禁言中，暂时无法发送消息'
  }
  if (/\bgroup_inactive\b/.test(lower) || /group chat is not allowed/.test(lower)) {
    return '该群聊不可用，无法发送消息'
  }
  if (/\bsender_inactive\b/.test(lower) || /\baccount_inactive\b/.test(lower)) {
    return '账号状态异常，无法发送消息'
  }
  if (/(^|\s)self(\b|（|\()/.test(lower) || /\bself（/.test(text)) {
    return '不能给自己发送消息'
  }
  if (/群内不可分享个人名片/.test(text)) return '群内不可分享个人名片'
  if (/仅群主或管理员可以@所有人/.test(text)) return '仅群主或管理员可以@所有人'
  if (err instanceof IMCallError && err.code === SEND_WAIT_TIMEOUT) {
    return '发送超时，请检查网络后重试'
  }
  if (/发送超时|timeout/i.test(text)) return '发送超时，请检查网络后重试'
  if (/\b10000\b|ws not connected|reconnect failed|network error/i.test(text)) {
    return '网络异常，请稍后重试'
  }
  // 已是中文业务提示（去掉 errCode 尾巴）就直接用
  const zh = text.replace(/（[^）]*errCode=[^）]*）/g, '').trim()
  if (/[\u4e00-\u9fff]/.test(zh)) return zh
  return '发送失败'
}

function isLoginRepeat(raw: unknown): boolean {
  if (raw && typeof raw === 'object' && 'errCode' in raw) {
    return (raw as { errCode?: number }).errCode === LOGIN_REPEAT_CODE
  }
  return raw instanceof Error && (raw.message.includes('10102') || raw.message.includes('login repeat'))
}

async function getSdkLoginStatus(): Promise<LoginStatus> {
  try {
    return await imCall<LoginStatus>(IMMethods.GetLoginStatus)
  } catch {
    return LoginStatus.Logout
  }
}

async function getSdkLoginUserId(): Promise<string> {
  try {
    return (await imCall<string>(IMMethods.GetLoginUserID)) || ''
  } catch {
    return ''
  }
}

function rememberLogin(imToken: IMTokenResult): string {
  imUserId.value = imToken.userId
  groupRetention.setOwner(imToken.userId)
  tokenExpireAt = Date.now() + Math.max(0, imToken.expireSec - 300) * 1000
  connected = true // 登录 + 同步已成功，视为已连上服务端
  boundAccessToken = getToken()
  return imUserId.value
}

/**
 * 登录成功只代表连上了，SDK 还要异步从服务端拉会话与消息。
 * 这期间查历史会拿到空 / 旧列表，所以要等同步结束；超时兜底，避免同步事件丢失时卡死。
 * 若本进程已收到过 OnSyncServerFinish 且仍保持连接，直接放行。
 */
export function waitForSync(timeoutMs = 15000): Promise<void> {
  if (serverSyncReady && connected) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      offFinish()
      offFailed()
      offStart()
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    const offStart = onIMEvent(IMEvents.OnSyncServerStart, () => {
      serverSyncReady = false
    })
    const offFinish = onIMEvent(IMEvents.OnSyncServerFinish, () => {
      serverSyncReady = true
      finish()
    })
    // 失败也放行：上层仍可读本地库，后续重连 / OnSyncServerFinish 会再补拉
    const offFailed = onIMEvent(IMEvents.OnSyncServerFailed, finish)
  })
}

/**
 * H5 把 SDK 的地址改到当前站点，App 保持服务端下发的绝对地址。
 *
 * 后端下发的是 `http://8.154.44.197/openim-api` 和 `ws://8.154.44.197/openim-ws`。
 * 线上页面是 https，浏览器会直接拦掉这两种明文地址，SDK 连不上就反复 Login，
 * 第二次被本地拒成 errCode=10102（login repeat）。这条错误不是 HTTP 失败，所以网络面板全是绿的。
 * 网站 nginx 已经反代 /openim-api、/openim-ws，这里改成同源 https/wss 即可。
 *
 * 开发环境只改 ws：Vite 只代理了 /openim-ws，api 仍直连服务端。
 */
function h5SdkAddr(raw: string, kind: 'api' | 'ws'): string {
  // #ifdef H5
  if (typeof location !== 'undefined' && location.host && raw) {
    const securePage = location.protocol === 'https:'
    const rewrite = kind === 'ws' ? securePage || import.meta.env.DEV : securePage
    if (rewrite) {
      try {
        const u = new URL(raw)
        if (kind === 'ws') {
          const proto = securePage ? 'wss:' : 'ws:'
          return `${proto}//${location.host}${u.pathname}${u.search}`
        }
        return `${location.origin}${u.pathname}${u.search}`
      } catch {
        if (kind === 'ws') {
          const proto = securePage ? 'wss:' : 'ws:'
          return `${proto}//${location.host}/openim-ws`
        }
      }
    }
  }
  // #endif
  return raw
}

/**
 * 图片/视频分片上传的签名地址是 http://8.154.44.197/openim/...。
 * https 页面里浏览器会直接拦截这种明文请求，网络面板里只看到一串哈希名的红请求，接口本身没有 4xx。
 * 改到当前站点的 /openim/，由网站 nginx 再带回 8.154.44.197（Host 仍是这个 IP，签名才对得上）。
 * App 不走浏览器，不安装这个改写。
 */
function rewriteH5StorageUrl(raw: string): string {
  // #ifdef H5
  if (isOSSStorageUrl(raw)) return raw
  if (typeof location !== 'undefined' && location.host && raw) {
    try {
      const url = new URL(raw, location.href)
      if ((url.protocol === 'http:' || url.protocol === 'ws:') && url.host !== location.host) {
        const path = url.pathname
        if (
          path.startsWith('/openim/') ||
          path.startsWith('/object/') ||
          path.startsWith('/minio/') ||
          path.startsWith('/openim-api/') ||
          path.startsWith('/openim-ws')
        ) {
          const proto =
            url.protocol === 'ws:' ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol
          return `${proto}//${location.host}${url.pathname}${url.search}`
        }
      }
    } catch {
      return raw
    }
  }
  // #endif
  return raw
}

function installH5StorageProxy(): void {
  // #ifdef H5
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  const host = window as Window & { __imH5StorageProxy?: boolean }
  if (host.__imH5StorageProxy) return
  host.__imH5StorageProxy = true
  const rawFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' || input instanceof URL) {
      return rawFetch(rewriteH5StorageUrl(String(input)), init)
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const next = rewriteH5StorageUrl(input.url)
      // eslint-disable-next-line max-lines
      if (next !== input.url) return rawFetch(new Request(next, input), init)
    }
    return rawFetch(input, init)
  }
  // #endif
}

installH5StorageProxy()

async function loginSdk(imToken: IMTokenResult): Promise<void> {
  const payload = {
    userID: imToken.userId,
    token: imToken.token,
    platformID: imToken.platform,
    apiAddr: h5SdkAddr(imToken.apiAddr, 'api'),
    wsAddr: h5SdkAddr(imToken.wsAddr, 'ws'),
    logLevel: H5_SDK_LOG_LEVEL,
  }
  let synced = waitForSync()
  try {
    await imCall(IMMethods.Login, payload)
  } catch (e) {
    if (!isLoginRepeat(e)) {
      const msg = (e as Error)?.message || ''
      if (isApp() && isLocalDatabaseWriteError(e)) {
        // 目录丢失/路径失效时，只重试 Login 会继续使用同一坏路径；重新准备目录并初始化一次。
        const epoch = loginEpoch
        await forceSdkLogout()
        if (epoch !== loginEpoch) throw new Error('已退出登录')
        resetLoginCache()
        appSdkReadyUserId = ''
        await initAppSdk(imToken)
        synced = waitForSync()
        await imCall(IMMethods.Login, payload)
      } else if (msg.includes('10005') || msg.includes('10004')) {
        await new Promise((r) => setTimeout(r, 400))
        synced = waitForSync()
        try {
          await imCall(IMMethods.Login, payload)
        } catch (again) {
          if (!isLoginRepeat(again)) throw again
        }
      } else {
        throw e
      }
    } else {
      const loggedUserId = await getSdkLoginUserId()
      // 空 userId 表示上一次 Login 还在进行。10102 的意思就是已经在登，这时再 Logout 会把进行中的登录打失败。
      if (loggedUserId && loggedUserId !== imToken.userId) {
        await imCall(IMMethods.Logout).catch(() => undefined)
        synced = waitForSync()
        try {
          await imCall(IMMethods.Login, payload)
        } catch (again) {
          if (!isLoginRepeat(again)) throw again
        }
      }
    }
  }
  await synced
}

async function initAppSdk(imToken: IMTokenResult): Promise<void> {
  if (!isApp()) return
  // 即使同一进程已初始化，重新登录前也要补回可能丢失的目录。
  const dataDir = await getAppSdkDataDir(imToken.userId, typeof plus === 'undefined' ? undefined : plus?.io)
  if (appSdkReadyUserId === imToken.userId) return
  const initialized = await imCall<unknown>(IMMethods.InitSDK, {
    platformID: imToken.platform,
    apiAddr: imToken.apiAddr,
    wsAddr: imToken.wsAddr,
    dataDir,
    logLevel: APP_SDK_LOG_LEVEL,
    isLogStandardOutput: APP_SDK_LOG_STDOUT,
  })
  if (initialized === false) throw new Error('聊天 SDK 初始化失败，请关闭 App 后重新打开')
  appSdkReadyUserId = imToken.userId
}

async function doLogin(): Promise<string> {
  const epoch = loginEpoch
  const force = forceNextLogin
  forceNextLogin = false
  const imToken: IMTokenResult = await fetchIMToken(currentPlatformId())
  if (epoch !== loginEpoch) {
    throw new Error('已退出登录')
  }

  await initAppSdk(imToken)

  const status = await getSdkLoginStatus()
  if (status === LoginStatus.Logged) {
    const loggedUserId = await getSdkLoginUserId()
    if (!force && loggedUserId === imToken.userId) {
      // 已经登录就先读本地库，进群不用干等本轮同步。
      // 同步结束会走 OnSyncServerFinish，再把离线期间的新消息补进当前房间。
      if (epoch !== loginEpoch) {
        throw new Error('已退出登录')
      }
      return rememberLogin(imToken)
    }
    // 换号，或库已关闭但状态仍是已登录：先 Logout，Login 才会重新打开 SQLite。
    await imCall(IMMethods.Logout).catch(() => undefined)
  }

  await loginSdk(imToken)
  if (epoch !== loginEpoch) {
    await imCall(IMMethods.Logout).catch(() => undefined)
    throw new Error('已退出登录')
  }
  return rememberLogin(imToken)
}

/**
 * 同一业务账号、IM token 未过期、SDK 还没登出时直接复用。
 * 断线不能在这里 Logout：Logout 会关 SQLite，紧接着的发送会在 GetGroups 上报 database is closed。
 */
async function reuseLiveSession(): Promise<string | null> {
  const businessToken = getToken()
  const sameAccount = !!imUserId.value && !!businessToken && businessToken === boundAccessToken
  if (!sameAccount || Date.now() >= tokenExpireAt) return null
  const logged = await getSdkLoginUserId()
  if (logged && logged !== imUserId.value) return null
  if (connected) return imUserId.value
  try {
    const status = await imCall<LoginStatus>(IMMethods.GetLoginStatus)
    if (status !== LoginStatus.Logout) return imUserId.value
  } catch {
    // 状态接口失败不代表库已关闭，这里 Logout 会把还开着的库关掉。
    return imUserId.value
  }
  return null
}

async function reloginSession(): Promise<string> {
  if (!forceNextLogin) {
    const reused = await reuseLiveSession()
    if (reused) return reused
  }
  const businessToken = getToken()
  if (imUserId.value || connected || boundAccessToken) {
    const switchingAccount = !businessToken || (boundAccessToken !== '' && businessToken !== boundAccessToken)
    if (switchingAccount) {
      invalidatePendingLogin()
      appSdkReadyUserId = ''
    } else {
      // 同一账号换 IM token，不要增加 loginEpoch，进行中的发送还要重试。
      resetLoginCache()
    }
    await forceSdkLogout().catch(() => undefined)
  }
  const epoch = loginEpoch
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null
    })
  }
  try {
    const userId = await loginPromise
    if (epoch !== loginEpoch) return ensureIMLogin()
    return userId
  } catch (e) {
    if (epoch !== loginEpoch) return ensureIMLogin()
    if (isApp() && isLocalDatabaseWriteError(e)) {
      appSdkReadyUserId = ''
      resetLoginCache()
      console.error('[im] database login recovery failed', e)
      throw new Error('聊天本地数据库初始化失败，请检查手机可用空间后重新打开 App')
    }
    throw e
  }
}

/**
 * 发送打到已关闭的本地库时，Logout 再 Login 重新打开。
 * 不增加 loginEpoch，同一条消息可以接着发。
 */
function reopenClosedSdkDatabase(): Promise<void> {
  if (!closedDbRecovery) {
    const epoch = loginEpoch
    closedDbRecovery = enqueueSession(async () => {
      if (epoch !== loginEpoch) return
      if (loginPromise) await loginPromise.catch(() => undefined)
      if (epoch !== loginEpoch) return
      forceNextLogin = true
      await reloginSession()
    }).finally(() => {
      closedDbRecovery = null
    })
  }
  return closedDbRecovery
}

/** 保证 SDK 已登录，重复调用只会真正登录一次；返回当前 OpenIM 用户 ID */
export async function ensureIMLogin(): Promise<string> {
  if (!shouldUseOpenIM()) throw new Error('聊天功能未启用')
  if (!forceNextLogin) {
    const reused = await reuseLiveSession()
    if (reused) return reused
  }
  return enqueueSession(() => reloginSession())
}

/**
 * 连接监听是否已注册，避免 initOpenIM 被多次调用时重复订阅同一事件。
 */
let connectionWatchersReady = false

/**
 * 订阅 SDK 连接生命周期事件（只注册一次）。
 * 这是修复「errCode=10004 资源未加载」的关键：OpenIM 服务端不稳定会断连，
 * 前端必须感知断连 / 被踢 / token 过期，据此失效本地缓存、等待重连，
 * 否则缓存还自认已登录，调会话接口就被 SDK 拒绝。
 */
function setupConnectionWatchers() {
  if (connectionWatchersReady) return
  connectionWatchersReady = true

  // 连接失败：标记未连上。本地缓存保留，等 SDK 自动重连或下次调用时重登。
  onIMEvent(IMEvents.OnConnectFailed, () => {
    connected = false
  })
  // 连接成功：标记已可用，缓存复用路径恢复。
  onIMEvent(IMEvents.OnConnectSuccess, () => {
    connected = true
    wakeReconnectWaiters()
  })
  // 同步生命周期：供 waitForSync 短路；UI 层另听 Finish 强制重拉。
  onIMEvent(IMEvents.OnSyncServerStart, () => {
    serverSyncReady = false
  })
  onIMEvent(IMEvents.OnSyncServerFinish, () => {
    serverSyncReady = true
  })
  onIMEvent(IMEvents.OnSyncServerFailed, () => {
    serverSyncReady = false
  })
  // 被其它端踢下线：SDK 会自动 logout，本地缓存作废，下次必须重新登录。
  onIMEvent(IMEvents.OnKickedOffline, () => {
    invalidatePendingLogin()
  })
  // token 被服务端判过期：旧 token 作废，必须重新向业务后端换 token 再登录。
  onIMEvent(IMEvents.OnUserTokenExpired, () => {
    invalidatePendingLogin()
  })
}

/** 业务登录成功后调用，失败不阻断主流程 */
export async function initOpenIM(): Promise<void> {
  if (!shouldUseOpenIM()) return
  setupConnectionWatchers() // 注册连接生命周期监听（只注册一次）
  await ensureIMLogin()
}

export async function logoutOpenIM(): Promise<void> {
  await enqueueSession(async () => {
    invalidatePendingLogin()
    appSdkReadyUserId = ''
    // 刷新后内存会话为空，但 H5 WASM 仍可能是 Logged；必须 Logout，
    // 否则下次 doLogin 走 Logged 捷径、本地库不触发完整同步。
    try {
      await withTimeout(forceSdkLogout(), 3000)
    } catch {
      // 本地必须清掉，避免下一个账号读到上一个号的会话库
    }
    resetLoginCache()
  })
}

/** 手动重连：重新取 token 再登录，用于「重新选线」 */
export async function reconnectOpenIM(): Promise<void> {
  await logoutOpenIM()
  await ensureIMLogin()
}

/** 订阅 SDK 事件，返回取消订阅函数 */
export function onIMEvent<T>(event: IMEvents, handler: (data: T) => void): () => void {
  const wrapped = (payload: Record<string, unknown>) => {
    handler(parseEventData<T>(payload))
  }
  IMSDK.subscribe(event, wrapped)
  return () => IMSDK.unsubscribe(event, wrapped as unknown as () => void)
}

/** app 端原生插件回调里的 data 可能是 JSON 字符串 */
function parseEventData<T>(payload: Record<string, unknown>): T {
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T
    } catch {
      return data as unknown as T
    }
  }
  return data as T
}

// ---------------------------------------------------------------------------
// 会话与消息
// ---------------------------------------------------------------------------

export async function getConversationList(offset = 0, count = 200): Promise<ConversationItem[]> {
  try {
    return await imCall<ConversationItem[]>(IMMethods.GetConversationListSplit, { offset, count })
  } catch (e) {
    if (!isDatabaseClosedError(e) && !(isApp() && isLocalDatabaseWriteError(e))) throw e
    await reopenClosedSdkDatabase()
    return imCall<ConversationItem[]>(IMMethods.GetConversationListSplit, { offset, count })
  }
}

/**
 * 按业务目标取会话，OpenIM 会在不存在时新建，无需先建群或建会话。
 *
 * 注意：SDK 登录后还会异步从服务端拉取会话/消息资源，这段窗口期内调用
 * GetOneConversation 会瞬时返回 errCode=10004(ResourceLoadNotComplete)。
 *
 * 修复策略：
 * 1. 先指数退避重试 4 次（300→600→1200→2400ms），自动跨过资源未就绪的窗口。
 * 2. 若仍 10004，多半是内存登录缓存认为已连上但 SDK 实际已掉线/资源从未同步，
 *    此时清空本地缓存并重新登录，再最后试一次。
 * 3. 非 10004 的错误（如目标不可聊）立即上抛。
 */
export async function getOneConversation(
  sourceID: string,
  sessionType: number,
  maxRetry = 4,
): Promise<ConversationItem> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await imCall<ConversationItem>(IMMethods.GetOneConversation, { sourceID, sessionType })
    } catch (e) {
      lastErr = e
      const errMsg = (e as Error)?.message || ''
      const isResourceNotReady = errMsg.includes('10004')
      // 其它错误直接抛
      if (!isResourceNotReady) throw e
      // 资源未就绪：先等 SDK 自动恢复
      if (attempt < maxRetry) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)))
        continue
      }
      // 重试耗尽：清缓存、重新登录并等待资源同步完成后再最后试一次。
      // 否则 doLogin 的缓存复用分支会跳过同步等待，仍可能立即 10004。
      resetLoginCache()
      await ensureIMLogin()
      await waitForSync(5000)
      return await imCall<ConversationItem>(IMMethods.GetOneConversation, { sourceID, sessionType })
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('getOneConversation 重试/重登后仍失败')
}

function isSdkResourceNotReady(err: unknown): boolean {
  if (err instanceof IMCallError && (err.code === 10004 || err.code === 10005)) return true
  const text = err instanceof Error ? err.message : String(err || '')
  return text.includes('10004') || text.includes('10005')
}

/** OpenIM 把已关闭的 SQLite 包成 errCode=10005，原文里带 database is closed */
function isDatabaseClosedError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err || '')
  return /database is closed/i.test(text)
}

/**
 * 本地库不可用，需要 Logout→Login 重开。
 * 覆盖几类线上原文（都常被包成 10005 / 10006）：
 * - database is closed
 * - attempt to write a readonly database（journal/WAL、文件保护）
 * - initDB / unable to open database / no such file（目录在、.db 丢了或还没建好）
 * - InsertMessage failed
 */
export function isLocalDatabaseWriteError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err || '')
  return (
    isDatabaseClosedError(err) ||
    /readonly database/i.test(text) ||
    /disk i\/o error/i.test(text) ||
    /init\s*database|initdb failed|open db failed/i.test(text) ||
    /unable to open database file/i.test(text) ||
    /no such file or directory/i.test(text) ||
    (/insertmessage/i.test(text) && /failed/i.test(text))
  )
}

/** 本地库写失败时给用户的可行动提示，别再弹干巴巴的「发送失败」。 */
const LOCAL_WRITE_FAILURE_MESSAGE = '本地存储写入失败，请检查手机存储空间后重试'

/**
 * 新装的壳或刚重连时，本地库还没初始化完就拉历史，
 * SDK 会把 10004 包在 10005 里抛出来。先退避再重登，避免把原文弹给用户。
 */
async function callHistoryWhenReady(
  conversationID: string,
  count: number,
  startClientMsgID: string,
): Promise<{ messageList: MessageItem[]; isEnd: boolean }> {
  const run = () =>
    imCall<unknown>(IMMethods.GetAdvancedHistoryMessageList, {
      conversationID,
      count,
      startClientMsgID: startClientMsgID || '',
      lastMinSeq: 0,
      viewType: ViewType.History,
    }).then(normalizeHistoryResult)

  let lastErr: unknown
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      return await run()
    } catch (e) {
      lastErr = e
      if (isDatabaseClosedError(e) || !isSdkResourceNotReady(e) || attempt === 3) break
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
    }
  }
  if (isDatabaseClosedError(lastErr)) {
    try {
      await reopenClosedSdkDatabase()
      return await run()
    } catch (e) {
      if (isDatabaseClosedError(e) || isSdkResourceNotReady(e)) {
        throw new Error('聊天记录还在同步，请稍后再试')
      }
      throw e
    }
  }
  if (!isSdkResourceNotReady(lastErr)) throw lastErr
  resetLoginCache()
  await ensureIMLogin()
  await waitForSync(5000)
  try {
    return await run()
  } catch (e) {
    if (isSdkResourceNotReady(e)) throw new Error('聊天记录还在同步，请稍后再试')
    throw e
  }
}

export async function getHistoryMessages(
  conversationID: string,
  count = 20,
  startClientMsgID = '',
): Promise<{ messageList: MessageItem[]; isEnd: boolean }> {
  await groupRetention.sync([conversationID])
  const result = await callHistoryWhenReady(conversationID, count, startClientMsgID)
  const filtered = groupRetention.filter(conversationID, result.messageList)
  return { messageList: filtered, isEnd: result.isEnd || filtered.length < result.messageList.length }
}

/** 从新到旧分页拉出会话历史，供搜索 / 媒体页使用 */
export async function collectHistoryMessages(
  conversationID: string,
  maxCount = 400,
): Promise<MessageItem[]> {
  const pages: MessageItem[][] = []
  const seenCursor = new Set<string>()
  let startClientMsgID = ''
  let loaded = 0
  while (loaded < maxCount) {
    const { messageList, isEnd } = await getHistoryMessages(conversationID, 50, startClientMsgID)
    if (!messageList.length) break
    const fresh = messageList.filter((item) => {
      const id = item.clientMsgID
      if (!id || seenCursor.has(id)) return false
      seenCursor.add(id)
      return true
    })
    if (!fresh.length) break
    pages.push(fresh)
    loaded += fresh.length
    if (isEnd) break
    // 下一页从本页最旧的一条继续。H5 有时把新消息放在 [0]，固定取 [0] 会反复扫同一页，旧的「12」永远扫不到
    const next = oldestClientMsgID(fresh)
    if (!next || next === startClientMsgID) break
    startClientMsgID = next
  }
  return pages.flat()
}

/** 只清当前用户本端及云端副本，不影响其他人设备 */
export async function clearConversationMessages(conversationID: string): Promise<void> {
  // H5 client-sdk 没有 clearConversationAndDeleteAllMsg；调用不存在的方法会在
  // SDK 代理层抛出 "Cannot read properties of undefined (reading 'apply')"。
  // App 原生插件则继续使用已经验证可用的 ClearConversationAndDeleteAllMsg。
  const method = isApp()
    ? IMMethods.ClearConversationAndDeleteAllMsg
    : IMMethods.DeleteConversationAndDeleteAllMsg
  await imCall(method, conversationID)
}

/** 会话已全部读完时 OpenIM 报 hasReadSeq equal max，对调用方等价于成功 */
export async function markConversationRead(conversationID: string): Promise<void> {
  try {
    await imCall(IMMethods.MarkConversationMessageAsRead, conversationID)
  } catch (e) {
    if ((e as Error)?.message?.includes('hasReadSeq equal max')) return
    throw e
  }
}

// 消息撤回不再直连 OpenIM SDK：统一走后端 POST /im/messages/recall（服务端审计 + 同步），
// 见 src/api/im.ts 的 recallMessage。

export async function deleteLocalMessage(conversationID: string, clientMsgID: string): Promise<void> {
  try {
    await imCall(IMMethods.DeleteMessage, { conversationID, clientMsgID })
  } catch {
    await imCall(IMMethods.DeleteMessageFromLocalStorage, { conversationID, clientMsgID })
  }
}

export async function sendQuoteMessage(
  target: IMTarget,
  text: string,
  quote: MessageItem,
): Promise<MessageItem> {
  // App：CreateQuoteMessage 对 withForwardSnapshot 改写后的体极敏感（文字、图片都是）。
  // 同会话引用用清洗后的原消息创建；媒体副本保护只留给转发。
  // H5：仍走媒体副本保护，避免签名图过期后引用预览挂掉。
  const quoteForCreate = isApp()
    ? sanitizeMessageForNativeQuote(quote)
    : await protectReferencedMedia(quote)
  // SDK 的 createQuoteMessage 要求 message 是被引用消息的 JSON 字符串（QuoteMsgParams.message: string），
  // 直接传对象会被 JSON.parse 隐式转成 "[object Object]" 而报 errCode=10006。
  const paramsOf = (source: MessageItem) => ({ text, message: JSON.stringify(source) })
  // 1) 首选：清洗后的原消息（App）/ 媒体保护后的引用（H5 老图保命路径）
  try {
    const message = await imCall<MessageItem>(IMMethods.CreateQuoteMessage, paramsOf(quoteForCreate))
    return sendCreatedMessage(target, message)
  } catch (e) {
    if (!isNativeCreateResultError(e)) throw e
  }
  // 2) 最小字段集：只带身份 + 类型 + 远程预览，避开基座解析整包 PictureElem 失败
  try {
    const message = await imCall<MessageItem>(
      IMMethods.CreateQuoteMessage,
      paramsOf(minimalMessageForNativeQuote(quote)),
    )
    return sendCreatedMessage(target, message)
  } catch (e) {
    if (!isNativeCreateResultError(e)) throw e
  }
  // 3) 回退原消息再试（部分 App 基座吃不下 withForwardSnapshot 改写后的结构）
  try {
    const message = await imCall<MessageItem>(
      IMMethods.CreateQuoteMessage,
      paramsOf(cloneMessageForNativeQuote(quote)),
    )
    return sendCreatedMessage(target, message)
  } catch (e) {
    if (!isNativeCreateResultError(e)) throw e
    devWarn('[im] 原生 CreateQuoteMessage 不可用，降级为文本骨架 + quoteElem')
  }
  // 4) 彻底绕开原生 CreateQuoteMessage：用最基础的 createTextMessage 拿
  //    SDK 生成的 clientMsgID 与会话字段，再挂 quoteElem。文字/图片/视频都走这条。
  const message = await createQuoteFromTextMessage(text, quote)
  return sendCreatedMessage(target, message)
}

/**
 * 兜底构造引用消息：绕开原生 CreateQuoteMessage。
 * 个别 iOS 基座对任何入参都 resolve 空结果，表现为「所有类型的引用都发不出去」；
 * createTextMessage 是最基础的创建方法（普通文字消息依赖它，已验证可用），
 * 用它拿骨架与 clientMsgID，再手动挂 quoteElem。
 */
async function createQuoteFromTextMessage(text: string, quote: MessageItem): Promise<MessageItem> {
  const base = await imCall<MessageItem>(IMMethods.CreateTextMessage, text)
  const plain = plainNativeRecord(base as unknown as Record<string, unknown>)
  const quoted = slimQuotedMessage(quote)
  return {
    ...plain,
    contentType: MessageType.QuoteMessage,
    ContentType: MessageType.QuoteMessage,
    quoteElem: { text, quoteMessage: quoted },
    QuoteElem: { Text: text, QuoteMessage: quoted },
  } as unknown as MessageItem
}

export async function sendForwardMessage(target: IMTarget, source: MessageItem): Promise<MessageItem> {
  const protectedSource = await protectReferencedMedia(source)
  // H5 client-sdk expects MessageItem directly; the native plugin takes { message }.
  const message = await imCall<MessageItem>(
    IMMethods.CreateForwardMessage,
    isApp() ? { message: protectedSource } : protectedSource,
  )
  return sendCreatedMessage(target, message, {
    alreadyUploaded: mayContainForwardMedia(protectedSource.contentType),
  })
}

/** 原生 CreateQuoteMessage 吃的是原消息 JSON；勿改写 content/textElem 形态 */
function cloneMessageForNativeQuote(source: MessageItem): MessageItem {
  try {
    return JSON.parse(JSON.stringify(source)) as MessageItem
  } catch {
    return { ...source }
  }
}

function isRemoteHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

/** 清掉本机临时路径，只留 http(s)，避免 iOS CreateQuoteMessage 因死链路径返回空结果 */
function clearLocalPathFields(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value !== 'string' || !value) continue
    if (isRemoteHttpUrl(value)) continue
    obj[key] = ''
  }
}

function sanitizeMediaElem(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const elem = raw as Record<string, unknown>
  clearLocalPathFields(elem, [
    'sourcePath',
    'SourcePath',
    'soundPath',
    'SoundPath',
    'filePath',
    'FilePath',
    'videoPath',
    'VideoPath',
    'snapshotPath',
    'SnapshotPath',
  ])
}

function sanitizeMessageForNativeQuote(source: MessageItem): MessageItem {
  const plain = cloneMessageForNativeQuote(source)
  const bag = plain as unknown as Record<string, unknown>
  sanitizeMediaElem(bag.pictureElem ?? bag.PictureElem)
  sanitizeMediaElem(bag.soundElem ?? bag.SoundElem)
  sanitizeMediaElem(bag.videoElem ?? bag.VideoElem)
  sanitizeMediaElem(bag.fileElem ?? bag.FileElem)
  return plain
}

/** 创建仍失败时的兜底：只带身份与类型，图片只留一张远程缩略图 URL */
function minimalMessageForNativeQuote(source: MessageItem): MessageItem {
  const plain = sanitizeMessageForNativeQuote(source)
  const bag = plain as unknown as Record<string, unknown>
  const contentType = Number(bag.contentType ?? bag.ContentType ?? 0)
  const base: Record<string, unknown> = {
    clientMsgID: pickString(bag, ['clientMsgID', 'ClientMsgID', 'clientMsgId']),
    serverMsgID: pickString(bag, ['serverMsgID', 'ServerMsgID']),
    sendID: pickString(bag, ['sendID', 'SendID']),
    recvID: pickString(bag, ['recvID', 'RecvID']),
    groupID: pickString(bag, ['groupID', 'GroupID']),
    senderNickname: pickString(bag, ['senderNickname', 'SenderNickname']),
    senderFaceUrl: pickString(bag, ['senderFaceUrl', 'SenderFaceUrl']),
    contentType,
    ContentType: contentType,
    sessionType: Number(bag.sessionType ?? bag.SessionType ?? 0),
    sendTime: Number(bag.sendTime ?? bag.SendTime ?? 0),
    createTime: Number(bag.createTime ?? bag.CreateTime ?? 0),
  }
  if (contentType === MessageType.TextMessage || contentType === MessageType.AtTextMessage) {
    const text =
      pickString(
        (bag.textElem as Record<string, unknown>) ||
          (bag.TextElem as Record<string, unknown>) ||
          {},
        ['content', 'Content'],
      ) ||
      pickString(
        (bag.atTextElem as Record<string, unknown>) ||
          (bag.AtTextElem as Record<string, unknown>) ||
          {},
        ['text', 'Text'],
      )
    if (text) {
      base.textElem = { content: text }
      base.TextElem = { Content: text }
    }
    return base as unknown as MessageItem
  }
  if (contentType === MessageType.PictureMessage) {
    const pic =
      (bag.pictureElem as Record<string, unknown>) ||
      (bag.PictureElem as Record<string, unknown>) ||
      {}
    const info =
      (pic.sourcePicture as Record<string, unknown>) ||
      (pic.SourcePicture as Record<string, unknown>) ||
      (pic.snapshotPicture as Record<string, unknown>) ||
      (pic.SnapshotPicture as Record<string, unknown>) ||
      {}
    const url =
      pickString(info, ['url', 'Url', 'URL']) ||
      pickString(pic, ['sourcePath', 'SourcePath'])
    if (isRemoteHttpUrl(url)) {
      const picture = { url, type: pickString(info, ['type', 'Type']) || 'image/jpeg' }
      base.pictureElem = {
        sourcePath: '',
        sourcePicture: picture,
        bigPicture: picture,
        snapshotPicture: picture,
      }
      base.PictureElem = base.pictureElem
    }
    return base as unknown as MessageItem
  }
  return plain
}

async function protectReferencedMedia(source: MessageItem): Promise<MessageItem> {
  const snapshot = snapshotFromMessage(source)
  // 纯文本（101）等没有远程媒体：不能走 withForwardSnapshot。
  // 它会把 content 改成 JSON 字符串并重写 *Elem，部分 App 基座 CreateQuoteMessage 会直接返回空结果，
  // 表现为「原生 SDK 创建消息结果无效」（引用文字之前好好的就是被这步改坏的）。
  if (!mayContainForwardMedia(snapshot.contentType)) return cloneMessageForNativeQuote(source)
  const protectedSnapshot = await preserveForwardMedia(snapshot)
  if (protectedSnapshot.contentType !== snapshot.contentType) throw new Error('转发媒体保存结果无效')
  return withForwardSnapshot(source, protectedSnapshot)
}

export async function sendAtTextMessage(
  target: IMTarget,
  text: string,
  atUserIDList: string[],
  atUsersInfo: Array<{ atUserID: string; groupNickname: string }>,
): Promise<MessageItem> {
  // CreateTextAtMessage 官方参数只有 text / atUserIDList / atUsersInfo（及可选 quote）。
  // 不要传 isAtAll：App 原生桥会拒未知字段，表现为 @ 后发送失败。
  const message = await imCall<MessageItem>(IMMethods.CreateTextAtMessage, {
    text,
    atUserIDList,
    atUsersInfo,
  })
  return sendCreatedMessage(target, message)
}

/** OpenIM @所有人占位 ID */
export const OPENIM_AT_ALL_TAG = 'AtAllTag'

interface SendCreatedMessageOptions {
  /** 媒体文件已经上传并写入消息 URL，此时不能再让 SDK 查找本地文件并重复上传 */
  alreadyUploaded?: boolean
  /** 原生发送等待成功回调的超时（毫秒）。大文件（视频）走 OSS 上传时需比默认更久 */
  timeoutMs?: number
}

interface NativeSendResult {
  errCode: number
  errMsg?: string
  data?: unknown
}

interface NativeOpenIM {
  sendMessage?: (operationID: string, params: unknown, cb: (res: NativeSendResult) => void) => void
  sendMessageNotOss?: (operationID: string, params: unknown, cb: (res: NativeSendResult) => void) => void
}

function nativeOpenIM(): NativeOpenIM | null {
  try {
    return uni.requireNativePlugin('Tuoyun-OpenIMSDK') as NativeOpenIM | null
  } catch {
    return null
  }
}

function isSendProgressData(data: unknown): boolean {
  if (typeof data === 'number') return true
  if (typeof data === 'string' && /^\d+$/.test(data.trim())) return true
  if (data && typeof data === 'object' && !('contentType' in data) && ('progress' in data || 'current' in data)) {
    return true
  }
  return false
}

/** 原生进度回调也可能带 clientMsgID，但不能当成发送完成 */
function isCompleteSentMessage(msg: MessageItem | null): msg is MessageItem {
  if (!msg?.clientMsgID || !msg.contentType) return false
  if (msg.status === MessageStatus.Sending || msg.status === MessageStatus.Failed) return false
  return true
}

/** OpenIM FullPath API 只要 POSIX 绝对路径，不能传 uni.chooseImage 的 file:// / _doc 临时路径 */
function toNativeFullPath(filePath: string): string {
  let path = filePath || ''
  try {
    const converted = plus?.io?.convertLocalFileSystemURL?.(path)
    if (converted) path = converted
  } catch {
    /* H5 或转换失败时沿用原路径 */
  }
  return path.replace(/^file:\/\//, '')
}

async function sendCreatedMessage(
  target: IMTarget,
  message: MessageItem,
  options: SendCreatedMessageOptions = {},
): Promise<MessageItem> {
  // sessionType=3 必须填 groupID，填 recvID 会被 OpenIM 拒绝
  const method = options.alreadyUploaded ? IMMethods.SendMessageNotOss : IMMethods.SendMessage
  const groupID =
    target.sessionType === SessionType.Single
      ? ''
      : toOpenIMID(target.groupId || groupIdFromConversationId(target.conversationId))
  let recvID = target.sessionType === SessionType.Single ? toOpenIMID(target.recvId) : ''
  if (target.sessionType === SessionType.Single && !recvID) {
    recvID = peerIdFromSingleConversation(target.conversationId, imUserId.value)
  }
  // 安卓原生有时只读消息体上的 id；iOS 桥返回值可能只读，补字段必须新建发送对象。
  if (isApp()) {
    const plain = plainNativeRecord(message as unknown as Record<string, unknown>) as unknown as MessageItem
    message = {
      ...plain,
      ...(groupID && !plain.groupID ? { groupID } : {}),
      ...(recvID && !plain.recvID ? { recvID } : {}),
      ...((groupID || recvID) && !plain.sessionType ? { sessionType: target.sessionType } : {}),
    }
  }
  const params = {
    recvID,
    groupID,
    message,
    offlinePushInfo: {
      title: '你收到一条新消息',
      desc: '',
      ex: '',
      iOSPushSound: '+1',
      iOSBadgeCount: true,
    },
  }
  // 视频单次就很久，少重试；文字/图片断线后同一条 clientMsgID 再发，避免连上之前就标失败
  const perAttemptTimeout = options.timeoutMs ?? 20000
  const attempts = (options.timeoutMs ?? 0) >= 60000 ? 2 : 4
  const epoch = loginEpoch
  let lastErr: unknown
  let reopenedDatabase = false
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (epoch !== loginEpoch) break
    try {
      if (isApp()) {
        return await sendOnAppNative(method, params, message.clientMsgID, perAttemptTimeout, false)
      }
      const sent = await imCall<unknown>(method, params)
      if (!isMessageItem(sent) || sent.status === MessageStatus.Failed) {
        throw new Error('发送失败')
      }
      return sent
    } catch (err) {
      lastErr = err
      const code = err instanceof IMCallError ? err.code : undefined
      // 超时/断线后同一条重试，SDK 常回 10204：对面其实已收到，按成功处理
      if (isDuplicateSendError(err)) {
        return { ...message, status: MessageStatus.Succeed }
      }
      if (epoch !== loginEpoch) break
      // 库已经关了，原地重试还是 GetGroups database is closed。先重开再发这一条。
      if (!reopenedDatabase && attempt < attempts - 1 && isLocalDatabaseWriteError(err)) {
        reopenedDatabase = true
        try {
          await reopenClosedSdkDatabase()
        } catch (recoverErr) {
          lastErr = recoverErr instanceof Error ? recoverErr : lastErr
          break
        }
        if (epoch !== loginEpoch) break
        continue
      }
      if (code !== undefined && DISCONNECT_CODES.has(code)) connected = false
      const canRetry =
        attempt < attempts - 1 &&
        epoch === loginEpoch &&
        code !== undefined &&
        RETRYABLE_SEND_CODES.has(code)
      if (!canRetry) break
      const keepGoing = await waitToRetrySend(attempt, epoch)
      if (!keepGoing) break
    }
  }
  const failure = lastErr instanceof Error ? lastErr : new Error('发送失败')
  if (epoch === loginEpoch) {
    if (isApp()) reportAppNativeSendFailure(params, message.clientMsgID, failure)
    else reportTargetSendFailure(target, message, 'send', 'send_failed', failure.message)
  }
  // 上报保留原始错误便于排查；给用户看的换成可行动提示，别让他对着「发送失败」发呆。
  if (isLocalDatabaseWriteError(failure)) failure.message = LOCAL_WRITE_FAILURE_MESSAGE
  throw failure
}

/**
 * 基于 IMTarget + 已创建消息的失败上报（best-effort），用于 web/非原生发送路径。
 */
function reportTargetSendFailure(
  target: IMTarget,
  message: MessageItem,
  stage: string,
  failCode: string,
  failMessage?: string,
): void {
  try {
    const isGroup = target.sessionType !== SessionType.Single
    void reportSendFailure({
      clientMsgId: message?.clientMsgID,
      peerType: isGroup ? 'group' : 'c2c',
      targetId: isGroup ? target.groupId : target.recvId,
      contentType: message?.contentType,
      stage,
      failCode,
      failMessage: failMessage || '发送失败',
      platform: 'h5',
    })
  } catch {
    /* 上报构造异常也不得影响发送流程 */
  }
}

/**
 * App 原生发送失败/超时统一上报（best-effort）。
 * params 内含 recvID/groupID（OpenIM id）与 message.contentType，据此还原会话类型与目标。
 * 超时归 timeout 阶段（视频大文件超时的主要形态），其余归 send。
 */
function reportAppNativeSendFailure(params: unknown, clientMsgID: string, err?: Error): void {
  try {
    const p = (params ?? {}) as { recvID?: string; groupID?: string; message?: { contentType?: number } }
    const groupID = String(p.groupID ?? '').trim()
    const recvID = String(p.recvID ?? '').trim()
    const message = String(err?.message ?? '').trim()
    const isTimeout = /超时|timeout/i.test(message)
    void reportSendFailure({
      clientMsgId: clientMsgID,
      peerType: groupID ? 'group' : 'c2c',
      targetId: groupID || recvID,
      contentType: p.message?.contentType,
      stage: isTimeout ? 'timeout' : 'send',
      failCode: isTimeout ? 'send_timeout' : 'send_failed',
      failMessage: message || '发送失败',
      platform: 'app',
    })
  } catch {
    /* 上报构造异常也不得影响发送流程 */
  }
}

/**
 * App 原生 sendMessage 会多次回调：先 onProgress（errCode=0 + 数字），再 onSuccess。
 * polyfill 第一次 errCode=0 就 resolve，真正成功被丢掉，会话 latestMsg 不会更新。
 */
function sendOnAppNative(
  method: IMMethods,
  params: unknown,
  clientMsgID: string,
  timeoutMs?: number,
  reportFailure = true,
): Promise<MessageItem> {
  const sdk = nativeOpenIM()
  if (!sdk) throw new Error(APP_NATIVE_PLUGIN_MISSING)
  const useNotOss = method === IMMethods.SendMessageNotOss
  if (useNotOss ? typeof sdk.sendMessageNotOss !== 'function' : typeof sdk.sendMessage !== 'function') {
    throw new Error(APP_NATIVE_PLUGIN_MISSING)
  }
  const waitMs = timeoutMs ?? (useNotOss ? 15000 : 60000)
  const isVideo =
    !!params &&
    typeof params === 'object' &&
    (params as { message?: { contentType?: number } }).message?.contentType === MessageType.VideoMessage
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (ok: boolean, payload?: unknown, err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      offOk()
      offFail()
      if (ok) {
        const msg = coerceMessage(payload)
        if (isCompleteSentMessage(msg)) {
          resolve(msg)
          return
        }
      }
      const failure = err || new Error('发送失败')
      if (reportFailure) reportAppNativeSendFailure(params, clientMsgID, failure)
      reject(failure)
    }
    const timer = setTimeout(() => {
      if (isVideo) devWarn('[video][send] TIMEOUT 未收到成功/失败回调', { clientMsgID, waitMs })
      finish(false, undefined, new IMCallError(SEND_WAIT_TIMEOUT, '发送超时'))
    }, waitMs)
    const offOk = onIMEvent<MessageItem>(IMEvents.SendMessageSuccess, (msg) => {
      const parsed = coerceMessage(msg)
      if (parsed?.clientMsgID === clientMsgID && isCompleteSentMessage(parsed)) finish(true, parsed)
    })
    const offFail = onIMEvent<unknown>(IMEvents.SendMessageFailed, (err) => {
      const failed = unwrapRawMessage(err)
      const failedId = failed ? pickString(failed, ['clientMsgID', 'ClientMsgID', 'clientMsgId']) : ''
      // 没有 id 的失败事件不能算到当前这条上，否则群里偶发会把其实发出去的消息标成失败
      if (!failed || !failedId || failedId !== clientMsgID) return
      const errMsg = pickString(failed, ['errMsg', 'ErrMsg', 'message', 'errDlt'])
      const errCode = pickFiniteNumber(failed, ['errCode', 'ErrCode'])
      finish(false, err, new IMCallError(errCode ?? 0, errMsg || '发送失败'))
    })
    const onNative = (res: NativeSendResult) => {
      let data = res?.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data) as unknown
        } catch {
          /* 保持原字符串 */
        }
      }
      if (isVideo) {
        const m = coerceMessage(data)
        devLog('[video][send] native cb', {
          errCode: res?.errCode,
          dataType: typeof res?.data,
          isProgress: isSendProgressData(data),
          status: m?.status,
          contentType: m?.contentType,
        })
      }
      if (isSendProgressData(data)) return
      if (res?.errCode !== 0) {
        finish(false, undefined, toIMError(res, method))
        return
      }
      const msg = coerceMessage(data)
      if (!msg || msg.status === MessageStatus.Sending) return
      if (msg.status === MessageStatus.Failed) {
        finish(false, msg, new Error('发送失败'))
        return
      }
      if (!isCompleteSentMessage(msg)) return
      finish(true, msg)
    }
    if (useNotOss) {
      sdk.sendMessageNotOss!(IMSDK.uuid(), params, onNative)
    } else {
      sdk.sendMessage!(IMSDK.uuid(), params, onNative)
    }
  })
}

export async function sendTextMessage(target: IMTarget, text: string): Promise<MessageItem> {
  const message = await imCall<MessageItem>(IMMethods.CreateTextMessage, text)
  return sendCreatedMessage(target, message)
}

/**
 * 好友名片消息（OpenIM contentType=108）。
 * cardElem.userID 必须是 OpenIM 用户 ID（业务 UUID 去横线），
 * 业务 UUID 冗余进 ex，接收端解析后可直接跳好友详情页。
 */
export async function sendCardMessage(
  target: IMTarget,
  card: { businessUserId: string; nickname: string; avatar: string },
): Promise<MessageItem> {
  const message = await imCall<MessageItem>(IMMethods.CreateCardMessage, {
    userID: card.businessUserId.replace(/-/g, '').toLowerCase(),
    nickname: card.nickname || '',
    faceURL: card.avatar || '',
    ex: JSON.stringify({ businessUserId: card.businessUserId }),
  })
  return sendCreatedMessage(target, message)
}

/**
 * 图片消息。app 端交给原生插件读本地全路径并自行上传；
 * web 端没有 createImageMessageFromFullPath，先把文件传到对象存储换 URL 再发。
 */
function ensurePictureSourceUrl(message: MessageItem, url: string): MessageItem {
  if (!url || pictureUrlOf(message)) return message
  const picture = {
    uuid: IMSDK.uuid(),
    type: 'image/jpeg',
    size: 0,
    width: 0,
    height: 0,
    url,
  }
  return {
    ...message,
    pictureElem: {
      ...(message.pictureElem || {}),
      sourcePath: url,
      sourcePicture: picture,
      bigPicture: picture,
      snapshotPicture: picture,
    },
  }
}

/** 路径/文件名是否像聊天图片（含华为截图名被截断、HEIC） */
export function isLikelyChatImage(pathOrName: string): boolean {
  const s = String(pathOrName || '').trim()
  if (!s) return false
  const lower = s.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|heic|heif)(\?|#|$)/i.test(lower)) return true
  // 华为截图：Screenshot_yyyyMMdd_HHmmss_包名… 扩展名偶发在 UI 里被截掉
  if (/screenshot[_-]?\d{8}/i.test(lower)) return true
  if (/(^|[\\/])img[_-]?\d{10,}/i.test(lower)) return true
  return false
}

function compressLocalChatImage(localPath: string): Promise<string> {
  return new Promise((resolve) => {
    uni.compressImage({
      src: localPath,
      quality: 85,
      success: (res) => resolve(res.tempFilePath || localPath),
      fail: () => resolve(localPath),
    })
  })
}

function toAppFileUrlForIo(path: string): string {
  if (/^(file|content|http|https|blob):/i.test(path)) return path
  try {
    const converted = plus?.io?.convertLocalFileSystemURL?.(path)
    if (converted) return converted
  } catch {
    /* ignore */
  }
  return path.startsWith('/') ? `file://${path}` : path
}

/** 华为相册常给 content://，OpenIM FullPath/Upload 读不到；拷到 _doc 再发 */
function copyAppImageToDoc(srcPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const io = plus?.io as {
      resolveLocalFileSystemURL?: (
        url: string,
        ok: (entry: {
          copyTo: (
            parent: unknown,
            newName: string,
            success: (e: { fullPath?: string; toLocalURL?: () => string }) => void,
            fail: (err: unknown) => void,
          ) => void
        }) => void,
        bad: (err: unknown) => void,
      ) => void
    }
    if (!io?.resolveLocalFileSystemURL) {
      reject(new Error('无法读取图片'))
      return
    }
    const destName = `chat_img_${Date.now()}.jpg`
    io.resolveLocalFileSystemURL(
      toAppFileUrlForIo(srcPath),
      (entry) => {
        io.resolveLocalFileSystemURL!(
          '_doc/',
          (dir) => {
            entry.copyTo(
              dir,
              destName,
              (copied) => {
                const local =
                  (typeof copied.toLocalURL === 'function' ? copied.toLocalURL() : '') ||
                  copied.fullPath ||
                  `_doc/${destName}`
                resolve(local)
              },
              reject,
            )
          },
          reject,
        )
      },
      reject,
    )
  })
}

/**
 * App 发图前把路径收成原生可读文件。
 * 华为 / 鸿蒙 4：content:// 必须先物化到沙盒，否则 FullPath / 上传都会挂。
 */
async function prepareAppChatImagePath(filePath: string): Promise<string> {
  try {
    const { isPreparedChatImage, materializeAppLocalImage } = await import('@/utils/file-upload')
    // 选图阶段已经物化过的路径不要再压一次；content:// 仍会走进 materialize
    if (isPreparedChatImage(filePath)) return filePath
    return await materializeAppLocalImage(filePath)
  } catch (e) {
    console.warn('[image] materialize 失败，走旧压缩/拷贝', (e as Error)?.message || e)
  }
  const compressed = await compressLocalChatImage(filePath)
  if (compressed && !/^content:/i.test(compressed)) return compressed
  if (!/^content:/i.test(filePath) && compressed) return compressed
  try {
    return await copyAppImageToDoc(filePath)
  } catch (err) {
    console.warn('[image] copyTo _doc 失败', (err as Error)?.message || err)
    return compressed || filePath
  }
}

/** 列表缩略图长边。只影响新发出的图，旧消息仍用消息里已有的地址。 */
const CHAT_THUMB_EDGE = 360

interface ChatThumb {
  url: string
  width: number
  height: number
}

/** 长边收到 edge 以内，短边按原比例走。微信缩略图也是这样，只改一边会在安卓/鸿蒙上拉变形。 */
function fitLongEdge(width: number, height: number, edge: number): { width: number; height: number } {
  const long = Math.max(width, height)
  if (width <= 0 || height <= 0 || long <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, edge / long)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function sameImageAspect(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  const left = a.width / a.height
  const right = b.width / b.height
  return Math.abs(left - right) / right < 0.04
}

/**
 * 缩略图宽高一起传给 compressImage。
 * 只传 compressedWidth 时，安卓和鸿蒙会把高度也收成这个值，或保持原高度只改宽度，气泡再用 scaleToFill 一铺就变形。
 * 压完再量一次成品；比例和目标差太多就丢掉，列表退回原图。
 */
function compressChatThumbnail(
  localPath: string,
): Promise<{ path: string; width: number; height: number } | null> {
  return imageSizeOf(localPath).then((origin) => {
    const target = fitLongEdge(origin.width, origin.height, CHAT_THUMB_EDGE)
    if (!target.width || !target.height) return null
    if (origin.width <= CHAT_THUMB_EDGE && origin.height <= CHAT_THUMB_EDGE) return null
    return new Promise((resolve) => {
      const compress = uni.compressImage as (options: {
        src: string
        quality?: number
        compressedWidth?: number
        compressedHeight?: number
        success?: (res: { tempFilePath?: string }) => void
        fail?: () => void
      }) => void
      compress({
        src: localPath,
        quality: 55,
        compressedWidth: target.width,
        compressedHeight: target.height,
        success: (res) => {
          const next = res.tempFilePath || ''
          if (!next || next === localPath) {
            resolve(null)
            return
          }
          imageSizeOf(next)
            .then((measured) => {
              const size =
                measured.width > 0 && measured.height > 0
                  ? measured
                  : target
              if (!sameImageAspect(size, target)) {
                resolve(null)
                return
              }
              resolve({ path: next, width: size.width, height: size.height })
            })
            .catch(() => resolve(null))
        },
        fail: () => resolve(null),
      })
    })
  })
}

/** 缩略图上传失败不影响原图发送。压完没有变小、或比例被压坏，就放弃，列表继续用原图。 */
async function uploadChatThumbnail(localPath: string): Promise<ChatThumb | null> {
  try {
    const thumb = await compressChatThumbnail(localPath)
    if (!thumb) return null
    const thumbFull = toNativeFullPath(thumb.path)
    const originFull = toNativeFullPath(localPath)
    const [thumbBytes, originBytes] = await Promise.all([
      nativeFileSize(thumbFull),
      nativeFileSize(originFull),
    ])
    if (originBytes > 0 && thumbBytes >= originBytes * 0.85) return null
    const uploaded = await uploadFileFromPath(thumbFull, `thumb_${Date.now()}.jpg`, 'image/jpeg')
    return { url: uploaded.url, width: thumb.width, height: thumb.height }
  } catch (e) {
    console.warn('[image] 缩略图上传失败，列表继续用原图', (e as Error)?.message || e)
    return null
  }
}

function h5ThumbnailFile(file: File): Promise<{ file: File; width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return Promise.resolve(null)
  }
  return createImageBitmap(file)
    .then(
      (bitmap) =>
        new Promise<{ file: File; width: number; height: number } | null>((resolve) => {
          const scale = Math.min(1, CHAT_THUMB_EDGE / Math.max(bitmap.width, 1))
          const width = Math.max(1, Math.round(bitmap.width * scale))
          const height = Math.max(1, Math.round(bitmap.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            bitmap.close?.()
            resolve(null)
            return
          }
          ctx.drawImage(bitmap, 0, 0, width, height)
          bitmap.close?.()
          canvas.toBlob(
            (blob) => {
              if (!blob || blob.size >= file.size * 0.85) {
                resolve(null)
                return
              }
              resolve({
                file: new File([blob], `thumb_${Date.now()}.jpg`, { type: 'image/jpeg' }),
                width,
                height,
              })
            },
            'image/jpeg',
            0.7,
          )
        }),
    )
    .catch(() => null)
}

/** 把宽高和独立缩略图写进待发消息。原图字段保持不动，SDK 仍按本地路径上传原图。 */
function stampOutgoingPicture(
  message: MessageItem,
  size: { width: number; height: number },
  thumb: ChatThumb | null,
): MessageItem {
  const elem = message.pictureElem
  if (!elem?.sourcePicture || !elem.bigPicture || !elem.snapshotPicture) return message
  const sized = <T extends { width?: number; height?: number }>(pic: T): T => ({
    ...pic,
    width: pic.width || size.width || 0,
    height: pic.height || size.height || 0,
  })
  const snapshot = thumb?.url
    ? {
        ...elem.snapshotPicture,
        uuid: elem.snapshotPicture.uuid || IMSDK.uuid(),
        type: elem.snapshotPicture.type || 'image/jpeg',
        size: elem.snapshotPicture.size || 0,
        width: thumb.width || size.width || 0,
        height: thumb.height || size.height || 0,
        url: thumb.url,
      }
    : sized(elem.snapshotPicture)
  return {
    ...message,
    pictureElem: {
      ...elem,
      sourcePicture: sized(elem.sourcePicture),
      bigPicture: sized(elem.bigPicture),
      snapshotPicture: snapshot,
    },
  }
}

/** App：FullPath 失败时压成 jpeg 再走 URL（华为 content URI / HEIC / 无后缀常见） */
async function sendImageMessageViaUpload(
  target: IMTarget,
  filePath: string,
  preset?: { prepared?: boolean; thumb?: ChatThumb | null; size?: { width: number; height: number } },
): Promise<MessageItem> {
  const prepared = preset?.prepared ? filePath : await prepareAppChatImagePath(filePath)
  const fullPath = toNativeFullPath(prepared)
  const uploaded = await uploadFileFromPath(fullPath, `img_${Date.now()}.jpg`, 'image/jpeg')
  const size = preset?.size?.width ? preset.size : await imageSizeOf(prepared).catch(() => ({ width: 0, height: 0 }))
  const thumb = preset?.thumb === undefined ? await uploadChatThumbnail(prepared) : preset.thumb
  const picture = {
    uuid: IMSDK.uuid(),
    type: 'image/jpeg',
    size: uploaded.size,
    url: uploaded.url,
    width: size.width,
    height: size.height,
  }
  const snapshot = thumb?.url
    ? {
        uuid: IMSDK.uuid(),
        type: 'image/jpeg',
        size: 0,
        url: thumb.url,
        width: thumb.width || size.width,
        height: thumb.height || size.height,
      }
    : picture
  const message = await imCall<MessageItem>(IMMethods.CreateImageMessageByURL, {
    sourcePath: uploaded.url,
    sourcePicture: picture,
    bigPicture: picture,
    snapshotPicture: snapshot,
  })
  const drafted = stampOutgoingPicture(ensurePictureSourceUrl(message, uploaded.url), size, thumb)
  return sendCreatedMessage(target, drafted, {
    alreadyUploaded: true,
  })
}

export async function sendImageMessage(target: IMTarget, filePath: string): Promise<MessageItem> {
  let message: MessageItem
  if (isApp()) {
    // 先物化成可读本地文件，再 FullPath；华为 content:// 直接 FullPath 必挂
    const prepared = await prepareAppChatImagePath(filePath)
    const fullPath = toNativeFullPath(prepared)
    const [thumb, size] = await Promise.all([
      uploadChatThumbnail(prepared),
      imageSizeOf(prepared).catch(() => ({ width: 0, height: 0 })),
    ])
    try {
      message = await imCall<MessageItem>(IMMethods.CreateImageMessageFromFullPath, fullPath)
      // 原图仍由 SDK 上传；缩略图已经是 http 地址，发送时不应再被当成本地文件重传
      message = stampOutgoingPicture(message, size, thumb)
      return sendCreatedMessage(target, message, { alreadyUploaded: false })
    } catch (e) {
      console.warn('[image] FullPath 失败，改走压缩上传', (e as Error)?.message || e)
      return sendImageMessageViaUpload(target, prepared, { prepared: true, thumb, size })
    }
  }
  // H5：HEIC / WebP / 超大图先压 jpeg；WebP 原样上传易触发 OSS Content-Type 签名不一致（表现像跨域）
  const { prepareImageFile } = await import('@/utils/file-upload')
  let file = await pathToFile(filePath)
  try {
    file = await prepareImageFile(file, { fileName: `img_${Date.now()}.jpg`, maxBytes: 2_000_000 })
  } catch (e) {
    console.warn('[image] H5 预处理失败，尝试原图', (e as Error)?.message || e)
  }
  if (/webp/i.test(file.type) || /\.webp$/i.test(file.name)) {
    throw new Error('暂不支持直接发送 WebP，请换一张图片')
  }
  const [url, size, thumbFile] = await Promise.all([
    uploadFile(file),
    imageSizeOf(filePath),
    h5ThumbnailFile(file),
  ])
  let thumb: ChatThumb | null = null
  if (thumbFile) {
    try {
      thumb = { url: await uploadFile(thumbFile.file), width: thumbFile.width, height: thumbFile.height }
    } catch (e) {
      console.warn('[image] H5 缩略图上传失败，列表继续用原图', (e as Error)?.message || e)
    }
  }
  const picture = {
    uuid: IMSDK.uuid(),
    type: file.type || 'image/jpeg',
    size: file.size,
    url,
    width: size.width,
    height: size.height,
  }
  const snapshot = thumb?.url
    ? {
        uuid: IMSDK.uuid(),
        type: 'image/jpeg',
        size: thumbFile?.file.size || 0,
        url: thumb.url,
        width: thumb.width || size.width,
        height: thumb.height || size.height,
      }
    : picture
  message = await imCall<MessageItem>(IMMethods.CreateImageMessageByURL, {
    sourcePath: url,
    sourcePicture: picture,
    bigPicture: picture,
    snapshotPicture: snapshot,
  })
  // Create 回包偶发缺 pictureElem.url，气泡会空白；强制写回已上传地址，并保留独立缩略图
  const drafted = stampOutgoingPicture(ensurePictureSourceUrl(message, url), size, thumb)
  return sendCreatedMessage(target, drafted, { alreadyUploaded: true })
}

function videoDurationSeconds(duration: number): number {
  return Math.max(1, Math.round(duration > 1000 ? duration / 1000 : duration))
}

async function snapshotOfVideo(videoPath: string, snapshotPath = '', durationSec = 0): Promise<string> {
  if (snapshotPath) return toNativeFullPath(snapshotPath)
  const fullPath = toNativeFullPath(videoPath)
  // Android：按时间点取帧，避开片头黑场（OpenIM getVideoCover 多半是首帧）
  const androidCover = captureAndroidVideoFrame(fullPath, durationSec)
  if (androidCover) return androidCover
  try {
    const cover = await Promise.race([
      IMSDK.getVideoCover?.(fullPath),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
    ])
    const path =
      typeof cover === 'string'
        ? cover
        : cover && typeof cover === 'object'
          ? pickString(cover as Record<string, unknown>, ['path', 'snapshotPath', 'coverPath'])
          : ''
    if (path) return toNativeFullPath(path)
  } catch {
    /* 封面失败仍发视频 */
  }
  return ''
}

/** Android MediaMetadataRetriever：在 duration 约 10% 处截帧，写入临时 jpg。 */
function captureAndroidVideoFrame(videoPath: string, durationSec = 0): string {
  // #ifdef APP-PLUS
  try {
    const os = plus.os?.name || ''
    if (!/android/i.test(os) || !videoPath) return ''
    const MediaMetadataRetriever = plus.android.importClass('android.media.MediaMetadataRetriever') as unknown as {
      new (): {
        setDataSource: (path: string) => void
        extractMetadata: (key: number) => string
        getFrameAtTime: (timeUs: number, option: number) => unknown
        release: () => void
      }
      METADATA_KEY_DURATION: number
      OPTION_CLOSEST_SYNC: number
    }
    const Bitmap = plus.android.importClass('android.graphics.Bitmap') as unknown as {
      CompressFormat: { JPEG: unknown }
    }
    const File = plus.android.importClass('java.io.File') as unknown as new (path: string) => {
      getAbsolutePath: () => string
    }
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream') as unknown as new (
      file: unknown,
    ) => {
      close: () => void
    }
    const retriever = new MediaMetadataRetriever()
    retriever.setDataSource(videoPath.replace(/^file:\/\//, ''))
    const durationMs = Number(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION) || 0)
    const seconds = durationSec > 0 ? durationSec : durationMs / 1000
    const seekSec = videoSnapshotTime(seconds)
    const timeUs = Math.max(0, Math.floor(seekSec * 1_000_000))
    const bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
    if (!bitmap) {
      retriever.release()
      return ''
    }
    const docRoot = plus.io.convertLocalFileSystemURL('_doc') || ''
    const outPath = `${docRoot.replace(/\/$/, '')}/video_cover_${Date.now()}.jpg`
    const file = new File(outPath.replace(/^file:\/\//, ''))
    const stream = new FileOutputStream(file)
    const bmp = bitmap as {
      compress: (format: unknown, quality: number, out: unknown) => boolean
      recycle: () => void
    }
    bmp.compress(Bitmap.CompressFormat.JPEG, 85, stream)
    stream.close()
    bmp.recycle()
    retriever.release()
    const abs = file.getAbsolutePath()
    return abs ? toNativeFullPath(abs) : ''
  } catch {
    return ''
  }
  // #endif
  return ''
}

/**
 * 转发/展示缺封面时：远程先下载，再用原生 getVideoCover 取帧。
 * getVideoInfo 在多数 App 基座不返回 thumbTempFilePath，不能当封面用。
 */
export async function extractVideoCoverForForward(videoUrl: string): Promise<string> {
  if (!videoUrl) return ''
  const local = await downloadRemoteVideoForCover(videoUrl)
  if (!local) return ''
  return snapshotOfVideo(toNativeFullPath(local))
}

interface VideoSnapshotFile {
  file: File
  width: number
  height: number
}

/**
 * H5 的 chooseVideo 通常不返回 thumbTempFilePath，因此必须由浏览器解码本地视频并截帧。
 * 取 10% 处（最多 1 秒）的画面，避开不少视频开头的黑帧；长边限制为 720，控制上传大小。
 */
async function createH5VideoSnapshot(videoFile: File): Promise<VideoSnapshotFile | null> {
  // #ifdef H5
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(videoFile)
    let settled = false
    let timer = 0

    const finish = (result: VideoSnapshotFile | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      URL.revokeObjectURL(objectUrl)
      resolve(result)
    }

    const capture = () => {
      const sourceWidth = video.videoWidth
      const sourceHeight = video.videoHeight
      if (!sourceWidth || !sourceHeight) {
        finish(null)
        return
      }
      const scale = Math.min(1, 720 / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        finish(null)
        return
      }
      try {
        context.drawImage(video, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              finish(null)
              return
            }
            finish({
              file: new File([blob], `video_cover_${Date.now()}.jpg`, { type: 'image/jpeg' }),
              width,
              height,
            })
          },
          'image/jpeg',
          0.82,
        )
      } catch {
        finish(null)
      }
    }

    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    // iOS 把 1px 隐藏视频的解码跳过，videoWidth 一直是 0，封面失败后整条视频发不出去
    video.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;z-index:-1'
    video.onerror = () => finish(null)
    video.onloadedmetadata = () => {
      const seekOrCapture = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0
        const target = videoSnapshotTime(duration)
        let done = false
        const once = () => {
          if (done) return
          done = true
          capture()
        }
        if (target > 0.01) {
          const seekTimer = window.setTimeout(once, 1500)
          video.onseeked = () => {
            window.clearTimeout(seekTimer)
            once()
          }
          try {
            video.currentTime = target
          } catch {
            window.clearTimeout(seekTimer)
            once()
          }
        } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          once()
        } else {
          video.onloadeddata = once
        }
      }
      const played = video.play()
      if (played && typeof played.then === 'function') {
        played.then(() => {
          video.pause()
          seekOrCapture()
        }).catch(() => seekOrCapture())
      } else {
        seekOrCapture()
      }
    }
    timer = window.setTimeout(() => finish(null), 10000)
    document.body.appendChild(video)
    video.src = objectUrl
    video.load()
  })
  // #endif
  // #ifndef H5
  return null
  // #endif
}

/** 浏览器解不出画面时仍给一张封面，避免视频因为缺封面整条发不出去 */
function createFallbackVideoCover(): Promise<VideoSnapshotFile | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve(null)
  context.fillStyle = '#1c1c1c'
  context.fillRect(0, 0, 320, 180)
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null)
          return
        }
        resolve({
          file: new File([blob], `video_cover_${Date.now()}.jpg`, { type: 'image/jpeg' }),
          width: 320,
          height: 180,
        })
      },
      'image/jpeg',
      0.8,
    )
  })
}

function persistTempMedia(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    uni.saveFile({
      tempFilePath: filePath,
      success: (res) => resolve(res.savedFilePath || filePath),
      fail: () => resolve(filePath),
    })
  })
}

function videoElemSendable(message: MessageItem): boolean {
  return !!(message.videoElem?.videoUrl || message.videoElem?.videoPath)
}

function videoElemHasSnapshot(message: MessageItem): boolean {
  return !!parseVideoMeta(message).snapshotUrl
}

async function sendUploadedVideoMessage(
  target: IMTarget,
  videoPath: string,
  seconds: number,
  snapshotPath: string,
): Promise<MessageItem> {
  const uploaded = await uploadFileFromPath(videoPath, `video_${Date.now()}.mp4`, 'video/mp4')
  let snapshotUrl = ''
  let snapshotSize = 0
  let snapshotWidth = 0
  let snapshotHeight = 0
  if (snapshotPath) {
    const cover = await uploadFileFromPath(snapshotPath, `video_cover_${Date.now()}.jpg`, 'image/jpeg')
    snapshotUrl = cover.url
    snapshotSize = cover.size
    const dimensions = await imageSizeOf(snapshotPath)
    snapshotWidth = dimensions.width
    snapshotHeight = dimensions.height
  }
  if (!snapshotUrl) throw new Error('视频封面上传失败')
  // App 原生桥部分版本只认 PascalCase；两套字段一起传，避免创建出的消息丢封面。
  const message = await imCall<MessageItem>(IMMethods.CreateVideoMessageByURL, {
    videoPath: '',
    duration: seconds,
    videoType: 'mp4',
    snapshotPath: '',
    videoUUID: IMSDK.uuid(),
    videoUrl: uploaded.url,
    VideoUrl: uploaded.url,
    VideoURL: uploaded.url,
    videoSize: uploaded.size,
    snapshotUUID: IMSDK.uuid(),
    snapshotSize,
    snapshotUrl,
    SnapshotUrl: snapshotUrl,
    SnapshotURL: snapshotUrl,
    snapshotWidth,
    snapshotHeight,
  })
  const ensured = keepRemoteVideoUrls(message, uploaded.url, snapshotUrl)
  const sent = await sendCreatedMessage(target, ensured, { alreadyUploaded: true, timeoutMs: 30000 })
  return keepRemoteVideoUrls(sent, uploaded.url, snapshotUrl)
}

/** 原生发送回调偶发丢掉已上传的 snapshotUrl，回填后气泡才能用 <image> 封面。 */
function keepRemoteVideoUrls(message: MessageItem, videoUrl: string, snapshotUrl: string): MessageItem {
  const meta = parseVideoMeta(message)
  const nextUrl = preferRemoteMediaUrl(meta.url, videoUrl)
  const nextSnap = preferRemoteMediaUrl(meta.snapshotUrl, snapshotUrl)
  if (nextUrl === meta.url && nextSnap === meta.snapshotUrl) return message
  return {
    ...message,
    videoElem: {
      ...(message.videoElem || {}),
      videoUrl: nextUrl,
      snapshotUrl: nextSnap,
    } as MessageItem['videoElem'],
  }
}

/**
 * 视频消息。app 端先落到可访问的本地文件并走对象存储 URL 发送，
 * 避免 CreateVideoMessageFromFullPath 缺路径时原生上传一直等到超时。
 */
export async function sendVideoMessage(
  target: IMTarget,
  filePath: string,
  duration: number,
  snapshotPath = '',
): Promise<MessageItem> {
  const seconds = videoDurationSeconds(duration)
  if (isApp()) {
    // 原生取帧插件对 chooseVideo 的原始临时路径兼容性最好，保存后的 _doc 路径作为后备。
    let snap = await snapshotOfVideo(filePath, snapshotPath, seconds)
    const saved = await persistTempMedia(filePath)
    const videoPath = toNativeFullPath(saved)
    if (!snap) snap = await snapshotOfVideo(videoPath, '', seconds)
    if (!snap) throw new Error('无法提取视频封面，请重新选择视频')
    devLog('[video][send] app 路径', {
      filePath,
      saved,
      videoPath,
      snap,
      seconds,
    })
    try {
      return await sendUploadedVideoMessage(target, videoPath, seconds, snap)
    } catch (uploadErr) {
      devWarn('[video][send] 上传后按 URL 发失败，改走原生 FullPath', (uploadErr as Error)?.message)
    }
    let message: MessageItem
    try {
      message = await imCall<MessageItem>(IMMethods.CreateVideoMessageFromFullPath, {
        videoFullPath: videoPath,
        videoPath,
        duration: seconds,
        snapshotPath: snap,
      })
    } catch {
      message = await imCall<MessageItem>(IMMethods.CreateVideoMessageFromFullPath, videoPath)
    }
    if (!videoElemSendable(message) || !videoElemHasSnapshot(message)) {
      return sendUploadedVideoMessage(target, videoPath, seconds, snap)
    }
    return sendCreatedMessage(target, message, { timeoutMs: 180000 })
  }
  const rawFile = await pathToFile(filePath)
  const file = rawFile.type.startsWith('video/')
    ? rawFile
    : new File([rawFile], rawFile.name && rawFile.name.includes('.') ? rawFile.name : `video_${Date.now()}.mp4`, {
        type: 'video/mp4',
      })
  let snapshotUrl = ''
  let snapshotSize = 0
  let snapshotWidth = 0
  let snapshotHeight = 0
  if (snapshotPath) {
    try {
      const coverFile = await pathToFile(snapshotPath)
      snapshotUrl = await uploadFile(coverFile)
      snapshotSize = coverFile.size
      const dimensions = await imageSizeOf(snapshotPath)
      snapshotWidth = dimensions.width
      snapshotHeight = dimensions.height
    } catch (error) {
      devWarn('[video][cover] H5 自带封面上传失败，将重新截帧', (error as Error)?.message)
    }
  }
  if (!snapshotUrl) {
    const generated = await createH5VideoSnapshot(file)
    if (generated) {
      try {
        snapshotUrl = await uploadFile(generated.file)
        snapshotSize = generated.file.size
        snapshotWidth = generated.width
        snapshotHeight = generated.height
      } catch (error) {
        devWarn('[video][cover] H5 截帧上传失败', (error as Error)?.message)
      }
    } else {
      devWarn('[video][cover] H5 无法从所选视频提取画面')
    }
  }
  if (!snapshotUrl) {
    const fallback = await createFallbackVideoCover()
    if (fallback) {
      snapshotUrl = await uploadFile(fallback.file)
      snapshotSize = fallback.file.size
      snapshotWidth = fallback.width
      snapshotHeight = fallback.height
    }
  }
  if (!snapshotUrl) throw new Error('无法生成视频封面，请确认浏览器支持该视频格式')
  const rawType = file.type.toLowerCase()
  const videoType = rawType.includes('webm') ? 'webm' : rawType.includes('ogg') ? 'ogg' : 'mp4'
  const url = await uploadFile(file)
  const message = await imCall<MessageItem>(IMMethods.CreateVideoMessageByURL, {
    videoPath: '',
    duration: seconds,
    videoType,
    snapshotPath: '',
    videoUUID: IMSDK.uuid(),
    videoUrl: url,
    VideoUrl: url,
    VideoURL: url,
    videoSize: file.size,
    snapshotUUID: IMSDK.uuid(),
    snapshotSize,
    snapshotUrl,
    SnapshotUrl: snapshotUrl,
    SnapshotURL: snapshotUrl,
    snapshotWidth,
    snapshotHeight,
  })
  const ensured = keepRemoteVideoUrls(message, url, snapshotUrl)
  const sent = await sendCreatedMessage(target, ensured, { alreadyUploaded: true })
  return keepRemoteVideoUrls(sent, url, snapshotUrl)
}

export async function sendVoiceMessage(
  target: IMTarget,
  filePath: string,
  duration: number,
): Promise<MessageItem> {
  const seconds = Math.max(1, Math.round(duration > 120 ? duration / 1000 : duration))
  if (isApp()) {
    const soundPath = toNativeFullPath(filePath)
    let message: MessageItem
    try {
      message = await imCall<MessageItem>(IMMethods.CreateSoundMessageFromFullPath, {
        soundPath,
        duration: seconds,
      })
    } catch {
      try {
        message = await imCall<MessageItem>(
          IMMethods.CreateSoundMessageFromFullPath,
          soundPath,
          seconds,
        )
      } catch {
        // iOS 播放依赖后缀/封装；用 m4a（AAC-in-MP4）比裸 .aac 稳
        const uploaded = await uploadFileFromPath(soundPath, `voice_${Date.now()}.m4a`, 'audio/mp4')
        message = await imCall<MessageItem>(IMMethods.CreateSoundMessageByURL, {
          uuid: IMSDK.uuid(),
          soundPath: '',
          sourceUrl: uploaded.url,
          dataSize: uploaded.size,
          duration: seconds,
          soundType: 'm4a',
        })
        return sendCreatedMessage(target, message, { alreadyUploaded: true })
      }
    }
    return sendCreatedMessage(target, message)
  }
  const file = await pathToFile(filePath)
  // 网页端（尤其 Chrome）录的是 opus-in-webm，iOS AVPlayer 放不出来；
  // 改走业务后端，由后端统一转码成 m4a 后再按 URL 发。转码链路异常时回退 OpenIM 直传。
  let url = ''
  let dataSize = file.size
  let soundType = file.type
  try {
    const up = await uploadVoiceViaApi(file, file.name || `voice_${Date.now()}.webm`)
    if (up?.url) {
      url = up.url
      dataSize = up.size || file.size
      soundType = up.format ? `audio/${up.format}` : 'audio/mp4'
    }
  } catch {
    /* 回退 OpenIM 直传 */
  }
  if (!url) url = await uploadFile(file)
  const message = await imCall<MessageItem>(IMMethods.CreateSoundMessageByURL, {
    uuid: IMSDK.uuid(),
    soundPath: '',
    sourceUrl: url,
    dataSize,
    duration: seconds,
    soundType,
  })
  return sendCreatedMessage(target, message, { alreadyUploaded: true })
}

function fileContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return table[ext] || 'application/octet-stream'
}

/** 系统相册里的文件，uni.getFileInfo 经常读不到大小，再用 plus.io 量一次。 */
function nativeFileSize(fullPath: string): Promise<number> {
  return new Promise((resolve) => {
    uni.getFileInfo({
      filePath: fullPath,
      success: (res) => {
        const size = Number(res.size) || 0
        if (size > 0) resolve(size)
        else plusFileSize(fullPath).then(resolve)
      },
      fail: () => {
        plusFileSize(fullPath).then(resolve)
      },
    })
  })
}

function plusFileSize(fullPath: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const io = plus?.io as { resolveLocalFileSystemURL?: PlusResolveLocalFile } | undefined
      if (!io?.resolveLocalFileSystemURL) {
        resolve(0)
        return
      }
      const url = /^(file|content):\/\//.test(fullPath) ? fullPath : `file://${fullPath}`
      io.resolveLocalFileSystemURL(
        url,
        (entry: { file?: (ok: (file: { size?: number }) => void, bad: () => void) => void }) => {
          if (!entry.file) {
            resolve(0)
            return
          }
          entry.file(
            (file) => resolve(Number(file.size) || 0),
            () => resolve(0),
          )
        },
        () => resolve(0),
      )
    } catch {
      resolve(0)
    }
  })
}

async function uploadFileFromPath(
  fullPath: string,
  fileName: string,
  contentType: string,
): Promise<{ url: string; size: number }> {
  const size = await nativeFileSize(fullPath)
  if (size <= 0) throw new Error('文件无效')
  const res = await imCall<{ url: string }>(IMMethods.UploadFile, {
    name: fileName,
    contentType,
    uuid: IMSDK.uuid(),
    filepath: fullPath,
    filePath: fullPath,
  })
  if (!res?.url) throw new Error('文件上传失败')
  return { url: res.url, size }
}

/** 转发视频缺封面时，把本地截帧图上传成可访问的 snapshotUrl。 */
export async function uploadLocalImageForForward(localPath: string): Promise<{ url: string; size: number }> {
  const fullPath = toNativeFullPath(localPath)
  // #ifdef H5
  if (localPath.startsWith('data:')) {
    const file = await dataUrlToFile(localPath, `video_cover_${Date.now()}.jpg`)
    const url = await uploadFile(file)
    return { url, size: file.size }
  }
  // #endif
  return uploadFileFromPath(fullPath, `video_cover_${Date.now()}.jpg`, 'image/jpeg')
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' })
}

async function uploadFile(file: File): Promise<string> {
  // 空 type 时浏览器/SDK 常补成 octet-stream 或按扩展名猜 MIME，与 OSS 预签名不一致会 403（表现像跨域）
  const contentType =
    (file.type || '').trim() || fileContentType(file.name) || 'application/octet-stream'
  const res = await imCall<{ url: string }>(IMMethods.UploadFile, {
    name: file.name,
    contentType,
    uuid: IMSDK.uuid(),
    file,
  })
  if (!res?.url) throw new Error('文件上传失败')
  return res.url
}

/**
 * 文件消息。App 先上传换 URL 再发：原生 FullPath 发送会在自己上传时找不到相册文件，
 * 气泡一直停在文件名并报发送失败。H5 同样先上传再发。
 */
export async function sendFileMessage(
  target: IMTarget,
  filePath: string,
  fileName: string,
): Promise<MessageItem> {
  const safeName = fileName.trim() || '文件'
  if (isApp()) {
    const fullPath = toNativeFullPath(filePath)
    try {
      return await sendUploadedFileMessage(target, fullPath, safeName)
    } catch (error) {
      devWarn('[file][send] 上传后按 URL 发失败，改走原生 FullPath', (error as Error)?.message)
      try {
        return await sendFullPathFileMessage(target, fullPath, safeName)
      } catch {
        throw error
      }
    }
  }
  const file = await pathToFile(filePath, safeName)
  const url = await uploadFile(file)
  const message = await imCall<MessageItem>(IMMethods.CreateFileMessageByURL, {
    filePath: '',
    fileName: safeName,
    uuid: IMSDK.uuid(),
    sourceUrl: url,
    fileSize: file.size,
    fileType: file.type,
  })
  return sendCreatedMessage(target, ensureFileSourceUrl(message, url, safeName, file.size), {
    alreadyUploaded: true,
  })
}

async function sendUploadedFileMessage(
  target: IMTarget,
  fullPath: string,
  fileName: string,
): Promise<MessageItem> {
  const contentType = fileContentType(fileName)
  const uploaded = await uploadFileFromPath(fullPath, fileName, contentType)
  const uuid = IMSDK.uuid()
  const message = await imCall<MessageItem>(IMMethods.CreateFileMessageByURL, {
    filePath: '',
    FilePath: '',
    fileName,
    FileName: fileName,
    uuid,
    UUID: uuid,
    sourceUrl: uploaded.url,
    SourceUrl: uploaded.url,
    fileSize: uploaded.size,
    FileSize: uploaded.size,
    fileType: contentType,
    FileType: contentType,
  })
  return sendCreatedMessage(
    target,
    ensureFileSourceUrl(message, uploaded.url, fileName, uploaded.size),
    { alreadyUploaded: true },
  )
}

async function sendFullPathFileMessage(
  target: IMTarget,
  fullPath: string,
  fileName: string,
): Promise<MessageItem> {
  let message: MessageItem
  try {
    message = await imCall<MessageItem>(IMMethods.CreateFileMessageFromFullPath, fullPath, fileName)
  } catch {
    message = await imCall<MessageItem>(IMMethods.CreateFileMessageFromFullPath, {
      filePath: fullPath,
      fileName,
    })
  }
  return sendCreatedMessage(target, message)
}

function ensureFileSourceUrl(
  message: MessageItem,
  url: string,
  fileName: string,
  fileSize: number,
): MessageItem {
  if (fileSourceUrlOf(message)) return message
  return {
    ...message,
    fileElem: {
      ...(message.fileElem || {}),
      fileName,
      sourceUrl: url,
      fileSize,
    },
  }
}

/** 图片 URL 直发（收藏的图片 / 已上传图片不再二次上传） */
export async function sendImageUrlMessage(target: IMTarget, url: string): Promise<MessageItem> {
  const picture = { uuid: IMSDK.uuid(), type: 'image/jpeg', size: 0, width: 0, height: 0, url }
  const message = await imCall<MessageItem>(IMMethods.CreateImageMessageByURL, {
    sourcePath: url,
    sourcePicture: picture,
    bigPicture: picture,
    snapshotPicture: picture,
  })
  return sendCreatedMessage(target, ensurePictureSourceUrl(message, url), { alreadyUploaded: true })
}

/**
 * 选本地文件，返回 { path, name } 列表（一次最多 count 个）。
 * app 端用 OpenIM 原生插件的文件选择器（原生仅支持单选）；
 * 小程序用 chooseMessageFile；H5 用 chooseFile，两者支持 count 多选。
 */
export async function chooseLocalFiles(
  count = 1,
): Promise<Array<{ path: string; name: string }>> {
  if (isApp()) {
    const path = await IMSDK.pickFile()
    if (!path) throw new Error('未选择文件')
    const idx = path.lastIndexOf('/')
    return [{ path, name: idx >= 0 ? path.slice(idx + 1) : '文件' }]
  }
  const anyUni = uni as unknown as {
    chooseMessageFile?: (opt: unknown) => void
    chooseFile?: (opt: unknown) => void
  }
  const pick = (fn: (opt: unknown) => void) =>
    new Promise<Array<{ path: string; name?: string }>>((resolve) => {
      fn({
        count,
        type: 'file',
        success: (res: { tempFiles?: Array<{ path: string; name?: string }> }) =>
          resolve(res.tempFiles || []),
        fail: () => resolve([]),
      })
    })
  let picked: Array<{ path: string; name?: string }> = []
  if (typeof anyUni.chooseMessageFile === 'function') {
    picked = await pick(anyUni.chooseMessageFile)
  }
  if (!picked.length && typeof anyUni.chooseFile === 'function') {
    picked = await pick(anyUni.chooseFile)
  }
  if (!picked.length) throw new Error('当前平台暂不支持选择文件')
  return picked.map((f) => ({ path: f.path, name: f.name || '文件' }))
}

async function pathToFile(path: string, fileName = ''): Promise<File> {
  const blob = await (await fetch(path)).blob()
  // MediaRecorder 的 type 带 codecs 参数（audio/webm;codecs=opus），不能原样拼进文件名
  const subtype = (blob.type.split('/')[1] || '').split(';')[0].trim()
  const ext = blob.type.startsWith('audio/') && subtype === 'mp4' ? 'm4a' : subtype || 'bin'
  const name = fileName.trim() || `${Date.now()}.${ext}`
  return new File([blob], name, { type: blob.type || 'application/octet-stream' })
}

function imageSizeOf(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    uni.getImageInfo({
      src: path,
      success: (info) => resolve({ width: info.width, height: info.height }),
      fail: () => resolve({ width: 0, height: 0 }),
    })
  })
}

// ---------------------------------------------------------------------------
// OpenIM 结构 → 项目视图结构
// ---------------------------------------------------------------------------

/**
 * 与 OpenIM 服务端一致的会话 ID 规则。收到的消息只有消息体，
 * 要靠它归位到某个会话。
 */
export function conversationIdOf(message: MessageItem): string {
  const raw = message as MessageItem & Record<string, unknown>
  const fromSdk = String(raw.conversationID ?? raw.ConversationID ?? '').trim()
  if (fromSdk) return fromSdk
  const sessionType = Number(raw.sessionType ?? raw.SessionType ?? 0)
  const sendID = String(raw.sendID ?? raw.SendID ?? '').trim()
  const recvID = String(raw.recvID ?? raw.RecvID ?? '').trim()
  const groupID = String(raw.groupID ?? raw.GroupID ?? '').trim()
  if (sessionType === SessionType.Single) {
    if (!sendID || !recvID) return ''
    return `si_${[sendID, recvID].sort().join('_')}`
  }
  if (sessionType === SessionType.Notification) {
    return `sn_${sendID}_${recvID}`
  }
  if (!groupID) return ''
  return `sg_${groupID}`
}

export function targetOf(conversation: ConversationItem | Conversation): IMTarget {
  if ('conversationID' in conversation) {
    return {
      conversationId: conversation.conversationID,
      sessionType: conversation.conversationType,
      recvId: conversation.userID,
      groupId: conversation.groupID || groupIdFromConversationId(conversation.conversationID),
    }
  }
  return {
    conversationId: conversation.id,
    sessionType: conversation.type === 'group' ? SessionType.Group : SessionType.Single,
    recvId: conversation.peerUserId || '',
    groupId: conversation.groupId || groupIdFromConversationId(conversation.id),
  }
}

function conversationNumericField(item: ConversationItem, camel: string, pascal: string): number {
  const raw = item as ConversationItem & Record<string, unknown>
  const value = raw[camel] ?? raw[pascal]
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** App 原生桥偶发 PascalCase / 字符串 / 数字布尔，统一成 true/false */
function conversationBoolField(item: ConversationItem, camel: string, pascal: string): boolean {
  const raw = item as ConversationItem & Record<string, unknown>
  const value = raw[camel] ?? raw[pascal]
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'True'
}

export function toConversation(item: ConversationItem): Conversation {
  const raw = item as ConversationItem & Record<string, unknown>
  const conversationID = String(raw.conversationID ?? raw.ConversationID ?? '')
  const conversationType = Number(raw.conversationType ?? raw.ConversationType ?? SessionType.Single)
  const isGroup = conversationType !== SessionType.Single
  const groupId =
    String(raw.groupID ?? raw.GroupID ?? '') || groupIdFromConversationId(conversationID)
  const remark = isGroup ? groupRemarkFromEx(conversationEx(item)) : ''
  const unreadCount = conversationNumericField(item, 'unreadCount', 'UnreadCount')
  const groupAtType = conversationNumericField(item, 'groupAtType', 'GroupAtType')
  const atType = effectiveGroupAtType(groupAtType, unreadCount)
  const showName = String(raw.showName ?? raw.ShowName ?? '')
  const faceURL = String(raw.faceURL ?? raw.FaceURL ?? '')
  const latestMsg = (raw.latestMsg ?? raw.LatestMsg) as ConversationItem['latestMsg']
  const latestMsgSendTime = Number(raw.latestMsgSendTime ?? raw.LatestMsgSendTime ?? 0)
  const recvMsgOpt = conversationNumericField(item, 'recvMsgOpt', 'RecvMsgOpt')
  const latest = coerceMessage(latestMsg)
  const latestRemoved = groupRetention.removed(conversationID, latest)
  let userID = String(raw.userID ?? raw.UserID ?? '')
  // App 原生偶发不带 userID，备注覆盖和发消息都依赖 peer，从 si_ 会话 id 补回来
  if (!isGroup && !userID) {
    userID = peerIdFromSingleConversation(conversationID, imUserId.value)
  }
  return {
    id: conversationID,
    type: isGroup ? 'group' : 'private',
    title: remark || showName,
    avatar:
      faceURL ||
      (isGroup ? APP_CONFIG.defaultGroupAvatarUrl : APP_CONFIG.defaultAvatarUrl),
    lastMessage: latestRemoved ? '' : summarize(latestMsg),
    lastMessageAt: latestRemoved ? '' : toISOTime(latestMsgSendTime),
    lastMessageSeq: retentionSeq(latest) || undefined,
    lastMessageId: latest?.clientMsgID || undefined,
    unreadCount: latestRemoved ? 0 : groupRetention.unread(conversationID, latest, unreadCount),
    pinned: conversationBoolField(item, 'isPinned', 'IsPinned'),
    pinnedMessage: pinnedMessageFromEx(conversationEx(item)),
    recvMsgOpt,
    peerUserId: userID || undefined,
    groupId: groupId || undefined,
    groupAtType: latestRemoved ? 0 : groupAtType,
    highlightTags: latestRemoved ? [] : highlightTagsOf(atType, false),
  }
}

export function toChatMessage(rawItem: MessageItem): ChatMessage {
  // 历史/实时推送都可能带 PascalCase；统一先归一再取 pictureElem，避免群图空白
  const item = coerceMessage(rawItem) || rawItem
  const notificationKind = notificationKindOf(item.contentType)
  const inviteFromCustom =
    Number(item.contentType) === MessageType.CustomMessage
      ? parseGroupInvitePayload(customMessageDataOf(item))
      : null
  let content = inviteFromCustom ? JSON.stringify(inviteFromCustom) : extractContent(item)
  const rawType = toAppMessageType(Number(item.contentType))
  // App 原生桥偶发 contentType 丢失/类型错标，图片会变成 text + file:// 路径；按 content 再收敛一次
  let type: AppMessageType = inviteFromCustom
    ? 'groupInvite'
    : ((resolveQuoteType(rawType, content) as AppMessageType) || rawType)
  // CustomMessage：兜底再从 content 识别
  if (type !== 'groupInvite' && Number(item.contentType) === MessageType.CustomMessage) {
    const invite = parseGroupInvitePayload(content)
    if (invite) {
      type = 'groupInvite'
      content = JSON.stringify(invite)
    }
  }
  const fromIMAdmin = item.sendID === 'imAdmin' || item.senderNickname === 'imAdmin'
  // 历史：建群欢迎语曾由 imAdmin 以文本气泡下发；归一为系统提示，避免假用户头像
  if (type === 'text' && fromIMAdmin && content.trim() === GROUP_CREATED_WELCOME_TEXT) {
    type = 'system'
  }
  const isPurgeTip = type === 'text' && fromIMAdmin && isGroupPurgeTipText(content)
  if (isPurgeTip) type = 'system'
  // 图片：气泡优先缩略图。原图放进 fallback / sourceUrl，加载失败或点预览时再用。
  const imageMeta = type === 'image' ? pictureMetaOf(item) : null
  const videoSize = type === 'video' ? videoPosterSizeOf(item) : null
  const displayContent = imageMeta?.displayUrl || content
  const imageFallbacks =
    type === 'image'
      ? pictureRemoteCandidates(item)
          .map((url) => listThumbnailUrl(url))
          .filter(
            (url, index, all) =>
              url !== displayContent && all.indexOf(url) === index,
          )
      : []
  return {
    id: item.clientMsgID,
    conversationId: conversationIdOf(item),
    senderId: item.sendID,
    senderAvatar: item.senderFaceUrl || undefined,
    senderNickname: item.senderNickname || undefined,
    type,
    content: displayContent,
    imageFallbacks: imageFallbacks.length ? imageFallbacks : undefined,
    thumbUrl: imageMeta?.thumbUrl,
    sourceUrl: imageMeta?.sourceUrl,
    width: imageMeta?.width || videoSize?.width,
    height: imageMeta?.height || videoSize?.height,
    createdAt: toISOTime(item.sendTime),
    systemEventKey:
      imNotificationEventKey(item) ||
      (isPurgeTip ? `group-purge:${item.groupID || ''}:${item.clientMsgID}` : '') ||
      undefined,
    notificationKind: notificationKind || undefined,
    quote: quotePreviewOf(item),
    hasRead: messageIsRead(item),
    seq: seqOf(item) || undefined,
    status:
      item.status === MessageStatus.Failed
        ? 'failed'
        : item.status === MessageStatus.Sending
          ? 'sending'
          : 'sent',
  }
}

/** 单聊已读标记：App 原生桥可能把布尔编成字符串，统一容错 */
function messageIsRead(item: MessageItem): boolean {
  const raw = (item as { isRead?: unknown }).isRead
  return raw === true || raw === 'true'
}

function toAppMessageType(contentType: number): AppMessageType {
  switch (Number(contentType)) {
    case MessageType.TextMessage:
    case MessageType.AtTextMessage:
    case MessageType.QuoteMessage:
      return 'text'
    case MessageType.PictureMessage:
      return 'image'
    case MessageType.VoiceMessage:
      return 'voice'
    case MessageType.CardMessage:
      return 'card'
    case MessageType.VideoMessage:
      return 'video'
    case MessageType.FileMessage:
      return 'file'
    case MessageType.CustomMessage:
      return 'system'
    default:
      return 'system'
  }
}

/** 从 OpenIM CustomMessage(110) 各端字段取出 data 字符串 */
function customMessageDataOf(item: MessageItem): string {
  const raw = item as MessageItem & Record<string, unknown>
  const elem = (raw.customElem ?? raw.CustomElem) as Record<string, unknown> | undefined
  if (elem) {
    const data = elem.data ?? elem.Data
    if (typeof data === 'string' && data) return data
  }
  const fromContent = jsonContentField(item.content, 'data')
  if (fromContent) return fromContent
  if (typeof item.content === 'string' && item.content.trim()) {
    const text = item.content.trim()
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        if (typeof parsed.data === 'string') return parsed.data
        // H5 偶发直接把业务 JSON 放在 content
        if (parsed.businessKey === 'group_invite' || parsed.BusinessKey === 'group_invite') {
          return text
        }
      } catch {
        /* ignore */
      }
    }
  }
  return ''
}

/** 解析入群邀请自定义消息 payload（兼容 camel / Pascal） */
export function parseGroupInvitePayload(raw: unknown): {
  token: string
  groupId: string
  groupName: string
  groupAvatar: string
  memberCount: number
} | null {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (!obj) return null
  const key = String(obj.businessKey ?? obj.BusinessKey ?? '')
  if (key !== 'group_invite') return null
  const token = String(obj.token ?? obj.Token ?? '').trim()
  const groupId = String(obj.groupId ?? obj.GroupId ?? obj.groupID ?? obj.GroupID ?? '').trim()
  if (!token || !groupId) return null
  return {
    token,
    groupId,
    groupName: String(obj.groupName ?? obj.GroupName ?? '群聊'),
    groupAvatar: String(obj.groupAvatar ?? obj.GroupAvatar ?? ''),
    memberCount: Number(obj.memberCount ?? obj.MemberCount ?? 0) || 0,
  }
}

function jsonContentField(raw: unknown, key: string): string {
  if (raw && typeof raw === 'object' && key in raw) {
    const value = (raw as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : ''
  }
  if (typeof raw !== 'string' || !raw) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && key in parsed) {
      const value = (parsed as Record<string, unknown>)[key]
      return typeof value === 'string' ? value : ''
    }
  } catch {
    /* content 不是 JSON 时按纯文本用 */
  }
  return raw
}

function jsonSoundMeta(raw: unknown): { path: string; duration: number } {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const nestedRaw = obj.soundElem ?? obj.SoundElem
    if (nestedRaw && typeof nestedRaw === 'object') {
      const nested = jsonSoundMeta(nestedRaw)
      if (nested.path || nested.duration) return nested
    }
    // App 原生桥偶发 PascalCase：SourceUrl / SoundPath / Duration
    const path = pickString(obj, [
      'sourceUrl',
      'SourceUrl',
      'sourceURL',
      'SourceURL',
      'soundPath',
      'SoundPath',
      'path',
      'Path',
      'url',
      'Url',
    ])
    return { path, duration: Number(obj.duration ?? obj.Duration ?? 0) }
  }
  if (typeof raw === 'string' && raw) {
    try {
      return jsonSoundMeta(JSON.parse(raw))
    } catch {
      return { path: '', duration: 0 }
    }
  }
  return { path: '', duration: 0 }
}

/** 语音地址：优先远程 URL，兼容 soundElem / SoundElem */
export function soundMetaOf(item: MessageItem | Record<string, unknown>): { path: string; duration: number } {
  const raw = item as Record<string, unknown>
  const fromElem = jsonSoundMeta(raw.soundElem ?? raw.SoundElem)
  const fromContent = jsonSoundMeta(raw.content)
  const path =
    preferRemoteMediaUrl(fromElem.path, fromContent.path) || fromElem.path || fromContent.path
  return { path, duration: fromElem.duration || fromContent.duration }
}

function jsonPictureUrl(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const pictures = [obj.sourcePicture, obj.SourcePicture, obj.bigPicture, obj.BigPicture, obj.snapshotPicture, obj.SnapshotPicture]
    for (const picture of pictures) {
      if (picture && typeof picture === 'object') {
        const url = pickString(picture as Record<string, unknown>, ['url', 'Url', 'URL'])
        if (url) return url
      }
    }
    if (typeof obj.sourcePath === 'string' && obj.sourcePath) return obj.sourcePath
    if (typeof obj.url === 'string' && obj.url) return obj.url
  }
  if (typeof raw !== 'string' || !raw) return ''
  try {
    return jsonPictureUrl(JSON.parse(raw))
  } catch {
    return looksLikeImageUrl(raw) ? raw : ''
  }
}

function pictureInfoUrl(elem: unknown, keys: string[]): string {
  if (!elem || typeof elem !== 'object') return ''
  const obj = elem as Record<string, unknown>
  for (const key of keys) {
    const picture = obj[key]
    if (!picture || typeof picture !== 'object') continue
    const url = pickString(picture as Record<string, unknown>, ['url', 'Url', 'URL'])
    if (url) return url
  }
  return ''
}

/** 图片消息的候选地址：气泡优先缩略图（对齐微信列表），失败再降级原图。 */
function pictureCandidateList(item: MessageItem): string[] {
  const elem = item.pictureElem as unknown as Record<string, unknown> | undefined
  const pascal = (item as unknown as Record<string, unknown>).PictureElem
  const raw = [
    pictureInfoUrl(elem, ['snapshotPicture', 'SnapshotPicture']),
    pictureInfoUrl(pascal, ['snapshotPicture', 'SnapshotPicture']),
    pictureInfoUrl(elem, ['sourcePicture', 'SourcePicture']),
    pictureInfoUrl(elem, ['bigPicture', 'BigPicture']),
    pictureInfoUrl(pascal, ['sourcePicture', 'SourcePicture']),
    pictureInfoUrl(pascal, ['bigPicture', 'BigPicture']),
    jsonPictureUrl(item.content),
    item.pictureElem?.sourcePath,
    typeof item.content === 'string' ? item.content : '',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') continue
    const url = candidate.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/**
 * 可跨端访问（http(s)/blob）的图片候选地址。原图排第一，缩略图在后：
 * 原图对象偶发缺失或上传失败时，前端可据此降级重试，而不是留一个空白框。
 */
export function pictureRemoteCandidates(item: MessageItem): string[] {
  return pictureCandidateList(item).filter(
    (u) => /^https?:\/\//i.test(u) || u.startsWith('blob:'),
  )
}

/** 气泡和预览用原图。缩略图 snapshot 只有一两百像素，拉大以后就是马赛克。 */
function pictureUrlOf(item: MessageItem): string {
  const candidates = pictureCandidateList(item)
  const remote = candidates.find((u) => /^https?:\/\//i.test(u) || u.startsWith('blob:'))
  if (remote) return remote
  // H5：本地路径不可用；App：允许本地路径用于发送中预览
  if (uni.getSystemInfoSync().uniPlatform === 'web') return ''
  const local = candidates.find((u) => looksLikeImageUrl(u))
  return local || candidates[0] || ''
}

function readPictureBox(picture: unknown): { url: string; width: number; height: number } {
  if (!picture || typeof picture !== 'object') return { url: '', width: 0, height: 0 }
  const obj = picture as Record<string, unknown>
  const width = Number(obj.width ?? obj.Width ?? 0)
  const height = Number(obj.height ?? obj.Height ?? 0)
  return {
    url: pickString(obj, ['url', 'Url', 'URL']),
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  }
}

/**
 * 列表优先用和原图同比例的缩略图。点开走 1280 中图，保存和转发仍用原图。
 * 旧消息三个地址相同时不假装有缩略图，但宽高仍然带上，避免气泡再下载一次只为量尺寸。
 */
function pictureMetaOf(item: MessageItem): {
  displayUrl: string
  thumbUrl?: string
  sourceUrl?: string
  width?: number
  height?: number
} {
  const elem = item.pictureElem
  const snap = readPictureBox(elem?.snapshotPicture)
  const source = readPictureBox(elem?.sourcePicture)
  const big = readPictureBox(elem?.bigPicture)
  const sourceUrl = source.url || big.url
  const distinctThumb = snap.url && snap.url !== sourceUrl ? snap.url : ''
  const sourceBox = source.width > 0 && source.height > 0 ? source : big
  // 只信和原图同一比例的缩略图。安卓/鸿蒙只压宽度时缩略图会被拉扁，这种直接显示原图。
  const thumbTrustworthy =
    !!distinctThumb &&
    snap.width > 0 &&
    snap.height > 0 &&
    (sourceBox.width <= 0 || sourceBox.height <= 0 || sameImageAspect(snap, sourceBox))
  const original = sourceUrl || pictureUrlOf(item)
  // 旧消息缩略图和原图是同一个地址。列表改要 OpenIM 的等比小图，点开仍用原图。
  const displayUrl = thumbTrustworthy ? distinctThumb : listThumbnailUrl(original)
  const shown = thumbTrustworthy ? snap : sourceBox
  const box = shown.width > 0 && shown.height > 0 ? shown : null
  return {
    displayUrl,
    thumbUrl: displayUrl || undefined,
    sourceUrl: original && original !== displayUrl ? original : undefined,
    width: box ? box.width : undefined,
    height: box ? box.height : undefined,
  }
}

function videoPosterSizeOf(item: MessageItem): { width?: number; height?: number } {
  const raw = item.videoElem as { snapshotWidth?: number; snapshotHeight?: number } | undefined
  const width = Number(raw?.snapshotWidth) || 0
  const height = Number(raw?.snapshotHeight) || 0
  if (width > 0 && height > 0) return { width, height }
  return {}
}

function quotePreviewOf(item: MessageItem): ChatMessage['quote'] {
  const quoted = quotedMessageOf(item)
  if (!quoted) return undefined
  const type = resolveQuotedAppType(quoted)
  const rawContent = extractContent(quoted)
  const rawQuoted = quoted as MessageItem & Record<string, unknown>
  const clientMsgId = String(
    quoted.clientMsgID || rawQuoted.ClientMsgID || rawQuoted.clientMsgId || '',
  ).trim()
  return {
    senderNickname: quoted.senderNickname || pickQuotedNickname(quoted) || '',
    thumbUrl: quoteThumbOf(type, rawContent, quoted.senderFaceUrl || undefined) || undefined,
    content: quoteSummaryOf(type, rawContent),
    clientMsgId: clientMsgId || undefined,
  }
}

/** App 原生桥里 quoteElem / quoteMessage 经常是 JSON 字符串，且 contentType 可能是字符串数字 */
function quotedMessageOf(item: MessageItem): MessageItem | undefined {
  const elem = normalizeQuoteElem(item)
  if (!elem?.quoteMessage) return undefined
  return coerceMessage(elem.quoteMessage) || elem.quoteMessage
}

function normalizeQuoteElem(
  item: MessageItem,
): { text?: string; quoteMessage?: MessageItem } | undefined {
  const bag = item as MessageItem & Record<string, unknown>
  let raw: unknown = bag.quoteElem ?? bag.QuoteElem
  if (raw == null && typeof item.content === 'string' && item.content.startsWith('{')) {
    try {
      const parsed = JSON.parse(item.content) as Record<string, unknown>
      raw = parsed.quoteElem ?? parsed.QuoteElem
    } catch {
      /* content 不是带 quoteElem 的 JSON */
    }
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  let quoteMessage = obj.quoteMessage ?? obj.QuoteMessage
  if (typeof quoteMessage === 'string') {
    try {
      quoteMessage = JSON.parse(quoteMessage) as unknown
    } catch {
      quoteMessage = undefined
    }
  }
  const text =
    (typeof obj.text === 'string' && obj.text) ||
    (typeof obj.Text === 'string' && obj.Text) ||
    undefined
  if (!quoteMessage || typeof quoteMessage !== 'object') {
    return text ? { text } : undefined
  }
  return {
    text,
    quoteMessage: quoteMessage as MessageItem,
  }
}

function resolveQuotedAppType(quoted: MessageItem): AppMessageType {
  const type = toAppMessageType(Number(quoted.contentType))
  if (type !== 'text' && type !== 'system') return type
  const pictureUrl =
    quoted.pictureElem?.snapshotPicture?.url ||
    quoted.pictureElem?.sourcePicture?.url ||
    quoted.pictureElem?.sourcePath ||
    jsonPictureUrl(quoted.content) ||
    (typeof quoted.content === 'string' ? quoted.content : '')
  if (looksLikeImageUrl(pictureUrl) || quoted.pictureElem) return 'image'
  if (quoted.videoElem || parseVideoMeta(quoted.content).url) return 'video'
  if (soundMetaOf(quoted).path || (quoted as MessageItem).soundElem) return 'voice'
  if (quoted.fileElem) return 'file'
  if (quoted.cardElem) return 'card'
  return type
}

function pickQuotedNickname(quoted: MessageItem): string {
  const obj = quoted as unknown as Record<string, unknown>
  return pickString(obj, ['senderNickname', 'SenderNickname', 'senderNickName'])
}

function fileElemOf(item: MessageItem): Record<string, unknown> | undefined {
  const raw = item as MessageItem & { FileElem?: Record<string, unknown> }
  const elem = item.fileElem || raw.FileElem
  return elem && typeof elem === 'object' ? (elem as Record<string, unknown>) : undefined
}

/** App 原生桥文件字段可能是 fileElem.sourceUrl，也可能是 FileElem.SourceUrl。 */
function fileSourceUrlOf(item: MessageItem): string {
  const elem = fileElemOf(item)
  if (elem) {
    const url = pickString(elem, ['sourceUrl', 'SourceUrl', 'url', 'Url'])
    if (url) return url
  }
  return typeof item.content === 'string' && /^https?:\/\//i.test(item.content) ? item.content : ''
}

function fileDisplayNameOf(item: MessageItem, url: string): string {
  const elem = fileElemOf(item)
  const named = elem ? pickString(elem, ['fileName', 'FileName', 'name', 'Name']) : ''
  if (named) return named
  const seg = url.split('?')[0]?.split(/[\\/]/).filter(Boolean).pop() || ''
  return seg || '文件'
}

/** App 原生桥偶发把 *Elem 编成 JSON 字符串，或只用 PascalCase */
function textLikeElemOf(
  item: MessageItem,
  camel: 'textElem' | 'atTextElem',
  pascal: 'TextElem' | 'AtTextElem',
): Record<string, unknown> | undefined {
  const raw = item as MessageItem & Record<string, unknown>
  let value: unknown = raw[camel] ?? raw[pascal]
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function extractTextContent(item: MessageItem): string {
  const textElem = textLikeElemOf(item, 'textElem', 'TextElem')
  return (
    pickString(textElem || {}, ['content', 'Content']) ||
    item.textElem?.content ||
    jsonContentField(item.content, 'content')
  )
}

function extractAtTextContent(item: MessageItem): string {
  const atElem = textLikeElemOf(item, 'atTextElem', 'AtTextElem')
  return (
    pickString(atElem || {}, ['text', 'Text']) ||
    item.atTextElem?.text ||
    jsonContentField(item.content, 'text')
  )
}

function extractQuoteContent(item: MessageItem): string {
  const elem = normalizeQuoteElem(item)
  return elem?.text || item.quoteElem?.text || jsonContentField(item.content, 'text')
}

function extractVoiceContent(item: MessageItem): string {
  const meta = soundMetaOf(item)
  return JSON.stringify({ path: meta.path, duration: meta.duration })
}

function extractFileContent(item: MessageItem): string {
  const url = fileSourceUrlOf(item)
  const fileName = fileDisplayNameOf(item, url)
  return url ? JSON.stringify({ url, fileName }) : fileName
}

function extractVideoContent(item: MessageItem): string {
  const merged = parseVideoMeta(item)
  const fromJson = parseVideoMeta(item.content)
  // 气泡只保留可跨端访问的远程封面；发送端本地 snapshotPath 在接收端/App 历史里是死链，
  // 写进 content 会让 H5 走截帧、App 却去加载坏图，表现为「H5 有封面、App 没有」。
  const snap = preferRemoteMediaUrl(merged.snapshotUrl, fromJson.snapshotUrl)
  return JSON.stringify({
    url: preferRemoteMediaUrl(merged.url, fromJson.url),
    snapshotUrl: isRemoteMediaUrl(snap) ? snap : '',
    duration: merged.duration || fromJson.duration,
  })
}

/** 名片 content：{userId, nickname, avatar}；业务 ID 优先读 ex，旧消息再从 OpenIM userID 反推 */
function extractCardContent(item: MessageItem): string {
  const card = item.cardElem
  let userId = ''
  try {
    const ex = card?.ex ? (JSON.parse(card.ex) as { businessUserId?: string }) : null
    userId = ex?.businessUserId || ''
  } catch {
    /* ex 不是 JSON 时走反推 */
  }
  if (!userId) userId = businessUserIdFromIM(card?.userID || '')
  return JSON.stringify({
    userId,
    nickname: card?.nickname || '',
    avatar: card?.faceURL || '',
  })
}

function extractCustomContent(item: MessageItem): string {
  const invite = parseGroupInvitePayload(customMessageDataOf(item))
  if (invite) return JSON.stringify(invite)
  const raw = item as MessageItem & Record<string, unknown>
  const elem = (raw.customElem ?? raw.CustomElem) as
    | { description?: string; Description?: string }
    | undefined
  const desc =
    (typeof elem?.description === 'string' && elem.description) ||
    (typeof elem?.Description === 'string' && elem.Description) ||
    jsonContentField(item.content, 'description') ||
    ''
  return desc || '[自定义消息]'
}

function extractFallbackContent(item: MessageItem): string {
  // App 偶发 contentType 丢失，但 content 已是图片 URL
  if (typeof item.content === 'string' && looksLikeImageUrl(item.content)) return item.content
  return jsonPictureUrl(item.content) || formatIMNotification(item, resolveNoticeDisplayName)
}

function extractContent(item: MessageItem): string {
  switch (Number(item.contentType)) {
    case MessageType.TextMessage:
      return extractTextContent(item)
    case MessageType.AtTextMessage:
      return extractAtTextContent(item)
    case MessageType.QuoteMessage:
      return extractQuoteContent(item)
    case MessageType.PictureMessage:
      return pictureUrlOf(item)
    case MessageType.VoiceMessage:
      return extractVoiceContent(item)
    case MessageType.FileMessage:
      return extractFileContent(item)
    case MessageType.VideoMessage:
      return extractVideoContent(item)
    case MessageType.CardMessage:
      return extractCardContent(item)
    case MessageType.CustomMessage:
      return extractCustomContent(item)
    default:
      return extractFallbackContent(item)
  }
}

/** 系统通知展示名：优先好友备注（OpenIM id / 业务 UUID 都能对上） */
function resolveNoticeDisplayName(userId: string): string {
  if (!userId) return ''
  try {
    const store = useContactStore()
    const biz = businessUserIdFromIM(userId) || userId
    return store.remarkOf(biz) || store.remarkOf(userId) || ''
  } catch {
    return ''
  }
}

/** 本页里发送时间最早的一条，用作向更旧历史翻页的起点 */
function oldestClientMsgID(list: MessageItem[]): string {
  let oldest = list[0]
  for (const item of list) {
    const time = Number(item.sendTime || 0)
    const oldestTime = Number(oldest?.sendTime || 0)
    if (time > 0 && (oldestTime <= 0 || time < oldestTime)) oldest = item
  }
  return oldest?.clientMsgID || ''
}

/**
 * 搜索用纯文本。H5 文本经常是 `{"content":"12"}`，纯数字还会被收成 `{"content":12}`。
 * 只认字符串时「12」会被丢掉，App 的 textElem 仍是字符串所以搜得到。
 */
function plainSearchText(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return ''
  const content = raw.trim()
  if (!content || /^https?:\/\//i.test(content)) return ''
  if (!content.startsWith('{') && !content.startsWith('[')) return content
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return String(parsed)
    if (typeof parsed === 'string') return parsed.trim()
    if (!parsed || typeof parsed !== 'object') return ''
    const obj = parsed as Record<string, unknown>
    const text = obj.content ?? obj.Content ?? obj.text ?? obj.Text
    if (typeof text === 'number' && Number.isFinite(text)) return String(text)
    if (typeof text === 'string') return text.trim()
  } catch {
    return ''
  }
  return ''
}

/** 聊天记录搜索用的纯文本预览（兼容 App PascalCase 字段，以及 H5 的数字 JSON） */
export function messageSearchPreview(item: MessageItem): string {
  const t = Number(item.contentType)
  const isText =
    t === MessageType.TextMessage ||
    t === MessageType.AtTextMessage ||
    t === MessageType.QuoteMessage
  if (!isText && t) return ''
  const extracted = plainSearchText(extractContent(item))
  if (extracted) return extracted
  return plainSearchText(item.content)
}

/** 会话列表 / 群内关键词搜索：命中会话 + 预览 + 可定位的消息 id */
export interface LocalMessageSearchHit {
  conversationID: string
  messageCount: number
  preview: string
  clientMsgID: string
  /** 指定会话内搜索时返回的命中消息列表（已按时间新→旧） */
  messages: MessageItem[]
}

/**
 * 业务侧统一用从 1 开始的页码；转成各端 SDK 约定。
 * Android 原生文档首页从 0；iOS / H5 WASM 从 1。传错首页会整页空，表现为「有时搜不到」。
 */
function toSdkSearchPageIndex(oneBasedPage: number): number {
  const page = Number.isFinite(oneBasedPage) && oneBasedPage > 0 ? Math.trunc(oneBasedPage) : 1
  if (isApp() && isAndroid()) return page - 1
  return page
}

/**
 * 搜本机已同步的聊天记录。conversationID 空 = 全局搜所有会话。
 * App 原生桥结果字段可能是 PascalCase，这里统一归一。
 * 本地索引查询本身很快，不要在这里 waitForSync，否则同步事件丢失时会空等数秒。
 */
export async function searchLocalMessages(params: {
  keyword: string
  conversationID?: string
  count?: number
  pageIndex?: number
}): Promise<LocalMessageSearchHit[]> {
  const keyword = params.keyword.trim()
  if (!keyword) return []
  const oneBasedPage = params.pageIndex ?? 1
  const payload = {
    conversationID: params.conversationID || '',
    keywordList: [keyword],
    keywordListMatchType: 0,
    senderUserIDList: [] as string[],
    // App：空列表才等于全部类型，指定文本类型时群消息对不上，搜索会一直空。
    // H5 WASM：空列表等于不搜任何类型，必须显式带上文本 / @ / 引用，否则「12」这种纯数字也没有结果。
    messageTypeList: isApp()
      ? ([] as number[])
      : [MessageType.TextMessage, MessageType.AtTextMessage, MessageType.QuoteMessage],
    searchTimePosition: 0,
    searchTimePeriod: 0,
    pageIndex: toSdkSearchPageIndex(oneBasedPage),
    count: params.count ?? 100,
  }
  try {
    const res = await imCall<unknown>(IMMethods.SearchLocalMessages, payload)
    const hits = normalizeLocalMessageSearchResult(res)
    const ids = hits.map((hit) => hit.conversationID)
    // 保留状态未加载时必须先同步，否则搜索结果会短暂暴露已过期消息。
    // 私聊不会触发网络请求；群聊只在本地状态超过刷新周期时请求一次。
    if (ids.length) await groupRetention.sync(ids)
    return hits.flatMap((hit) => {
      const messages = groupRetention.filter(hit.conversationID, hit.messages)
      if (!messages.length) return []
      return [{ ...hit, messages, messageCount: messages.length, clientMsgID: messages[0].clientMsgID,
        preview: messageSearchPreview(messages[0]) }]
    })
  } catch {
    // H5 / 旧基座偶发无此方法：回退为空，调用方仍可用标题/摘要过滤
    return []
  }
}

/** 对标微信：进搜索页后台预热本地库；搜索本身不阻塞等预热 */
const localHistoryWarm = new Map<string, Promise<MessageItem[]>>()
const localHistoryReady = new Map<string, MessageItem[]>()
/** 上次预热已拉到会话尽头（条数 < 目标），避免短会话反复重拉 */
const localHistoryExhausted = new Set<string>()

/**
 * 与群可见保留量对齐（服务端 GroupRetentionCount≈3000）。
 * 曾经默认只预热 500 条：活跃群大约一两小时，客户就会反馈「早的搜不到」。
 */
const SEARCH_HISTORY_CAP = 3000
/** 首屏 / 每一屏期望命中数：先出最近的，其余靠上滑加载更多 */
const SEARCH_RESULT_PAGE_SIZE = 30
/** 每次加载更多最多再扫多少条历史（按消息条数，不是命中数） */
const SEARCH_HISTORY_SCAN_BATCH = 250

/**
 * 把指定会话历史拉进本地库（后台用）。默认拉满保留上限，供本地索引与补扫。
 * 已有缓存且条数够用 / 已确认拉尽则直接复用；否则加深，避免卡在旧的 500 条上限。
 */
export function ensureLocalConversationHistory(
  conversationID: string,
  maxCount = SEARCH_HISTORY_CAP,
): Promise<MessageItem[]> {
  if (!conversationID) return Promise.resolve([])
  const target = Math.max(1, Math.trunc(maxCount) || SEARCH_HISTORY_CAP)
  const cached = localHistoryReady.get(conversationID)
  if (cached && (cached.length >= target || localHistoryExhausted.has(conversationID))) {
    return Promise.resolve(cached)
  }
  const existing = localHistoryWarm.get(conversationID)
  if (existing) return existing
  const task = (async () => {
    // 最多等 800ms：有同步就蹭一下，没有也立刻拉本地/历史，避免搜索链路空等 8 秒
    await waitForSync(800)
    try {
      return await collectHistoryMessages(conversationID, target)
    } catch {
      return collectHistoryMessages(conversationID, target).catch(() => [] as MessageItem[])
    }
  })()
  localHistoryWarm.set(conversationID, task)
  void task.then(
    (messages) => {
      localHistoryWarm.delete(conversationID)
      if (messages.length < target) localHistoryExhausted.add(conversationID)
      else localHistoryExhausted.delete(conversationID)
      if (messages.length) {
        localHistoryReady.set(conversationID, messages)
        setTimeout(() => {
          if (localHistoryReady.get(conversationID) === messages) {
            localHistoryReady.delete(conversationID)
            localHistoryExhausted.delete(conversationID)
          }
        }, 60_000)
      }
    },
    () => {
      localHistoryWarm.delete(conversationID)
    },
  )
  return task
}

function peekLocalConversationHistory(conversationID: string): MessageItem[] {
  return localHistoryReady.get(conversationID) || []
}

function normalizeLocalMessageSearchResult(res: unknown): LocalMessageSearchHit[] {
  if (!res || typeof res !== 'object') return []
  const obj = res as Record<string, unknown>
  const items = obj.searchResultItems ?? obj.SearchResultItems
  if (!Array.isArray(items)) return []
  const hits: LocalMessageSearchHit[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const conversationID = String(
      item.conversationID ?? item.ConversationID ?? item.conversationId ?? '',
    )
    if (!conversationID) continue
    const messageCount = Number(item.messageCount ?? item.MessageCount ?? 0)
    const messageList = item.messageList ?? item.MessageList
    const messages: MessageItem[] = []
    if (Array.isArray(messageList)) {
      for (const m of messageList) {
        const coerced = coerceMessage(m)
        if (coerced) messages.push(coerced)
      }
    }
    const first = messages[0]
    hits.push({
      conversationID,
      messageCount,
      preview: first ? messageSearchPreview(first) : '',
      clientMsgID: first?.clientMsgID || '',
      messages,
    })
  }
  return hits
}

/** 搜索用正文：文本 / @ / 引用；类型丢失时退回纯文本 content */
function searchableTextOf(item: MessageItem): string {
  const preview = messageSearchPreview(item)
  if (preview) return preview
  return plainSearchText(item.content)
}

function matchesSearchKeyword(item: MessageItem, keyLower: string): boolean {
  const text = searchableTextOf(item)
  return !!text && text.toLowerCase().includes(keyLower)
}

/** SDK 已按关键词命中；App 偶发抽不出正文时仍保留，避免二次过滤洗成空 */
function acceptSdkSearchHit(item: MessageItem, keyLower: string): boolean {
  const text = searchableTextOf(item)
  return !text || text.toLowerCase().includes(keyLower)
}

/** 会话内关键词搜索游标：首屏 → 上滑加载更多 */
export interface ConversationMessageSearchCursor {
  sdkPage: number
  sdkDone: boolean
  historyStartId: string
  historyDone: boolean
  seenIds: string[]
  /** 本页扫到但超出 limit 的命中，留给下一屏，避免翻页漏结果 */
  pending: MessageItem[]
}

export interface ConversationMessageSearchPage {
  messages: MessageItem[]
  cursor: ConversationMessageSearchCursor
  hasMore: boolean
}

function emptySearchCursor(): ConversationMessageSearchCursor {
  return {
    sdkPage: 1,
    sdkDone: false,
    historyStartId: '',
    historyDone: false,
    seenIds: [],
    pending: [],
  }
}

/**
 * 对标微信：先出最近命中（本地索引，毫秒级），上滑再向更早历史翻页补扫。
 * 活跃群本地索引往往只有近几小时；不翻历史就会表现为「早的搜不到」。
 */
export async function searchConversationMessagesPage(params: {
  conversationID: string
  keyword: string
  cursor?: ConversationMessageSearchCursor | null
  limit?: number
  /** 本轮最多扫多少条历史；会话列表搜索宜小，避免「加载更多」卡住 */
  historyScanBatch?: number
}): Promise<ConversationMessageSearchPage> {
  const conversationID = params.conversationID
  const rawKeyword = params.keyword.trim()
  const key = rawKeyword.toLowerCase()
  const limit =
    Number.isFinite(params.limit) && (params.limit as number) > 0
      ? Math.trunc(params.limit as number)
      : SEARCH_RESULT_PAGE_SIZE
  const historyScanBatch =
    Number.isFinite(params.historyScanBatch) && (params.historyScanBatch as number) > 0
      ? Math.trunc(params.historyScanBatch as number)
      : SEARCH_HISTORY_SCAN_BATCH
  const isFirstPage = !params.cursor
  const cursor: ConversationMessageSearchCursor = params.cursor
    ? {
        sdkPage: params.cursor.sdkPage,
        sdkDone: params.cursor.sdkDone,
        historyStartId: params.cursor.historyStartId,
        historyDone: params.cursor.historyDone,
        seenIds: [...params.cursor.seenIds],
        pending: [...params.cursor.pending],
      }
    : emptySearchCursor()

  if (!conversationID || !key) {
    return { messages: [], cursor, hasMore: false }
  }

  // 后台拉满保留上限，不挡首屏；已预热的可立刻内存补扫
  if (isFirstPage) void ensureLocalConversationHistory(conversationID, SEARCH_HISTORY_CAP)

  const seen = new Set(cursor.seenIds)
  const pending = cursor.pending.filter((item) => {
    if (!item?.clientMsgID || seen.has(item.clientMsgID)) return false
    seen.add(item.clientMsgID)
    return true
  })
  const out: MessageItem[] = []

  const takePending = () => {
    while (out.length < limit && pending.length) {
      out.push(pending.shift() as MessageItem)
    }
  }
  takePending()

  /** 命中先入队，再按 limit 吐出，避免一页内多余命中被游标跳过 */
  const enqueue = (item: MessageItem, fromSdk: boolean) => {
    if (!item?.clientMsgID || seen.has(item.clientMsgID)) return false
    if (fromSdk ? !acceptSdkSearchHit(item, key) : !matchesSearchKeyword(item, key)) return false
    seen.add(item.clientMsgID)
    if (out.length < limit) out.push(item)
    else pending.push(item)
    return true
  }

  const sdkPageSize = 100
  while (!cursor.sdkDone && out.length < limit && !pending.length) {
    const hits = await searchLocalMessages({
      keyword: rawKeyword,
      conversationID,
      count: sdkPageSize,
      pageIndex: cursor.sdkPage,
    })
    const conv =
      hits.find((h) => h.conversationID === conversationID) ||
      (hits.length === 1 ? hits[0] : undefined)
    const batch = conv?.messages || []
    if (!batch.length) {
      cursor.sdkDone = true
      break
    }
    let added = 0
    for (const item of batch) {
      if (enqueue(item, true)) added += 1
    }
    cursor.sdkPage += 1
    const total = Number(conv?.messageCount || 0)
    if (total > 0 && seen.size >= total) cursor.sdkDone = true
    else if (batch.length < sdkPageSize) cursor.sdkDone = true
    else if (!added) cursor.sdkDone = true
  }
  takePending()

  if (isFirstPage) {
    for (const item of peekLocalConversationHistory(conversationID)) {
      enqueue(item, false)
    }
    takePending()
    // 索引空且预热还没好：最多再等 1.2s 补扫一次
    if (!out.length && !pending.length) {
      const warm = localHistoryWarm.get(conversationID)
      if (warm) {
        const history = await Promise.race([
          warm,
          new Promise<MessageItem[]>((resolve) => setTimeout(() => resolve([]), 1200)),
        ])
        for (const item of history) enqueue(item, false)
        takePending()
        if (!out.length && !pending.length && !cursor.sdkDone) {
          cursor.sdkPage = 1
          cursor.sdkDone = false
          const hits = await searchLocalMessages({
            keyword: rawKeyword,
            conversationID,
            count: sdkPageSize,
            pageIndex: 1,
          })
          const conv =
            hits.find((h) => h.conversationID === conversationID) ||
            (hits.length === 1 ? hits[0] : undefined)
          for (const item of conv?.messages || []) enqueue(item, true)
          takePending()
          cursor.sdkPage = 2
          if (!(conv?.messages || []).length) cursor.sdkDone = true
        }
      }
    }
  }

  // 首屏未凑满，或上滑加载更多：向更早历史扫关键词（会把消息拉进本地库）
  const shouldScanHistory =
    !cursor.historyDone &&
    !pending.length &&
    (!isFirstPage || out.length < limit)
  if (shouldScanHistory) {
    let scanned = 0
    while (
      !cursor.historyDone &&
      out.length < limit &&
      !pending.length &&
      scanned < historyScanBatch
    ) {
      const { messageList, isEnd } = await getHistoryMessages(
        conversationID,
        50,
        cursor.historyStartId,
      )
      if (!messageList.length) {
        cursor.historyDone = true
        break
      }
      const ordered = [...messageList].sort(
        (a, b) => Number(b.sendTime || 0) - Number(a.sendTime || 0),
      )
      for (const item of ordered) enqueue(item, false)
      takePending()
      scanned += messageList.length
      const next = oldestClientMsgID(messageList)
      if (!next || next === cursor.historyStartId) {
        cursor.historyDone = true
        break
      }
      cursor.historyStartId = next
      if (isEnd) {
        cursor.historyDone = true
        break
      }
    }
  }

  out.sort((a, b) => Number(b.sendTime || 0) - Number(a.sendTime || 0))
  pending.sort((a, b) => Number(b.sendTime || 0) - Number(a.sendTime || 0))
  cursor.pending = pending
  cursor.seenIds = [...seen]
  // 本地索引耗尽后仍可能有更早历史；队列里还有待展示命中时也算还有更多
  const hasMore = pending.length > 0 || !cursor.sdkDone || !cursor.historyDone
  return { messages: out, cursor, hasMore }
}

/**
 * 一次性取会话内命中（内部按页拉取）。页面展示请用 searchConversationMessagesPage。
 */
export async function searchConversationMessages(
  conversationID: string,
  keyword: string,
): Promise<MessageItem[]> {
  const all: MessageItem[] = []
  let cursor: ConversationMessageSearchCursor | null = null
  let hasMore = true
  for (let i = 0; i < 40 && hasMore; i++) {
    const page: ConversationMessageSearchPage = await searchConversationMessagesPage({
      conversationID,
      keyword,
      cursor,
      limit: SEARCH_RESULT_PAGE_SIZE,
    })
    all.push(...page.messages)
    cursor = page.cursor
    hasMore = page.hasMore
    if (!page.messages.length && !hasMore) break
  }
  return all
}

function groupIdFromConversationId(conversationId: string): string {
  return conversationId.startsWith('sg_') ? conversationId.slice(3) : ''
}

function pickFiniteNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** 取出 OpenIM 消息序号。App 原生插件可能用 Seq，或把数字编成字符串，且刚发送成功时经常是 0。 */
export function seqOf(item: unknown): number {
  if (!item || typeof item !== 'object') return 0
  const obj = item as Record<string, unknown>
  return toPositiveSeq(obj.seq) || toPositiveSeq(obj.Seq)
}

function toPositiveSeq(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function unwrapRawMessage(raw: unknown, depth = 0): Record<string, unknown> | null {
  if (raw == null || depth > 3) return null
  if (typeof raw === 'string') {
    if (!raw) return null
    try {
      return unwrapRawMessage(JSON.parse(raw) as unknown, depth + 1)
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!pickString(obj, ['clientMsgID', 'ClientMsgID', 'clientMsgId']) && obj.data != null) {
    return unwrapRawMessage(obj.data, depth + 1)
  }
  return obj
}

/** App 原生桥用 Status，不归一化的话发送中会被当成已完成，或把别的失败当成这条没发出去 */
function messageStatusOf(obj: Record<string, unknown>): number | undefined {
  const raw = obj.status ?? obj.Status
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function isMessageItem(value: unknown): value is MessageItem {
  return !!value && typeof value === 'object' && typeof (value as MessageItem).clientMsgID === 'string'
}

/**
 * App 原生桥推送常用 PascalCase；历史拉取已走本函数，实时 OnRecvNewMessage 也必须走，
 * 否则 clientMsgID/conversationID 为空会被 appendMessage 静默丢弃，表现为「刷新才收到」。
 */
export function coerceMessage(raw: unknown): MessageItem | null {
  const obj = unwrapRawMessage(raw)
  if (!obj) return null
  const clientMsgID = pickString(obj, ['clientMsgID', 'ClientMsgID', 'clientMsgId'])
  if (!clientMsgID) return null
  const contentType = Number(obj.contentType ?? obj.ContentType ?? 0)
  const sessionType = Number(obj.sessionType ?? obj.SessionType ?? 0)
  const sendTime = Number(obj.sendTime ?? obj.SendTime ?? obj.createTime ?? obj.CreateTime ?? 0)
  const item = {
    ...(obj as unknown as MessageItem),
    clientMsgID,
    seq: seqOf(obj),
    contentType: Number.isFinite(contentType) ? contentType : 0,
    status: messageStatusOf(obj),
    sendID: pickString(obj, ['sendID', 'SendID']) || (obj as MessageItem).sendID,
    recvID: pickString(obj, ['recvID', 'RecvID']) || (obj as MessageItem).recvID,
    groupID: pickString(obj, ['groupID', 'GroupID']) || (obj as MessageItem).groupID,
    sessionType: Number.isFinite(sessionType) ? sessionType : (obj as MessageItem).sessionType,
    sendTime: Number.isFinite(sendTime) && sendTime > 0 ? sendTime : (obj as MessageItem).sendTime,
    senderFaceUrl:
      pickString(obj, ['senderFaceUrl', 'SenderFaceUrl', 'senderFaceURL', 'SenderFaceURL']) ||
      (obj as MessageItem).senderFaceUrl,
    senderNickname:
      pickString(obj, ['senderNickname', 'SenderNickname']) || (obj as MessageItem).senderNickname,
    conversationID:
      pickString(obj, ['conversationID', 'ConversationID']) ||
      (obj as MessageItem & { conversationID?: string }).conversationID,
  } as MessageItem & { conversationID?: string }
  // OpenIM App 原生桥在部分版本中使用 PascalCase，统一成 Web SDK 的字段名，
  // 后续渲染、收藏和转发就不需要各自判断平台。
  const pictureElemRaw = obj.pictureElem ?? obj.PictureElem
  if (pictureElemRaw) {
    let pe: Record<string, unknown> | null = null
    if (typeof pictureElemRaw === 'string') {
      try {
        const parsed = JSON.parse(pictureElemRaw) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') pe = parsed
      } catch {
        /* PictureElem 不是 JSON 时保持原样 */
      }
    } else if (typeof pictureElemRaw === 'object') {
      pe = pictureElemRaw as Record<string, unknown>
    }
    if (pe) {
      const pickPic = (keys: string[]) => {
        for (const key of keys) {
          const pic = pe![key]
          if (!pic || typeof pic !== 'object') continue
          const url = pickString(pic as Record<string, unknown>, ['url', 'Url', 'URL'])
          if (!url) continue
          return { ...(pic as Record<string, unknown>), url }
        }
        return undefined
      }
      item.pictureElem = {
        sourcePath: pickString(pe, ['sourcePath', 'SourcePath']),
        sourcePicture: pickPic(['sourcePicture', 'SourcePicture']),
        bigPicture: pickPic(['bigPicture', 'BigPicture']),
        snapshotPicture: pickPic(['snapshotPicture', 'SnapshotPicture']),
      } as MessageItem['pictureElem']
    }
  }
  const videoElemRaw = obj.videoElem ?? obj.VideoElem
  if (videoElemRaw) {
    if (typeof videoElemRaw === 'string') {
      try {
        const parsed = JSON.parse(videoElemRaw) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') {
          item.videoElem = {
            videoUrl: pickString(parsed, ['videoUrl', 'VideoUrl', 'videoURL', 'VideoURL']),
            videoPath: pickString(parsed, ['videoPath', 'VideoPath']),
            snapshotUrl: pickString(parsed, ['snapshotUrl', 'SnapshotUrl', 'snapshotURL', 'SnapshotURL']),
            snapshotPath: pickString(parsed, ['snapshotPath', 'SnapshotPath']),
            duration: Number(parsed.duration ?? parsed.Duration ?? 0),
            videoSize: Number(parsed.videoSize ?? parsed.VideoSize ?? 0),
            snapshotWidth: Number(parsed.snapshotWidth ?? parsed.SnapshotWidth ?? 0),
            snapshotHeight: Number(parsed.snapshotHeight ?? parsed.SnapshotHeight ?? 0),
          } as MessageItem['videoElem']
        }
      } catch {
        /* VideoElem 不是 JSON 时保持原样 */
      }
    } else if (typeof videoElemRaw === 'object') {
      const ve = videoElemRaw as Record<string, unknown>
      item.videoElem = {
        videoUrl: pickString(ve, ['videoUrl', 'VideoUrl', 'videoURL', 'VideoURL']),
        videoPath: pickString(ve, ['videoPath', 'VideoPath']),
        snapshotUrl: pickString(ve, ['snapshotUrl', 'SnapshotUrl', 'snapshotURL', 'SnapshotURL']),
        snapshotPath: pickString(ve, ['snapshotPath', 'SnapshotPath']),
        duration: Number(ve.duration ?? ve.Duration ?? 0),
        videoSize: Number(ve.videoSize ?? ve.VideoSize ?? 0),
        snapshotWidth: Number(ve.snapshotWidth ?? ve.SnapshotWidth ?? 0),
        snapshotHeight: Number(ve.snapshotHeight ?? ve.SnapshotHeight ?? 0),
      } as MessageItem['videoElem']
    }
  }
  // 本地 snapshotPath 不能盖住 content / 其它字段里的远程封面
  if (item.contentType === MessageType.VideoMessage || item.videoElem) {
    const fromElem = parseVideoMeta(item)
    const fromContent = parseVideoMeta(item.content)
    const url = preferRemoteMediaUrl(fromElem.url, fromContent.url)
    const snap = preferRemoteMediaUrl(fromElem.snapshotUrl, fromContent.snapshotUrl)
    const snapshotUrl = isRemoteMediaUrl(snap) ? snap : ''
    if (url || snapshotUrl) {
      item.videoElem = {
        ...(item.videoElem || {}),
        videoUrl: url,
        snapshotUrl,
        duration: fromElem.duration || fromContent.duration,
      } as MessageItem['videoElem']
    }
  }
  // 与视频一致：App 原生桥 SoundElem / SourceUrl 归一成 soundElem，否则 iOS 气泡 path 为空点不开
  const soundElemRaw = obj.soundElem ?? obj.SoundElem
  if (soundElemRaw) {
    let se: Record<string, unknown> | null = null
    if (typeof soundElemRaw === 'string') {
      try {
        const parsed = JSON.parse(soundElemRaw) as Record<string, unknown>
        if (parsed && typeof parsed === 'object') se = parsed
      } catch {
        /* SoundElem 不是 JSON 时保持原样 */
      }
    } else if (typeof soundElemRaw === 'object') {
      se = soundElemRaw as Record<string, unknown>
    }
    if (se) {
      const sourceUrl = pickString(se, ['sourceUrl', 'SourceUrl', 'sourceURL', 'SourceURL'])
      const soundPath = pickString(se, ['soundPath', 'SoundPath'])
      item.soundElem = {
        uuid: pickString(se, ['uuid', 'UUID', 'Uuid']),
        soundPath,
        sourceUrl,
        dataSize: Number(se.dataSize ?? se.DataSize ?? 0),
        duration: Number(se.duration ?? se.Duration ?? 0),
        soundType: pickString(se, ['soundType', 'SoundType']),
      } as MessageItem['soundElem']
    }
  }
  return item as MessageItem
}

function parseFindMessageResult(res: unknown, clientMsgID: string): MessageItem | null {
  const obj = unwrapRawMessage(res) || (res && typeof res === 'object' ? (res as Record<string, unknown>) : null)
  if (!obj) return null
  const items = obj.findResultItems ?? obj.FindResultItems
  const groups = Array.isArray(items) ? items : []
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    const rec = group as Record<string, unknown>
    const rawList = rec.messageList ?? rec.MessageList
    const list = Array.isArray(rawList) ? rawList : []
    for (const msg of list) {
      const parsed = coerceMessage(msg)
      if (parsed?.clientMsgID === clientMsgID) return parsed
    }
  }
  const direct = coerceMessage(obj)
  return direct?.clientMsgID === clientMsgID ? direct : null
}

/** 按 clientMsgID 查本地库。App 刚发出时历史接口可能还是空的，这条比翻历史更稳。 */
export async function findLocalMessage(
  conversationID: string,
  clientMsgID: string,
): Promise<MessageItem | null> {
  if (!conversationID || !clientMsgID) return null
  await groupRetention.sync([conversationID])
  const tryCall = (params: unknown) => imCall<unknown>('findMessageList' as IMMethods, params)
  const take = (res: unknown) => {
    const item = parseFindMessageResult(res, clientMsgID)
    return groupRetention.removed(conversationID, item) ? null : item
  }
  try {
    return take(await tryCall([{ conversationID, clientMsgIDList: [clientMsgID] }]))
  } catch {
    try {
      return take(await tryCall({ conversationID, clientMsgIDList: [clientMsgID] }))
    } catch {
      return null
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * 撤回需要服务端 seq。H5 WASM 发送成功时通常已带上；
 * App 原生回调经常先成功、seq 仍为 0，要等本地库写完再查。
 */
export async function resolveMessageSeq(
  conversationID: string,
  clientMsgID: string,
  cached?: MessageItem,
): Promise<{ seq: number; message?: MessageItem }> {
  const take = (item: MessageItem | null | undefined) => {
    const seq = seqOf(item)
    return seq > 0 ? { seq, message: item || undefined } : null
  }
  const immediate = take(cached)
  if (immediate) return immediate

  const delays = isApp() ? [0, 400, 1000] : [0]
  for (const delay of delays) {
    if (delay) await sleep(delay)
    const found = take(await findLocalMessage(conversationID, clientMsgID))
    if (found) return found
    const { messageList } = await getHistoryMessages(conversationID, 50).catch(() => ({
      messageList: [] as MessageItem[],
    }))
    const hist = take(messageList.find((m) => m.clientMsgID === clientMsgID))
    if (hist) return hist
  }
  return { seq: 0 }
}

function normalizeHistoryResult(res: unknown): { messageList: MessageItem[]; isEnd: boolean } {
  if (Array.isArray(res)) {
    return {
      messageList: res.map(coerceMessage).filter((item): item is MessageItem => !!item),
      isEnd: res.length === 0,
    }
  }
  const obj = res && typeof res === 'object' ? (res as Record<string, unknown>) : {}
  const rawList = obj.messageList ?? obj.MessageList
  const list = Array.isArray(rawList)
    ? rawList.map(coerceMessage).filter((item): item is MessageItem => !!item)
    : []
  return { messageList: list, isEnd: Boolean(obj.isEnd ?? obj.IsEnd) }
}

function summarize(latestMsg: string | MessageItem | null | undefined): string {
  if (latestMsg == null || latestMsg === '') return ''
  const message = coerceMessage(latestMsg)
  if (!message) {
    return typeof latestMsg === 'string' && !latestMsg.startsWith('{') && !latestMsg.startsWith('[')
      ? latestMsg
      : ''
  }
  if (Number(message.contentType) === MessageType.CustomMessage) {
    const dataStr = customMessageDataOf(message)
    const invite = parseGroupInvitePayload(dataStr)
    if (invite) return '[群邀请]'
    const pin = parseMessagePinPayload(dataStr)
    if (pin) return pin.action === 'unpin' ? '' : '[置顶消息]'
  }
  const type = toAppMessageType(message.contentType)
  if (type === 'image') return '[图片]'
  if (type === 'voice') return '[语音]'
  if (type === 'video') return '[视频]'
  if (type === 'file') return '[文件]'
  if (type === 'card') return '[名片]'
  return extractContent(message)
}

/** OpenIM 时间戳是毫秒 */
function toISOTime(timestamp: number): string {
  if (!timestamp) return new Date().toISOString()
  return new Date(timestamp).toISOString()
}

// ---------------------------------------------------------------------------
// 会话级设置（置顶 / 免打扰 / 隐藏）：直接走 OpenIM SDK，随账号云同步，多端一致。
// 注意：这些不经由业务后端 REST 接口，避免与 OpenIM 服务端的会话状态冲突。
// ---------------------------------------------------------------------------

/**
 * 置顶 / 取消置顶某个会话。
 * 按 OpenIM 官方文档，uni-app 统一走 asyncApi('setConversation', ...)。
 * App 原生桥部分版本只认 PascalCase 字段，失败时再试 IsPinned。
 */
export async function setConversationPin(conversationID: string, isPinned: boolean): Promise<void> {
  try {
    await imCall('setConversation' as IMMethods, { conversationID, isPinned })
  } catch (first) {
    if (!isApp()) throw first
    await imCall('setConversation' as IMMethods, { conversationID, IsPinned: isPinned })
  }
}

/**
 * 设置会话的消息接收选项。
 * opt 取值见 MessageReceiveOptType：0=正常提醒，1=不接收，2=接收但不提醒（免打扰）。
 * 按 OpenIM 官方文档，uni-app 统一走 asyncApi('setConversation', ...)。
 */
export async function setConversationRecvOpt(conversationID: string, opt: number): Promise<void> {
  await imCall('setConversation' as IMMethods, { conversationID, recvMsgOpt: opt })
}

/**
 * 隐藏指定会话（仅本地层面）。
 * - 群聊/私聊未解散时，对方发消息会重新插入列表（OpenIM OnNewConversation / OnConversationChanged 事件触发）。
 * - 不影响服务端消息记录。
 * - 对应 OpenIM SDK 的 hideConversation 接口。
 * - H5 平台 client-sdk 不支持 hideConversation，调用会抛 undefined.apply 错误，本地已过滤等于成功。
 */
export async function hideConversation(conversationID: string): Promise<void> {
  try {
    await imCall(IMMethods.HideConversation, conversationID)
  } catch (e) {
    // H5 SDK 不支持 hideConversation；本地 hideConversationLocal 已经在调用前把会话从列表中移除，
    // 因此本次操作在 UI 上已生效。吞掉底层错误即可。
    devWarn('[openim] hideConversation 调用失败（H5 SDK 可能不支持该接口）', e)
  }
}

function conversationEx(item: ConversationItem): string {
  const raw = item as ConversationItem & Record<string, unknown>
  const ex = raw.ex ?? raw.Ex
  return typeof ex === 'string' ? ex : ''
}

function parseConversationEx(ex: string): Record<string, unknown> {
  if (!ex) return {}
  try {
    const parsed: unknown = JSON.parse(ex)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    /* 非 JSON 的旧 ex 不沿用，避免污染备注结构 */
  }
  return {}
}

export function groupRemarkFromEx(ex: string | undefined): string {
  const remark = parseConversationEx(ex || '').groupRemark
  return typeof remark === 'string' ? remark.trim() : ''
}

function pinnedMessageFromEx(ex: string | undefined): ConversationPinnedMessage | null {
  const raw = parseConversationEx(ex || '').pinnedMessage
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const clientMsgID = String(obj.clientMsgID ?? obj.ClientMsgID ?? '').trim()
  if (!clientMsgID) return null
  const scope = obj.scope === 'shared' ? 'shared' : 'self'
  return {
    clientMsgID,
    preview: String(obj.preview ?? obj.Preview ?? '').trim(),
    senderNickname: String(obj.senderNickname ?? obj.SenderNickname ?? '').trim(),
    messageType: String(obj.messageType ?? obj.MessageType ?? 'text').trim() || 'text',
    scope,
    pinnedAt: Number(obj.pinnedAt ?? obj.PinnedAt ?? 0) || Date.now(),
  }
}

/** 解析置顶同步自定义消息（businessKey=message_pin） */
export function parseMessagePinPayload(raw: unknown): {
  action: 'pin' | 'unpin'
  clientMsgID: string
  preview: string
  senderNickname: string
  messageType: string
} | null {
  let obj: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (!obj) return null
  const key = String(obj.businessKey ?? obj.BusinessKey ?? '')
  if (key !== 'message_pin') return null
  const actionRaw = String(obj.action ?? obj.Action ?? 'pin').toLowerCase()
  const action = actionRaw === 'unpin' ? 'unpin' : 'pin'
  const clientMsgID = String(obj.clientMsgID ?? obj.ClientMsgID ?? '').trim()
  if (action === 'pin' && !clientMsgID) return null
  return {
    action,
    clientMsgID,
    preview: String(obj.preview ?? obj.Preview ?? '').trim(),
    senderNickname: String(obj.senderNickname ?? obj.SenderNickname ?? '').trim(),
    messageType: String(obj.messageType ?? obj.MessageType ?? 'text').trim() || 'text',
  }
}

/** 从 OpenIM 消息项解析置顶同步 payload */
export function messagePinPayloadOf(item: MessageItem): ReturnType<typeof parseMessagePinPayload> {
  return parseMessagePinPayload(customMessageDataOf(item))
}

async function mergeConversationEx(
  conversationID: string,
  mutator: (extra: Record<string, unknown>) => void,
): Promise<void> {
  const list = await getConversationList().catch(() => [] as ConversationItem[])
  const current = list.find((item) => item.conversationID === conversationID)
  const extra = parseConversationEx(current ? conversationEx(current) : '')
  mutator(extra)
  await imCall('setConversation' as IMMethods, {
    conversationID,
    ex: Object.keys(extra).length ? JSON.stringify(extra) : '',
  })
}

/** 群备注仅自己可见：写进 OpenIM 会话 ex，随账号云同步，列表标题优先展示备注 */
export async function setConversationGroupRemark(conversationID: string, remark: string): Promise<void> {
  await mergeConversationEx(conversationID, (extra) => {
    const next = remark.trim()
    if (next) extra.groupRemark = next
    else delete extra.groupRemark
  })
}

/** 写入 / 清除本账号会话内的置顶消息（conversation.ex） */
export async function setConversationPinnedMessage(
  conversationID: string,
  pinned: ConversationPinnedMessage | null,
): Promise<void> {
  await mergeConversationEx(conversationID, (extra) => {
    if (pinned?.clientMsgID) extra.pinnedMessage = pinned
    else delete extra.pinnedMessage
  })
}

/** 向会话同步共享置顶（自定义消息，接收端静默应用，不进气泡列表） */
export async function sendMessagePinSync(
  target: IMTarget,
  payload: {
    action: 'pin' | 'unpin'
    clientMsgID: string
    preview: string
    senderNickname: string
    messageType: string
  },
): Promise<void> {
  const data = JSON.stringify({
    businessKey: 'message_pin',
    action: payload.action,
    clientMsgID: payload.clientMsgID,
    preview: payload.preview,
    senderNickname: payload.senderNickname,
    messageType: payload.messageType,
  })
  const description = payload.action === 'unpin' ? '' : '置顶消息'
  let message: MessageItem
  try {
    message = await imCall<MessageItem>(IMMethods.CreateCustomMessage, {
      data,
      description,
      extension: '',
    })
  } catch {
    message = await imCall<MessageItem>(IMMethods.CreateCustomMessage, {
      Data: data,
      Description: description,
      Extension: '',
    })
  }
  await sendCreatedMessage(target, message)
}

/** 清掉会话上的 @ / 新公告强提醒，对应参考站「不再提示」 */
export async function resetConversationGroupAtType(conversationID: string): Promise<void> {
  const attempts: unknown[] = [
    conversationID,
    { conversationID, groupAtType: GroupAtType.AtNormal },
  ]
  if (isApp()) {
    attempts.push({ conversationID, GroupAtType: GroupAtType.AtNormal })
  }
  for (const params of attempts) {
    try {
      await imCall('resetConversationGroupAtType' as IMMethods, params)
      return
    } catch {
      /* 原生桥参数形态不一致，继续尝试 setConversation */
    }
  }
  const setArgs = isApp()
    ? [
        { conversationID, groupAtType: GroupAtType.AtNormal },
        { conversationID, GroupAtType: GroupAtType.AtNormal },
      ]
    : [{ conversationID, groupAtType: GroupAtType.AtNormal }]
  for (const params of setArgs) {
    try {
      await imCall('setConversation' as IMMethods, params)
      return
    } catch {
      /* try next shape */
    }
  }
}

/**
 * 群聊的 OpenIM 会话 ID 是 `sg_` + 群 ID（超级群 groupType=2，本项目群均为该类型）。
 * 用业务群 ID 换取 OpenIM 群 ID 后，可确定性拼出会话 ID，无需先建会话。
 */
export async function resolveGroupConversationID(businessGroupId: string): Promise<string> {
  const target = await resolveIMGroup(businessGroupId)
  return `sg_${target.imGroupId}`
}

// ---------------------------------------------------------------------------
// 用户在线状态：订阅 + 事件更新，用于聊天列表私聊头像的小绿点。
// App 原生插件方法名是小写，Web/小程序端 client-sdk 方法名是大写驼峰，需要做平台适配。
// ---------------------------------------------------------------------------

/**
 * 订阅指定用户的在线状态。成功后会通过 OnUserStatusChanged 事件推送变更，
 * 也可调用 getSubscribeUsersStatus 查询当前状态。
 *
 * 注意：polyfill 的 asyncApi 在 Web 端直接调用 client-sdk 的方法对象，方法名均为小写，
 * 因此这里统一使用 polyfill 枚举里的方法名（小写）。
 */
export async function subscribeUsersStatus(userIDs: string[]): Promise<UserOnlineState[]> {
  if (!userIDs.length) return []
  const res = await imCall<UserOnlineState[]>(IMMethods.SubscribeUsersStatus, userIDs)
  return res || []
}

/** 取消订阅指定用户的在线状态 */
export async function unsubscribeUsersStatus(userIDs: string[]): Promise<void> {
  if (!userIDs.length) return
  await imCall(IMMethods.UnsubscribeUsersStatus, userIDs)
}

/** 查询所有已订阅用户的当前在线状态 */
export async function getSubscribeUsersStatus(): Promise<UserOnlineState[]> {
  const res = await imCall<UserOnlineState[]>('getSubscribeUsersStatus' as IMMethods)
  return res || []
}

/** 监听用户在线状态变更 */
export function onUserStatusChanged(handler: (state: UserOnlineState) => void): () => void {
  return onIMEvent<UserOnlineState>(IMEvents.OnUserStatusChanged, handler)
}

export { OnlineState }
