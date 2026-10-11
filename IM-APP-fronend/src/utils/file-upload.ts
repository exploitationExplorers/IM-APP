import { completeUpload, createUploadTask } from '@/api/file'
import type { UploadPurpose } from '@/types'
import { h5PublicMediaUrl } from '@/utils/chatMedia'

interface ImageBytes {
  bytes: ArrayBuffer
  fileName: string
  contentType: string
  size: number
}

/** App WebView 也有 fetch，但不能用来读 file:// / _doc 本地图。 */
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
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return map[ext] || 'application/octet-stream'
}

/** 华为/部分 Android 相册常给 HEIC 或 octet-stream，头像接口只收 image/* */
function forceAvatarJpegMeta(fileName: string, contentType: string): { fileName: string; contentType: string } {
  const type = (contentType || '').toLowerCase()
  const lowerName = (fileName || '').toLowerCase()
  const needsJpeg =
    !type.startsWith('image/') ||
    type.includes('heic') ||
    type.includes('heif') ||
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif')
  if (!needsJpeg && type.startsWith('image/')) {
    return { fileName: fileName || 'avatar.jpg', contentType: type === 'image/jpg' ? 'image/jpeg' : type }
  }
  return { fileName: 'avatar.jpg', contentType: 'image/jpeg' }
}

function compressLocalImage(localPath: string): Promise<string> {
  return new Promise((resolve) => {
    uni.compressImage({
      src: localPath,
      quality: 80,
      success: (res) => resolve(res.tempFilePath || localPath),
      fail: () => resolve(localPath),
    })
  })
}

/** App 选图前申请相册读权限；拒绝时仍继续（系统可能再弹一次） */
export function requestAndroidAlbumPermission(): Promise<void> {
  return new Promise((resolve) => {
    let uniPlatform = ''
    try {
      uniPlatform = uni.getSystemInfoSync().uniPlatform || ''
    } catch {
      resolve()
      return
    }
    if (uniPlatform !== 'app') {
      resolve()
      return
    }
    const os = String(uni.getSystemInfoSync().osName || uni.getSystemInfoSync().platform || '').toLowerCase()
    const request = plus?.android?.requestPermissions
    if (!os.includes('android') || typeof request !== 'function') {
      resolve()
      return
    }
    request(
      [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        // Android 14+ / 华为部分机型：用户可选部分相册访问
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.READ_EXTERNAL_STORAGE',
      ],
      () => resolve(),
      () => resolve(),
    )
  })
}

function isPickCancelError(err: unknown): boolean {
  const msg = String((err as { errMsg?: string; message?: string })?.errMsg
    || (err as Error)?.message
    || err
    || '')
  return /cancel|用户取消|12/i.test(msg) || (err as { code?: number })?.code === 12
}

/** plus.gallery.pick：华为上 uni.chooseImage 常挂，系统选择器更稳 */
function pickViaPlusGallery(opts: {
  count: number
  system: boolean
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const gallery = plus?.gallery
    if (!gallery?.pick) {
      reject(new Error('无法打开相册'))
      return
    }
    const multiple = opts.count > 1
    gallery.pick(
      (res: string | { files?: string[] }) => {
        if (typeof res === 'string') {
          resolve(res ? [res] : [])
          return
        }
        resolve((res?.files || []).filter(Boolean).slice(0, opts.count))
      },
      (err: { message?: string; code?: number }) => {
        if (isPickCancelError(err)) {
          reject(new Error('cancel'))
          return
        }
        reject(new Error(String(err?.message || '无法打开相册')))
      },
      {
        filter: 'image',
        multiple,
        maximum: opts.count,
        system: opts.system,
        filename: '_doc/gallery/',
      },
    )
  })
}

function chooseImagePaths(opts: {
  count: number
  sourceType: Array<'album' | 'camera'>
  sizeType: Array<'original' | 'compressed'>
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: opts.count,
      sourceType: opts.sourceType,
      sizeType: opts.sizeType,
      success: (res) => {
        const anyRes = res as unknown as { tempFilePaths?: string[] | string }
        const raw = anyRes.tempFilePaths
        const paths = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean)
        resolve(paths.slice(0, opts.count))
      },
      fail: (err) => reject(err),
    })
  })
}

