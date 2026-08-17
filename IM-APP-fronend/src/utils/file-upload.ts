import { completeUpload, createUploadTask } from '@/api/file'
import type { UploadPurpose } from '@/types'

function guessContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  }
  return map[ext] || 'application/octet-stream'
}

function getFileName(filePath: string, fallback = 'avatar.jpg'): string {
  const idx = filePath.lastIndexOf('/')
  const name = idx >= 0 ? filePath.slice(idx + 1) : filePath
  return name || fallback
}

async function loadImageBlob(localPath?: string, remoteUrl?: string): Promise<{ blob: Blob; fileName: string }> {
  if (localPath) {
    const blob = await fetch(localPath).then((res) => res.blob())
    return { blob, fileName: getFileName(localPath) }
  }
  if (remoteUrl) {
    const blob = await fetch(remoteUrl).then((res) => res.blob())
    const ext = blob.type.split('/')[1] || 'jpg'
    return { blob, fileName: `avatar.${ext}` }
  }
  throw new Error('请选择头像')
}

async function putBlob(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  headers: Record<string, string> = {},
): Promise<void> {
  if (typeof fetch === 'undefined') {
    throw new Error('当前环境不支持文件上传')
  }
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      ...headers,
    },
    body: blob,
  })
  if (!res.ok) {
    throw new Error(`上传失败(${res.status})`)
  }
}

async function uploadViaTask(
  purpose: UploadPurpose,
  blob: Blob,
  fileName: string,
  contentType: string,
): Promise<string> {
  const init = await createUploadTask({
    purpose,
    fileName,
    contentType,
    size: blob.size,
  })
  const fileId = init.file.id
  if (!fileId) {
    throw new Error('创建上传任务失败')
  }
  await putBlob(init.uploadUrl, blob, contentType, init.headers || {})
  const file = await completeUpload(fileId)
  return file.id
}

/** 上传头像并返回 fileId（接口 12 → PUT → 接口 13） */
export async function uploadAvatarForProfile(
  localPath?: string,
  remoteUrl?: string,
): Promise<string> {
  const { blob, fileName } = await loadImageBlob(localPath, remoteUrl)
  const contentType = blob.type || guessContentType(fileName)
  return uploadViaTask('avatar', blob, fileName, contentType)
}

/** 上传举报截图并返回 fileId（接口 12 → PUT → 接口 13，purpose=image） */
export async function uploadReportImage(localPath: string): Promise<string> {
  const { blob, fileName } = await loadImageBlob(localPath)
  const contentType = blob.type || guessContentType(fileName)
  return uploadViaTask('image', blob, fileName, contentType)
}
