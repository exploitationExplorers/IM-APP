import { downloadRemoteFile } from '@/utils/chatMediaDownload'
import { playableMediaUrl } from '@/utils/chatMediaUrl'
import { persistNamedFile } from '@/utils/chatMediaAudio'
import { previewImagesWithSave } from '@/utils/chatMediaSave'

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
