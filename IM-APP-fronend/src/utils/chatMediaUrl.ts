import { APP_CONFIG } from '@/config'
import { storeMediaUrl } from '@/utils/app-store-network'
import { isAppPlatform } from '@/utils/platform'
import { isBusinessCDNHost, isChatCDNHost, isPermanentChatCDNHost } from '@/utils/storage-hosts'
import { isOSSStorageUrl } from '@/utils/storage-url'

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

/**
 * H5 的 https 页面不能展示或上传 http://IP/... 媒体，浏览器会当混合内容拦掉。
 * 已知对象存储路径改成当前站点同源；其它 http 媒体也尽量改写到 pathname（由前端 nginx 反代）。
 * App 仍用原始地址。
 */
export function h5PublicMediaUrl(path: string): string {
  path = storeMediaUrl(path)
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

const OSS_MEDIA_PATH = '/api/v1/public/oss-media'
const OSS_IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|bmp|gif|tiff?|heic|heif|avif)$/i
const NON_IMAGE_MEDIA_EXTENSIONS = /\.(?:mp4|mov|m4v|webm|mkv|avi|aac|m4a|mp3|wav|ogg|flac|pdf|zip|rar|7z|docx?|xlsx?|pptx?)$/i
const CHAT_OBJECT_PREFIXES = ['im-app-production/chat/', 'oss-test/chat/']
const BUSINESS_OBJECT_PREFIXES = ['im-app-production/business/', 'oss-test/business/']

// Mirrors IM-APP-server internal/infra/oss.go so the browser and the stable
// proxy ask OSS for the same bytes. The quality attribute must stay explicit:
// `image/resize,w_128/q_70/format,webp` is rejected with 400 InvalidArgument.
const PUBLIC_IMAGE_PROCESSES = {
  list: 'image/resize,w_360/quality,q_60/format,webp',
  preview: 'image/resize,w_1280/quality,q_75/format,webp',
  'preview-mobile': 'image/resize,w_960/quality,q_72/format,webp',
  avatar: 'image/resize,w_128/quality,q_70/format,webp',
} as const

function decodePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    .join('/')
}

/** 签名 URL 的路径包含 OSS 物理前缀；OpenIM `/object/` 只接受物理前缀后的逻辑 key。 */
function hasStorageSignature(query: URLSearchParams): boolean {
  return (
    query.has('x-oss-signature') ||
    query.has('X-Amz-Signature') ||
    (query.has('OSSAccessKeyId') && query.has('Signature'))
  )
}

function logicalChatKeyFromOSS(raw: string): string {
  try {
    const parsed = new URL(raw)
    const query = parsed.searchParams
    // 只有「无签名」和「真 CDN 域名」这两种地址能长期直接用，不必还原重签。
    // 注意不能用 isChatCDNHost：那个集合为了追加 x-oss-process 也收了签名直连域名
    // oss-chat-test.*，而那里的地址 7 天就过期 —— 一旦在这里被当成永不过期跳过，
    // 老消息里的图就再也显示不出来（403）。
    if (!hasStorageSignature(query) || isPermanentChatCDNHost(parsed.hostname)) return ''
    const pathname = decodePathname(parsed.pathname).replace(/^\/+/, '')
    for (const prefix of CHAT_OBJECT_PREFIXES) {
      if (pathname.startsWith(prefix)) return pathname.slice(prefix.length)
    }
  } catch {
    /* not an absolute URL */
  }
  return ''
}

/**
 * H5 走当前站点同源 /object；App/小程序从业务 API 地址推导后端绝对地址。
 * APP_CONFIG 在 H5 已是 /api/v1，因此结果保持为 /object/... 相对路径。
 */
function openIMObjectBaseURL(): string {
  const configured = String(APP_CONFIG.apiBaseUrl || '').trim()
  if (!/^https?:\/\//i.test(configured)) return ''
  try {
    const parsed = new URL(configured)
    parsed.pathname = parsed.pathname.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '')
    parsed.search = ''
    parsed.hash = ''
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return ''
  }
}

function openIMObjectURL(logicalKey: string, edge: number): string {
  const key = logicalKey
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  if (!key) return ''
  const query = new URLSearchParams({
    type: 'image',
    width: String(edge),
    height: String(edge),
    format: 'webp',
  })
  return `${openIMObjectBaseURL()}/object/${key}?${query.toString()}`
}

