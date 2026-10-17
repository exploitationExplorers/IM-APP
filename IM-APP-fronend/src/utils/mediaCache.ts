import { APP_CONFIG } from '@/config'
import { deleteH5, readH5Meta, storeH5, writeH5Meta } from '@/utils/mediaCacheH5'
import { isApp, isIOS } from '@/utils/platform'

/**
 * canary 列表媒体缓存。
 * 只服务气泡上正在显示的图片和视频封面：内存索引，下载排队，
 * 单张超过上限的原图直接丢掉，不写索引。test / prod 渠道整段关闭。
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const DIR_REL = '_doc/media_cache'
const INDEX_NAME = 'index.json'

export function mediaCacheEnabled(): boolean {
  return APP_CONFIG.updateChannel === 'canary'
}

export function mediaCacheKey(url: string): string {
  let hi = 2166136261
  let lo = 2166136261 ^ url.length
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i)
    hi ^= code
    hi = Math.imul(hi, 16777619)
    lo = Math.imul(lo ^ code, 2246822519)
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0')
}

export function mediaCacheAcceptsSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_FILE_BYTES
}

export function pickCacheEvictions(
  entries: Array<{ url: string; bytes: number; at: number }>,
  incomingBytes: number,
  maxBytes = MAX_TOTAL_BYTES,
): string[] {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0) + incomingBytes
  if (total <= maxBytes) return []
  const target = Math.floor(maxBytes * 0.8)
  const ordered = [...entries].sort((a, b) => a.at - b.at)
  const drop: string[] = []
  for (const entry of ordered) {
    if (total <= target) break
    drop.push(entry.url)
    total -= entry.bytes
  }
  return drop
}

type CacheRow = { path: string; rel: string; bytes: number; at: number }

const rows = new Map<string, CacheRow>()
const skipped = new Set<string>()
const listeners = new Map<string, Array<(path: string) => void>>()
const queued = new Set<string>()
const order: string[] = []
const inflight = new Set<string>()
let generation = 0
let ready: Promise<void> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function peekMediaCache(url: string): string {
  if (!mediaCacheEnabled()) return ''
  const row = rows.get(url.trim())
  return row?.path || ''
}

export function warmMediaCache(): void {
  if (!mediaCacheEnabled()) return
  void ensureReady()
}

export function mediaCacheHas(url: string): boolean {
  return mediaCacheEnabled() && rows.has(url.trim())
}

export function resetMediaCacheQueue(): void {
  generation += 1
  order.length = 0
  queued.clear()
  for (const url of [...listeners.keys()]) {
    if (!inflight.has(url)) listeners.delete(url)
  }
}

export function forgetMediaCache(url: string): void {
  const remote = url.trim()
  const row = rows.get(remote)
  rows.delete(remote)
  skipped.delete(remote)
  if (!row) return
  revokeBlob(row.path)
  void removeStored(row.rel)
  scheduleFlush()
}

export function requestMediaCache(url: string, onReady: (path: string) => void): void {
  if (!mediaCacheEnabled()) return
  const remote = url.trim()
  if (!/^https?:\/\//i.test(remote) || skipped.has(remote)) return
  const hit = rows.get(remote)
  if (hit?.path) {
    hit.at = Date.now()
    scheduleFlush()
    onReady(hit.path)
    return
  }
  const list = listeners.get(remote) || []
  list.push(onReady)
  listeners.set(remote, list)
  void ensureReady().then(() => {
    const loaded = rows.get(remote)
    if (loaded?.path) {
      deliver(remote, loaded.path)
      return
    }
    enqueue(remote)
  })
}

function deliver(url: string, path: string): void {
  const list = listeners.get(url) || []
  listeners.delete(url)
  queued.delete(url)
  for (const fn of list) fn(path)
}

function fail(url: string): void {
  deliver(url, '')
}

function enqueue(url: string): void {
  if (queued.has(url) || inflight.has(url) || rows.get(url)?.path) return
  queued.add(url)
  order.push(url)
  pump()
}

function pump(): void {
  const limit = isIOS() ? 2 : 3
  while (inflight.size < limit && order.length > 0) {
    const url = order.shift()
    if (!url) return
    queued.delete(url)
    if (!listeners.has(url)) continue
    const gen = generation
    inflight.add(url)
    void storeRemote(url)
      .then((result) => finishStore(url, gen, result))
      .catch(() => finishStore(url, gen, { ok: false, skip: true }))
  }
}

function finishStore(
  url: string,
  gen: number,
  result: { ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean },
): void {
  inflight.delete(url)
  if (!result.ok) {
    if (result.skip) skipped.add(url)
    if (gen === generation) fail(url)
    else listeners.delete(url)
    pump()
    return
  }
  remember(url, result)
  deliver(url, result.path)
  pump()
}

function remember(
  url: string,
  result: { path: string; rel: string; bytes: number },
): void {
  const victims = pickCacheEvictions(snapshotRows(), result.bytes)
  for (const victim of victims) {
    const old = rows.get(victim)
    rows.delete(victim)
    if (!old) continue
    revokeBlob(old.path)
    void removeStored(old.rel)
  }
  rows.set(url, { path: result.path, rel: result.rel, bytes: result.bytes, at: Date.now() })
  scheduleFlush()
}

function snapshotRows(): Array<{ url: string; bytes: number; at: number }> {
  return [...rows.entries()].map(([url, row]) => ({ url, bytes: row.bytes, at: row.at }))
}

function ensureReady(): Promise<void> {
  if (!ready) ready = loadIndex()
  return ready
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void writeIndex()
  }, 800)
}

function revokeBlob(path: string): void {
  if (path.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(path)
}

function whenPlusReady(): Promise<void> {
  if (!isApp() || plus?.io) return Promise.resolve()
  return new Promise((resolve) => {
    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('plusready', () => resolve(), { once: true })
      }
    } catch {
      /* 自定义基座可能没有 document */
    }
    setTimeout(resolve, 2000)
  })
}

