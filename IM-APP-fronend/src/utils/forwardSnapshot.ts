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
      if (item.pictureElem) return item.pictureElem
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