type OSSMediaVariant = 'list' | 'preview' | 'preview-mobile' | 'avatar'

/**
 * 稳定 OSS 媒体入口由服务端固定处理规格；只允许白名单中的规格，不能把任意
 * x-oss-process 暴露给客户端。视频、语音和文件保持原地址。
 */
function withStableOSSMediaVariant(url: string, variant: OSSMediaVariant): string {
  const raw = (url || '').trim()
  if (!raw) return raw
  const absolute = /^https?:\/\//i.test(raw)
  const rootRelative = raw.startsWith('/')
  if (!absolute && !rootRelative) return raw
  try {
    const parsed = new URL(raw, 'https://relative.invalid')
    if (parsed.pathname !== OSS_MEDIA_PATH) return raw
    const key = parsed.searchParams.get('key') || ''
    if (!parsed.searchParams.get('token') || !OSS_IMAGE_EXTENSIONS.test(key)) return raw
    parsed.searchParams.set('variant', variant)
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return raw
  }
}

/**
 * 只有已知 CDN 域名与对应桶前缀同时匹配时才追加图片处理参数。
 * 聊天地址带签名、未知域名或跨桶路径一律保持原样，避免把业务域名误用于聊天对象。
 */
function withPublicImageProcess(url: string, variant: OSSMediaVariant): string {
  const raw = (url || '').trim()
  if (!/^https?:\/\//i.test(raw)) return raw
  try {
    const parsed = new URL(raw)
    if (hasStorageSignature(parsed.searchParams)) return raw
    if (parsed.searchParams.has('x-oss-process')) return raw
    const pathname = decodePathname(parsed.pathname).replace(/^\/+/, '')
    const knownBusinessObject =
      isBusinessCDNHost(parsed.hostname) &&
      BUSINESS_OBJECT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    const knownPublicObject =
      variant === 'avatar'
        ? knownBusinessObject
        : (isChatCDNHost(parsed.hostname) && CHAT_OBJECT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) ||
          knownBusinessObject
    if (!knownPublicObject) return raw
    if (!OSS_IMAGE_EXTENSIONS.test(pathname)) return raw
    parsed.searchParams.set('x-oss-process', PUBLIC_IMAGE_PROCESSES[variant])
    return parsed.toString()
  } catch {
    return raw
  }
}

/**
 * 聊天 OSS 原图先转成稳定的 OpenIM 图片处理入口。签名参数只属于原始 OSS
 * 地址，不能带到 `/object/`；OpenIM 会按逻辑 key 重新签名并让 OSS 实时出图。
 * 业务桶之外的直链保持原地址。
 */
function withObjectThumbnail(url: string, edge: number): string {
  const raw = (url || '').trim()
  if (!raw) return raw

  const logicalKey = logicalChatKeyFromOSS(raw)
  if (logicalKey && !NON_IMAGE_MEDIA_EXTENSIONS.test(logicalKey)) {
    return openIMObjectURL(logicalKey, edge) || raw
  }

  const absolute = /^https?:\/\//i.test(raw)
  const rootRelativeObject = raw.startsWith('/object/')
  if (!absolute && !rootRelativeObject) return raw
  try {
    const parsed = absolute ? new URL(raw) : new URL(raw, 'https://relative.invalid')
    if (!parsed.pathname.startsWith('/object/')) return raw
    if (NON_IMAGE_MEDIA_EXTENSIONS.test(parsed.pathname)) return raw
    // 任意签名直链都不能再加查询参数，否则 OSS 签名立即失效。
    if (hasStorageSignature(parsed.searchParams)) return raw
    parsed.searchParams.set('type', 'image')
    parsed.searchParams.set('width', String(edge))
    parsed.searchParams.set('height', String(edge))
    parsed.searchParams.set('format', 'webp')
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`
  } catch {
    return raw
  }
}

/** 列表气泡用的缩略图。聊天 OSS 固定为 360px WebP，旧 OpenIM 地址仍走宽高参数。 */
export function listThumbnailUrl(url: string): string {
  const raw = storeMediaUrl((url || '').trim())
  const stable = withStableOSSMediaVariant(raw, 'list')
  if (stable !== raw) return stable
  const object = withObjectThumbnail(raw, 360)
  if (object !== raw) return object
  return withPublicImageProcess(raw, 'list')
}

function isMobileViewport(): boolean {
  if (isAppPlatform()) return true
  if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0) {
    return window.innerWidth <= 768
  }
  try {
    const width = Number(uni.getSystemInfoSync().windowWidth || 0)
    return width > 0 && width <= 768
  } catch {
    return false
  }
}

/** 点开看的中图。手机固定 960px、桌面 1280px，原图只用于保存、收藏和转发。 */
export function previewThumbnailUrl(url: string): string {
  url = storeMediaUrl(url || '')
  const mobile = isMobileViewport()
  const edge = mobile ? 960 : 1280
  const variant = mobile ? 'preview-mobile' : 'preview'
  const stable = withStableOSSMediaVariant(url, variant)
  if (stable !== url) return stable
  const object = withObjectThumbnail(url, edge)
  if (object !== url) return object
  return withPublicImageProcess(url, variant)
}

/**
 * 保存用的原图地址。预览/列表 URL 上的实时处理参数只服务于显示：
 * x-oss-process 出来的结果和 /object/ 的 format=webp 都是 WebP，
 * iOS 相册拒存 WebP（PHPhotosErrorDomain 3302），保存必须回到原图。
 * 签名地址本身没有处理参数，保持字节级不变。
 */
export function originalImageUrl(url: string): string {
  const raw = storeMediaUrl((url || '').trim())
  if (!raw) return raw
  const hasProcess = /[?&]x-oss-process=/.test(raw)
  const isObjectVariant = /\/object\//.test(raw) && /[?&](type|width|height|format)=/.test(raw)
  // 预览走 oss-media?variant=preview-mobile，响应是 WebP。去掉 variant 才是原图。
  const isOssMediaVariant = raw.includes(OSS_MEDIA_PATH) && /[?&]variant=/.test(raw)
  if (!hasProcess && !isObjectVariant && !isOssMediaVariant) return raw
  let parsed: URL
  try {
    parsed = new URL(raw, 'https://relative.invalid')
  } catch {
    return raw
  }
  if (hasStorageSignature(parsed.searchParams)) return raw
  parsed.searchParams.delete('x-oss-process')
  parsed.searchParams.delete('variant')
  if (parsed.pathname.includes('/object/')) {
    parsed.searchParams.delete('type')
    parsed.searchParams.delete('width')
    parsed.searchParams.delete('height')
    parsed.searchParams.delete('format')
  }
  const out = parsed.toString()
  const base = 'https://relative.invalid'
  return out.startsWith(`${base}/`) ? out.slice(base.length) : out
}

/**
 * 高频头像使用 128px WebP；签名 OSS 地址不能追加处理参数，必须保持字节级不变。
 * 没有签名的公开业务桶头像可以直接让 OSS 实时缩图。
 */
export function avatarThumbnailUrl(url: string): string {
  const raw = storeMediaUrl((url || '').trim())
  if (!raw) return raw
  const stable = withStableOSSMediaVariant(raw, 'avatar')
  if (stable !== raw) return stable

  const absolute = /^https?:\/\//i.test(raw)
  const rootRelative = raw.startsWith('/')
  if (!absolute && !rootRelative) return raw
  try {
    const parsed = new URL(raw, 'https://relative.invalid')
    if (hasStorageSignature(parsed.searchParams)) return raw
    if (/\/avatars\//i.test(parsed.pathname) && !NON_IMAGE_MEDIA_EXTENSIONS.test(parsed.pathname)) {
      const limited = withPublicImageProcess(raw, 'avatar')
      if (limited !== raw) return limited
    }
    if (!/\/avatars\//i.test(parsed.pathname)) return raw
    // Absolute URLs may only use the known business CDN. Root-relative avatar
    // paths retain the same-origin behavior used by legacy deployments.
    if (absolute) return raw
    if (NON_IMAGE_MEDIA_EXTENSIONS.test(parsed.pathname)) return raw
    if (parsed.searchParams.has('x-oss-process')) return raw
    parsed.searchParams.set('x-oss-process', PUBLIC_IMAGE_PROCESSES.avatar)
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
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

/**
 * 图片消息点开时用的地址。必须从原图出中图：新消息的 content 是单独上传的 360 小图，
 * 拿它要 1280 只会得到同一张小图。预取和预览共用这一个函数，缓存 key 才对得上。
 */
export function imagePreviewUrlOf(message: { sourceUrl?: string; content?: string }): string {
  const source = (message.sourceUrl || message.content || '').trim()
  return source ? playableMediaUrl(previewThumbnailUrl(source)) : ''
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
