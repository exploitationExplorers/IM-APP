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

/**
 * OpenIM `/object/` 按宽高框等比出图。签名直链不能改参数，否则签名失效。
 * 已经带 type=image 时仍覆盖宽高，方便列表 360、预览 1280 共用同一条地址。
 */
function withObjectThumbnail(url: string, edge: number): string {
  const raw = (url || '').trim()
  if (!raw || isOSSStorageUrl(raw) || /[?&](X-Amz-Signature|Signature)=/i.test(raw)) return raw
  if (!/^https?:\/\//i.test(raw)) return raw
  try {
    const parsed = new URL(raw)
    const path = parsed.pathname
    if (/\.(mp4|mov|m4v|webm|mkv|aac|m4a|mp3)(\?|$)/i.test(path)) return raw
    if (!path.startsWith('/object/')) return raw
    parsed.searchParams.set('type', 'image')
    parsed.searchParams.set('width', String(edge))
    parsed.searchParams.set('height', String(edge))
    return parsed.toString()
  } catch {
    return raw
  }
}

/** 列表气泡用的缩略图。OpenIM 按宽高框等比缩小，不是把图拉成正方形。 */
export function listThumbnailUrl(url: string): string {
  const raw = (url || '').trim()
  if (/[?&]type=image\b/i.test(raw)) return raw
  return withObjectThumbnail(raw, 360)
}

/** 点开看的中图。比列表小图清楚，但不要把未压缩原图交给系统预览。 */
export function previewThumbnailUrl(url: string): string {
  return withObjectThumbnail(url, 1280)
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
