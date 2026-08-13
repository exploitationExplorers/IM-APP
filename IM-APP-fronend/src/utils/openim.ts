import { ref } from 'vue'
import IMSDK, {
  IMEvents,
  IMMethods,
  MessageStatus,
  MessageType,
  Platform,
  SessionType,
} from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import { APP_CONFIG } from '@/config'
import { fetchIMToken, type IMTokenResult } from '@/api/im'
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

/** app 端走原生插件，web / 小程序端走 @openim/client-sdk，两者初始化方式不同 */
const isAppPlatform = uni.getSystemInfoSync().uniPlatform === 'app'

/** 当前登录的 OpenIM 用户 ID，消息里的 sendID 就是它 */
export const imUserId = ref('')

let tokenExpireAt = 0
let loginPromise: Promise<string> | null = null

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

/**
 * 登录成功只代表连上了，SDK 还要异步从服务端拉会话与消息。
 * 这期间查历史会拿到空列表，所以要等同步结束；超时兜底，避免同步事件丢失时卡死。
 */
function waitForSync(timeoutMs = 8000): Promise<void> {
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

  // 先挂监听再登录，否则同步很快结束时会错过事件
  const synced = waitForSync()
  await imCall(IMMethods.Login, {
    userID: imToken.userId,
    token: imToken.token,
    platformID: imToken.platform,
    apiAddr: imToken.apiAddr,
    wsAddr: imToken.wsAddr,
  })
  await synced

  imUserId.value = imToken.userId
  // 提前 5 分钟过期，避免正在聊天时 token 失效
  tokenExpireAt = Date.now() + Math.max(0, imToken.expireSec - 300) * 1000
  return imUserId.value
}

/** 保证 SDK 已登录，重复调用只会真正登录一次；返回当前 OpenIM 用户 ID */
export async function ensureIMLogin(): Promise<string> {
  if (!shouldUseOpenIM()) throw new Error('聊天功能未启用')
  if (imUserId.value && Date.now() < tokenExpireAt) return imUserId.value
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null
    })
  }
  return loginPromise
}

/** 业务登录成功后调用，失败不阻断主流程 */
export async function initOpenIM(): Promise<void> {
  if (!shouldUseOpenIM()) return
  await ensureIMLogin()
}

export async function logoutOpenIM(): Promise<void> {
  if (!imUserId.value) return
  try {
    await imCall(IMMethods.Logout)
  } finally {
    imUserId.value = ''
    tokenExpireAt = 0
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

/** 按业务目标取会话，OpenIM 会在不存在时新建，无需先建群或建会话 */
export async function getOneConversation(
  sourceID: string,
  sessionType: number,
): Promise<ConversationItem> {
  return imCall<ConversationItem>(IMMethods.GetOneConversation, { sourceID, sessionType })
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
  if (message.sessionType === SessionType.Single) {
    return `si_${[message.sendID, message.recvID].sort().join('_')}`
  }
  if (message.sessionType === SessionType.Notification) {
    return `sn_${message.sendID}_${message.recvID}`
  }
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
  return {
    id: item.conversationID,
    type: item.conversationType === SessionType.Single ? 'private' : 'group',
    title: item.showName,
    avatar: item.faceURL || APP_CONFIG.defaultAvatarUrl,
    lastMessage: summarize(item.latestMsg),
    lastMessageAt: toISOTime(item.latestMsgSendTime),
    unreadCount: item.unreadCount || 0,
    pinned: item.isPinned,
    peerUserId: item.userID || undefined,
    groupId: item.groupID || undefined,
  }
}

export function toChatMessage(item: MessageItem): ChatMessage {
  return {
    id: item.clientMsgID,
    conversationId: conversationIdOf(item),
    senderId: item.sendID,
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

function extractContent(item: MessageItem): string {
  switch (item.contentType) {
    case MessageType.TextMessage:
      return item.textElem?.content || ''
    case MessageType.AtTextMessage:
      return item.atTextElem?.text || ''
    case MessageType.QuoteMessage:
      return item.quoteElem?.text || ''
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
      return item.notificationElem?.detail || ''
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
