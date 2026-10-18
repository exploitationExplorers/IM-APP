import type { MessageItem } from 'openim-uniapp-polyfill'
import type { ForwardMessageSnapshot } from '@/types/forward'

// 仅需协议固定值；避免纯函数测试加载会初始化 uni/OpenIM 的运行时 SDK。
const MESSAGE_TYPE = {
  Text: 101,
  Picture: 102,
  Voice: 103,
  Video: 104,
  File: 105,
  AtText: 106,
  Merge: 107,
  Quote: 114,
} as const

export function snapshotFromMessage(item: MessageItem): ForwardMessageSnapshot {
  return buildSnapshot(item, 0)
}

function buildSnapshot(item: MessageItem, depth: number): ForwardMessageSnapshot {
  if (depth > 6) throw new Error('引用消息层级过深，无法转发')
  const raw = item as unknown as Record<string, unknown>
  const contentType = Number(raw.contentType ?? raw.ContentType ?? 0)
  if (!contentType || contentType >= 1000) {
    throw new Error('该消息不支持转发')
  }
  return {
    contentType,
    content: contentFromMessage(item, contentType, depth),
  }
}

function contentFromMessage(item: MessageItem, contentType: number, depth: number): unknown {
  const raw = item as unknown as Record<string, unknown>
  const stored = () => parseStoredContent(raw.content ?? raw.Content)
  switch (contentType) {
    case MESSAGE_TYPE.Text:
      {
        const elem = asObject(raw.textElem ?? raw.TextElem)
        if (elem) return { content: elem.content ?? elem.Content ?? '' }
      }
      break
    case MESSAGE_TYPE.AtText:
      return normalizeReference(
        asObject(raw.atTextElem ?? raw.AtTextElem) ?? asObject(stored()) ?? {},
        depth,
        true,
      )
    case MESSAGE_TYPE.Quote:
      return normalizeReference(
        asObject(raw.quoteElem ?? raw.QuoteElem) ?? asObject(stored()) ?? {},
        depth,
      )
    case MESSAGE_TYPE.Picture:
      return normalizePictureElem(asObject(raw.pictureElem ?? raw.PictureElem) ?? stored())
    case MESSAGE_TYPE.Voice: {
      const elem = asObject(raw.soundElem ?? raw.SoundElem) ?? asObject(stored()) ?? {}
      return {
        uuid: stringOf(elem, ['uuid', 'UUID']),
        soundPath: '',
        sourceUrl: preferHttpUrl(
          stringOf(elem, ['sourceUrl', 'SourceUrl', 'SourceURL']),
          stringOf(elem, ['soundPath', 'SoundPath']),
        ),
        dataSize: numberOf(elem, ['dataSize', 'DataSize']),
        duration: numberOf(elem, ['duration', 'Duration']),
      }
    }
    case MESSAGE_TYPE.File: {
      const elem = asObject(raw.fileElem ?? raw.FileElem) ?? asObject(stored()) ?? {}
      return {
        uuid: stringOf(elem, ['uuid', 'UUID']),
        filePath: '',
        sourceUrl: preferHttpUrl(
          stringOf(elem, ['sourceUrl', 'SourceUrl', 'SourceURL']),
          stringOf(elem, ['filePath', 'FilePath']),
        ),
        fileName: stringOf(elem, ['fileName', 'FileName']),
        fileSize: numberOf(elem, ['fileSize', 'FileSize']),
      }
    }
    case MESSAGE_TYPE.Video:
      return normalizeVideoElem(item)
    case MESSAGE_TYPE.Merge: {
      const elem = asObject(raw.mergeElem ?? raw.MergeElem) ?? asObject(stored()) ?? {}
      const messages = elem.multiMessage ?? elem.MultiMessage
      const parsedMessages: unknown = typeof messages === 'string' ? JSON.parse(messages) : messages
      if (!Array.isArray(parsedMessages) || parsedMessages.length === 0)
        throw new Error('合并消息内容无效')
      return {
        title: elem.title ?? elem.Title ?? '',
        abstractList: elem.abstractList ?? elem.AbstractList ?? [],
        multiMessage: parsedMessages.map((message) => normalizeEmbeddedMessage(message, depth + 1)),
        messageEntityList: elem.messageEntityList ?? elem.MessageEntityList ?? [],
      }
    }
    default:
      break
  }
  return stored()
}

