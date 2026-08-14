import { ref } from 'vue'
import IMSDK, {
  IMEvents,
  IMMethods,
  LoginStatus,
  MessageStatus,
  MessageType,
  Platform,
  SessionType,
} from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import { APP_CONFIG } from '@/config'
import { fetchIMToken, resolveIMGroup, type IMTokenResult } from '@/api/im'
import type { ChatMessage, Conversation, MessageType as AppMessageType } from '@/types'

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
 * 统一 asyncApi 的返回形态：多数方法返回 { errCode, data } 信封，
 * createXxxMessage 这类同步方法直接返回结果本身。
 * 失败时 polyfill reject 的是 { errCode, errMsg } 裸对象，转成 Error 才能带到 UI。
 */
async function imCall<T>(method: IMMethods, ...args: unknown[]): Promise<T> {
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

async function doLogin(): Promise<string> {
  const imToken: IMTokenResult = await fetchIMToken(currentPlatformId())

  if (isAppPlatform) {
    await imCall(IMMethods.InitSDK, {
      platformID: imToken.platform,
      apiAddr: imToken.apiAddr,
      wsAddr: imToken.wsAddr,
      dataDir: (uni as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH,
      logLevel: 4,
      isLogStandardOutput: true,
    })
  }

  const status = await getSdkLoginStatus()
  if (status === LoginStatus.Logged) {
    const loggedUserId = await getSdkLoginUserId()
    if (!loggedUserId || loggedUserId === imToken.userId) {
      return rememberLogin(imToken)
    }
    await imCall(IMMethods.Logout).catch(() => undefined)
  }

  // 先挂监听再登录，否则同步很快结束时会错过事件
  const synced = waitForSync()
  try {
    await imCall(IMMethods.Login, {
      userID: imToken.userId,
      token: imToken.token,
      platformID: imToken.platform,
      apiAddr: imToken.apiAddr,
      wsAddr: imToken.wsAddr,
    })
  } catch (e) {
    if (!isLoginRepeat(e)) throw e
    return rememberLogin(imToken)
  }
  await synced
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
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null
    })
  }
  return loginPromise
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
    resetLoginCache()
  })
  // token 被服务端判过期：旧 token 作废，必须重新向业务后端换 token 再登录。
  onIMEvent(IMEvents.OnUserTokenExpired, () => {
    resetLoginCache()
  })
}

/** 业务登录成功后调用，失败不阻断主流程 */
export async function initOpenIM(): Promise<void> {
  if (!shouldUseOpenIM()) return
  setupConnectionWatchers() // 注册连接生命周期监听（只注册一次）
  await ensureIMLogin()
}

