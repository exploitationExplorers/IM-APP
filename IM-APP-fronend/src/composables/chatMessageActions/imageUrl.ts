import type { ChatMessage } from '@/types'

const PICTURE_KEYS = [
  'sourcePicture',
  'bigPicture',
  'snapshotPicture',
  'SourcePicture',
  'BigPicture',
  'SnapshotPicture',
] as const

function urlFromPicture(pic: unknown): string {
  if (!pic || typeof pic !== 'object') return ''
  return String((pic as { url?: string; URL?: string }).url || (pic as { URL?: string }).URL || '')
}

function pickPictureUrl(raw: string): string {
  const text = (raw || '').trim()
  if (/^https?:\/\//i.test(text) || text.startsWith('blob:') || text.startsWith('/')) return text
  if (!text || text[0] !== '{') return ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    for (const key of PICTURE_KEYS) {
      const url = urlFromPicture(parsed[key])
      if (url) return url
    }
    return String(parsed.url || parsed.URL || '')
  } catch {
    return ''
  }
}

/** 从图片消息取出可下载/可加表情的远程地址（兼容 camelCase / PascalCase） */
export function imageUrlOfMessage(message: ChatMessage): string {
  const primary = pickPictureUrl(message.sourceUrl || message.content || '')
  if (primary) return primary
  for (const fallback of message.imageFallbacks || []) {
    const url = pickPictureUrl(fallback)
    if (url) return url
  }
  return ''
}
