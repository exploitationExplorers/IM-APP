import { isAndroid, isAppPlatform } from '@/utils/platform'
import type { PlusFileEntry, PlusGallerySave, PlusResolveLocalFile } from '@/types/plus-io'
import { isOSSStorageUrl } from '@/utils/storage-url'

export interface VideoMeta {
  url: string
  snapshotUrl: string
  duration: number
}

/** 气泡角标：09 → 00:09，65 → 01:05 */
export function formatVideoDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 取视频靠前但非首帧的位置，尽量避开黑场；短视频也保证不越过结尾。 */
export function videoSnapshotTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0.05) return 0
  return Math.min(1, Math.max(0.1, duration * 0.1), duration - 0.05)
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return stringFromUnknown(obj.url ?? obj.URL ?? obj.Url ?? obj.src)
  }
  return ''
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = stringFromUnknown(obj[key])
    if (text) return text
  }
  return ''
}

export function isRemoteMediaUrl(path: string): boolean {
  return /^https?:\/\//i.test(path) || path.startsWith('blob:')
}

/** App 本地临时/相册路径；H5 浏览器无法加载，不能塞进 <image src> */
export function looksLikeLocalFilePath(path: string): boolean {
  if (!path || isRemoteMediaUrl(path) || path.startsWith('blob:')) return false
  if (path.startsWith('file://')) return true
  return (
    path.startsWith('/storage/') ||
    path.startsWith('/data/') ||
    path.startsWith('/var/') ||
    path.startsWith('_doc/') ||
    path.startsWith('_www/') ||
    path.startsWith('wxfile://') ||
    path.startsWith('content://') ||
    path.includes('/Android/data/') ||
    /^[a-zA-Z]:[\\/]/.test(path)
  )
}

/** 封面/视频地址优先取可跨端访问的远程 URL，避免 App 把发送端本地路径当封面。 */
export function preferRemoteMediaUrl(...candidates: string[]): string {
  const cleaned = candidates.map((v) => String(v || '').trim()).filter(Boolean)
  const remote = cleaned.find((v) => isRemoteMediaUrl(v))
  if (remote) return remote
  return cleaned[0] || ''
}

/** 兼容 H5 camelCase 与 App 原生桥 PascalCase 的视频消息结构。 */
export function parseVideoMeta(raw: unknown): VideoMeta {
  if (typeof raw === 'string') {
    if (!raw) return { url: '', snapshotUrl: '', duration: 0 }
    try {
      return parseVideoMeta(JSON.parse(raw) as unknown)
    } catch {
      return { url: isRemoteMediaUrl(raw) || looksLikeLocalFilePath(raw) ? raw : '', snapshotUrl: '', duration: 0 }
    }
  }
  if (!raw || typeof raw !== 'object') return { url: '', snapshotUrl: '', duration: 0 }
  const obj = raw as Record<string, unknown>
  const nested = obj.videoElem ?? obj.VideoElem
  if (nested) {
    const result = parseVideoMeta(nested)
    if (result.url || result.snapshotUrl) return result
  }
  const url = preferRemoteMediaUrl(
    firstString(obj, ['videoUrl', 'VideoUrl', 'videoURL', 'VideoURL', 'video_url', 'sourceUrl', 'SourceUrl', 'url', 'URL']),
    firstString(obj, ['videoPath', 'VideoPath']),
  )
  const snapshotUrl = preferRemoteMediaUrl(
    firstString(obj, [
      'snapshotUrl',
      'SnapshotUrl',
      'snapshotURL',
      'SnapshotURL',
      'snapshot_url',
      'coverUrl',
      'CoverUrl',
      'thumbUrl',
      'ThumbUrl',
    ]),
    firstString(obj, ['snapshotPath', 'SnapshotPath']),
  )
  return {
    url,
    snapshotUrl,
    duration: Number(obj.duration ?? obj.Duration ?? 0),
  }
}

/**
 * H5 的 https 页面不能展示或上传 http://IP/... 媒体，浏览器会当混合内容拦掉。
 * 已知对象存储路径改成当前站点同源；其它 http 媒体也尽量改写到 pathname（由前端 nginx 反代）。
 * App 仍用原始地址。
 */