async function loadIndex(): Promise<void> {
  try {
    if (isApp()) {
      await whenPlusReady()
      await loadAppIndex()
    } else {
      await loadH5Index()
    }
  } catch {
    rows.clear()
  }
}

async function writeIndex(): Promise<void> {
  try {
    if (isApp()) await writeAppIndex()
    else await saveH5Meta()
  } catch {
    /* 索引写失败下次还能从已有文件恢复，不打断聊天 */
  }
}

async function storeRemote(
  url: string,
): Promise<{ ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean }> {
  if (isApp()) return storeApp(url)
  return storeH5(url)
}

async function removeStored(rel: string): Promise<void> {
  if (!rel) return
  if (isApp()) {
    await removeAppFile(rel)
    return
  }
  await deleteH5(rel)
}

function playableLocal(rel: string): string {
  const io = plus?.io
  const raw = io?.convertLocalFileSystemURL?.(rel) || ''
  if (!raw) return ''
  if (raw.startsWith('file://') || /^https?:\/\//i.test(raw)) return raw
  return raw.startsWith('/') ? `file://${raw}` : raw
}

type DirEntry = {
  getDirectory?: (
    name: string,
    flags: { create?: boolean },
    ok: (entry: DirEntry) => void,
    err?: (e?: unknown) => void,
  ) => void
  getFile?: (
    name: string,
    flags: { create?: boolean },
    ok: (entry: FileEntry) => void,
    err?: (e?: unknown) => void,
  ) => void
}

type FileEntry = {
  file?: (ok: (file: { size?: number }) => void, err?: () => void) => void
  copyTo?: (
    dir: unknown,
    name: string,
    ok: () => void,
    err?: () => void,
  ) => void
  remove?: (ok: () => void, err?: () => void) => void
  createWriter?: (
    ok: (writer: {
      onwrite?: () => void
      onerror?: () => void
      write: (data: string) => void
      seek?: (pos: number) => void
      truncate?: (len: number) => void
    }) => void,
    err?: () => void,
  ) => void
}

function resolveLocal(path: string): Promise<DirEntry & FileEntry> {
  return new Promise((resolve, reject) => {
    const io = plus?.io as { resolveLocalFileSystemURL?: (path: string, ok: (entry: DirEntry & FileEntry) => void, err?: (e?: unknown) => void) => void } | undefined
    if (!io?.resolveLocalFileSystemURL) {
      reject(new Error('没有本地目录'))
      return
    }
    io.resolveLocalFileSystemURL(path, (entry) => resolve(entry), (err) => reject(err))
  })
}

async function cacheDir(): Promise<DirEntry> {
  const root = await resolveLocal('_doc/')
  return new Promise((resolve, reject) => {
    if (!root.getDirectory) {
      reject(new Error('没有本地目录'))
      return
    }
    root.getDirectory('media_cache', { create: true }, (entry) => resolve(entry), (err) => reject(err))
  })
}

function fileBytes(path: string): Promise<number> {
  return new Promise((resolve) => {
    uni.getFileInfo({
      filePath: path,
      success: (res) => resolve(Number(res.size) || 0),
      fail: () => resolve(0),
    })
  })
}

async function storeApp(
  url: string,
): Promise<{ ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean }> {
  const temp = await downloadTemp(url)
  if (!temp) return { ok: false, skip: false }
  const bytes = await fileBytes(temp)
  if (!mediaCacheAcceptsSize(bytes)) return { ok: false, skip: true }
  const name = `${mediaCacheKey(url)}.img`
  const rel = `${DIR_REL}/${name}`
  const dir = await cacheDir()
  const src = await resolveLocal(temp)
  const copied = await new Promise<boolean>((resolve) => {
    if (!src.copyTo) {
      resolve(false)
      return
    }
    src.copyTo(dir, name, () => resolve(true), () => resolve(false))
  })
  if (!copied) return { ok: false, skip: false }
  const path = playableLocal(rel)
  if (!path) return { ok: false, skip: false }
  return { ok: true, path, rel, bytes }
}

function downloadTemp(url: string): Promise<string> {
  return new Promise((resolve) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        resolve('')
      },
      fail: () => resolve(''),
    })
  })
}

