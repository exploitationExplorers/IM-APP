import { MessageType } from 'openim-uniapp-polyfill'
import type { MessageItem } from 'openim-uniapp-polyfill'
import type { ForwardMessageSnapshot } from '@/types/forward'

export function snapshotFromMessage(item: MessageItem): ForwardMessageSnapshot {
  if (!item.contentType || item.contentType >= 1000) {
    throw new Error('该消息不支持转发')
  }
  return {
    contentType: item.contentType,
    content: contentFromMessage(item),
  }
}

function contentFromMessage(item: MessageItem): unknown {
  switch (item.contentType) {
    case MessageType.TextMessage:
      if (item.textElem?.content) return { content: item.textElem.content }
      break
    case MessageType.AtTextMessage:
      if (item.atTextElem) return item.atTextElem
      break
    case MessageType.QuoteMessage:
      if (item.quoteElem) return item.quoteElem
      break
    case MessageType.PictureMessage:
      if (item.pictureElem) return normalizePictureElem(item.pictureElem)
      break
    case MessageType.VoiceMessage:
      if (item.soundElem) return item.soundElem
      break
    case MessageType.FileMessage:
      if (item.fileElem) return item.fileElem
      break
    case MessageType.VideoMessage:
      if (item.videoElem) return item.videoElem
      break
    default:
      break
  }
  return parseStoredContent(item.content)
}

function parseStoredContent(raw: string): unknown {
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

function withPictureType(pic: PictureInfo | undefined, fallbackType: string): PictureInfo | undefined {
  if (!pic || typeof pic !== 'object') return undefined
  if (pic.type && pic.type.trim()) return pic
  return { ...pic, type: fallbackType }
}

function normalizePictureElem(elem: unknown): unknown {
  if (!elem || typeof elem !== 'object') return elem
  const e = elem as {
    sourcePicture?: PictureInfo
    bigPicture?: PictureInfo
    snapshotPicture?: PictureInfo
  }
  const fallbackType = firstPictureType([e.sourcePicture, e.bigPicture, e.snapshotPicture])
  const source = withPictureType(e.sourcePicture, fallbackType)
  const big = withPictureType(e.bigPicture, fallbackType) ?? source
  const snapshot = withPictureType(e.snapshotPicture, fallbackType) ?? source
  return { ...e, sourcePicture: source, bigPicture: big, snapshotPicture: snapshot }
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
