export type ImagePreviewSession = {
  urls: string[]
  current: number
  owner: string
  thumbnails: string[]
}
let session: { id: string; data: ImagePreviewSession; at: number } | undefined

/** URLs (including OSS signatures) stay in memory, not navigation URLs/storage. */
export function createImagePreviewSession(data: ImagePreviewSession): string {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  session = { id, data, at: Date.now() }
  return id
}

export function takeImagePreviewSession(id: string): ImagePreviewSession | undefined {
  if (!session || session.id !== id || Date.now() - session.at > 60000) return undefined
  const data = session.data
  session = undefined
  return data
}
