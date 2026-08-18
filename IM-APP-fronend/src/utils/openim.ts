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
import { fetchIMToken, resolveIMGroup, type IMTokenResult } from '@/api/im'
import type { ChatMessage, Conversation, MessageType as AppMessageType } from '@/types'
import { formatIMNotification, imNotificationEventKey } from '@/utils/im-notification'
import { highlightTagsOf } from '@/utils/group-announcement'

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
}

function invalidatePendingLogin() {
  loginEpoch += 1
  resetLoginCache()
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
  const { errCode, errMsg } = (raw || {}) as { errCode?: number; errMsg?: string }
  const detail = `${method} errCode=${errCode ?? 'unknown'}`
  return new Error(errMsg ? `${errMsg}（${detail}）` : `IM 调用失败（${detail}）`)
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
  }
  let synced = waitForSync()
  try {
    await imCall(IMMethods.Login, payload)
  } catch (e) {
    if (!isLoginRepeat(e)) throw e
    const loggedUserId = await getSdkLoginUserId()
    if (loggedUserId !== imToken.userId) {
      await imCall(IMMethods.Logout).catch(() => undefined)
      synced = waitForSync()
      await imCall(IMMethods.Login, payload)
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
      logLevel: 4,
      isLogStandardOutput: true,
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
  // 三者同时满足才直接复用缓存：本地有用户、token 未过期、且 SDK 当前已连上。
  // 只信前两个会在服务端掉线后误以为仍登录，从而拿到 errCode=10004。
  if (imUserId.value && Date.now() < tokenExpireAt && connected) {
    return imUserId.value
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
  invalidatePendingLogin()
  try {
    await forceSdkLogout()
  } catch {
    // 本地必须清掉，避免下一个账号读到上一个号的会话库
  } finally {
    resetLoginCache()
  }
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
  try {
    await imCall('clearConversationAndDeleteAllMsg' as IMMethods, conversationID)
  } catch {
    await imCall('clearConversationMsgs' as IMMethods, conversationID)
  }
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
    return sendOnAppNative(method, params, message.clientMsgID)
  }
  const sent = await imCall<unknown>(method, params)
  if (!isMessageItem(sent)) throw new Error('发送失败')
  if (sent.status === MessageStatus.Failed) throw new Error('发送失败')
  return sent
}

/**
 * App 原生 sendMessage 会多次回调：先 onProgress（errCode=0 + 数字），再 onSuccess。
 * polyfill 第一次 errCode=0 就 resolve，真正成功被丢掉，会话 latestMsg 不会更新。
 */
function sendOnAppNative(
  method: IMMethods,
  params: unknown,
  clientMsgID: string,
): Promise<MessageItem> {
  const sdk = nativeOpenIM()
  if (!sdk) throw new Error(APP_NATIVE_PLUGIN_MISSING)
  const useNotOss = method === IMMethods.SendMessageNotOss
  if (useNotOss ? typeof sdk.sendMessageNotOss !== 'function' : typeof sdk.sendMessage !== 'function') {
    throw new Error(APP_NATIVE_PLUGIN_MISSING)
  }
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
      reject(err || new Error('发送失败'))
    }
    const timer = setTimeout(() => {
      finish(false, undefined, new Error('发送超时'))
    }, useNotOss ? 15000 : 60000)
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

export async function sendVoiceMessage(
  target: IMTarget,
  filePath: string,
  duration: number,
): Promise<MessageItem> {
  // 录音上限 60 秒，超过 120 的入参只可能是毫秒，统一换算成秒
  const seconds = Math.max(1, Math.round(duration > 120 ? duration / 1000 : duration))
  let message: MessageItem
  if (isAppPlatform) {
    const soundPath = toNativeFullPath(filePath)
    try {
      message = await imCall<MessageItem>(
        IMMethods.CreateSoundMessageFromFullPath,
        soundPath,
        seconds,
      )
    } catch {
      // 部分原生插件把参数收成对象，而不是 (path, duration)
      message = await imCall<MessageItem>(IMMethods.CreateSoundMessageFromFullPath, {
        soundPath,
        duration: seconds,
      })
    }
  } else {
    const file = await pathToFile(filePath)
    const url = await uploadFile(file)
    message = await imCall<MessageItem>(IMMethods.CreateSoundMessageByURL, {
      uuid: IMSDK.uuid(),
      soundPath: '',
      sourceUrl: url,
      dataSize: file.size,
      duration: seconds,
      soundType: file.type,
    })
  }
  return sendCreatedMessage(target, message, { alreadyUploaded: !isAppPlatform })
}

/** 走 OpenIM 自己的对象存储，不经过业务后端 */
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
 * 选一个本地文件，返回 { path, name }。
 * app 端用 OpenIM 原生插件的文件选择器；小程序用 chooseMessageFile；H5 用 chooseFile。
 */
export async function chooseLocalFile(): Promise<{ path: string; name: string }> {
  if (isAppPlatform) {
    const path = await IMSDK.pickFile()
    if (!path) throw new Error('未选择文件')
    const idx = path.lastIndexOf('/')
    return { path, name: idx >= 0 ? path.slice(idx + 1) : '文件' }
  }
  const anyUni = uni as unknown as {
    chooseMessageFile?: (opt: unknown) => void
    chooseFile?: (opt: unknown) => void
  }
  const pick = (fn: (opt: unknown) => void) =>
    new Promise<{ path: string; name?: string } | null>((resolve) => {
      fn({
        count: 1,
        type: 'file',
        success: (res: { tempFiles?: Array<{ path: string; name?: string }> }) =>
          resolve(res.tempFiles?.[0] || null),
        fail: () => resolve(null),
      })
    })
  let picked: { path: string; name?: string } | null = null
  if (typeof anyUni.chooseMessageFile === 'function') {
    picked = await pick(anyUni.chooseMessageFile)
  }
  if (!picked && typeof anyUni.chooseFile === 'function') {
    picked = await pick(anyUni.chooseFile)
  }
  if (!picked?.path) throw new Error('当前平台暂不支持选择文件')
  return { path: picked.path, name: picked.name || '文件' }
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

export function toConversation(item: ConversationItem): Conversation {
  const isGroup = item.conversationType !== SessionType.Single
  const groupId = item.groupID || groupIdFromConversationId(item.conversationID)
  const remark = isGroup ? groupRemarkFromEx(conversationEx(item)) : ''
  return {
    id: item.conversationID,
    type: isGroup ? 'group' : 'private',
    title: remark || item.showName,
    avatar:
      item.faceURL ||
      (isGroup ? APP_CONFIG.defaultGroupAvatarUrl : APP_CONFIG.defaultAvatarUrl),
    lastMessage: summarize(item.latestMsg),
    lastMessageAt: toISOTime(item.latestMsgSendTime),
    unreadCount: item.unreadCount || 0,
    pinned: item.isPinned,
    recvMsgOpt: item.recvMsgOpt,
    peerUserId: item.userID || undefined,
    groupId: groupId || undefined,
    groupAtType: item.groupAtType || 0,
    highlightTags: highlightTagsOf(item.groupAtType || 0, false),
  }
}

export function toChatMessage(item: MessageItem): ChatMessage {
  return {
    id: item.clientMsgID,
    conversationId: conversationIdOf(item),
    senderId: item.sendID,
    senderAvatar: item.senderFaceUrl || undefined,
    senderNickname: item.senderNickname || undefined,
    type: toAppMessageType(item.contentType),
    content: extractContent(item),
    createdAt: toISOTime(item.sendTime),
    systemEventKey: imNotificationEventKey(item) || undefined,
    quote: quotePreviewOf(item),
    status:
      item.status === MessageStatus.Failed
        ? 'failed'
        : item.status === MessageStatus.Sending
          ? 'sending'
          : 'sent',
  }
}

function toAppMessageType(contentType: number): AppMessageType {
  switch (contentType) {
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
    case MessageType.FileMessage:
    case MessageType.VideoMessage:
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
    return ''
  }
}

function quotePreviewOf(item: MessageItem): ChatMessage['quote'] {
  const quoted = item.quoteElem?.quoteMessage
  if (!quoted) return undefined
  const content = extractContent(quoted).trim()
  return {
    senderNickname: quoted.senderNickname || '',
    content: content || '[消息]',
  }
}

function extractContent(item: MessageItem): string {
  switch (item.contentType) {
    case MessageType.TextMessage:
      return item.textElem?.content || jsonContentField(item.content, 'content')
    case MessageType.AtTextMessage:
      return item.atTextElem?.text || jsonContentField(item.content, 'text')
    case MessageType.QuoteMessage:
      return item.quoteElem?.text || jsonContentField(item.content, 'text')
    case MessageType.PictureMessage:
      return (
        item.pictureElem?.snapshotPicture?.url ||
        item.pictureElem?.sourcePicture?.url ||
        item.pictureElem?.sourcePath ||
        jsonPictureUrl(item.content)
      )
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
    case MessageType.VideoMessage:
      return item.videoElem?.videoUrl || ''
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
    default:
      return formatIMNotification(item)
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
  return {
    ...(obj as unknown as MessageItem),
    clientMsgID,
    seq: seqOf(obj),
    contentType: Number.isFinite(contentType) ? contentType : 0,
  }
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
// 会话级设置（置顶 / 免打扰）：直接走 OpenIM SDK，随账号云同步，多端一致。
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
  try {
    await imCall('resetConversationGroupAtType' as IMMethods, conversationID)
  } catch {
    await imCall('setConversation' as IMMethods, { conversationID, groupAtType: 0 })
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
