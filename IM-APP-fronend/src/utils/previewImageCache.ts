import { decode } from 'base64-arraybuffer'
import { getToken } from '@/utils/request'
import {
  createPreviewStorage,
  type PreviewAsset,
  type PreviewStorage,
} from '@/utils/previewImageStorage'

export const PREVIEW_CACHE_BYTES = 200 * 1024 * 1024
export const PREVIEW_FILE_BYTES = 20 * 1024 * 1024
export const PREVIEW_CACHE_TTL = 30 * 24 * 60 * 60 * 1000

/** Opt-in timing only. Never emit source URLs, signatures, tokens or owners. */
export function previewImageDebug(
  event: string,
  details: { source?: string; bytes?: number; ms?: number },
): void {
  try {
    if (uni.getStorageSync('im_preview_debug') === true)
      console.info('[im:preview]', event, details)
  } catch {
    /* Debugging must never affect image display. */
  }
}

/** A cache namespace, not authentication. Never store JWTs in cache keys/logs. */
export function previewCacheOwner(): string {
  try {
    const payload = getToken().split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') || ''
    if (payload.length > 8192) return 'public'
    const bytes = new Uint8Array(decode(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    const claims = JSON.parse(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) as {
      uid?: string
    }
    if (claims.uid && /^[a-zA-Z0-9_-]{1,96}$/.test(claims.uid)) return claims.uid
  } catch {
    /* Public download/preview screens have no user token. */
  }
  return 'public'
}

/** Shared across page lifetimes and release channels; exact signed URL is the key. */
export class PreviewImageCache {
  private memory = new Map<string, PreviewAsset>()
  private pending = new Map<string, { task: Promise<PreviewAsset>; valid: boolean }>()
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(
    private storage: PreviewStorage,
    private now = () => Date.now(),
  ) {}

  get(url: string, owner: string): Promise<PreviewAsset> {
    if (!/^https?:\/\//i.test(url))
      return Promise.resolve({ path: url, bytes: 0, at: this.now(), source: 'local' })
    const key = JSON.stringify([owner, url])
    const existing = this.pending.get(key)
    if (existing) return existing.task
    const run = { task: undefined as unknown as Promise<PreviewAsset>, valid: true }
    run.task = this.load(key, url, () => run.valid)
    this.pending.set(key, run)
    void run.task
      .finally(() => {
        if (this.pending.get(key) === run) this.pending.delete(key)
      })
      .catch(() => undefined)
    return run.task
  }

  async forget(url: string, owner: string): Promise<void> {
    const key = JSON.stringify([owner, url])
    const pending = this.pending.get(key)
    if (pending) pending.valid = false
    this.pending.delete(key)
    const row = this.memory.get(key)
    this.memory.delete(key)
    if (row) this.storage.release(row)
    await this.mutate(() => this.storage.remove(key))
  }

  async clear(): Promise<void> {
    for (const run of this.pending.values()) run.valid = false
    this.pending.clear()
    for (const row of this.memory.values()) this.storage.release(row)
    this.memory.clear()
    await this.mutate(() => this.storage.clear())
  }

  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const task = this.mutations.then(action, action)
    this.mutations = task.catch(() => undefined)
    return task
  }

  private async load(key: string, url: string, valid: () => boolean): Promise<PreviewAsset> {
    const started = this.now()
    // Serialize disk mutations so logout/forget cannot be overtaken by a saveFile/IDB write.
    await this.mutations
    let row = this.memory.get(key)
    const fromMemory = !!row
    if (!row) row = await this.storage.read(key).catch(() => undefined)
    if (row) {
      if (!valid()) {
        this.storage.release(row)
        throw new Error('预览已结束，请重新打开')
      }
      const usable =
        Number.isFinite(row.at) &&
        row.at > this.now() - PREVIEW_CACHE_TTL &&
        (await this.storage.valid(row).catch(() => false))
      if (!valid()) {
        this.storage.release(row)
        throw new Error('预览已结束，请重新打开')
      }
      if (usable) {
        row.at = this.now()
        await this.mutate(async () => {
          if (valid()) await this.storage.touch(key, row!.at)
        }).catch(() => undefined)
        if (!valid()) {
          this.storage.release(row)
          throw new Error('预览已结束，请重新打开')
        }
        this.remember(key, row)
        previewImageDebug('cache_hit', {
          source: fromMemory ? 'memory' : 'disk',
          bytes: row.bytes,
          ms: this.now() - started,
        })
        return row
      }
      this.memory.delete(key)
      this.storage.release(row)
      await this.mutate(async () => {
        if (valid()) await this.storage.remove(key)
      }).catch(() => undefined)
    }
    if (!valid()) throw new Error('预览已结束，请重新打开')
    const downloading = this.now()
    row = await this.storage.download(url)
    previewImageDebug('download', {
      source: row.source,
      bytes: row.bytes,
      ms: this.now() - downloading,
    })
    if (!valid()) {
      this.storage.release(row)
      throw new Error('预览已结束，请重新打开')
    }
    row.at = this.now()
    // Storage/quota failure must not prevent displaying a successfully downloaded image.
    if (row.bytes > 0 && row.bytes <= PREVIEW_FILE_BYTES && row.source !== 'remote') {
      row = await this.mutate(() =>
        valid() ? this.storage.write(key, row!) : Promise.resolve(row!),
      ).catch(() => row!)
    }
    if (!valid()) {
      this.storage.release(row)
      throw new Error('预览已结束，请重新打开')
    }
    // A CORS fallback is not a downloaded/cache hit and must be retried next time.
    if (row.source !== 'remote') this.remember(key, row)
    previewImageDebug('asset_ready', {
      source: row.source,
      bytes: row.bytes,
      ms: this.now() - started,
    })
    return row
  }

  private remember(key: string, row: PreviewAsset): void {
    this.memory.delete(key)
    this.memory.set(key, row)
    let bytes = [...this.memory.values()].reduce((n, item) => n + item.bytes, 0)
    for (const [oldKey, old] of this.memory) {
      if (this.memory.size <= 64 && bytes <= PREVIEW_CACHE_BYTES) break
      if (oldKey === key) continue
      this.memory.delete(oldKey)
      bytes -= old.bytes
      this.storage.release(old)
    }
  }
}

const cache = new PreviewImageCache(createPreviewStorage())
export const loadPreviewImage = (url: string, owner: string) => cache.get(url, owner)
export const forgetPreviewImage = (url: string, owner: string) => cache.forget(url, owner)
export const clearPreviewImageCache = () => cache.clear()