/**
 * 统一选图：权限 → chooseImage →（空路径/失败）plus.gallery system:true → system:false。
 * 华为 Mate / Harmony 上 chooseImage 常 fail 或 success 空路径，必须有 gallery 兜底。
 */
export async function pickLocalImages(opts?: {
  count?: number
  sourceType?: Array<'album' | 'camera'>
}): Promise<string[]> {
  const count = Math.max(1, Math.min(9, opts?.count ?? 1))
  const sourceType = opts?.sourceType?.length ? opts.sourceType : (['album'] as Array<'album' | 'camera'>)
  await requestAndroidAlbumPermission()

  let paths: string[] = []
  let chooseErr: unknown
  try {
    // original 优先：华为 compressed 经常空路径
    paths = await chooseImagePaths({
      count,
      sourceType,
      sizeType: ['original', 'compressed'],
    })
  } catch (e) {
    if (isPickCancelError(e)) throw new Error('cancel')
    chooseErr = e
  }

  if (paths.length) return paths

  if (!isAppPlatform() || typeof plus === 'undefined') {
    if (chooseErr) {
      const msg = String((chooseErr as { errMsg?: string })?.errMsg || (chooseErr as Error)?.message || '')
      throw new Error(msg.replace(/^[^:]+:\s*/, '') || '无法打开相册，请检查相册权限')
    }
    throw new Error('未获取到图片，请重试')
  }

  // 纯相机失败不再二次弹相册，避免误触
  if (!sourceType.includes('album')) {
    throw new Error('无法打开相机')
  }

  try {
    paths = await pickViaPlusGallery({ count, system: true })
    if (paths.length) return paths
  } catch (e) {
    if (isPickCancelError(e) || String((e as Error)?.message) === 'cancel') throw new Error('cancel')
  }
  try {
    paths = await pickViaPlusGallery({ count, system: false })
    if (paths.length) return paths
  } catch (e) {
    if (isPickCancelError(e) || String((e as Error)?.message) === 'cancel') throw new Error('cancel')
    throw e instanceof Error ? e : new Error('无法打开相册，请检查相册权限')
  }
  throw new Error('未获取到图片，请重试')
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

function isPlusAvailable(): boolean {
  return isAppPlatform() && typeof plus !== 'undefined'
}

function toAppFileUrl(path: string): string {
  if (
    path.startsWith('file://') ||
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:')
  ) {
    return path
  }
  if (!isPlusAvailable()) return path
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
  if (!isPlusAvailable()) {
    return Promise.reject(new Error('读取图片失败'))
  }
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
  if (type.startsWith('image/') && !type.includes('heic') && !type.includes('heif') && fileName.includes('.')) {
    return { fileName, contentType: type === 'image/jpg' ? 'image/jpeg' : type }
  }
  return forceAvatarJpegMeta(fileName, type)
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
    if (!isAppPlatform()) {
      throw new Error('读取图片失败')
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
    if (!isAppPlatform()) {
      throw new Error('读取图片失败')
    }
    const tempPath = await downloadToTemp(remoteUrl)
    return readAppFile(tempPath, 'avatar.jpg')
  }
  throw new Error('请选择头像')
}

async function postBytes(
  formUrl: string,
  formData: Record<string, string>,
  bytes: ArrayBuffer,
  fileName: string,
  contentType: string,
): Promise<void> {
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('当前环境不支持文件上传')
  }
  const body = new FormData()
  Object.entries(formData).forEach(([key, value]) => body.append(key, value))
  body.append('file', new Blob([bytes], { type: contentType }), fileName)
  const res = await fetch(h5PublicMediaUrl(formUrl), { method: 'POST', body })
  if (!res.ok) throw new Error(`上传失败(${res.status})`)
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
  if (!init.formUrl || !init.formData) {
    throw new Error('当前环境不支持文件上传')
  }
  await postBytes(init.formUrl, init.formData, image.bytes, image.fileName, image.contentType)
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
        if (!isPlusAvailable()) {
          fail()
          return
        }
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

/** App 端用本地路径通过预签名 multipart POST 直传。 */
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

/** 上传头像并返回 fileId（创建任务 → multipart POST 直传 → 确认完成） */
export async function uploadAvatarForProfile(
  localPath?: string,
  remoteUrl?: string,
): Promise<string> {
  if (isAppPlatform() && localPath) {
    // 华为等机型 HEIC / 无扩展名路径直传会被后端 image/* 校验拒绝，先压成 jpeg
    const compressed = await compressLocalImage(localPath)
    const meta = await getLocalFileMeta(compressed)
    const jpegMeta = forceAvatarJpegMeta(meta.fileName, meta.contentType)
    const init = await createUploadTask({
      purpose: 'avatar',
      fileName: jpegMeta.fileName,
      contentType: jpegMeta.contentType,
      size: meta.size,
    })
    const fileId = init.file.id
    if (!fileId) throw new Error('创建上传任务失败')
    if (!init.formUrl || !init.formData) throw new Error('当前环境不支持文件上传')
    await postLocalFile(init.formUrl, compressed, init.formData)
    const file = await completeUpload(fileId)
    return file.id
  }
  return uploadViaTask('avatar', await loadImageBytes(localPath, remoteUrl))
}

/** H5：直接用用户选中的文件上传。iPhone 相册常是 HEIC，先压成 jpeg 再传。 */
export async function uploadAvatarFile(file: File): Promise<string> {
  const prepared = await prepareAvatarFile(file)
  const bytes = await prepared.arrayBuffer()
  const meta = withImageMeta(prepared.name || 'avatar.jpg', prepared.type || 'image/jpeg')
  return uploadViaTask('avatar', {
    bytes,
    fileName: meta.fileName,
    contentType: meta.contentType,
    size: bytes.byteLength,
  })
}

function isReadyImageType(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif'
}

/**
 * H5：HEIC / 超大图 / 空 type 压成 jpeg，聊天发图与换头像共用。
 * App 无 document 时原样返回（走原生压缩路径）。
 */
export async function prepareImageFile(
  file: File,
  opts?: { maxBytes?: number; edge?: number; fileName?: string },
): Promise<File> {
  const maxBytes = opts?.maxBytes ?? 1_500_000
  const edge = opts?.edge ?? 1280
  const fileName = opts?.fileName || 'image.jpg'
  const type = (file.type || '').toLowerCase()
  if (isReadyImageType(type) && file.size > 0 && file.size <= maxBytes) return file
  if (typeof document === 'undefined') return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法读取这张图片，请换一张'))
      el.src = url
    })
    let width = img.naturalWidth || img.width
    let height = img.naturalHeight || img.height
    if (!width || !height) throw new Error('无法读取这张图片，请换一张')
    const scale = Math.min(1, edge / Math.max(width, height))
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法读取这张图片，请换一张')
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!blob) throw new Error('无法读取这张图片，请换一张')
    if (typeof File !== 'undefined') {
      return new File([blob], fileName, { type: 'image/jpeg' })
    }
    return Object.assign(blob, { name: fileName, lastModified: Date.now() }) as File
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function prepareAvatarFile(file: File): Promise<File> {
  return prepareImageFile(file, { fileName: 'avatar.jpg' })
}

/** 上传举报截图并返回 fileId（创建任务 → multipart POST 直传 → 确认完成） */
export async function uploadReportImage(localPath: string): Promise<string> {
  if (isAppPlatform()) {
    return uploadViaNativeFile('image', localPath)
  }
  return uploadViaTask('image', await loadImageBytes(localPath))
}

/** 上传自定义表情并返回 fileId */
export async function uploadSticker(localPath: string): Promise<string> {
  if (isAppPlatform()) {
    return uploadViaNativeFile('sticker', localPath)
  }
  return uploadViaTask('sticker', await loadImageBytes(localPath))
}