export function h5PublicMediaUrl(path: string): string {
  // #ifdef H5
  // OSS signs the original host/key/query; legacy MinIO same-origin rules must
  // never rewrite it, even when a misconfigured upstream returns HTTP.
  if (isOSSStorageUrl(path)) return path
  if (typeof location !== 'undefined' && location.host && /^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path)
      if (url.host === location.host) return path
      const name = url.pathname
      const known =
        name.startsWith('/object/') ||
        name.startsWith('/openim/') ||
        name.startsWith('/minio/') ||
        name.startsWith('/openim-api/')
      // HTTPS custom storage/CDN URLs already work without the legacy proxy.
      if (!known && url.protocol === 'https:') return path
      // OpenIM 偶发直出 http://IP:9000/bucket/...，无白名单前缀时也走同源 pathname
      const looksMedia =
        known ||
        /\.(jpe?g|png|gif|webp|bmp|mp4|mov|m4v|webm|aac|m4a|mp3)(\?|$)/i.test(name) ||
        /\/(object|openim|minio|bucket|im-data)\b/i.test(name)
      if (looksMedia) {
        return `${location.origin}${url.pathname}${url.search}${url.hash}`
      }
    } catch {
      return path
    }
  }
  // #endif
  return path
}

/** 列表气泡用的缩略图。OpenIM 按宽高框等比缩小，不是把图拉成正方形。 */
export function listThumbnailUrl(url: string): string {
  const raw = (url || '').trim()
  if (isOSSStorageUrl(raw) || /[?&](X-Amz-Signature|Signature)=/i.test(raw)) return raw
  if (!/^https?:\/\//i.test(raw) || /[?&]type=image\b/i.test(raw)) return raw
  try {
    const parsed = new URL(raw)
    const path = parsed.pathname
    if (/\.(mp4|mov|m4v|webm|mkv|aac|m4a|mp3)(\?|$)/i.test(path)) return raw
    // Only OpenIM's object resolver understands these thumbnail parameters.
    const isPicture = path.startsWith('/object/')
    if (!isPicture) return raw
    parsed.searchParams.set('type', 'image')
    parsed.searchParams.set('width', '360')
    parsed.searchParams.set('height', '360')
    return parsed.toString()
  } catch {
    return raw
  }
}

/**
 * 把 App 本地相对路径（_doc/...、_www/...、_downloads/...）转成 AVPlayer 能打开的绝对 file:// 路径。
 * 兼容不同 uni 基座：优先 convertToAbsURL，回退 convertLocalFileSystemURL；
 * 两者都缺失时按 _doc/_www/_downloads 拼应用沙盒绝对路径兜底。
 */
export function toAbsFileUrl(p: string): string {
  if (!p) return p
  if (p.startsWith('file://') || p.startsWith('cdvfile://')) return p
  const io = (typeof plus !== 'undefined' && plus.io) as
    | { convertToAbsURL?: (u: string) => string; convertLocalFileSystemURL?: (u: string) => string }
    | undefined
  const convert = io?.convertToAbsURL || io?.convertLocalFileSystemURL
  if (typeof convert === 'function') {
    try {
      const abs = convert(p)
      if (abs) return abs.startsWith('file://') ? abs : `file://${abs}`
    } catch {
      /* ignore */
    }
  }
  if (p.startsWith('_doc/') || p.startsWith('_www/') || p.startsWith('_downloads/')) {
    const root = p.slice(0, p.indexOf('/') + 1)
    const base = io?.convertToAbsURL?.(root) || io?.convertLocalFileSystemURL?.(root)
    if (base) {
      const absRoot = base.startsWith('file://') ? base : `file://${base}`
      const tail = p.slice(root.length)
      return `${absRoot.replace(/\/$/, '')}/${tail}`
    }
  }
  return p
}

/**
 * 异步把 App 本地相对路径（_doc/...、_www/...、_downloads/...）解析成 AVPlayer 能打开的绝对 file:// 路径。
 * 优先同步接口（标准 HBuilder 基座 convertLocalFileSystemURL / convertToAbsURL）；
 * 自定义基座常缺这两个方法，回退到 plus.io.resolveLocalFileSystemURL —— 该接口在本地文件读写链路里已验证可用，
 * 其返回的 FileEntry.toURL() 即绝对 file://。playVoice 本就 await ensurePlayableAudioPath，故此处可异步。
 */
async function resolveAbsAudioPath(rel: string): Promise<string> {
  const clean = (rel || '').trim()
  if (!clean || clean.startsWith('file://') || isRemoteMediaUrl(clean) || clean.startsWith('blob:')) {
    return clean
  }
  const io = plus?.io as
    | {
        convertToAbsURL?: (u: string) => string
        convertLocalFileSystemURL?: (u: string) => string
        resolveLocalFileSystemURL?: PlusResolveLocalFile
      }
    | undefined

  const syncConvert = io?.convertToAbsURL || io?.convertLocalFileSystemURL
  if (typeof syncConvert === 'function') {
    try {
      const abs = syncConvert(clean)
      if (abs) return abs.startsWith('file://') ? abs : `file://${abs}`
    } catch {
      /* 旧基座转换异常，走异步兜底 */
    }
  }

  if (typeof io?.resolveLocalFileSystemURL === 'function') {
    try {
      const abs = await new Promise<string>((resolve, reject) => {
        io!.resolveLocalFileSystemURL!(
          clean,
          (entry: { toURL?: () => string; toLocalURL?: () => string; fullPath?: string }) => {
            const u = entry.toURL?.() || entry.toLocalURL?.() || entry.fullPath || ''
            if (u) resolve(u.startsWith('file://') || isRemoteMediaUrl(u) ? u : `file://${u}`)
            else reject(new Error('无法解析语音路径'))
          },
          (err: unknown) => reject(new Error(typeof err === 'string' ? err : JSON.stringify(err))),
        )
      })
      if (abs) return abs
    } catch {
      /* 落到原值 */
    }
  }
  return clean
}

/** 归一化可播放地址：http(s)/blob/file 原样返回，App 本地路径转 file://。 */
export function playableMediaUrl(path: string): string {
  if (!path) return ''
  if (isRemoteMediaUrl(path) || path.startsWith('blob:') || path.startsWith('file://')) {
    return h5PublicMediaUrl(path)
  }
  if (!looksLikeLocalFilePath(path)) return path
  try {
    return toAbsFileUrl(path)
  } catch {
    /* H5 无 plus */
  }
  return path.startsWith('/') ? `file://${path}` : path
}

/** 把样式里的 http 对象存储地址换成当前站点，uni-image 的头像是 background-image 不是 img */
function rewriteCssMediaUrls(css: string): string {
  if (!css || (!css.includes('http://') && !css.includes('https://'))) return css
  return css.replace(/url\(\s*(['"]?)(https?:\/\/[^)'"\s]+)\1\s*\)/gi, (full, quote, raw) => {
    const next = h5PublicMediaUrl(raw)
    return next === raw ? full : `url(${quote}${next}${quote})`
  })
}

function wrapCssSetter(key: 'cssText' | 'backgroundImage'): void {
  const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, key)
  if (!desc?.set || !desc.get) return
  const nativeSet = desc.set
  const nativeGet = desc.get
  Object.defineProperty(CSSStyleDeclaration.prototype, key, {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get() {
      return nativeGet.call(this)
    },
    set(value: string) {
      nativeSet.call(this, rewriteCssMediaUrls(String(value ?? '')))
    },
  })
}

/** https 页面里图片地址改成同源。uni-image 用 background-image 显示，只改 img.src 不够 */
export function installH5MediaProxy(): void {
  // #ifdef H5
  if (typeof window === 'undefined') return
  const flag = window as Window & { __imH5ImageProxy?: boolean }
  if (flag.__imH5ImageProxy) return
  flag.__imH5ImageProxy = true
  if (typeof HTMLImageElement !== 'undefined') {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    if (desc?.set && desc.get) {
      const nativeSet = desc.set
      const nativeGet = desc.get
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable ?? true,
        get() {
          return nativeGet.call(this)
        },
        set(value: string) {
          nativeSet.call(this, h5PublicMediaUrl(String(value ?? '')))
        },
      })
    }
  }
  if (typeof CSSStyleDeclaration !== 'undefined') {
    wrapCssSetter('cssText')
    wrapCssSetter('backgroundImage')
  }
  // #endif
}

