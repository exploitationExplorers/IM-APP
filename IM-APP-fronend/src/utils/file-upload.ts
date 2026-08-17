import { completeUpload, createUploadTask } from '@/api/file'
import type { UploadPurpose } from '@/types'

interface ImageBytes {
  bytes: ArrayBuffer
  fileName: string
  contentType: string
  size: number
}

interface AppXHR {
  timeout: number
  status: number
  readyState: number
  onreadystatechange: (() => void) | null
  onerror: (() => void) | null
  open: (method: string, url: string) => void
  setRequestHeader: (name: string, value: string) => void
  send: (data?: ArrayBuffer) => void
}

/** App WebView 也有 fetch，但不能用来读 file:// / _doc 本地图，也不能可靠 PUT MinIO */
function isAppPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'app'
  } catch {
    return false
  }
}

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
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const name = idx >= 0 ? filePath.slice(idx + 1) : filePath
  return name || fallback
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toAppFileUrl(path: string): string {
  if (path.startsWith('file://') || path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  try {
    return plus.io.convertLocalFileSystemURL(path) || path
  } catch {
    return path
  }
}

function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        reject(new Error('下载图片失败'))
      },
      fail: () => reject(new Error('下载图片失败')),
    })
  })
}

function readAppFile(filePath: string, fallbackName = 'avatar.jpg'): Promise<ImageBytes> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('读取图片失败'))
    plus.io.resolveLocalFileSystemURL(
      toAppFileUrl(filePath),
      (rawEntry) => {
        const entry = rawEntry as unknown as PlusIoFileEntry
        if (typeof entry.file !== 'function') {
          fail()
          return
        }
        entry.file((file) => {
          const reader = new plus.io.FileReader()
          reader.onloadend = () => {
            const result = reader.result
            if (!result) {
              fail()
              return
            }
            const bytes = dataUrlToArrayBuffer(result)
            const fileName = file.name || getFileName(filePath, fallbackName)
            const meta = withImageMeta(fileName, file.type || '')
            resolve({
              bytes,
              fileName: meta.fileName,
              contentType: meta.contentType,
              size: bytes.byteLength,
            })
          }
          reader.onerror = fail
          reader.readAsDataURL(file)
        }, fail)
      },
      fail,
    )
  })
}

function withImageMeta(fileName: string, contentType: string): { fileName: string; contentType: string } {
  const type = contentType && contentType !== 'application/octet-stream'
    ? contentType
    : guessContentType(fileName)
  if (type !== 'application/octet-stream' && fileName.includes('.')) {
    return { fileName, contentType: type }
  }
  return { fileName: fileName.includes('.') ? fileName : 'avatar.jpg', contentType: 'image/jpeg' }
}

async function loadImageBytes(localPath?: string, remoteUrl?: string): Promise<ImageBytes> {
  if (localPath) {
    if (!isAppPlatform() && typeof fetch === 'function') {
      const blob = await fetch(localPath).then((res) => res.blob())
      const fileName = getFileName(localPath)
      const meta = withImageMeta(fileName, blob.type)
      return {
        bytes: await blob.arrayBuffer(),
        fileName: meta.fileName,
        contentType: meta.contentType,
        size: blob.size,
      }
    }
    return readAppFile(localPath)
  }
  if (remoteUrl) {
    if (!isAppPlatform() && typeof fetch === 'function') {
      const blob = await fetch(remoteUrl).then((res) => res.blob())
      const ext = blob.type.split('/')[1] || 'jpg'
      const meta = withImageMeta(`avatar.${ext}`, blob.type)
      return {
        bytes: await blob.arrayBuffer(),
        fileName: meta.fileName,
        contentType: meta.contentType,
        size: blob.size,
      }
    }
    const tempPath = await downloadToTemp(remoteUrl)
    return readAppFile(tempPath, 'avatar.jpg')
  }
  throw new Error('请选择头像')
}

function putBytesWithXHR(
  uploadUrl: string,
  bytes: ArrayBuffer,
  contentType: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let xhr: AppXHR
    try {
      const XHR = plus.net.XMLHttpRequest
      if (typeof XHR !== 'function') {
        reject(new Error('当前环境不支持文件上传'))
        return
      }
      xhr = new XHR() as unknown as AppXHR
    } catch {
      reject(new Error('当前环境不支持文件上传'))
      return
    }
    xhr.timeout = 60000
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return
      if ((xhr.status || 0) >= 200 && (xhr.status || 0) < 300) {
        resolve()
        return
      }
      reject(new Error(`上传失败(${xhr.status || 0})`))
    }
    xhr.onerror = () => reject(new Error('上传失败'))
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    Object.entries(headers).forEach(([key, value]) => {
      if (key.toLowerCase() !== 'content-type') xhr.setRequestHeader(key, value)
    })
    xhr.send(bytes)
  })
}