function normalizeReference(
  elem: Record<string, unknown>,
  depth: number,
  atText = false,
): Record<string, unknown> {
  const quote = elem.quoteMessage ?? elem.QuoteMessage
  return {
    text: elem.text ?? elem.Text ?? '',
    ...(quote ? { quoteMessage: normalizeEmbeddedMessage(quote, depth + 1) } : {}),
    ...(atText
      ? {
          atUserList: elem.atUserList ?? elem.AtUserList ?? [],
          atUsersInfo: normalizeAtUsersInfo(elem.atUsersInfo ?? elem.AtUsersInfo),
        }
      : {}),
  }
}

function normalizeAtUsersInfo(raw: unknown): Array<{ atUserID: string; groupNickname: string }> {
  if (!Array.isArray(raw)) return []
  return raw.map((value) => {
    const info = asObject(value) ?? {}
    return {
      atUserID: stringOf(info, ['atUserID', 'AtUserID']),
      groupNickname: stringOf(info, ['groupNickname', 'GroupNickname']),
    }
  })
}

function normalizeEmbeddedMessage(raw: unknown, depth: number): MessageItem {
  const message = asObject(raw)
  if (!message) throw new Error('引用消息内容无效')
  const item = message as unknown as MessageItem
  return withForwardSnapshot(item, buildSnapshot(item, depth))
}

const elemNames: Record<number, string> = {
  101: 'textElem',
  102: 'pictureElem',
  103: 'soundElem',
  104: 'videoElem',
  105: 'fileElem',
  106: 'atTextElem',
  107: 'mergeElem',
  114: 'quoteElem',
}

/** The native bridge can return frozen objects. Update a plain copy and both
 * field aliases so an SDK cannot prefer a stale content/element URL. */
export function withForwardSnapshot(
  item: MessageItem,
  snapshot: ForwardMessageSnapshot,
): MessageItem {
  const plain = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
  const content = JSON.parse(JSON.stringify(snapshot.content)) as unknown
  plain.contentType = snapshot.contentType
  plain.content = JSON.stringify(content)
  if ('ContentType' in plain) plain.ContentType = snapshot.contentType
  if ('Content' in plain) plain.Content = plain.content
  // Quoted native messages also need identity/time aliases for H5 rendering.
  for (const key of [
    'clientMsgID',
    'serverMsgID',
    'sendID',
    'recvID',
    'groupID',
    'sendTime',
    'createTime',
    'sessionType',
    'seq',
    'status',
    'senderNickname',
    'senderFaceUrl',
  ]) {
    const pascal = key[0].toUpperCase() + key.slice(1)
    if (plain[key] === undefined && plain[pascal] !== undefined) plain[key] = plain[pascal]
  }
  const name = elemNames[snapshot.contentType]
  if (name) {
    plain[name] = content
    const pascal = name[0].toUpperCase() + name.slice(1)
    if (pascal in plain) plain[pascal] = content
  }
  return plain as unknown as MessageItem
}

export function mayContainForwardMedia(contentType: number): boolean {
  return [102, 103, 104, 105, 106, 107, 114].includes(contentType)
}