/** 气泡封面：远程图、blob、以及本机截图路径可展示；视频地址不能当 <image> 用。 */
export function isUsableVideoPoster(path: string): boolean {
  const t = String(path || '').trim()
  if (!t) return false
  if (/\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i.test(t)) return false
  return isRemoteMediaUrl(t) || t.startsWith('file://') || t.startsWith('blob:') || looksLikeLocalFilePath(t)
}

/** 两条视频 content 合并时优先远程封面，避免本地 snapshotPath 盖掉已上传的 URL。 */
export function mergeVideoContent(primary: string, fallback: string): string {
  const a = parseVideoMeta(primary)
  const b = parseVideoMeta(fallback)
  return JSON.stringify({
    url: preferRemoteMediaUrl(a.url, b.url),
    snapshotUrl: preferRemoteMediaUrl(a.snapshotUrl, b.snapshotUrl),
    duration: a.duration || b.duration,
  })
}

export function videoPlayUrlFromContent(content: string): string {
  return playableMediaUrl(parseVideoMeta(content).url)
}

/** 播放页首屏封面：视频缓冲期间先展示消息自带缩略图，避免打开后长时间黑屏。 */
export function videoPosterUrlFromContent(content: string): string {
  const poster = parseVideoMeta(content).snapshotUrl
  return isUsableVideoPoster(poster) ? playableMediaUrl(poster) : ''
}