async function loadAppIndex(): Promise<void> {
  const text = await readAppText(`${DIR_REL}/${INDEX_NAME}`)
  if (!text) return
  applyIndex(text)
}

function applyIndex(text: string): void {
  const parsed = JSON.parse(text) as { items?: Array<{ url?: string; rel?: string; bytes?: number; at?: number }> }
  for (const item of parsed.items || []) {
    const url = String(item.url || '')
    const rel = String(item.rel || '')
    const bytes = Number(item.bytes) || 0
    if (!url || !rel || !mediaCacheAcceptsSize(bytes)) continue
    const path = playableLocal(rel)
    if (!path) continue
    rows.set(url, { path, rel, bytes, at: Number(item.at) || 0 })
  }
}

async function writeAppIndex(): Promise<void> {
  const dir = await cacheDir()
  const entry = await new Promise<FileEntry>((resolve, reject) => {
    if (!dir.getFile) {
      reject(new Error('没有本地目录'))
      return
    }
    dir.getFile(INDEX_NAME, { create: true }, (file) => resolve(file), (err) => reject(err))
  })
  await new Promise<void>((resolve, reject) => {
    if (!entry.createWriter) {
      reject(new Error('不能写索引'))
      return
    }
    entry.createWriter((writer) => {
      const text = JSON.stringify({ v: 1, items: indexItems() })
      writer.onerror = () => reject(new Error('写索引失败'))
      const writeAll = () => {
        writer.onwrite = () => resolve()
        writer.seek?.(0)
        writer.write(text)
      }
      if (writer.truncate) {
        writer.onwrite = () => writeAll()
        writer.truncate(0)
        return
      }
      writeAll()
    }, () => reject(new Error('不能写索引')))
  })
}

function indexItems(): Array<{ url: string; rel: string; bytes: number; at: number }> {
  return [...rows.entries()].map(([url, row]) => ({
    url,
    rel: row.rel,
    bytes: row.bytes,
    at: row.at,
  }))
}

function readAppText(rel: string): Promise<string> {
  return new Promise((resolve) => {
    void resolveLocal(rel)
      .then(
        (entry) =>
          new Promise<string>((ok) => {
            if (!entry.file) {
              ok('')
              return
            }
            entry.file(
              (file) => {
                const io = plus?.io as unknown as { FileReader?: new () => PlusTextReader } | undefined
                const Reader = io?.FileReader
                if (!Reader) {
                  ok('')
                  return
                }
                const reader = new Reader()
                reader.onloadend = (event) => ok(String(event?.target?.result || ''))
                reader.onerror = () => ok('')
                reader.readAsText(file)
              },
              () => ok(''),
            )
          }),
      )
      .then(resolve)
      .catch(() => resolve(''))
  })
}

type PlusTextReader = {
  onloadend: ((event?: { target?: { result?: unknown } }) => void) | null
  onerror: (() => void) | null
  readAsText: (file: unknown) => void
}

function removeAppFile(rel: string): Promise<void> {
  return new Promise((resolve) => {
    void resolveLocal(rel)
      .then((entry) => {
        if (!entry.remove) {
          resolve()
          return
        }
        entry.remove(() => resolve(), () => resolve())
      })
      .catch(() => resolve())
  })
}

async function loadH5Index(): Promise<void> {
  const items = await readH5Meta()
  for (const item of items) {
    if (!item.url || !mediaCacheAcceptsSize(item.bytes)) continue
    rows.set(item.url, { path: '', rel: item.rel, bytes: item.bytes, at: item.at })
  }
}

function saveH5Meta(): Promise<void> {
  return writeH5Meta(indexItems())
}

