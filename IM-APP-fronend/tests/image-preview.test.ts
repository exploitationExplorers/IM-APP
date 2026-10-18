import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ app: false, ios: false }))
vi.mock('@/utils/platform', () => ({
  isApp: () => platform.app,
  isIOS: () => platform.ios,
  isAppPlatform: () => platform.app,
  isAndroid: () => false,
  isIOSApp: () => platform.app && platform.ios,
}))
const cache = vi.hoisted(() => ({
  hits: new Map<string, string>(),
  fetchNow: vi.fn<(url: string) => Promise<string>>(),
}))
vi.mock('@/utils/mediaCache', () => ({
  peekMediaCache: (url: string) => cache.hits.get(url) || '',
  fetchMediaCacheNow: (url: string) => cache.fetchNow(url),
}))
import { imagePreviewUrlOf, previewImagesWithSave } from '@/utils/chatMedia'

const preview = vi.fn()
beforeEach(() => {
  platform.app = false
  platform.ios = false
  cache.hits.clear()
  cache.fetchNow.mockReset()
  cache.fetchNow.mockResolvedValue('')
  preview.mockReset()
  vi.stubGlobal('uni', { previewImage: preview, showLoading: vi.fn(), hideLoading: vi.fn(), showToast: vi.fn() })
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
    expect(cache.fetchNow).not.toHaveBeenCalled()
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

  it('opens cached slides from local files on App without downloading again', async () => {
    platform.app = true
    cache.hits.set(urls[0], 'file:///doc/media_cache/a.jpg')
    cache.hits.set(urls[1], 'file:///doc/media_cache/b.jpg')
    await previewImagesWithSave(urls, urls[1])
    expect(cache.fetchNow).not.toHaveBeenCalled()
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      urls: ['file:///doc/media_cache/a.jpg', 'file:///doc/media_cache/b.jpg'],
      current: 'file:///doc/media_cache/b.jpg',
    }))
  })

  it('downloads the tapped slide first when it is not cached yet', async () => {
    platform.app = true
    cache.fetchNow.mockResolvedValue('file:///doc/media_cache/b.jpg')
    await previewImagesWithSave(urls, urls[1])
    expect(cache.fetchNow).toHaveBeenCalledWith(urls[1])
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      urls: [urls[0], 'file:///doc/media_cache/b.jpg'],
      current: 'file:///doc/media_cache/b.jpg',
    }))
  })
})

describe('imagePreviewUrlOf', () => {
  it('builds the preview from the original, not the separately uploaded thumbnail', () => {
    const url = imagePreviewUrlOf({
      content: 'http://8.154.44.197/object/u1/thumb.jpg',
      sourceUrl: 'http://8.154.44.197/object/u1/origin.jpg',
    })
    expect(url).toContain('/object/u1/origin.jpg')
    expect(url).toContain('width=1280')
  })

  it('falls back to content for old messages without a separate original', () => {
    expect(imagePreviewUrlOf({ content: 'http://8.154.44.197/object/u1/a.jpg' })).toContain('/object/u1/a.jpg')
    expect(imagePreviewUrlOf({})).toBe('')
  })
})
