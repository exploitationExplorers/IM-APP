import { peekMediaCache } from '@/utils/mediaCache'
import { isAndroid, isAppPlatform } from '@/utils/platform'
import { createImagePreviewSession } from '@/utils/imagePreviewSession'
import { previewCacheOwner } from '@/utils/previewImageCache'
import type { PlusGallerySave } from '@/types/plus-io'
import { downloadRemoteFile } from '@/utils/chatMediaDownload'
import { playableMediaUrl, toAbsFileUrl } from '@/utils/chatMediaUrl'
import { parseVideoMeta } from '@/utils/chatMediaVideo'

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

/** 聊天里已经预取到本地的中图 / 缩略图直接给预览页，预览页对本地路径不再下载。 */
function cachedPreviewFile(url: string): string {
  const hit = url ? peekMediaCache(url) : ''
  return hit ? toAbsFileUrl(hit) : url
}

/**
 * H5/App share an on-demand viewer with persistent cache, decode/error deadline,
 * retry, pinch zoom and saving. Mini-programs keep the platform's native preview.
 */
export async function previewImagesWithSave(
  urls: string[],
  current?: string,
  thumbnails: string[] = [],
  originals: string[] = [],
): Promise<void> {
  const items = urls
    .map((u, i) => ({
      url: playableMediaUrl((u || '').trim()),
      thumbnail: playableMediaUrl(thumbnails[i] || ''),
      original: playableMediaUrl((originals[i] || '').trim()),
    }))
    .filter((item) => item.url)
  const list = items.map((item) => item.url)
  if (!list.length) return
  const cur = playableMediaUrl((current || '').trim())
  const currentUrl = cur && list.includes(cur) ? cur : list[0]
  if (isAppPlatform() || typeof document !== 'undefined') {
    const sessionData = {
      urls: list.map(cachedPreviewFile),
      current: list.indexOf(currentUrl),
      owner: previewCacheOwner(),
      thumbnails: items.map((item) => cachedPreviewFile(item.thumbnail)),
      ...(items.some((item) => item.original)
        ? { originals: items.map((item) => item.original) }
        : {}),
    }
    const session = createImagePreviewSession(sessionData)
    await new Promise<void>((resolve) => {
      uni.navigateTo({
        url: `/pages/chat/image-viewer?session=${session}`,
        animationType: 'fade-in',
        success: () => resolve(),
        fail: () => {
          uni.showToast({ title: '无法打开图片预览，请重试', icon: 'none' })
          resolve()
        },
      })
    })
    return
  }
  uni.previewImage({ urls: list, current: currentUrl })
}
