import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ app: false }))
vi.mock('@/utils/platform', () => ({
  isAppPlatform: () => platform.app,
  isAndroid: () => false,
  isIOSApp: () => false,
}))
import { previewImagesWithSave } from '@/utils/chatMedia'

const preview = vi.fn()
beforeEach(() => {
  platform.app = false
  preview.mockReset()
  vi.stubGlobal('uni', { previewImage: preview })
})
afterEach(() => vi.unstubAllGlobals())

describe('image preview platform contract', () => {
  const urls = [
    'https://images.example/a?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
    'https://images.example/b?x-oss-signature=b%2Fc',
  ]

  it('keeps H5 signed URLs byte-for-byte and retains every slide', async () => {
    await previewImagesWithSave(urls, urls[1])
    expect(preview).toHaveBeenCalledWith({ urls, current: urls[1] })
  })

  it('leaves the native App gallery and long-press save action intact', async () => {
    platform.app = true
    await previewImagesWithSave(urls, urls[1])
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      urls, current: urls[1], longPressActions: expect.objectContaining({
        itemList: ['保存图片'], success: expect.any(Function), fail: expect.any(Function),
      }),
    }))
  })

  it('ignores empty lists and falls back to the first valid current on both platforms', async () => {
    for (const app of [false, true]) {
      platform.app = app
      await previewImagesWithSave([' ', ''])
      expect(preview).not.toHaveBeenCalled()
      await previewImagesWithSave([' ', ...urls], 'missing')
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({ urls, current: urls[0] }))
      preview.mockClear()
    }
  })
})