function isAndroidApp(): boolean {
  return isAppPlatform() && isAndroid()
}

/** 华为等机型 previewImage 内置「保存图像」常因未申请写相册权限失败；保存前先要权限。 */
export function requestAndroidSaveAlbumPermission(): Promise<void> {
  return new Promise((resolve) => {
    if (!isAndroidApp()) {
      resolve()
      return
    }
    const request = plus?.android?.requestPermissions
    if (typeof request !== 'function') {
      resolve()
      return
    }
    request(
      [
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      ],
      () => resolve(),
      () => resolve(),
    )
  })
}

function saveLocalImageViaGallery(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const gallery = plus?.gallery as { save?: PlusGallerySave } | undefined
    if (typeof gallery?.save !== 'function') {
      reject(new Error('保存图片失败'))
      return
    }
    gallery.save(
      filePath,
      () => resolve(),
      (err: { message?: string } | string) => {
        const msg = typeof err === 'string' ? err : err?.message || '保存图片失败'
        reject(new Error(msg))
      },
    )
  })
}

function isAlbumPermissionError(msg: string): boolean {
  return /auth|permission|deny|authorize|no permission|权限/i.test(msg || '')
}

/** App 保存到系统相册；H5 使用浏览器下载，供同一长按菜单复用。 */
export async function saveVideoToDevice(content: string): Promise<void> {
  const { url } = parseVideoMeta(content)
  if (!url) throw new Error('视频地址不存在')

  // #ifdef APP-PLUS
  await requestAndroidSaveAlbumPermission()
  const filePath = /^https?:\/\//i.test(url) ? await downloadRemoteFile(url) : url
  await new Promise<void>((resolve, reject) => {
    uni.saveVideoToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const denied = isAlbumPermissionError(err.errMsg || '')
        reject(new Error(denied ? '请在系统设置中允许相册权限' : err.errMsg || '保存视频失败'))
      },
    })
  })
  return
  // #endif

  // #ifdef H5
  if (typeof document !== 'undefined') {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `video_${Date.now()}.mp4`
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  return
  // #endif

  throw new Error('当前平台暂不支持保存视频')
}

/**
 * 长按菜单「保存图片」。
 * App：先申请写相册权限 → 下载到本地 → saveImageToPhotosAlbum，华为失败再走 plus.gallery.save。
 * H5：优先 blob 下载，CORS 失败再直链。
 */
