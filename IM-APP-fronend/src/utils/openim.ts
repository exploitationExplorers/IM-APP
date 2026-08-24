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
import type { ChatMessage, Conversation, MessageType as AppMessageType } from '@/types'
import { looksLikeImageUrl, quoteSummaryOf, quoteThumbOf, resolveQuoteType } from '@/utils/format'
import { formatIMNotification, imNotificationEventKey, notificationKindOf, GROUP_CREATED_WELCOME_TEXT } from '@/utils/im-notification'
import { effectiveGroupAtType, GroupAtType, highlightTagsOf } from '@/utils/group-announcement'
import {
  parseVideoMeta,
  videoSnapshotTime,
  downloadRemoteVideoForCover,
  preferRemoteMediaUrl,
  isRemoteMediaUrl,
} from '@/utils/chatMedia'
import { devLog, devWarn } from '@/utils/devLog'

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

/** app 端走原生插件，web / 小程序端走 @openim/client-sdk，两者初始化方式不同 */
const isAppPlatform = uni.getSystemInfoSync().uniPlatform === 'app'

/** 标准运行基座不含第三方原生插件，App 聊天必须用包含 OpenIM 的自定义调试基座 */
const APP_NATIVE_PLUGIN_MISSING =
  'App 端缺少 OpenIM 原生插件，请用自定义调试基座运行'

function hasAppNativeIMSDK(): boolean {
  if (!isAppPlatform) return true
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

let tokenExpireAt = 0
let loginPromise: Promise<string> | null = null
/** 退出登录时递增，作废进行中的 IM 登录，避免旧账号登录完成后把会话写回来 */
let loginEpoch = 0
let boundAccessToken = ''

/**
 * SDK 是否已真正连上 OpenIM 服务端。
 * 光本地缓存(imUserId/tokenExpireAt)有效还不够——服务端掉线时 SDK 会断连，
 * 此时直接调会话接口会被 SDK 拒成 errCode=10004(Resource load not complete)。
 * 只有收到 OnConnectSuccess 才认为可用。
 */
let connected = false

/**
 * 清空本地登录缓存，下次 ensureIMLogin 会强制重新登录。
 * 触发场景：被其它端踢下线、token 在服务端过期、或需要重新握手时。
 */
function resetLoginCache() {
  imUserId.value = ''
  tokenExpireAt = 0
  connected = false
  boundAccessToken = ''
}

export function invalidateIMLoginCache() {
  resetLoginCache()
}

function invalidatePendingLogin() {
  loginEpoch += 1
  resetLoginCache()
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
  if (!isAppPlatform) return Platform.Web
  return uni.getSystemInfoSync().platform === 'ios' ? Platform.iOS : Platform.Android
}

/**
 * App 端 OpenIM 本地库目录。
 * uni.env.USER_DATA_PATH 是小程序字段，App 上为空，SDK 会把库建到 `/OpenIM_v3_xxx.db` 然后 10006。
 * 目录按 OpenIM 用户 ID 隔离，避免换号后读到上个账号的本地会话/消息库。
 */
function getAppSdkDataDir(userId: string): Promise<string> {
  const io = plus?.io
  if (!io) {
    return Promise.reject(new Error('当前 App 环境无法获取本地存储目录'))
  }
  const safeUserId = userId.replace(/[^0-9a-z_-]/gi, '') || 'default'

  const fromUrl = (): string => {
    const raw = io.convertLocalFileSystemURL(`_doc/openim/${safeUserId}/`) || ''
    return raw.replace(/^file:\/\//, '')
  }

  return new Promise((resolve, reject) => {
    const type = io.PRIVATE_DOC ?? 1
    io.requestFileSystem(
      type,
      (fs) => {
        const root = fs.root
        if (!root) {
          const fallback = fromUrl()
          if (fallback && fallback !== '/') {
            resolve(fallback.endsWith('/') ? fallback : `${fallback}/`)
            return
          }
          reject(new Error('OpenIM 数据目录无效'))
          return
        }
        root.getDirectory(
          'openim',
          { create: true },
          (entry) => {
            entry.getDirectory(
              safeUserId,
              { create: true },
              (userEntry) => {
                const path = (userEntry.fullPath || fromUrl()).replace(/^file:\/\//, '')
                if (!path || path === '/') {
                  reject(new Error('OpenIM 数据目录无效'))
                  return
                }
                resolve(path.endsWith('/') ? path : `${path}/`)
              },
              (err) => {
                const fallback = fromUrl()
                if (fallback && fallback !== '/') {
                  resolve(fallback.endsWith('/') ? fallback : `${fallback}/`)
                  return
                }
                reject(err)
              },
            )
          },
          (err) => {
            const fallback = fromUrl()
            if (fallback && fallback !== '/') {
              resolve(fallback.endsWith('/') ? fallback : `${fallback}/`)
              return
            }
            reject(err)
          },
        )
      },
      (err) => {
        const fallback = fromUrl()
        if (fallback && fallback !== '/') {
          resolve(fallback.endsWith('/') ? fallback : `${fallback}/`)
          return
        }
        reject(err)
      },
    )
  })
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
    if ('data' in envelope) return envelope.data as T
  }
  return raw as T
}

function toIMError(raw: unknown, method: IMMethods): Error {
  if (raw instanceof Error) return raw
  if (typeof raw === 'string') return new Error(`${raw}（${method}）`)
  const { errCode, errMsg, errDlt } = (raw || {}) as {
    errCode?: number
    errMsg?: string
    errDlt?: string
  }
  const detail = `${method} errCode=${errCode ?? 'unknown'}`
  const hint = [errMsg, errDlt].filter(Boolean).join(': ')
  return new Error(hint ? `${hint}（${detail}）` : `IM 调用失败（${detail}）`)
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
  tokenExpireAt = Date.now() + Math.max(0, imToken.expireSec - 300) * 1000
  connected = true // 登录 + 同步已成功，视为已连上服务端
  boundAccessToken = getToken()
  return imUserId.value
}

/**
 * 登录成功只代表连上了，SDK 还要异步从服务端拉会话与消息。
 * 这期间查历史会拿到空列表，所以要等同步结束；超时兜底，避免同步事件丢失时卡死。
 */
export function waitForSync(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      offFinish()
      offFailed()
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    const offFinish = onIMEvent(IMEvents.OnSyncServerFinish, finish)
    const offFailed = onIMEvent(IMEvents.OnSyncServerFailed, finish)
  })
}