function putBytesWithUniRequest(
  uploadUrl: string,
  bytes: ArrayBuffer,
  contentType: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: uploadUrl,
      method: 'PUT',
      header: {
        'Content-Type': contentType,
        ...headers,
      },
      data: bytes,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
          return
        }
        reject(new Error(`上传失败(${res.statusCode})`))
      },
      fail: (err) => reject(new Error(err.errMsg || '上传失败')),
    })
  })
}

async function putBytes(
  uploadUrl: string,
  bytes: ArrayBuffer,
  contentType: string,
  headers: Record<string, string> = {},
): Promise<void> {
  if (!isAppPlatform() && typeof fetch === 'function') {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...headers,
      },
      body: bytes,
    })
    if (!res.ok) throw new Error(`上传失败(${res.status})`)
    return
  }
  try {
    await putBytesWithXHR(uploadUrl, bytes, contentType, headers)
  } catch (e) {
    if ((e as Error).message === '当前环境不支持文件上传') {
      await putBytesWithUniRequest(uploadUrl, bytes, contentType, headers)
      return
    }
    throw e
  }
}

async function uploadViaTask(
  purpose: UploadPurpose,
  image: ImageBytes,
): Promise<string> {
  const init = await createUploadTask({
    purpose,
    fileName: image.fileName,
    contentType: image.contentType,
    size: image.size,
  })
  const fileId = init.file.id
  if (!fileId) {
    throw new Error('创建上传任务失败')
  }
  await putBytes(init.uploadUrl, image.bytes, image.contentType, init.headers || {})
  const file = await completeUpload(fileId)
  return file.id
}

function getLocalFileMeta(filePath: string): Promise<{ fileName: string; contentType: string; size: number }> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('读取图片失败'))
    const finish = (size: number, name: string, type: string) => {
      const meta = withImageMeta(name || 'avatar.jpg', type)
      if (size <= 0) {
        fail()
        return
      }
      resolve({ fileName: meta.fileName, contentType: meta.contentType, size })
    }
    uni.getFileInfo({
      filePath,
      success: (res) => finish(res.size, getFileName(filePath), ''),
      fail: () => {
        plus.io.resolveLocalFileSystemURL(
          toAppFileUrl(filePath),
          (rawEntry) => {
            const entry = rawEntry as unknown as PlusIoFileEntry
            if (typeof entry.file !== 'function') {
              fail()
              return
            }
            entry.file((file) => {
              finish(file.size || 0, file.name || getFileName(filePath), file.type || '')
            }, fail)
          },
          fail,
        )
      },
    })
  })
}

function postLocalFile(
  formUrl: string,
  filePath: string,
  formData: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: formUrl,
      filePath,
      name: 'file',
      formData,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
          return
        }
        reject(new Error(`上传失败(${res.statusCode})`))
      },
      fail: (err) => reject(new Error(err.errMsg || '上传失败')),
    })
  })
}

/** App 端用本地路径直传，避免 PUT ArrayBuffer 被发成空包 */
async function uploadViaNativeFile(purpose: UploadPurpose, localPath: string): Promise<string> {
  const meta = await getLocalFileMeta(localPath)
  const init = await createUploadTask({
    purpose,
    fileName: meta.fileName,
    contentType: meta.contentType,
    size: meta.size,
  })
  const fileId = init.file.id
  if (!fileId) {
    throw new Error('创建上传任务失败')
  }
  if (!init.formUrl || !init.formData) {
    throw new Error('当前环境不支持文件上传')
  }
  await postLocalFile(init.formUrl, localPath, init.formData)
  const file = await completeUpload(fileId)
  return file.id
}

/** 上传头像并返回 fileId（接口 12 → PUT/POST → 接口 13） */
export async function uploadAvatarForProfile(
  localPath?: string,
  remoteUrl?: string,
): Promise<string> {
  if (isAppPlatform() && localPath) {
    return uploadViaNativeFile('avatar', localPath)
  }
  return uploadViaTask('avatar', await loadImageBytes(localPath, remoteUrl))
}

/** 上传举报截图并返回 fileId（接口 12 → PUT/POST → 接口 13，purpose=image） */
export async function uploadReportImage(localPath: string): Promise<string> {
  if (isAppPlatform()) {
    return uploadViaNativeFile('image', localPath)
  }
  return uploadViaTask('image', await loadImageBytes(localPath))
}