export async function saveImageToDevice(url: string): Promise<void> {
  const src = playableMediaUrl((url || '').trim())
  if (!src) throw new Error('图片地址不存在')

  // #ifdef APP-PLUS
  await requestAndroidSaveAlbumPermission()
  const filePath = /^https?:\/\//i.test(src) ? await downloadRemoteFile(src) : src
  try {
    await new Promise<void>((resolve, reject) => {
      uni.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg || '保存图片失败')),
      })
    })
  } catch (err) {
    const msg = (err as Error)?.message || ''
    try {
      await saveLocalImageViaGallery(filePath)
    } catch (fallbackErr) {
      const denied = isAlbumPermissionError(msg) || isAlbumPermissionError((fallbackErr as Error)?.message || '')
      throw new Error(denied ? '请在系统设置中允许相册权限' : msg || '保存图片失败')
    }
  }
  return
  // #endif

  // #ifdef H5
  if (typeof document === 'undefined') {
    throw new Error('当前平台暂不支持保存图片')
  }
  const clickDownload = (href: string, filename: string) => {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.target = '_blank'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  if (/^https?:\/\//i.test(src) || src.startsWith('blob:')) {
    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' })
      if (!res.ok) throw new Error('图片下载失败')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const ext = blob.type.includes('png')
        ? 'png'
        : blob.type.includes('webp')
          ? 'webp'
          : blob.type.includes('gif')
            ? 'gif'
            : 'jpg'
      clickDownload(objectUrl, `image_${Date.now()}.${ext}`)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
      return
    } catch {
      /* 跨域时退回直链，浏览器可能直接打开预览 */
    }
  }
  clickDownload(src, `image_${Date.now()}.jpg`)
  return
  // #endif

  throw new Error('当前平台暂不支持保存图片')
}

/**
 * 统一图片预览：接管长按「保存」，避免华为上 previewImage 内置「保存图像到相册失败」。
 * App 用 longPressActions；H5 仍走系统预览。
 */
export async function previewImagesWithSave(urls: string[], current?: string): Promise<void> {
  const list = urls.map((u) => playableMediaUrl((u || '').trim())).filter(Boolean)
  if (!list.length) return
  const cur = playableMediaUrl((current || '').trim())
  const currentUrl = cur && list.includes(cur) ? cur : list[0]

  if (isAppPlatform()) {
    await requestAndroidSaveAlbumPermission()
    uni.previewImage({
      urls: list,
      current: currentUrl,
      // App 端接管长按菜单，走带权限/华为兜底的保存逻辑
      longPressActions: {
        itemList: ['保存图片'],
        success: (data: { tapIndex?: number; index?: number }) => {
          const idx = typeof data.index === 'number' ? data.index : list.indexOf(currentUrl)
          const url = list[idx] || list[0]
          if (data.tapIndex !== 0 || !url) return
          void saveImageToDevice(url)
            .then(() => {
              uni.showToast({ title: '已保存到相册', icon: 'success' })
            })
            .catch((e: unknown) => {
              uni.showToast({
                title: e instanceof Error ? e.message : '保存图片失败',
                icon: 'none',
              })
            })
        },
        fail: () => {
          /* 用户取消菜单 */
        },
      },
    } as UniApp.PreviewImageOptions)
    return
  }

  uni.previewImage({
    urls: list,
    current: currentUrl,
  })
}

function captureH5VideoPoster(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('')
      return
    }
    const video = document.createElement('video')
    const finish = (poster: string) => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      resolve(poster)
    }
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    video.crossOrigin = 'anonymous'
    video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0'
    video.onerror = () => finish('')
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = videoSnapshotTime(duration)
      const capture = () => {
        try {
          const width = video.videoWidth
          const height = video.videoHeight
          if (!width || !height) {
            finish('')
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) {
            finish('')
            return
          }
          context.drawImage(video, 0, 0, width, height)
          finish(canvas.toDataURL('image/jpeg', 0.82))
        } catch {
          finish('')
        }
      }
      if (target > 0) {
        video.onseeked = capture
        try {
          video.currentTime = target
        } catch {
          video.onloadeddata = capture
        }
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        capture()
      } else {
        video.onloadeddata = capture
      }
    }
    document.body.appendChild(video)
    video.src = url
    video.load()
  })
}