async function loginSdk(imToken: IMTokenResult): Promise<void> {
  const payload = {
    userID: imToken.userId,
    token: imToken.token,
    platformID: imToken.platform,
    apiAddr: imToken.apiAddr,
    wsAddr: imToken.wsAddr,
    logLevel: H5_SDK_LOG_LEVEL,
  }
  let synced = waitForSync()
  try {
    await imCall(IMMethods.Login, payload)
  } catch (e) {
    if (!isLoginRepeat(e)) {
      const msg = (e as Error)?.message || ''
      if (msg.includes('10005') || msg.includes('10004')) {
        await new Promise((r) => setTimeout(r, 400))
        synced = waitForSync()
        await imCall(IMMethods.Login, payload)
      } else {
        throw e
      }
    } else {
      const loggedUserId = await getSdkLoginUserId()
      if (loggedUserId !== imToken.userId) {
        await imCall(IMMethods.Logout).catch(() => undefined)
        synced = waitForSync()
        await imCall(IMMethods.Login, payload)
      }
    }
  }
  await synced
}

async function doLogin(): Promise<string> {
  const epoch = loginEpoch
  const imToken: IMTokenResult = await fetchIMToken(currentPlatformId())
  if (epoch !== loginEpoch) {
    throw new Error('已退出登录')
  }

  if (isAppPlatform) {
    const dataDir = await getAppSdkDataDir(imToken.userId)
    await imCall(IMMethods.InitSDK, {
      platformID: imToken.platform,
      apiAddr: imToken.apiAddr,
      wsAddr: imToken.wsAddr,
      dataDir,
      logLevel: APP_SDK_LOG_LEVEL,
      isLogStandardOutput: APP_SDK_LOG_STDOUT,
    })
  }

  const status = await getSdkLoginStatus()
  if (status === LoginStatus.Logged) {
    const loggedUserId = await getSdkLoginUserId()
    if (loggedUserId === imToken.userId) {
      return rememberLogin(imToken)
    }
    await imCall(IMMethods.Logout).catch(() => undefined)
  }

  await loginSdk(imToken)
  if (epoch !== loginEpoch) {
    await imCall(IMMethods.Logout).catch(() => undefined)
    throw new Error('已退出登录')
  }
  return rememberLogin(imToken)
}

