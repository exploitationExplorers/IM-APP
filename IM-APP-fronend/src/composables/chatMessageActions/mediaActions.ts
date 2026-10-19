import type { ChatMessage } from '@/types'
import { createSticker } from '@/api/sticker'
import { playableMediaUrl, saveImageToDevice, saveVideoToDevice } from '@/utils/chatMedia'
import { uploadSticker } from '@/utils/file-upload'
import { isAppPlatform } from '@/utils/platform'
import { imageUrlOfMessage } from './imageUrl'

function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) resolve(res.tempFilePath)
        else reject(new Error('下载图片失败'))
      },
      fail: () => reject(new Error('下载图片失败')),
    })
  })
}

export function createMediaActions() {
  async function addImageSticker(message: ChatMessage) {
    const url = imageUrlOfMessage(message)
    if (!url) {
      uni.showToast({ title: '图片还不能加入表情包', icon: 'none' })
      return
    }
    uni.showLoading({ title: '添加中', mask: true })
    try {
      const source = isAppPlatform()
        ? await downloadToTemp(playableMediaUrl(url))
        : playableMediaUrl(url)
      await createSticker(await uploadSticker(source))
      uni.hideLoading()
      uni.showToast({ title: '已加入表情包', icon: 'success' })
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: (e as Error).message || '添加失败', icon: 'none' })
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