/**
 * snapshotUrl 缺失时截取封面。
 * H5：canvas 截帧为 dataURL。
 * App：本函数不返回封面（getVideoInfo 无缩略图）；转发请用 extractVideoCoverForForward。
 */
export function captureVideoPosterFromUrl(url: string): Promise<string> {
  if (!url) return Promise.resolve('')

  // #ifdef H5
  return captureH5VideoPoster(url)
  // #endif

  return Promise.resolve('')
}

export interface FileMeta {
  url: string
  fileName: string
}

function fileNameFromUrl(url: string): string {
  const path = url.split('?')[0]?.split('#')[0] || ''
  const seg = path.split(/[\\/]/).filter(Boolean).pop() || ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/** 新消息 content 是 { url, fileName }；旧消息只有 URL，文件名从地址尾巴取。 */
export function parseFileContent(content: string): FileMeta {
  const raw = (content || '').trim()
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as { url?: string; fileName?: string }
      const url = (obj.url || '').trim()
      const fileName = (obj.fileName || '').trim() || fileNameFromUrl(url) || '文件'
      return { url, fileName }
    } catch {
      /* 不是 JSON 就按纯地址处理 */
    }
  }
  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, fileName: fileNameFromUrl(raw) || '文件' }
  }
  return { url: '', fileName: raw || '文件' }
}

const IMAGE_FILE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

function fileExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return ext === fileName.toLowerCase() ? '' : ext
}

function downloadRemoteFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        reject(new Error('文件下载失败'))
      },
      fail: (err) => reject(new Error(err.errMsg || '文件下载失败')),
    })
  })
}

const AUDIO_EXT_RE = /\.(aac|m4a|mp3|wav|caf|amr)(\?|#|$)/i

type PlusFileReader = {
  onloadend: ((e: { target?: { result?: unknown } }) => void) | null
  onerror: (() => void) | null
  readAsDataURL: (file: unknown) => void
}
type PlusIo = {
  resolveLocalFileSystemURL?: PlusResolveLocalFile
  FileReader?: new () => PlusFileReader
}

/** 读文件头若干字节；读不到返回 null（不影响后续按后缀兜底） */
function readFileHead(path: string, size = 16): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const io = plus?.io as unknown as PlusIo | undefined
    const Reader = io?.FileReader
    if (!io?.resolveLocalFileSystemURL || !Reader) {
      resolve(null)
      return
    }
    io.resolveLocalFileSystemURL(
      path,
      (entry: { file?: PlusFileEntry['file'] }) => {
        if (!entry.file) {
          resolve(null)
          return
        }
        entry.file(
          (file: { slice?: (start: number, end: number) => unknown }) => {
            const reader = new Reader()
            reader.onloadend = (e) => {
              const result = String(e.target?.result || '')
              const base64 = result.slice(result.indexOf(',') + 1)
              try {
                resolve(base64 ? new Uint8Array(uni.base64ToArrayBuffer(base64)).slice(0, size) : null)
              } catch {
                resolve(null)
              }
            }
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(typeof file.slice === 'function' ? file.slice(0, size) : file)
          },
          () => resolve(null),
        )
      },
      () => resolve(null),
    )
  })
}

/** 确认本地语音文件存在（带超时）：不存在直接报明确错误，避免 AVPlayer 拿到无效路径静默失败 */
function fileExistsForPlay(absPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const io = plus?.io as unknown as { resolveLocalFileSystemURL?: PlusResolveLocalFile } | undefined
    if (!io?.resolveLocalFileSystemURL) {
      resolve(true)
      return
    }
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(true)
      }
    }, 2500)
    try {
      io.resolveLocalFileSystemURL(
        absPath,
        () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(true)
          }
        },
        () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(false)
          }
        },
      )
    } catch {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(true)
      }
    }
  })
}