export async function logoutOpenIM(): Promise<void> {
  if (!imUserId.value) return
  try {
    await imCall(IMMethods.Logout)
  } finally {
    imUserId.value = ''
    tokenExpireAt = 0
    connected = false
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
  return imCall<{ messageList: MessageItem[]; isEnd: boolean }>(
    IMMethods.GetAdvancedHistoryMessageList,
    { conversationID, count, startClientMsgID },
  )
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

export async function revokeMessage(conversationID: string, clientMsgID: string): Promise<void> {
  await imCall(IMMethods.RevokeMessage, { conversationID, clientMsgID })
}

async function sendCreatedMessage(target: IMTarget, message: MessageItem): Promise<MessageItem> {
  // sessionType=3 必须填 groupID，填 recvID 会被 OpenIM 拒绝
  return imCall<MessageItem>(IMMethods.SendMessage, {
    recvID: target.sessionType === SessionType.Single ? target.recvId : '',
    groupID: target.sessionType === SessionType.Single ? '' : target.groupId,
    message,
  })
}

export async function sendTextMessage(target: IMTarget, text: string): Promise<MessageItem> {
  const message = await imCall<MessageItem>(IMMethods.CreateTextMessage, text)
  return sendCreatedMessage(target, message)
}

/**
 * 图片消息。app 端交给原生插件读本地全路径并自行上传；
 * web 端没有 createImageMessageFromFullPath，先把文件传到对象存储换 URL 再发。
 */
export async function sendImageMessage(target: IMTarget, filePath: string): Promise<MessageItem> {
  let message: MessageItem
  if (isAppPlatform) {
    message = await imCall<MessageItem>(IMMethods.CreateImageMessageFromFullPath, filePath)
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
  return sendCreatedMessage(target, message)
}

export async function sendVoiceMessage(
  target: IMTarget,
  filePath: string,
  duration: number,
): Promise<MessageItem> {
  const seconds = Math.max(1, Math.round(duration))
  let message: MessageItem
  if (isAppPlatform) {
    message = await imCall<MessageItem>(
      IMMethods.CreateSoundMessageFromFullPath,
      filePath,
      seconds,
    )
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
  return sendCreatedMessage(target, message)
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
      groupId: conversation.groupID,
    }
  }
  return {
    conversationId: conversation.id,
    sessionType: conversation.type === 'group' ? SessionType.Group : SessionType.Single,
    recvId: conversation.peerUserId || '',
    groupId: conversation.groupId || '',
  }
}

export function toConversation(item: ConversationItem): Conversation {
  const isGroup = item.conversationType !== SessionType.Single
  return {
    id: item.conversationID,
    type: isGroup ? 'group' : 'private',
    title: item.showName,
    avatar:
      item.faceURL ||
      (isGroup ? APP_CONFIG.defaultGroupAvatarUrl : APP_CONFIG.defaultAvatarUrl),
    lastMessage: summarize(item.latestMsg),
    lastMessageAt: toISOTime(item.latestMsgSendTime),
    unreadCount: item.unreadCount || 0,
    pinned: item.isPinned,
    recvMsgOpt: item.recvMsgOpt,
    peerUserId: item.userID || undefined,
    groupId: item.groupID || undefined,
  }
}

export function toChatMessage(item: MessageItem): ChatMessage {
  return {
    id: item.clientMsgID,
    conversationId: conversationIdOf(item),
    senderId: item.sendID,
    senderAvatar: item.senderFaceUrl || undefined,
    type: toAppMessageType(item.contentType),
    content: extractContent(item),
    createdAt: toISOTime(item.sendTime),
    status: item.status === MessageStatus.Failed ? 'failed' : 'sent',
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
    case MessageType.FileMessage:
    case MessageType.VideoMessage:
      return 'file'
    default:
      return 'system'
  }
}

function jsonContentField(raw: string, key: string): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && key in parsed) {
      const value = (parsed as Record<string, unknown>)[key]
      return typeof value === 'string' ? value : ''
    }
  } catch {
    /* content 不是 JSON 时按纯文本用 */
  }
  return raw
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
        ''
      )
    case MessageType.VoiceMessage:
      return JSON.stringify({
        path: item.soundElem?.sourceUrl || item.soundElem?.soundPath || '',
        duration: item.soundElem?.duration || 0,
      })
    case MessageType.FileMessage:
      return item.fileElem?.sourceUrl || ''
    case MessageType.VideoMessage:
      return item.videoElem?.videoUrl || ''
    default:
      // 好友通知等 detail 是 JSON，聊天气泡里展示不出来，交给页面过滤
      return ''
  }
}

function summarize(latestMsg: string): string {
  if (!latestMsg) return ''
  try {
    const message = JSON.parse(latestMsg) as MessageItem
    const type = toAppMessageType(message.contentType)
    if (type === 'text') return extractContent(message)
    if (type === 'image') return '[图片]'
    if (type === 'voice') return '[语音]'
    if (type === 'file') return '[文件]'
    return '[消息]'
  } catch {
    return ''
  }
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

/**
 * 群聊的 OpenIM 会话 ID 是 `sg_` + 群 ID（超级群 groupType=2，本项目群均为该类型）。
 * 用业务群 ID 换取 OpenIM 群 ID 后，可确定性拼出会话 ID，无需先建会话。
 */
export async function resolveGroupConversationID(businessGroupId: string): Promise<string> {
  const target = await resolveIMGroup(businessGroupId)
  return `sg_${target.imGroupId}`
}
