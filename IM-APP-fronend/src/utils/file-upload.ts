import { completeUpload, createUploadTask } from '@/api/file'
import type { UploadPurpose } from '@/types'
import { awaitMediaCache } from '@/utils/mediaCache'
import { isAppPlatform } from '@/utils/platform'
import { postStorageBytes as postBytes, postStorageLocalFile as postLocalFile } from '@/utils/storage-upload'

interface ImageBytes {
  bytes: ArrayBuffer
  fileName: string
  contentType: string
  size: number
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

/** 华为 / 荣耀 / 鸿蒙：chooseImage 常直接给不可读的 content://（鸿蒙 4 尤其明显） */
function isHuaweiLikeDevice(): boolean {
  try {
    const info = uni.getSystemInfoSync() as UniApp.GetSystemInfoResult & {
      brand?: string
      manufacturer?: string
      romName?: string
      osName?: string
      hostName?: string
    }
    const blob = [
      info.brand,
      info.manufacturer,
      info.romName,
      info.osName,
      info.hostName,
      info.platform,
      info.system,
    ]
      .map((v) => String(v || '').toLowerCase())
      .join(' ')
    return /huawei|honor|harmony|hongmeng|harmonyos/.test(blob)
  } catch {
    return false
  }
}

function isContentUri(path: string): boolean {
  return /^content:\/\//i.test(path || '')
}

/** 本轮已经压过的本地图。发图链路再遇到同一路径就直接用，避免二次 compressImage。 */
const preparedChatImagePaths = new Set<string>()

export function isPreparedChatImage(path: string): boolean {
  return preparedChatImagePaths.has(String(path || '').trim())
}

function rememberPreparedChatImage(path: string): string {
  const value = String(path || '').trim()
  if (value) preparedChatImagePaths.add(value)
  return path
}

function isSandboxLocalPath(path: string): boolean {
  const p = path || ''
  if (!p || isContentUri(p)) return false
  return (
    p.startsWith('_doc/') ||
    p.startsWith('_www/') ||
    p.startsWith('file://') ||
    p.includes('/files/') ||
    p.includes('/cache/') ||
    p.includes('uniapp_temp') ||
    p.includes('/Android/data/')
  )
}

function probeLocalFileSize(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    uni.getFileInfo({
      filePath,
      success: (res) => resolve(Number(res.size) || 0),
      fail: () => resolve(0),
    })
  })
}

/** 用 nativeObj.Bitmap 把 content:// / 临时路径落到 _doc jpeg（鸿蒙 4 上比 plus.io 稳） */
function saveViaNativeBitmap(srcPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof plus === 'undefined' || !plus.nativeObj?.Bitmap) {
        reject(new Error('无法读取图片'))
        return
      }
      const dest = `_doc/picked_${Date.now()}.jpg`
      const bitmap = new plus.nativeObj.Bitmap(`img_${Date.now()}`)
      const recycle = () => {
        try {
          bitmap.clear()
        } catch {
          /* ignore */
        }
      }
      bitmap.load(
        srcPath,
        () => {
          bitmap.save(
            dest,
            { overwrite: true, format: 'jpg', quality: 85 },
            () => {
              recycle()
              resolve(dest)
            },
            (err) => {
              recycle()
              reject(new Error(String((err as { message?: string })?.message || '无法保存图片')))
            },
          )
        },
        (err) => {
          recycle()
          reject(new Error(String((err as { message?: string })?.message || '无法读取图片')))
        },
      )
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法读取图片'))
    }
  })
}

/** 鸿蒙 4 / Android 14：content:// 用 ContentResolver 拷进应用目录，plus.io 经常解不开 */
function copyContentUriViaAndroid(contentUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof plus === 'undefined' || !plus.android) {
        reject(new Error('无法读取图片'))
        return
      }
      // plus.android 的 d.ts 参数签名偏窄，这里按运行时可变参数调用
      const android = plus.android as unknown as {
        runtimeMainActivity: () => unknown
        importClass: (name: string) => { parse?: (uri: string) => unknown; TYPE?: unknown; newInstance?: (...args: unknown[]) => unknown }
        invoke: (target: unknown, method: string, ...args: unknown[]) => unknown
        newObject: (className: string, ...args: unknown[]) => unknown
      }
      const main = android.runtimeMainActivity()
      const Uri = android.importClass('android.net.Uri')
      const ReflectArray = android.importClass('java.lang.reflect.Array')
      const Byte = android.importClass('java.lang.Byte')
      android.importClass('java.io.File')
      android.importClass('java.io.FileOutputStream')
      android.importClass('java.io.BufferedInputStream')
      const uri = Uri.parse!(contentUri)
      const resolver = android.invoke(main, 'getContentResolver')
      const input = android.invoke(resolver, 'openInputStream', uri)
      if (!input) {
        reject(new Error('无法读取图片'))
        return
      }
      const destName = `picked_${Date.now()}.jpg`
      const filesDir = android.invoke(main, 'getFilesDir')
      const destFile = android.newObject('java.io.File', filesDir, destName)
      const output = android.newObject('java.io.FileOutputStream', destFile)
      const bis = android.newObject('java.io.BufferedInputStream', input)
      const bytes = ReflectArray.newInstance!(Byte.TYPE, 8192)
      let n = Number(android.invoke(bis, 'read', bytes) || 0)
      while (n > 0) {
        android.invoke(output, 'write', bytes, 0, n)
        n = Number(android.invoke(bis, 'read', bytes) || 0)
      }
      android.invoke(bis, 'close')
      android.invoke(output, 'close')
      const abs = String(android.invoke(destFile, 'getAbsolutePath') || '')
      if (!abs) {
        reject(new Error('无法保存图片'))
        return
      }
      resolve(abs.startsWith('/') ? `file://${abs}` : abs)
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法读取图片'))
    }
  })
}

