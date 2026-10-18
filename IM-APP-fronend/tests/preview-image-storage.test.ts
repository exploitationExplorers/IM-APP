import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const platform = vi.hoisted(() => ({ app: true }))
vi.mock('@/utils/platform', () => ({ isAppPlatform: () => platform.app }))
vi.mock('@/utils/request', () => ({
  getToken: () => '',
  AUTH_SLOTS_KEY: 'im_auth_slots',
  ACTIVE_TAB_KEY: 'im_active_tab',
}))
import { createPreviewStorage, PREVIEW_IMAGE_INDEX_KEY } from '@/utils/previewImageStorage'
import { PreviewImageCache } from '@/utils/previewImageCache'
import { clearAppCache, clearSessionStorage } from '@/utils/app-cache'

const source = 'https://images.example/a?Signature=a%2Bb%3D'
let files: Set<string>
let settings: Map<string, unknown>
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  platform.app = true
  files = new Set()
  settings = new Map()
  api = {
    getStorageSync: vi.fn((key) => structuredClone(settings.get(key))),
    setStorageSync: vi.fn((key, value) => settings.set(key, structuredClone(value))),
    removeStorageSync: vi.fn((key) => settings.delete(key)),
    getStorageInfoSync: vi.fn(() => ({ keys: [...settings.keys()] })),
    getImageInfo: vi.fn((o) =>
      files.has(o.src) ? o.success({ width: 10, height: 10 }) : o.fail(),
    ),
    getFileInfo: vi.fn((o) => o.success({ size: 100 })),
    downloadFile: vi.fn((o) => {
      files.add('temp/a')
      o.success({ statusCode: 200, tempFilePath: 'temp/a' })
      return { abort: vi.fn() }
    }),
    saveFile: vi.fn((o) => {
      files.delete(o.tempFilePath)
      files.add('_doc/a')
      o.success({ savedFilePath: '_doc/a' })
    }),
    removeSavedFile: vi.fn((o) => files.delete(o.filePath)),
  }
  vi.stubGlobal('uni', api)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('native preview persistence', () => {
  it('downloads once, moves to saved storage, and reads from disk in a new instance', async () => {
    const first = new PreviewImageCache(createPreviewStorage())
    expect((await first.get(source, 'a')).path).toBe('_doc/a')
    const second = new PreviewImageCache(createPreviewStorage())
    expect((await second.get(source, 'a')).source).toBe('disk')
    expect(api.downloadFile).toHaveBeenCalledTimes(1)
    expect(api.downloadFile.mock.calls[0][0].url).toBe(source)
    expect(api.saveFile).toHaveBeenCalledTimes(1)
    expect(Object.keys(settings.get(PREVIEW_IMAGE_INDEX_KEY) as object)).toEqual([
      JSON.stringify(['a', source]),
    ])
  })
  it('redownloads if the OS removed a saved file', async () => {
    const cache = new PreviewImageCache(createPreviewStorage())
    await cache.get(source, 'a')
    files.clear()
    await new PreviewImageCache(createPreviewStorage()).get(source, 'a')
    expect(api.downloadFile).toHaveBeenCalledTimes(2)
  })
  it('keeps a usable saved path if index quota fails after saveFile moved the temp file', async () => {
    api.setStorageSync.mockImplementation(() => {
      throw new Error('quota')
    })
    const cache = new PreviewImageCache(createPreviewStorage())
    const asset = await cache.get(source, 'a')
    expect(files.has(asset.path)).toBe(true)
    expect(asset.path).toBe('_doc/a')
    expect(asset.ephemeral).toBe(true)
    await cache.clear()
    expect(files.has('_doc/a')).toBe(false)
  })
  it('uses the temp image if saveFile itself fails', async () => {
    api.saveFile.mockImplementation((o) => o.fail({ errMsg: 'disk full' }))
    const asset = await new PreviewImageCache(createPreviewStorage()).get(source, 'a')
    expect(asset.path).toBe('temp/a')
    expect(files.has(asset.path)).toBe(true)
  })
  it('a missing saveFile callback cannot stall the viewer indefinitely', async () => {
    vi.useFakeTimers()
    api.saveFile.mockImplementation(() => undefined)
    const pending = new PreviewImageCache(createPreviewStorage()).get(source, 'a')
    await vi.advanceTimersByTimeAsync(2100)
    await expect(pending).resolves.toHaveProperty('path', 'temp/a')
  })
  it.each([403, 404, 500])('rejects HTTP %i and does not save an error page', async (status) => {
    api.downloadFile.mockImplementation((o) => {
      o.success({ statusCode: status, tempFilePath: 'temp/a' })
      return {}
    })
    await expect(createPreviewStorage().download(source)).rejects.toThrow(
      status === 403 ? '失效' : status === 404 ? '不存在' : '失败',
    )
    expect(api.saveFile).not.toHaveBeenCalled()
  })
  it('rejects corrupt images before persistence', async () => {
    api.getImageInfo.mockImplementation((o) => o.fail())
    await expect(new PreviewImageCache(createPreviewStorage()).get(source, 'a')).rejects.toThrow(
      '格式不受支持',
    )
    expect(api.saveFile).not.toHaveBeenCalled()
  })
  it('aborts stalled downloads after 15 seconds', async () => {
    vi.useFakeTimers()
    const abort = vi.fn()
    api.downloadFile.mockReturnValue({ abort })
    const rejected = expect(createPreviewStorage().download(source)).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(abort).toHaveBeenCalledTimes(1)
  })
  it('clear removes only owned preview files and the index', async () => {
    const cache = new PreviewImageCache(createPreviewStorage())
    files.add('_doc/not-preview')
    await cache.get(source, 'a')
    await cache.clear()
    expect(settings.has(PREVIEW_IMAGE_INDEX_KEY)).toBe(false)
    expect(files.has('_doc/not-preview')).toBe(true)
    expect(files.has('_doc/a')).toBe(false)
  })

  it.each(['settings', 'logout'])(
    '%s clears saved previews without losing the async index',
    async (action) => {
      await new PreviewImageCache(createPreviewStorage()).get(source, 'a')
      settings.set('im_device_id', 'synthetic-device')
      settings.set('im_token', 'synthetic-token')
      if (action === 'settings') clearAppCache()
      else clearSessionStorage()
      await vi.waitFor(() => expect(files.has('_doc/a')).toBe(false))
      expect(settings.has(PREVIEW_IMAGE_INDEX_KEY)).toBe(false)
      expect(settings.get('im_device_id')).toBe('synthetic-device')
      expect(settings.has('im_token')).toBe(action === 'settings')
    },
  )
})

describe('H5 download error boundaries', () => {
  beforeEach(() => {
    platform.app = false
  })
  it('downloads the exact signed URL as an anonymous CORS blob', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })))
    vi.stubGlobal('fetch', fetcher)
    const storage = createPreviewStorage()
    const asset = await storage.download(source)
    expect(asset.path).toMatch(/^blob:/)
    expect(asset.bytes).toBe(5)
    expect(fetcher).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ mode: 'cors', credentials: 'omit' }),
    )
    storage.release(asset)
  })
  it.each([403, 404, 500])('reports HTTP %i rather than leaving a spinner', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status })),
    )
    await expect(createPreviewStorage().download(source)).rejects.toThrow(
      status === 403 ? '失效' : status === 404 ? '不存在' : '失败',
    )
  })
  it('marks CORS fallback as remote, not as persisted/cache success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('CORS')
      }),
    )
    await expect(createPreviewStorage().download(source)).resolves.toMatchObject({
      path: source,
      source: 'remote',
    })
  })
  it('rejects a non-image response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } })),
    )
    await expect(createPreviewStorage().download(source)).rejects.toThrow('格式不受支持')
  })
})