function asObject(raw: unknown): Record<string, unknown> | null {
  for (let depth = 0; typeof raw === 'string' && raw && depth < 4; depth += 1) {
    try {
      raw = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function stringOf(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function numberOf(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(obj[key])
    if (Number.isFinite(value) && value >= 0) return value
  }
  return 0
}

/**
 * App 原生桥可能返回 VideoElem/PascalCase，或只在 content 中留下简化元数据。
 * 转发前冻结成 OpenIM VideoElem；snapshotUrl 必须是远程地址，否则 send_msg 会被拒。
 */
export function normalizeVideoElem(item: MessageItem): Record<string, unknown> {
  const raw = item as unknown as Record<string, unknown>
  const elem =
    asObject(raw.videoElem ?? raw.VideoElem) || asObject(raw.content ?? raw.Content) || {}
  const videoUrl = preferHttpUrl(
    stringOf(elem, ['videoUrl', 'VideoUrl', 'videoURL', 'VideoURL', 'url', 'URL']),
    stringOf(elem, ['videoPath', 'VideoPath']),
  )
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    throw new Error('视频地址不存在，无法转发')
  }
  const snapshotUrl = preferHttpUrl(
    stringOf(elem, ['snapshotUrl', 'SnapshotUrl', 'snapshotURL', 'SnapshotURL']),
    stringOf(elem, ['snapshotPath', 'SnapshotPath']),
  )
  const fallbackId =
    item.clientMsgID || stringOf(raw, ['ClientMsgID', 'clientMsgId']) || `video_${Date.now()}`
  const duration = numberOf(elem, ['duration', 'Duration'])
  const videoSize = numberOf(elem, ['videoSize', 'VideoSize'])
  const snapshotWidth = numberOf(elem, ['snapshotWidth', 'SnapshotWidth'])
  const snapshotHeight = numberOf(elem, ['snapshotHeight', 'SnapshotHeight'])
  return {
    videoPath: '',
    videoUUID: stringOf(elem, ['videoUUID', 'VideoUUID', 'videoUuid']) || `${fallbackId}_video`,
    videoUrl,
    videoType: stringOf(elem, ['videoType', 'VideoType']) || 'mp4',
    // OpenIM send_msg 要求 videoSize；未知时用 1 占位，避免 0 触发校验失败
    videoSize: videoSize > 0 ? videoSize : 1,
    duration: duration > 0 ? duration : 1,
    snapshotPath: '',
    snapshotUUID:
      stringOf(elem, ['snapshotUUID', 'SnapshotUUID', 'snapshotUuid']) || `${fallbackId}_cover`,
    snapshotSize: numberOf(elem, ['snapshotSize', 'SnapshotSize']),
    snapshotUrl: /^https?:\/\//i.test(snapshotUrl) ? snapshotUrl : '',
    snapshotWidth: snapshotWidth > 0 ? snapshotWidth : 720,
    snapshotHeight: snapshotHeight > 0 ? snapshotHeight : 1280,
  }
}

function preferHttpUrl(...candidates: string[]): string {
  const cleaned = candidates.map((v) => String(v || '').trim()).filter(Boolean)
  const remote = cleaned.find((v) => /^https?:\/\//i.test(v))
  return remote || cleaned[0] || ''
}

/** 用聊天层简化 content 补齐 raw 消息里缺失的视频 URL（App 偶发只落在 ChatMessage.content）。 */
export function mergeVideoSnapshotFromChatContent(
  snapshot: ForwardMessageSnapshot,
  chatContent: string,
): ForwardMessageSnapshot {
  if (snapshot.contentType !== MESSAGE_TYPE.Video) return snapshot
  const meta = (() => {
    try {
      return typeof chatContent === 'string'
        ? (JSON.parse(chatContent) as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  })()
  if (!meta || typeof meta !== 'object') return snapshot
  const content = { ...(asObject(snapshot.content) || {}) }
  const chatUrl = preferHttpUrl(String(meta.url || ''), String(meta.videoUrl || ''))
  const chatSnap = preferHttpUrl(String(meta.snapshotUrl || ''), String(meta.SnapshotUrl || ''))
  if ((!content.videoUrl || !/^https?:\/\//i.test(String(content.videoUrl))) && chatUrl) {
    content.videoUrl = chatUrl
  }
  if ((!content.snapshotUrl || !/^https?:\/\//i.test(String(content.snapshotUrl))) && chatSnap) {
    content.snapshotUrl = chatSnap
  }
  const chatDuration = Number(meta.duration || 0)
  if (!(Number(content.duration) > 0) && chatDuration > 0) content.duration = chatDuration
  return { contentType: snapshot.contentType, content }
}

export function patchVideoSnapshotCover(
  snapshot: ForwardMessageSnapshot,
  cover: { url: string; width?: number; height?: number; size?: number },
): ForwardMessageSnapshot {
  if (snapshot.contentType !== MESSAGE_TYPE.Video) return snapshot
  const content = { ...(asObject(snapshot.content) || {}) }
  content.snapshotUrl = cover.url
  content.snapshotPath = ''
  if (cover.width && cover.width > 0) content.snapshotWidth = cover.width
  if (cover.height && cover.height > 0) content.snapshotHeight = cover.height
  if (cover.size && cover.size > 0) content.snapshotSize = cover.size
  if (!(Number(content.snapshotWidth) > 0)) content.snapshotWidth = 720
  if (!(Number(content.snapshotHeight) > 0)) content.snapshotHeight = 1280
  return { contentType: snapshot.contentType, content }
}

export function videoSnapshotNeedsRemoteCover(snapshot: ForwardMessageSnapshot): boolean {
  if (snapshot.contentType !== MESSAGE_TYPE.Video) return false
  const content = asObject(snapshot.content) || {}
  return !/^https?:\/\//i.test(String(content.snapshotUrl || ''))
}

function parseStoredContent(raw: unknown): unknown {
  if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null) return parsed
    } catch {
      return { content: raw }
    }
  }
  if (raw && typeof raw === 'object') return raw
  throw new Error('无法读取消息内容')
}

/**
 * OpenIM 服务端对 PictureElem 的每个图片对象都有 required 校验（至少 type 必填，url 亦然）。
 * App 原生插件发出的图片，其缩略图 snapshotPicture 常常缺 type，本人发送时不暴露，
 * 一到转发（经服务端 send_msg）才被 OpenIM 拒成
 * ServerInternalError: Field validation for 'Type' failed on the 'required' tag。
 * 冻结快照前在此补齐：用兄弟图片的 type 兜底，仍缺则默认 image/jpeg；整对象缺失时用 sourcePicture 补。
 */
const DEFAULT_PICTURE_TYPE = 'image/jpeg'

interface PictureInfo {
  uuid?: string
  type?: string
  size?: number
  width?: number
  height?: number
  url?: string
}

function firstPictureType(pics: Array<PictureInfo | undefined>): string {
  for (const pic of pics) {
    const type = pic?.type?.trim()
    if (type) return type
  }
  return DEFAULT_PICTURE_TYPE
}

function withPictureType(
  pic: PictureInfo | undefined,
  fallbackType: string,
): PictureInfo | undefined {
  if (!pic || typeof pic !== 'object') return undefined
  if (pic.type && pic.type.trim()) return pic
  return { ...pic, type: fallbackType }
}

function normalizePictureElem(elem: unknown): unknown {
  const raw = asObject(elem)
  if (!raw) return elem
  const picture = (value: unknown): PictureInfo | undefined => {
    const p = asObject(value)
    if (!p) return undefined
    return {
      uuid: stringOf(p, ['uuid', 'UUID']),
      type: stringOf(p, ['type', 'Type']),
      url: stringOf(p, ['url', 'Url', 'URL']),
      size: numberOf(p, ['size', 'Size']),
      width: numberOf(p, ['width', 'Width']),
      height: numberOf(p, ['height', 'Height']),
    }
  }
  const e = {
    sourcePicture: picture(raw.sourcePicture ?? raw.SourcePicture),
    bigPicture: picture(raw.bigPicture ?? raw.BigPicture),
    snapshotPicture: picture(raw.snapshotPicture ?? raw.SnapshotPicture),
  }
  const fallbackType = firstPictureType([e.sourcePicture, e.bigPicture, e.snapshotPicture])
  const source = withPictureType(e.sourcePicture, fallbackType)
  const big = withPictureType(e.bigPicture, fallbackType) ?? source
  const snapshot = withPictureType(e.snapshotPicture, fallbackType) ?? source
  return { sourcePath: '', sourcePicture: source, bigPicture: big, snapshotPicture: snapshot }
}

export function createIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function chunkIds(ids: string[], size: number): string[][] {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size))
  }
  return batches
}