/** 保证 SDK 已登录，重复调用只会真正登录一次；返回当前 OpenIM 用户 ID */
export async function ensureIMLogin(): Promise<string> {
  if (!shouldUseOpenIM()) throw new Error('聊天功能未启用')
  const businessToken = getToken()
  if (
    imUserId.value &&
    Date.now() < tokenExpireAt &&
    connected &&
    businessToken &&
    businessToken === boundAccessToken
  ) {
    const logged = await getSdkLoginUserId()
    if (!logged || logged === imUserId.value) {
      return imUserId.value
    }
    resetLoginCache()
  } else if (imUserId.value || connected || boundAccessToken) {
    invalidatePendingLogin()
    await forceSdkLogout().catch(() => undefined)
    resetLoginCache()
  }
  const epoch = loginEpoch
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null
    })
  }
  try {
    const userId = await loginPromise
    if (epoch !== loginEpoch) {
      return ensureIMLogin()
    }
    return userId
  } catch (e) {
    if (epoch !== loginEpoch) {
      return ensureIMLogin()
    }
    throw e
  }
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
  const hadIMSession = !!(imUserId.value || connected)
  invalidatePendingLogin()
  if (hadIMSession) {
    try {
      await withTimeout(forceSdkLogout(), 1500)
    } catch {
      // 本地必须清掉，避免下一个账号读到上一个号的会话库
    }
  }
  resetLoginCache()
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
  return imCall<ConversationItem[]>(IMMethods.GetConversationListSplit, { offset, count })
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

export async function getHistoryMessages(
  conversationID: string,
  count = 20,
  startClientMsgID = '',
): Promise<{ messageList: MessageItem[]; isEnd: boolean }> {
  const res = await imCall<unknown>(IMMethods.GetAdvancedHistoryMessageList, {
    conversationID,
    count,
    startClientMsgID: startClientMsgID || '',
    lastMinSeq: 0,
    viewType: ViewType.History,
  })
  return normalizeHistoryResult(res)
}

/** 从新到旧分页拉出会话历史，供搜索 / 媒体页使用 */
export async function collectHistoryMessages(
  conversationID: string,
  maxCount = 400,
): Promise<MessageItem[]> {
  const pages: MessageItem[][] = []
  let startClientMsgID = ''
  let loaded = 0
  while (loaded < maxCount) {
    const { messageList, isEnd } = await getHistoryMessages(conversationID, 50, startClientMsgID)
    if (!messageList.length) break
    pages.push(messageList)
    loaded += messageList.length
    if (isEnd) break
    startClientMsgID = messageList[0]?.clientMsgID || ''
    if (!startClientMsgID) break
  }
  return pages.flat()
}

/** 只清当前用户本端及云端副本，不影响其他人设备 */
export async function clearConversationMessages(conversationID: string): Promise<void> {
  // H5 client-sdk 没有 clearConversationAndDeleteAllMsg；调用不存在的方法会在
  // SDK 代理层抛出 "Cannot read properties of undefined (reading 'apply')"。
  // App 原生插件则继续使用已经验证可用的 ClearConversationAndDeleteAllMsg。
  const method = isAppPlatform
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
  // SDK 的 createQuoteMessage 要求 message 是被引用消息的 JSON 字符串（QuoteMsgParams.message: string），
  // 直接传对象会被 JSON.parse 隐式转成 "[object Object]" 而报 errCode=10006。
  const message = await imCall<MessageItem>(IMMethods.CreateQuoteMessage, {
    text,
    message: JSON.stringify(quote),
  })
  return sendCreatedMessage(target, message)
}

export async function sendForwardMessage(target: IMTarget, source: MessageItem): Promise<MessageItem> {
  const message = await imCall<MessageItem>(IMMethods.CreateForwardMessage, {
    message: source,
  })
  return sendCreatedMessage(target, message)
}

