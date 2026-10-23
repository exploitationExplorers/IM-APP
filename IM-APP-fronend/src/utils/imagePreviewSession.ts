export type ImagePreviewSession = {
  urls: string[]
  current: number
  owner: string
  thumbnails: string[]
  /** 保存时使用的原图；查看和缩放仍使用压缩后的 urls。 */
  originals?: string[]
}
let session: { id: string; data: ImagePreviewSession; at: number } | undefined

/** URLs (including OSS signatures) stay in memory, not navigation URLs/storage. */
export function createImagePreviewSession(data: ImagePreviewSession): string {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  session = { id, data, at: Date.now() }
  return id
}

/** 保存优先使用原图；仅在调用方未提供原图时回退到当前可保存的预览文件。 */
export function imagePreviewSaveSource(
  session: ImagePreviewSession | undefined,
  index: number,
  readyPath = '',
): string {
  return String(session?.originals?.[index] || readyPath || session?.urls[index] || '').trim()
}

export function takeImagePreviewSession(id: string): ImagePreviewSession | undefined {
  if (!session || session.id !== id || Date.now() - session.at > 60000) return undefined
  const data = session.data
  session = undefined
  return data
}
