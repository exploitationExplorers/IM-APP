export interface VideoMeta {
  url: string
  snapshotUrl: string
  duration: number
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** 兼容 H5 camelCase 与 App 原生桥 PascalCase 的视频消息结构。 */
export function parseVideoMeta(raw: unknown): VideoMeta {
  if (typeof raw === 'string') {
    if (!raw) return { url: '', snapshotUrl: '', duration: 0 }
    try {
      return parseVideoMeta(JSON.parse(raw) as unknown)
    } catch {
      return { url: raw, snapshotUrl: '', duration: 0 }
    }
  }
  if (!raw || typeof raw !== 'object') return { url: '', snapshotUrl: '', duration: 0 }
  const obj = raw as Record<string, unknown>
  const nested = obj.videoElem ?? obj.VideoElem
  if (nested) {
    const result = parseVideoMeta(nested)
    if (result.url || result.snapshotUrl) return result
  }
  return {
    url: firstString(obj, ['videoUrl', 'VideoUrl', 'videoURL', 'VideoURL', 'videoPath', 'VideoPath', 'url', 'URL']),
    snapshotUrl: firstString(obj, ['snapshotUrl', 'SnapshotUrl', 'snapshotURL', 'SnapshotURL', 'snapshotPath', 'SnapshotPath']),
    duration: Number(obj.duration ?? obj.Duration ?? 0),
  }
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