/**
 * 按文件头判断真实封装。iOS AVPlayer 依赖后缀选解析器：
 * 安卓录的 ADTS-AAC 被改名成 .m4a 会直接 MediaError，必须用和内容一致的后缀。
 */
function sniffAudioExt(h: Uint8Array): string {
  if (h.length < 4) return ''
  const ascii = (start: number, end: number) => String.fromCharCode(...Array.from(h.slice(start, end)))
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return 'aac'
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (ascii(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return 'mp3'
  if (ascii(0, 4) === 'RIFF') return 'wav'
  if (ascii(0, 4) === 'caff') return 'caf'
  if (ascii(0, 5) === '#!AMR') return 'amr'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'webm'
  return ''
}

function isIOSApp(): boolean {
  try {
    return uni.getSystemInfoSync().platform === 'ios'
  } catch {
    return false
  }
}

const playableAudioCache = new Map<string, string>()

async function toNamedPlayableAudio(localPath: string, srcHint = ''): Promise<string> {
  const head = await readFileHead(localPath)
  const ext = head ? sniffAudioExt(head) : ''
  if ((ext === 'webm' || ext === 'ogg') && isIOSApp()) {
    throw new Error('该语音为网页端录制的格式，iOS 暂不支持播放')
  }
  if (!ext) {
    if (AUDIO_EXT_RE.test(localPath)) return localPath
    // 读不到文件头时按来源地址后缀兜底；语音几乎都是 aac/m4a，缺省 .aac。
    // ⚠️ 切勿盲给 .m4a：裸 ADTS-AAC 被当 MP4 容器解析会 MediaError「格式不对」（iOS/安卓都中招）。
    const m = srcHint.match(/\.(aac|m4a|mp3|wav|caf|amr)(\?|#|$)/i)
    const fallbackExt = (m && m[1] ? m[1] : 'aac').toLowerCase()
    return persistNamedFile(localPath, `voice_${Date.now()}.${fallbackExt}`)
  }
  if (new RegExp(`\\.${ext}(\\?|#|$)`, 'i').test(localPath)) return localPath
  return persistNamedFile(localPath, `voice_${Date.now()}.${ext}`)
}

/**
 * App 上远程语音先完整下载到本地，再按文件头/来源后缀补真实封装后交给 InnerAudio；
 * 同一条语音只落地一次。H5 仍走原 URL。
 *
 * 为什么 iOS 也走「下载到本地」而不是「直接给 AVPlayer 远程 URL」：
 * - 业务 App 与 IM 服务端全链路 HTTP（API 即 http://…），原生壳 ATS 已放行 http，故 ATS 不是主因；
 * - 但 OpenIM / MinIO 返回的 object 地址对 AVPlayer「远程流式」支持差：裸 ADTS-AAC 无容器、
 *   Range/Content-Type 不稳，iOS 直接 onError「播放失败」。安卓端此前就是「完整下载后播」才正常，
 *   因此 iOS 统一成同一路径：下载 → file:// 本地播放（无远程流式、按文件头选对解析器）。
 */
export async function ensurePlayableAudioPath(url: string): Promise<string> {
  const original = (url || '').trim()
  const src = playableMediaUrl(original)
  if (!src) return ''
  if (!isAppPlatform()) return src

  // 网页端 MediaRecorder 录的 webm/ogg/opus：iOS 与多数安卓基座都无法用系统播放器解码，提前给友好提示
  if (/\.(webm|ogg|opus)(\?|#|$)/i.test(src)) {
    const msg = isIOSApp()
      ? '该语音为网页端录制的格式，iOS 暂不支持播放'
      : '该语音格式暂不支持播放'
    throw new Error(msg)
  }

  const cached = playableAudioCache.get(original)
  if (cached) return cached

  let local = src
  if (isRemoteMediaUrl(src)) {
    try {
      local = await downloadRemoteFile(src)
    } catch {
      // 下载失败保留远程地址最后一搏（AVPlayer 可能仍失败，但不再抛错阻断）
      local = src
    }
  } else if (
    looksLikeLocalFilePath(original) ||
    original.startsWith('_doc') ||
    original.startsWith('_www') ||
    original.startsWith('_downloads')
  ) {
    // App 本地语音（多为 OpenIM 下载缓存）：转绝对路径并确认文件存在，避免 iOS AVPlayer 拿到相对路径静默失败。
    const abs = await resolveAbsAudioPath(original)
    const ok = await fileExistsForPlay(abs)
    if (!ok) throw new Error('语音文件已过期，请让对方重新发送')
    local = abs
  }

  // 关键（真机验证）：uni.downloadFile 在 iOS 上返回的 tempFilePath 是**相对**形态
  // （_doc/uniapp_temp_<ts>/download/xxx.aac），此前只对「本来就是本地路径」的分支做过绝对化，
  // 下载产物绕过了转换 → AVPlayer 拿到相对路径直接 onError「播放失败」。此处统一补一道。
  if (!isRemoteMediaUrl(local) && !local.startsWith('file://') && looksLikeLocalFilePath(local)) {
    const abs = await resolveAbsAudioPath(local)
    if (abs && abs !== local) local = abs
  }
  const playable = await toNamedPlayableAudio(local, src)
  if (playableAudioCache.size > 200) playableAudioCache.clear()
  playableAudioCache.set(original, playable)
  return playable
}

/**
 * 下载结果经常没有后缀，系统不知道用哪个应用打开。
 * 拷到应用目录并带上原始文件名后再交给 openDocument。
 */
function persistNamedFile(tempPath: string, fileName: string): Promise<string> {
  return new Promise((resolve) => {
    const io = plus?.io as { resolveLocalFileSystemURL?: PlusResolveLocalFile } | undefined
    if (!io?.resolveLocalFileSystemURL) {
      resolve(tempPath)
      return
    }
    const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(-100) || 'file'
    const src = /^(file|content):\/\//.test(tempPath) ? tempPath : tempPath
    io.resolveLocalFileSystemURL(
      src,
      (entry: { copyTo?: PlusFileEntry['copyTo'] }) => {
        io.resolveLocalFileSystemURL?.(
          '_doc/',
          (dir: object) => {
            if (!entry.copyTo) {
              resolve(tempPath)
              return
            }
            entry.copyTo(
              dir,
              `${Date.now()}_${safe}`,
              (copied: { fullPath?: string; toLocalURL?: () => string }) => {
                resolve(copied.fullPath || copied.toLocalURL?.() || tempPath)
              },
              () => resolve(tempPath),
            )
          },
          () => resolve(tempPath),
        )
      },
      () => resolve(tempPath),
    )
  })
}

/** App 下载后用系统应用打开；图片直接预览。H5 新开页面。 */
export async function openChatFile(content: string): Promise<void> {
  const { url, fileName } = parseFileContent(content)
  if (!/^https?:\/\//i.test(url)) {
    uni.showToast({ title: '文件还没发送完成', icon: 'none' })
    return
  }
  const href = playableMediaUrl(url)
  if (IMAGE_FILE_EXTS.has(fileExt(fileName))) {
    void previewImagesWithSave([href], href)
    return
  }
  if (uni.getSystemInfoSync().uniPlatform === 'web') {
    window.open(href, '_blank')
    return
  }
  uni.showLoading({ title: '正在打开', mask: true })
  try {
    const temp = await downloadRemoteFile(url)
    const local = await persistNamedFile(temp, fileName)
    await new Promise<void>((resolve, reject) => {
      uni.openDocument({
        filePath: local,
        showMenu: true,
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg || '无法打开该文件')),
      })
    })
  } catch (error) {
    uni.showToast({ title: (error as Error).message || '无法打开该文件', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

/** App：把远程视频下到临时路径，供 OpenIM getVideoCover 取帧。 */
export function downloadRemoteVideoForCover(url: string): Promise<string> {
  if (!url) return Promise.resolve('')
  if (!isRemoteMediaUrl(url)) return Promise.resolve(url)
  return new Promise((resolve) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        resolve('')
      },
      fail: () => resolve(''),
    })
  })
}
