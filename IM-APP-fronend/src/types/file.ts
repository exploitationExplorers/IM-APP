/** 文件上传相关类型（对齐 Apifox） */

export type UploadPurpose = 'avatar' | 'image' | 'voice' | 'file' | 'sticker'

export interface CreateUploadInput {
  purpose: UploadPurpose
  fileName: string
  contentType: string
  size: number
  sha256?: string
}

export interface FileObject {
  id: string
  purpose?: string
  fileName?: string
  contentType?: string
  size?: number
  url?: string
  thumbnailUrl?: string
  durationMs?: number
  status?: string
}

export interface UploadInitResult {
  file: FileObject
  uploadUrl: string
  formUrl?: string
  formData?: Record<string, string>
  headers?: Record<string, string>
  expiresIn: number
}

export interface CompleteUploadInput {
  etag?: string
}

/** @deprecated 使用 FileObject */
export type FileInfo = FileObject

/** @deprecated 旧版 presign 响应 */
export interface PresignResult {
  uploadUrl: string
  fileUrl: string
  objectKey: string
  expiresIn: number
  devMode?: boolean
}