function copyViaPlusIoToDoc(srcPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isPlusAvailable()) {
      reject(new Error('无法读取图片'))
      return
    }
    const destName = `picked_${Date.now()}.jpg`
    plus.io.resolveLocalFileSystemURL(
      toAppFileUrl(srcPath),
      (rawEntry) => {
        const entry = rawEntry as unknown as {
          copyTo: (
            parent: unknown,
            newName: string,
            ok: (e: { fullPath?: string; toLocalURL?: () => string }) => void,
            bad: (err: unknown) => void,
          ) => void
        }
        plus.io.resolveLocalFileSystemURL(
          '_doc/',
          (dir) => {
            entry.copyTo(
              dir,
              destName,
              (copied) => {
                const local =
                  (typeof copied.toLocalURL === 'function' ? copied.toLocalURL() : '') ||
                  copied.fullPath ||
                  `_doc/${destName}`
                resolve(local)
              },
              reject,
            )
          },
          reject,
        )
      },
      reject,
    )
  })
}

/**
 * 把相册/相机路径收成应用可读的本地文件。
 * 鸿蒙 4 的 content:// 不能直接压图、上传、交给 OpenIM，必须先落到沙盒。
 */
function looksLikeWebpPath(path: string): boolean {
  return /\.webp(\?|#|$)/i.test(path || '')
}

/** WebP 原样上传易触发 OpenIM Content-Type 签名不一致；尽量落到 jpg。 */
async function ensureAppChatJpeg(path: string): Promise<string> {
  if (!looksLikeWebpPath(path) && !/\.hei[cf](\?|#|$)/i.test(path || '')) return path
  try {
    const jpeg = await saveViaNativeBitmap(path)
    if (jpeg) return jpeg
  } catch (e) {
    console.warn('[image] WebP/HEIC 转 jpg 失败', (e as Error)?.message || e)
  }
  return path
}

export async function materializeAppLocalImage(srcPath: string): Promise<string> {
  const path = String(srcPath || '').trim()
  if (!path) throw new Error('未获取到图片，请重试')
  if (!isAppPlatform()) return path
  if (isPreparedChatImage(path)) return path

  const tryCompress = async (input: string) => {
    const compressed = await compressLocalImage(input)
    if (!compressed || isContentUri(compressed)) return ''
    const size = await probeLocalFileSize(compressed)
    return size > 0 ? compressed : ''
  }

  if (!isContentUri(path)) {
    const size = await probeLocalFileSize(path)
    if (size > 0) {
      const compressed = await tryCompress(path)
      const next = await ensureAppChatJpeg(compressed || path)
      return rememberPreparedChatImage(next)
    }
  }

  const compressed = await tryCompress(path)
  if (compressed) {
    const next = await ensureAppChatJpeg(compressed)
    return rememberPreparedChatImage(next)
  }

  try {
    const viaBitmap = await saveViaNativeBitmap(path)
    const again = await tryCompress(viaBitmap)
    return rememberPreparedChatImage(again || viaBitmap)
  } catch (e) {
    console.warn('[image] Bitmap 落盘失败', (e as Error)?.message || e)
  }

  try {
    const copied = await copyViaPlusIoToDoc(path)
    const again = await tryCompress(copied)
    const next = await ensureAppChatJpeg(again || copied)
    return rememberPreparedChatImage(next)
  } catch (e) {
    console.warn('[image] plus.io 拷贝失败', (e as Error)?.message || e)
  }

  if (isContentUri(path) || !isSandboxLocalPath(path)) {
    try {
      const viaAndroid = await copyContentUriViaAndroid(
        isContentUri(path) ? path : toAppFileUrl(path),
      )
      const again = await tryCompress(viaAndroid)
      const next = await ensureAppChatJpeg(again || viaAndroid)
      return rememberPreparedChatImage(next)
    } catch (e) {
      console.warn('[image] ContentResolver 拷贝失败', (e as Error)?.message || e)
    }
  }

  throw new Error('无法读取这张图片，请换一张或检查相册权限')
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
        // 落到应用目录，避免鸿蒙 4 只给一次性 content://
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

async function materializePickedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  for (const path of paths) {
    try {
      out.push(await materializeAppLocalImage(path))
    } catch (e) {
      console.warn('[image] 物化选图失败', path, (e as Error)?.message || e)
    }
  }
  if (!out.length && paths.length) {
    throw new Error('无法读取这张图片，请换一张或检查相册权限')
  }
  return out
}

/**
 * 统一选图：权限 →（华为/鸿蒙优先 gallery）→ chooseImage → gallery 兜底 → 物化到沙盒。
 * 鸿蒙 4 上 chooseImage「成功」却返回不可读 content://，不能再直接当本地路径用。
 */
export async function pickLocalImages(opts?: {
  count?: number
  sourceType?: Array<'album' | 'camera'>
  /**
   * 聊天发图传 false：选完立刻把原路径交回去做占位气泡，
   * 压缩留到发送时做一次。头像等入口保持默认，选完再物化。
   */
  materialize?: boolean
}): Promise<string[]> {
  // 聊天发资料图一次最多 20；其它入口仍可传更小的 count
  const count = Math.max(1, Math.min(20, opts?.count ?? 1))
  const sourceType = opts?.sourceType?.length ? opts.sourceType : (['album'] as Array<'album' | 'camera'>)
  await requestAndroidAlbumPermission()
  const settle = (picked: string[]) =>
    opts?.materialize === false ? Promise.resolve(picked.filter(Boolean)) : materializePickedPaths(picked)

  const huaweiLike = isAppPlatform() && isHuaweiLikeDevice()
  let paths: string[] = []
  let chooseErr: unknown

  // 华为/鸿蒙：先走 gallery system:false，直接落到 _doc，避开鸿蒙 4 的 content://
  if (huaweiLike && sourceType.includes('album') && typeof plus !== 'undefined') {
    try {
      paths = await pickViaPlusGallery({ count, system: false })
      if (paths.length) {
        try {
          return await settle(paths)
        } catch (e) {
          console.warn('[image] gallery 路径物化失败，继续兜底', (e as Error)?.message || e)
          paths = []
        }
      }
    } catch (e) {
      if (isPickCancelError(e) || String((e as Error)?.message) === 'cancel') throw new Error('cancel')
    }
  }

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

  if (paths.length) {
    try {
      return await settle(paths)
    } catch (e) {
      // 物化失败再试 gallery，不要把坏路径交给上传
      console.warn('[image] chooseImage 路径不可用，改走 gallery', (e as Error)?.message || e)
      paths = []
    }
  }

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
    paths = await pickViaPlusGallery({ count, system: false })
    if (paths.length) return settle(paths)
  } catch (e) {
    if (isPickCancelError(e) || String((e as Error)?.message) === 'cancel') throw new Error('cancel')
  }
  try {
    paths = await pickViaPlusGallery({ count, system: true })
    if (paths.length) return settle(paths)
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
    path.startsWith('content://') ||
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

function downloadToTemp(url: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error, path?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(path!)
    }
    const timer = setTimeout(() => finish(new Error('下载图片超时')), Math.max(3000, timeoutMs))
    try {
      uni.downloadFile({
        url,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
            finish(undefined, res.tempFilePath)
            return
          }
          finish(new Error('下载图片失败'))
        },
        fail: () => finish(new Error('下载图片失败')),
      })
    } catch {
      finish(new Error('下载图片失败'))
    }
  })
}

