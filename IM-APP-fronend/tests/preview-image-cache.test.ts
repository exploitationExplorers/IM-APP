import { afterEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ token: '' }))
vi.mock('@/utils/request', () => ({ getToken: () => auth.token }))
import {
  PREVIEW_CACHE_TTL,
  PREVIEW_FILE_BYTES,
  PreviewImageCache,
  previewCacheOwner,
  previewImageDebug,
} from '@/utils/previewImageCache'
import type { PreviewAsset, PreviewStorage } from '@/utils/previewImageStorage'
import { mediaCacheLegacyKey, previewMediaCacheKey } from '@/utils/mediaCacheIdentity'

const url = 'https://images.example/a?Signature=a%2Bb%3D&Expires=123'
const row = (): PreviewAsset => ({ path: 'saved/a', bytes: 100, at: Date.now(), source: 'network' })
function fixture() {
  const disk = new Map<string, PreviewAsset>()
  const storage: PreviewStorage = {
    read: vi.fn(async (key) => (disk.has(key) ? { ...disk.get(key)! } : undefined)),
    valid: vi.fn(async () => true),
    download: vi.fn(async () => row()),
    write: vi.fn(async (key, asset) => {
      disk.set(key, { ...asset })
      return asset
    }),
    touch: vi.fn(async (key, at) => {
      if (disk.has(key)) disk.get(key)!.at = at
    }),
    remove: vi.fn(async (key) => {
      disk.delete(key)
    }),
    clear: vi.fn(async () => {
      disk.clear()
    }),
    release: vi.fn(),
  }
  return { storage, disk, cache: new PreviewImageCache(storage) }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('persistent preview cache (all channels)', () => {
  it('coalesces concurrent downloads, reuses memory, and survives a new cache instance', async () => {
    const { cache, storage, disk } = fixture()
    await Promise.all([cache.get(url, 'a'), cache.get(url, 'a')])
    await cache.get(url, 'a')
    await new PreviewImageCache(storage).get(url, 'a')
    expect(storage.download).toHaveBeenCalledTimes(1)
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect([...disk.keys()]).toEqual([previewMediaCacheKey('a', url)])
  })
  it('reuses rotating signatures but separates owners and business query', async () => {
    const { cache, storage } = fixture()
    for (const [source, owner] of [
      [url, 'a'],
      [url, 'b'],
      [url.replace('a%2Bb', 'different'), 'a'],
      [url + '&x=1', 'a'],
      [url + '&x=2&x=1', 'a'],
      [url + '&x=1&x=2', 'a'],
    ])
      await cache.get(source, owner)
    expect(storage.download).toHaveBeenCalledTimes(4)
    expect(storage.download).toHaveBeenNthCalledWith(1, url)
    expect(storage.download).toHaveBeenNthCalledWith(2, url)
    expect(storage.download).toHaveBeenNthCalledWith(3, url + '&x=1')
    expect(storage.download).toHaveBeenNthCalledWith(4, url + '&x=2&x=1')
  })
  it.each(['missing', 'expired', 'invalid'])('redownloads a %s disk file', async (kind) => {
    const { cache, storage, disk } = fixture()
    disk.set(mediaCacheLegacyKey('a', url), {
      ...row(),
      at: kind === 'expired' ? Date.now() - PREVIEW_CACHE_TTL : Date.now(),
    })
    if (kind === 'missing') vi.mocked(storage.valid).mockResolvedValueOnce(false)
    if (kind === 'invalid') vi.mocked(storage.valid).mockRejectedValueOnce(new Error('bad'))
    await cache.get(url, 'a')
    expect(storage.download).toHaveBeenCalledTimes(1)
    expect(storage.remove).toHaveBeenCalledTimes(1)
  })
  it('does not cache a download failure and allows retry', async () => {
    const { cache, storage } = fixture()
    vi.mocked(storage.download).mockRejectedValueOnce(new Error('network'))
    await expect(cache.get(url, 'a')).rejects.toThrow('network')
    expect(storage.write).not.toHaveBeenCalled()
    await expect(cache.get(url, 'a')).resolves.toHaveProperty('path', 'saved/a')
  })
  it('still displays a downloaded file if persistent storage is unavailable', async () => {
    const { cache, storage } = fixture()
    vi.mocked(storage.read).mockRejectedValue(new Error('unavailable'))
    vi.mocked(storage.write).mockRejectedValue(new Error('quota'))
    await expect(cache.get(url, 'a')).resolves.toHaveProperty('path', 'saved/a')
    await cache.get(url, 'a')
    expect(storage.download).toHaveBeenCalledTimes(1)
  })
  it('does not persist oversized originals, or treat a CORS fallback as a cache hit', async () => {
    const { cache, storage } = fixture()
    vi.mocked(storage.download).mockResolvedValueOnce({ ...row(), bytes: PREVIEW_FILE_BYTES + 1 })
    await cache.get(url, 'a')
    expect(storage.write).not.toHaveBeenCalled()
    vi.mocked(storage.download).mockResolvedValue({ ...row(), path: url, source: 'remote' })
    await cache.get(url, 'b')
    await cache.get(url, 'b')
    expect(storage.download).toHaveBeenCalledTimes(3)
  })
  it('passes local App paths through without download or album permissions', async () => {
    const { cache, storage } = fixture()
    await expect(cache.get('_doc/test.jpg', 'a')).resolves.toHaveProperty('source', 'local')
    await expect(cache.get('/static/logo.png', 'a')).resolves.toHaveProperty('source', 'local')
    expect(storage.download).not.toHaveBeenCalled()
  })
  it('downloads H5 relative chat media through its same-origin absolute URL', async () => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://www.example.com' })
    const { cache, storage, disk } = fixture()
    const relative = '/object/chat/a.jpg?type=image&width=1280&format=webp'
    const absolute = 'https://www.example.com/object/chat/a.jpg?type=image&width=1280&format=webp'
    await cache.get(relative, 'a')
    expect(storage.download).toHaveBeenCalledWith(absolute)
    expect([...disk.keys()]).toEqual([previewMediaCacheKey('a', absolute)])

    await cache.forget(relative, 'a')
    expect(disk.size).toBe(0)
  })
  it.each(['clear', 'forget'])(
    '%s invalidates an in-flight download before it can repopulate disk',
    async (action) => {
      const { cache, storage, disk } = fixture()
      let complete!: (asset: PreviewAsset) => void
      vi.mocked(storage.download).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve
          }),
      )
      const pending = cache.get(url, 'a')
      const rejected = expect(pending).rejects.toThrow('预览已结束')
      await vi.waitFor(() => expect(storage.download).toHaveBeenCalledTimes(1))
      if (action === 'clear') await cache.clear()
      else await cache.forget(url, 'a')
      complete(row())
      await rejected
      expect(storage.write).not.toHaveBeenCalled()
      expect(disk.size).toBe(0)
    },
  )
  it('clear waits for an already-started persistent write then removes it', async () => {
    const { cache, storage, disk } = fixture()
    let finish!: () => void
    vi.mocked(storage.write).mockImplementationOnce(
      (key, asset) =>
        new Promise((resolve) => {
          finish = () => {
            disk.set(key, asset)
            resolve(asset)
          }
        }),
    )
    const pending = cache.get(url, 'a')
    const rejected = expect(pending).rejects.toThrow('预览已结束')
    await vi.waitFor(() => expect(storage.write).toHaveBeenCalledTimes(1))
    const clearing = cache.clear()
    finish()
    await clearing
    await rejected
    expect(disk.size).toBe(0)
    await cache.get(url, 'a')
    expect(storage.download).toHaveBeenCalledTimes(2)
  })
  it('a stale disk validation cannot delete a fresh retry result', async () => {
    const { cache, storage, disk } = fixture()
    const key = mediaCacheLegacyKey('a', url)
    disk.set(key, row())
    let finish!: (valid: boolean) => void
    vi.mocked(storage.valid).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const old = cache.get(url, 'a')
    const rejected = expect(old).rejects.toThrow('预览已结束')
    await vi.waitFor(() => expect(storage.valid).toHaveBeenCalledTimes(1))
    await cache.forget(url, 'a')
    await cache.get(url, 'a')
    finish(false)
    await rejected
    expect(disk.has(previewMediaCacheKey('a', url))).toBe(true)
    expect(storage.remove).toHaveBeenCalledTimes(2)
  })
  it('limits memory and releases evicted assets', async () => {
    const { cache, storage } = fixture()
    for (let i = 0; i < 66; i++) await cache.get(`${url}&i=${i}`, 'a')
    expect(storage.release).toHaveBeenCalledTimes(2)
  })
})
describe('owner namespace', () => {
  it('debug logging is opt-in and records timing only', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal('uni', { getStorageSync: () => false })
    previewImageDebug('cache_hit', { source: 'disk', bytes: 123, ms: 4 })
    expect(log).not.toHaveBeenCalled()
    vi.stubGlobal('uni', { getStorageSync: () => true })
    previewImageDebug('cache_hit', { source: 'disk', bytes: 123, ms: 4 })
    expect(log).toHaveBeenCalledWith('[im:preview]', 'cache_hit', {
      source: 'disk',
      bytes: 123,
      ms: 4,
    })
    log.mockRestore()
    vi.unstubAllGlobals()
  })
  it('uses a stable uid across JWT refresh without persisting the token', () => {
    const token = (uid: string, exp: number) =>
      'head.' + Buffer.from(JSON.stringify({ uid, exp })).toString('base64url') + '.signature'
    auth.token = token('user-1', 1)
    expect(previewCacheOwner()).toBe('user-1')
    auth.token = token('user-1', 2)
    expect(previewCacheOwner()).toBe('user-1')
    auth.token = token('../../bad', 3)
    expect(previewCacheOwner()).toBe('public')
    auth.token = ''
    expect(previewCacheOwner()).toBe('public')
  })
})