export async function sendAtTextMessage(
  target: IMTarget,
  text: string,
  atUserIDList: string[],
  atUsersInfo: Array<{ atUserID: string; groupNickname: string }>,
): Promise<MessageItem> {
  const message = await imCall<MessageItem>(IMMethods.CreateTextAtMessage, {
    text,
    atUserIDList,
    atUsersInfo,
  })
  return sendCreatedMessage(target, message)
}

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
      : target.groupId || groupIdFromConversationId(target.conversationId)
  const params = {
    recvID: target.sessionType === SessionType.Single ? target.recvId : '',
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
  if (isAppPlatform) {
    return sendOnAppNative(method, params, message.clientMsgID, options.timeoutMs)
  }
  const sent = await imCall<unknown>(method, params).catch((err: unknown) => {
    reportTargetSendFailure(target, message, 'send', 'send_failed', (err as Error)?.message)
    throw err
  })
  if (!isMessageItem(sent) || sent.status === MessageStatus.Failed) {
    reportTargetSendFailure(target, message, 'send', 'send_failed', '发送失败')
    throw new Error('发送失败')
  }
  return sent
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
      reportAppNativeSendFailure(params, clientMsgID, failure)
      reject(failure)
    }
    const timer = setTimeout(() => {
      if (isVideo) devWarn('[video][send] TIMEOUT 未收到成功/失败回调', { clientMsgID, waitMs })
      finish(false, undefined, new Error('发送超时'))
    }, waitMs)
    const offOk = onIMEvent<MessageItem>(IMEvents.SendMessageSuccess, (msg) => {
      const parsed = coerceMessage(msg)
      if (parsed?.clientMsgID === clientMsgID && isCompleteSentMessage(parsed)) finish(true, parsed)
    })
    const offFail = onIMEvent<{ clientMsgID?: string; errMsg?: string }>(IMEvents.SendMessageFailed, (err) => {
      if (!err?.clientMsgID || err.clientMsgID === clientMsgID) {
        finish(false, err, new Error(err?.errMsg || '发送失败'))
      }
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
export async function sendImageMessage(target: IMTarget, filePath: string): Promise<MessageItem> {
  let message: MessageItem
  if (isAppPlatform) {
    message = await imCall<MessageItem>(
      IMMethods.CreateImageMessageFromFullPath,
      toNativeFullPath(filePath),
    )
  } else {
    const file = await pathToFile(filePath)
    const url = await uploadFile(file)
    const size = await imageSizeOf(filePath)
    const picture = { uuid: IMSDK.uuid(), type: file.type, size: file.size, url, ...size }
    message = await imCall<MessageItem>(IMMethods.CreateImageMessageByURL, {
      sourcePath: url,
      sourcePicture: picture,
      bigPicture: picture,
      snapshotPicture: picture,
    })
  }
  return sendCreatedMessage(target, message, { alreadyUploaded: !isAppPlatform })
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

/** App 气泡缺远程封面时：按视频 URL 截帧，同 URL 共用一次下载/取帧。 */
const appPosterByVideoUrl = new Map<string, Promise<string>>()

export function captureAppVideoPosterFromUrl(videoUrl: string): Promise<string> {
  if (!isAppPlatform || !isRemoteMediaUrl(videoUrl)) return Promise.resolve('')
  const key = videoUrl.trim()
  if (!key) return Promise.resolve('')
  let pending = appPosterByVideoUrl.get(key)
  if (!pending) {
    pending = extractVideoCoverForForward(key)
      .then((path) => path || '')
      .catch(() => '')
    appPosterByVideoUrl.set(key, pending)
  }
  return pending
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
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0'
    video.onerror = () => finish(null)
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = videoSnapshotTime(duration)
      if (target > 0.01) {
        video.onseeked = capture
        try {
          video.currentTime = target
        } catch {
          video.onloadeddata = capture
        }
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        capture()
      } else {
        video.onloadeddata = capture
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
  if (isAppPlatform) {
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
  const file = await pathToFile(filePath)
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
  if (!snapshotUrl) throw new Error('无法生成视频封面，请确认浏览器支持该视频格式')
  const url = await uploadFile(file)
  const message = await imCall<MessageItem>(IMMethods.CreateVideoMessageByURL, {
    videoPath: '',
    duration: seconds,
    videoType: file.type || 'mp4',
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
  if (isAppPlatform) {
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
        const uploaded = await uploadFileFromPath(soundPath, `voice_${Date.now()}.aac`, 'audio/mp4')
        message = await imCall<MessageItem>(IMMethods.CreateSoundMessageByURL, {
          uuid: IMSDK.uuid(),
          soundPath: '',
          sourceUrl: uploaded.url,
          dataSize: uploaded.size,
          duration: seconds,
          soundType: 'aac',
        })
        return sendCreatedMessage(target, message, { alreadyUploaded: true })
      }
    }
    return sendCreatedMessage(target, message)
  }
  const file = await pathToFile(filePath)
  const url = await uploadFile(file)
  const message = await imCall<MessageItem>(IMMethods.CreateSoundMessageByURL, {
    uuid: IMSDK.uuid(),
    soundPath: '',
    sourceUrl: url,
    dataSize: file.size,
    duration: seconds,
    soundType: file.type,
  })
  return sendCreatedMessage(target, message, { alreadyUploaded: true })
}

async function uploadFileFromPath(
  fullPath: string,
  fileName: string,
  contentType: string,
): Promise<{ url: string; size: number }> {
  const size = await new Promise<number>((resolve) => {
    uni.getFileInfo({
      filePath: fullPath,
      success: (res) => resolve(Number(res.size) || 0),
      fail: () => resolve(0),
    })
  })
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
  const res = await imCall<{ url: string }>(IMMethods.UploadFile, {
    name: file.name,
    contentType: file.type,
    uuid: IMSDK.uuid(),
    file,
  })
  if (!res?.url) throw new Error('文件上传失败')
  return res.url
}

/**
 * 文件消息。app 端走原生插件读本地全路径；
 * web 端先传对象存储换 URL 再发。
 */
export async function sendFileMessage(
  target: IMTarget,
  filePath: string,
  fileName: string,
): Promise<MessageItem> {
  let message: MessageItem
  if (isAppPlatform) {
    const fullPath = toNativeFullPath(filePath)
    try {
      message = await imCall<MessageItem>(IMMethods.CreateFileMessageFromFullPath, fullPath, fileName)
    } catch {
      // 部分原生插件把参数收成对象，而不是 (path, name)
      message = await imCall<MessageItem>(IMMethods.CreateFileMessageFromFullPath, {
        filePath: fullPath,
        fileName,
      })
    }
  } else {
    const file = await pathToFile(filePath)
    const url = await uploadFile(file)
    message = await imCall<MessageItem>(IMMethods.CreateFileMessageByURL, {
      filePath: '',
      fileName: file.name || fileName,
      uuid: IMSDK.uuid(),
      sourceUrl: url,
      fileSize: file.size,
      fileType: file.type,
    })
  }
  return sendCreatedMessage(target, message, { alreadyUploaded: !isAppPlatform })
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
  return sendCreatedMessage(target, message, { alreadyUploaded: true })
}

/**
 * 选本地文件，返回 { path, name } 列表（一次最多 count 个）。
 * app 端用 OpenIM 原生插件的文件选择器（原生仅支持单选）；
 * 小程序用 chooseMessageFile；H5 用 chooseFile，两者支持 count 多选。
 */
export async function chooseLocalFiles(
  count = 1,
): Promise<Array<{ path: string; name: string }>> {
  if (isAppPlatform) {
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

async function pathToFile(path: string): Promise<File> {
  const blob = await (await fetch(path)).blob()
  const ext = blob.type.split('/')[1] || 'bin'
  return new File([blob], `${Date.now()}.${ext}`, { type: blob.type })
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
  const fromSdk = (message as MessageItem & { conversationID?: string }).conversationID
  if (fromSdk) return fromSdk
  if (message.sessionType === SessionType.Single) {
    if (!message.sendID || !message.recvID) return ''
    return `si_${[message.sendID, message.recvID].sort().join('_')}`
  }
  if (message.sessionType === SessionType.Notification) {
    return `sn_${message.sendID}_${message.recvID}`
  }
  if (!message.groupID) return ''
  return `sg_${message.groupID}`
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

export function toConversation(item: ConversationItem): Conversation {
  const isGroup = item.conversationType !== SessionType.Single
  const groupId = item.groupID || groupIdFromConversationId(item.conversationID)
  const remark = isGroup ? groupRemarkFromEx(conversationEx(item)) : ''
  const unreadCount = conversationNumericField(item, 'unreadCount', 'UnreadCount')
  const groupAtType = conversationNumericField(item, 'groupAtType', 'GroupAtType')
  const atType = effectiveGroupAtType(groupAtType, unreadCount)
  return {
    id: item.conversationID,
    type: isGroup ? 'group' : 'private',
    title: remark || item.showName,
    avatar:
      item.faceURL ||
      (isGroup ? APP_CONFIG.defaultGroupAvatarUrl : APP_CONFIG.defaultAvatarUrl),
    lastMessage: summarize(item.latestMsg),
    lastMessageAt: toISOTime(item.latestMsgSendTime),
    unreadCount,
    pinned: item.isPinned,
    recvMsgOpt: item.recvMsgOpt,
    peerUserId: item.userID || undefined,
    groupId: groupId || undefined,
    groupAtType,
    highlightTags: highlightTagsOf(atType, false),
  }
}

export function toChatMessage(item: MessageItem): ChatMessage {
  const notificationKind = notificationKindOf(item.contentType)
  const content = extractContent(item)
  const rawType = toAppMessageType(Number(item.contentType))
  // App 原生桥偶发 contentType 丢失/类型错标，图片会变成 text + file:// 路径；按 content 再收敛一次
  let type = (resolveQuoteType(rawType, content) as AppMessageType) || rawType
  // 历史：建群欢迎语曾由 imAdmin 以文本气泡下发；归一为系统提示，避免假用户头像
  if (
    type === 'text' &&
    content.trim() === GROUP_CREATED_WELCOME_TEXT &&
    (item.sendID === 'imAdmin' || item.senderNickname === 'imAdmin')
  ) {
    type = 'system'
  }
  return {
    id: item.clientMsgID,
    conversationId: conversationIdOf(item),
    senderId: item.sendID,
    senderAvatar: item.senderFaceUrl || undefined,
    senderNickname: item.senderNickname || undefined,
    type,
    content,
    createdAt: toISOTime(item.sendTime),
    systemEventKey: imNotificationEventKey(item) || undefined,
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
    default:
      return 'system'
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
    if (obj.soundElem && typeof obj.soundElem === 'object') {
      const nested = jsonSoundMeta(obj.soundElem)
      if (nested.path || nested.duration) return nested
    }
    const path =
      (typeof obj.sourceUrl === 'string' && obj.sourceUrl) ||
      (typeof obj.soundPath === 'string' && obj.soundPath) ||
      (typeof obj.path === 'string' && obj.path) ||
      ''
    return { path, duration: Number(obj.duration || 0) }
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

function jsonPictureUrl(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const pictures = [obj.snapshotPicture, obj.sourcePicture, obj.bigPicture]
    for (const picture of pictures) {
      if (picture && typeof picture === 'object' && 'url' in picture) {
        const url = (picture as { url?: unknown }).url
        if (typeof url === 'string' && url) return url
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

/** 图片地址：优先远程 URL，避免 App 端引用/回显时只剩 file:// 本地路径 */
function pictureUrlOf(item: MessageItem): string {
  const candidates = [
    item.pictureElem?.snapshotPicture?.url,
    item.pictureElem?.sourcePicture?.url,
    item.pictureElem?.bigPicture?.url,
    jsonPictureUrl(item.content),
    item.pictureElem?.sourcePath,
    typeof item.content === 'string' ? item.content : '',
  ].filter((u): u is string => typeof u === 'string' && !!u.trim())

  const remote = candidates.find((u) => /^https?:\/\//i.test(u.trim()))
  if (remote) return remote.trim()
  const local = candidates.find((u) => looksLikeImageUrl(u))
  return (local || candidates[0] || '').trim()
}

function quotePreviewOf(item: MessageItem): ChatMessage['quote'] {
  const quoted = quotedMessageOf(item)
  if (!quoted) return undefined
  const type = resolveQuotedAppType(quoted)
  const rawContent = extractContent(quoted)
  return {
    senderNickname: quoted.senderNickname || pickQuotedNickname(quoted) || '',
    thumbUrl: quoteThumbOf(type, rawContent, quoted.senderFaceUrl || undefined) || undefined,
    content: quoteSummaryOf(type, rawContent),
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
  let raw: unknown = (item as { quoteElem?: unknown }).quoteElem
  if (raw == null && typeof item.content === 'string' && item.content.startsWith('{')) {
    try {
      const parsed = JSON.parse(item.content) as { quoteElem?: unknown }
      raw = parsed.quoteElem
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
  if (quoted.soundElem || jsonSoundMeta(quoted.content).path) return 'voice'
  if (quoted.fileElem) return 'file'
  if (quoted.cardElem) return 'card'
  return type
}

function pickQuotedNickname(quoted: MessageItem): string {
  const obj = quoted as unknown as Record<string, unknown>
  return pickString(obj, ['senderNickname', 'SenderNickname', 'senderNickName'])
}

function extractContent(item: MessageItem): string {
  switch (Number(item.contentType)) {
    case MessageType.TextMessage:
      return item.textElem?.content || jsonContentField(item.content, 'content')
    case MessageType.AtTextMessage:
      return item.atTextElem?.text || jsonContentField(item.content, 'text')
    case MessageType.QuoteMessage: {
      const elem = normalizeQuoteElem(item)
      return elem?.text || item.quoteElem?.text || jsonContentField(item.content, 'text')
    }
    case MessageType.PictureMessage:
      return pictureUrlOf(item)
    case MessageType.VoiceMessage: {
      const fromElem = {
        path: item.soundElem?.sourceUrl || item.soundElem?.soundPath || '',
        duration: item.soundElem?.duration || 0,
      }
      const fromJson = jsonSoundMeta(item.content)
      return JSON.stringify({
        path: fromElem.path || fromJson.path,
        duration: fromElem.duration || fromJson.duration,
      })
    }
    case MessageType.FileMessage:
      return item.fileElem?.sourceUrl || ''
    case MessageType.VideoMessage: {
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
    case MessageType.CardMessage: {
      // 名片：content 统一存 {userId, nickname, avatar}，userId 为业务 UUID。
      // 发送时把业务 ID 冗余进 ex；旧消息没有 ex 则从 OpenIM userID 反推。
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
    default: {
      // App 偶发 contentType 丢失，但 content 已是图片 URL
      if (typeof item.content === 'string' && looksLikeImageUrl(item.content)) return item.content
      const pictureUrl = jsonPictureUrl(item.content)
      if (pictureUrl) return pictureUrl
      return formatIMNotification(item)
    }
  }
}

function groupIdFromConversationId(conversationId: string): string {
  return conversationId.startsWith('sg_') ? conversationId.slice(3) : ''
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

function isMessageItem(value: unknown): value is MessageItem {
  return !!value && typeof value === 'object' && typeof (value as MessageItem).clientMsgID === 'string'
}

function coerceMessage(raw: unknown): MessageItem | null {
  const obj = unwrapRawMessage(raw)
  if (!obj) return null
  const clientMsgID = pickString(obj, ['clientMsgID', 'ClientMsgID', 'clientMsgId'])
  if (!clientMsgID) return null
  const contentType = Number(obj.contentType ?? obj.ContentType ?? 0)
  const item = {
    ...(obj as unknown as MessageItem),
    clientMsgID,
    seq: seqOf(obj),
    contentType: Number.isFinite(contentType) ? contentType : 0,
  }
  // OpenIM App 原生桥在部分版本中使用 PascalCase，统一成 Web SDK 的字段名，
  // 后续渲染、收藏和转发就不需要各自判断平台。
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
  return item
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
  const tryCall = (params: unknown) => imCall<unknown>('findMessageList' as IMMethods, params)
  try {
    return parseFindMessageResult(await tryCall([{ conversationID, clientMsgIDList: [clientMsgID] }]), clientMsgID)
  } catch {
    try {
      return parseFindMessageResult(await tryCall({ conversationID, clientMsgIDList: [clientMsgID] }), clientMsgID)
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

  const delays = isAppPlatform ? [0, 400, 1000] : [0]
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
 */
export async function setConversationPin(conversationID: string, isPinned: boolean): Promise<void> {
  await imCall('setConversation' as IMMethods, { conversationID, isPinned })
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
  return (item as ConversationItem & { ex?: string }).ex || ''
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

/** 群备注仅自己可见：写进 OpenIM 会话 ex，随账号云同步，列表标题优先展示备注 */
export async function setConversationGroupRemark(conversationID: string, remark: string): Promise<void> {
  const list = await getConversationList().catch(() => [] as ConversationItem[])
  const current = list.find((item) => item.conversationID === conversationID)
  const extra = parseConversationEx(current ? conversationEx(current) : '')
  const next = remark.trim()
  if (next) extra.groupRemark = next
  else delete extra.groupRemark
  await imCall('setConversation' as IMMethods, {
    conversationID,
    ex: Object.keys(extra).length ? JSON.stringify(extra) : '',
  })
}

/** 清掉会话上的 @ / 新公告强提醒，对应参考站「不再提示」 */
export async function resetConversationGroupAtType(conversationID: string): Promise<void> {
  const attempts: unknown[] = [
    conversationID,
    { conversationID, groupAtType: GroupAtType.AtNormal },
  ]
  if (isAppPlatform) {
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
  const setArgs = isAppPlatform
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