/** 按文件头识别类型，避免临时路径无后缀时被当成 jpeg（GIF 会变静态）。 */
function sniffImageMeta(bytes: ArrayBuffer): { contentType: string; ext: string } | null {
  const head = new Uint8Array(bytes.slice(0, 16))
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    return { contentType: 'image/gif', ext: 'gif' }
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' }
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return { contentType: 'image/png', ext: 'png' }
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return { contentType: 'image/webp', ext: 'webp' }
  }
  return null
}

function withStickerMeta(fileName: string, contentType: string, bytes: ArrayBuffer): {
  fileName: string
  contentType: string
} {
  const sniffed = sniffImageMeta(bytes)
  const type = (sniffed?.contentType || contentType || guessContentType(fileName) || '').toLowerCase()
  const ext = sniffed?.ext || (type === 'image/jpeg' || type === 'image/jpg' ? 'jpg' : type.replace(/^image\//, ''))
  if (type.startsWith('image/') && !type.includes('heic') && !type.includes('heif') && ext) {
    const base = (fileName || 'sticker').replace(/\.[^.]+$/i, '') || 'sticker'
    return {
      fileName: `${base}.${ext}`,
      contentType: type === 'image/jpg' ? 'image/jpeg' : type,
    }
  }
  return forceAvatarJpegMeta(fileName, type)
}

async function resolveStickerSource(path: string): Promise<string> {
  const src = String(path || '').trim()
  if (!src) throw new Error('请选择表情图片')
  if (src.startsWith('blob:') || src.startsWith('file://') || src.startsWith('content://')) return src
  if (!/^https?:\/\//i.test(src)) return src
  // 与群聊气泡同一套媒体缓存（含 OSS 302），避免 iOS 直连下载挂死
  const cached = await awaitMediaCache(src, 30000)
  if (cached) return cached
  if (!isAppPlatform()) return src
  return downloadToTemp(src, 30000)
}

async function loadStickerBytes(sourcePath: string): Promise<ImageBytes> {
  const raw = await loadImageBytes(sourcePath)
  const meta = withStickerMeta(raw.fileName, raw.contentType, raw.bytes)
  return {
    bytes: raw.bytes,
    fileName: meta.fileName,
    contentType: meta.contentType,
    size: raw.bytes.byteLength,
  }
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
  await postBytes(init.formUrl, init.formData, image)
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
    // 鸿蒙 4 等：先物化到沙盒，再压 jpeg；原生直传失败再读字节上传
    const local = await materializeAppLocalImage(localPath)
    try {
      const compressed = await compressLocalImage(local)
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
    } catch (e) {
      console.warn('[avatar] 原生直传失败，改走读字节', (e as Error)?.message || e)
      return uploadViaTask('avatar', await loadImageBytes(local, remoteUrl))
    }
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

/**
 * 可原样上传的类型。不含 webp：OpenIM OSS 预签名常按 application/octet-stream，
 * Web SDK 再补 image/webp 会 403（浏览器常报成跨域）；部分 App WebView 预览也不稳。
 * GIF 保留动画；PNG/JPEG 走原图。
 */
function isReadyImageType(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/gif'
}

function isWebpLike(type: string, fileName: string): boolean {
  const t = (type || '').toLowerCase()
  const n = (fileName || '').toLowerCase()
  return t.includes('webp') || n.endsWith('.webp')
}

/**
 * H5：HEIC / WebP / 超大图 / 空 type 压成 jpeg，聊天发图与换头像共用。
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
  const mustJpeg = isWebpLike(type, file.name) || type.includes('heic') || type.includes('heif')
  if (!mustJpeg && isReadyImageType(type) && file.size > 0 && file.size <= maxBytes) return file
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
    const jpegName = `${(fileName || 'image.jpg').replace(/\.[^.]+$/i, '') || 'image'}.jpg`
    if (typeof File !== 'undefined') {
      return new File([blob], jpegName, { type: 'image/jpeg' })
    }
    return Object.assign(blob, { name: jpegName, lastModified: Date.now() }) as File
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
    const local = await materializeAppLocalImage(localPath)
    try {
      return await uploadViaNativeFile('image', local)
    } catch (e) {
      console.warn('[image] 举报图直传失败，改走读字节', (e as Error)?.message || e)
      return uploadViaTask('image', await loadImageBytes(local))
    }
  }
  return uploadViaTask('image', await loadImageBytes(localPath))
}

/**
 * 上传自定义表情并返回 fileId。
 * 不走 materialize/compress：那条链路会压成 jpeg，GIF 动图会变成静态。
 * 远程图先走聊天媒体缓存（与群聊图同一套 OSS），再原样字节上传 purpose=sticker。
 */
export async function uploadSticker(localPath: string): Promise<string> {
  const source = await resolveStickerSource(localPath)
  // HEIC 仍需转 jpeg；其余格式（含 gif）保持原字节
  const lower = source.toLowerCase()
  const maybeHeic = lower.includes('.heic') || lower.includes('.heif')
  const local = maybeHeic && isAppPlatform() ? await materializeAppLocalImage(source) : source
  try {
    return await uploadViaTask('sticker', await loadStickerBytes(local))
  } catch (e) {
    if (!isAppPlatform() || /^https?:\/\//i.test(local) || local.startsWith('blob:')) throw e
    console.warn('[image] 表情读字节失败，改走原生直传', (e as Error)?.message || e)
    return uploadViaNativeFile('sticker', local)
  }
}
