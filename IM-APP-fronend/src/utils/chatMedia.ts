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

/** 封面/视频地址优先取可跨端访问的远程 URL，避免 App 把发送端本地路径当封面。 */
export function preferRemoteMediaUrl(...candidates: string[]): string {
  const cleaned = candidates.map((v) => String(v || '').trim()).filter(Boolean)
  const remote = cleaned.find((v) => isRemoteMediaUrl(v))
  if (remote) return remote
  return cleaned[0] || ''
}

function looksLikeLocalFilePath(path: string): boolean {
  if (!path || isRemoteMediaUrl(path) || path.startsWith('blob:')) return false
  if (path.startsWith('file://')) return true
  return (
    path.startsWith('/storage/') ||
    path.startsWith('/data/') ||
    path.startsWith('/var/') ||
    path.startsWith('_doc/') ||
    path.startsWith('_www/') ||
    path.startsWith('wxfile://') ||
    /^[a-zA-Z]:[\\/]/.test(path)
  )
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

/** 归一化可播放地址：http(s)/blob/file 原样返回，App 本地路径转 file://。 */
export function playableMediaUrl(path: string): string {
  if (!path) return ''
  if (isRemoteMediaUrl(path) || path.startsWith('blob:') || path.startsWith('file://')) return path
  if (!looksLikeLocalFilePath(path)) return path
  try {
    const converted = plus?.io?.convertLocalFileSystemURL?.(path)
    if (converted) return converted.startsWith('file://') ? converted : `file://${converted}`
  } catch {
    /* H5 无 plus */
  }
  return path.startsWith('/') ? `file://${path}` : path
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

function downloadVideo(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(url)
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
        } else {
          reject(new Error('视频下载失败'))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '视频下载失败')),
    })
  })
}

/** App 保存到系统相册；H5 使用浏览器下载，供同一长按菜单复用。 */
export async function saveVideoToDevice(content: string): Promise<void> {
  const { url } = parseVideoMeta(content)
  if (!url) throw new Error('视频地址不存在')

  // #ifdef APP-PLUS
  const filePath = await downloadVideo(url)
  await new Promise<void>((resolve, reject) => {
    uni.saveVideoToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const denied = /auth|permission|deny|authorize/i.test(err.errMsg || '')
        reject(new Error(denied ? '请在系统设置中允许相册权限' : err.errMsg || '保存视频失败'))
      },
    })
  })
  return
  // #endif

  // #ifdef H5
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `video_${Date.now()}.mp4`
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return
  // #endif

  throw new Error('当前平台暂不支持保存视频')
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
