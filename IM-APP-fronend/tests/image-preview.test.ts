import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const platform = vi.hoisted(() => ({ app: false }))
vi.mock('@/utils/platform', () => ({
  isApp: () => platform.app,
  isIOS: () => false,
  isAppPlatform: () => platform.app,
  isAndroid: () => false,
  isIOSApp: () => false,
}))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
const cacheHits = vi.hoisted(() => new Map<string, string>())
vi.mock('@/utils/mediaCache', () => ({
  peekMediaCache: (url: string) => cacheHits.get(url) || '',
}))
import { imagePreviewUrlOf, previewImagesWithSave } from '@/utils/chatMedia'
import { createImagePreviewSession, takeImagePreviewSession } from '@/utils/imagePreviewSession'
const preview = vi.fn()
const navigate = vi.fn((options) => options.success())
const toast = vi.fn()
const urls = [
  'https://images.example/a?OSSAccessKeyId=fake&Signature=a%2Bb%3D',
  'https://images.example/b?x-oss-signature=b%2Fc',
]
beforeEach(() => {
  platform.app = false
  cacheHits.clear()
  vi.clearAllMocks()
  vi.stubGlobal('uni', { previewImage: preview, navigateTo: navigate, showToast: toast })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('image preview platform contract', () => {
  it.each(['h5', 'app'])(
    '%s opens a cache viewer without leaking source signatures into routing',
    async (platformName) => {
      platform.app = platformName === 'app'
      if (platformName === 'h5') vi.stubGlobal('document', {})
      await previewImagesWithSave(urls, urls[1], ['thumb1', 'thumb2'])
      const route = navigate.mock.calls[0][0].url
      expect(route).toMatch(/^\/pages\/chat\/image-viewer\?session=[a-z0-9_]+$/)
      expect(route).not.toContain('Signature')
      expect(takeImagePreviewSession(route.split('session=')[1])).toEqual({
        urls,
        current: 1,
        owner: 'public',
        thumbnails: ['thumb1', 'thumb2'],
      })
      expect(preview).not.toHaveBeenCalled()
    },
  )
  it('preserves native mini-program preview and exact signed URLs', async () => {
    await previewImagesWithSave(urls, urls[1])
    expect(preview).toHaveBeenCalledWith({ urls, current: urls[1] })
    expect(navigate).not.toHaveBeenCalled()
  })
  it('keeps thumbnails aligned when invalid entries are filtered', async () => {
    platform.app = true
    await previewImagesWithSave([' ', urls[0], '', urls[1]], 'missing', ['bad', 'a', 'bad', 'b'])
    const session = takeImagePreviewSession(navigate.mock.calls[0][0].url.split('session=')[1])
    expect(session).toEqual({ urls, current: 0, owner: 'public', thumbnails: ['a', 'b'] })
  })
  it('hands images already cached by the chat list to the viewer as local files', async () => {
    platform.app = true
    cacheHits.set(urls[1], 'file:///doc/media_cache/b.jpg')
    cacheHits.set('https://images.example/thumb-a', 'file:///doc/media_cache/ta.jpg')
    await previewImagesWithSave(urls, urls[1], ['https://images.example/thumb-a', ''])
    const session = takeImagePreviewSession(navigate.mock.calls[0][0].url.split('session=')[1])
    expect(session).toEqual({
      urls: [urls[0], 'file:///doc/media_cache/b.jpg'],
      current: 1,
      owner: 'public',
      thumbnails: ['file:///doc/media_cache/ta.jpg', ''],
    })
  })
  it('ignores empty lists and handles navigation failure without an unhandled rejection', async () => {
    platform.app = true
    await previewImagesWithSave([' ', ''])
    expect(navigate).not.toHaveBeenCalled()
    navigate.mockImplementationOnce((options) => options.fail())
    await previewImagesWithSave(urls)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'none' }))
  })
  it('sessions are one-shot, expire, and do not expose data on a wrong id', () => {
    vi.useFakeTimers()
    const data = { urls, owner: 'a', current: 0, thumbnails: [] }
    const id = createImagePreviewSession(data)
    expect(takeImagePreviewSession('wrong')).toBeUndefined()
    expect(takeImagePreviewSession(id)).toEqual(data)
    expect(takeImagePreviewSession(id)).toBeUndefined()
    const expired = createImagePreviewSession(data)
    vi.advanceTimersByTime(60001)
    expect(takeImagePreviewSession(expired)).toBeUndefined()
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
