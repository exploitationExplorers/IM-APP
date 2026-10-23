import type { ChatMessage } from '@/types'
import { createSticker } from '@/api/sticker'
import { playableMediaUrl, saveImageToDevice, saveVideoToDevice } from '@/utils/chatMedia'
import { uploadSticker } from '@/utils/file-upload'
import { isAppPlatform } from '@/utils/platform'
import { imageUrlOfMessage } from './imageUrl'

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function createMediaActions() {
  /**
   * 聊天图 → 表情：uploadSticker（媒体缓存 + OSS purpose=sticker）→ POST /stickers。
   * 不再单独 downloadFile，避免 iOS 私有链下载挂死、以及 compress 把 GIF 压成静态图。
   */
  async function addImageSticker(message: ChatMessage) {
    const url = imageUrlOfMessage(message)
    if (!url) {
      uni.showToast({ title: '图片还不能加入表情包', icon: 'none' })
      return
    }
    uni.showLoading({ title: '添加中', mask: true })
    try {
      const source = playableMediaUrl(url)
      const fileId = await withTimeout(uploadSticker(source), 45000, '添加超时，请重试')
      await createSticker(fileId)
      uni.showToast({ title: '已加入表情包', icon: 'success' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '添加失败', icon: 'none' })
    } finally {
      uni.hideLoading()
    }
  }

  async function saveMediaMessage(message: ChatMessage) {
    uni.showLoading({ title: '正在保存' })
    try {
      if (message.type === 'video') await saveVideoToDevice(message.content)
      else {
        const url = imageUrlOfMessage(message)
        if (!url) throw new Error('图片地址不存在')
        await saveImageToDevice(url)
      }
      uni.hideLoading()
      uni.showToast({
        title: isAppPlatform() ? '已保存到相册' : '已开始下载',
        icon: 'success',
      })
    } catch (e) {
      uni.hideLoading()
      uni.showToast({
        title: (e as Error).message || (message.type === 'video' ? '保存视频失败' : '保存图片失败'),
        icon: 'none',
      })
    }
  }

  async function saveVideoMessage(message: ChatMessage) {
    uni.showLoading({ title: '正在保存' })
    try {
      await saveVideoToDevice(message.content)
      uni.hideLoading()
      uni.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: (e as Error).message || '保存视频失败', icon: 'none' })
    }
  }

  function copyText(message: ChatMessage) {
    uni.setClipboardData({
      data: message.content,
      success: () => uni.showToast({ title: '已复制', icon: 'none' }),
    })
  }

  return { addImageSticker, saveMediaMessage, saveVideoMessage, copyText }
}
