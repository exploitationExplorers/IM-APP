import { APP_CONFIG } from '@/config'
import { deleteH5, readH5Meta, storeH5, writeH5Meta } from '@/utils/mediaCacheH5'
import { cacheableChatMediaUrl, mediaCacheIdentity } from '@/utils/mediaCacheIdentity'
import { isApp, isIOS } from '@/utils/platform'

/**
 * 聊天媒体本地缓存。
 * 气泡上正在显示的缩略图 / 视频封面走前台队列（后请求的先下，即最新消息先出）；
 * 点开用的中图走后台队列，前台空了才一张张预取。内存索引，单张超过上限的原图不写索引。
 * key 是消息里稳定的 /object/ 地址，不是 302 之后会过期的签名地址。
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 500 * 1024 * 1024
const DIR_REL = '_doc/media_cache'
const INDEX_NAME = 'index.json'
const BACKGROUND_SLOTS = 1

export function mediaCacheEnabled(): boolean {
  return APP_CONFIG.mediaCacheEnabled
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
const remoteUrls = new Map<string, string>()
const skipped = new Set<string>()
const listeners = new Map<string, Array<(path: string) => void>>()
const queued = new Set<string>()
const order: string[] = []
const waiting = new Set<string>()
const backlog: string[] = []
const inflight = new Set<string>()
const backgroundInflight = new Set<string>()
let ready: Promise<void> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function peekMediaCache(url: string): string {
  if (!mediaCacheEnabled()) return ''
  const row = rows.get(mediaCacheIdentity(cacheableChatMediaUrl(url) || url))
  return row?.path || ''
}

export function warmMediaCache(): void {
  if (!mediaCacheEnabled()) return
  void ensureReady()
}

export function mediaCacheHas(url: string): boolean {
  return (
    mediaCacheEnabled() &&
    rows.has(mediaCacheIdentity(cacheableChatMediaUrl(url) || url))
  )
}

/** 换会话：没开始的下载全部作废。等待方收到空地址，气泡自己退回远程图。 */
export function resetMediaCacheQueue(): void {
  const dropped = [...order, ...backlog]
  order.length = 0
  backlog.length = 0
  queued.clear()
  waiting.clear()
  for (const key of dropped) {
    remoteUrls.delete(key)
    if (!inflight.has(key)) fail(key)
  }
}

export function forgetMediaCache(url: string): void {
  const key = mediaCacheIdentity(cacheableChatMediaUrl(url) || url)
  const row = rows.get(key)
  rows.delete(key)
  remoteUrls.delete(key)
  skipped.delete(key)
  if (!row) return
  revokeBlob(row.path)
  void removeStored(row.rel)
  scheduleFlush()
}

/**
 * 返回 true 表示之后一定会回调 onReady（失败时给空字符串）；false 表示不缓存这条，调用方直接用远程地址。
 * background：点开才用的中图，只在前台队列空闲时预取。
 */
export function requestMediaCache(
  url: string,
  onReady: (path: string) => void,
  options: { background?: boolean } = {},
): boolean {
  if (!mediaCacheEnabled()) return false
  const remote = cacheableChatMediaUrl(url)
  const key = mediaCacheIdentity(remote)
  if (!key || !/^https?:\/\//i.test(remote) || skipped.has(key)) return false
  remoteUrls.set(key, remote)
  const hit = rows.get(key)
  if (hit?.path) {
    hit.at = Date.now()
    scheduleFlush()
    onReady(hit.path)
    return true
  }
  const list = listeners.get(key) || []
  list.push(onReady)
  listeners.set(key, list)
  void ensureReady().then(() => {
    const loaded = rows.get(key)
    if (loaded?.path) {
      deliver(key, loaded.path)
      return
    }
    enqueue(key, !!options.background)
  })
  return true
}

/** 预取点开用的中图，不占前台名额。 */
export function prefetchMediaCache(url: string): void {
  requestMediaCache(url, () => {}, { background: true })
}

/**
 * 等一条远程媒体进本地缓存（与气泡同一套 OSS 下载）。
 * 命中或下完返回本地路径；超时/失败返回空串，调用方再决定退路。
 */
export function awaitMediaCache(url: string, timeoutMs = 30000): Promise<string> {
  const remote = (url || '').trim()
  if (!remote || !mediaCacheEnabled()) return Promise.resolve('')
  const hit = peekMediaCache(remote)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    let settled = false
    const finish = (path: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(path || '')
    }
    const timer = setTimeout(() => finish(''), Math.max(3000, timeoutMs))
    const queued = requestMediaCache(remote, (path) => finish(path))
    if (!queued) finish('')
  })
}

function deliver(key: string, path: string): void {
  const list = listeners.get(key) || []
  listeners.delete(key)
  queued.delete(key)
  for (const fn of list) fn(path)
}

function fail(key: string): void {
  deliver(key, '')
}

function dropFrom(list: string[], key: string): void {
  const at = list.lastIndexOf(key)
  if (at >= 0) list.splice(at, 1)
}

function enqueue(key: string, background: boolean): void {
  if (inflight.has(key) || rows.get(key)?.path) return
  if (background) {
    if (queued.has(key) || waiting.has(key)) return
    waiting.add(key)
    backlog.push(key)
  } else {
    if (waiting.delete(key)) dropFrom(backlog, key)
    if (queued.has(key)) dropFrom(order, key)
    queued.add(key)
    order.push(key)
  }
  pump()
}

/** 缩略图几十 KB，瓶颈在每张都要先走一次 /object/ 302，多开几路比排队快。 */
function pump(): void {
  const limit = isIOS() ? 4 : 6
  while (inflight.size < limit) {
    let key = order.pop()
    let background = false
    if (key) {
      queued.delete(key)
    } else {
      if (backgroundInflight.size >= BACKGROUND_SLOTS) return
      key = backlog.pop()
      if (!key) return
      waiting.delete(key)
      background = true
    }
    if (!listeners.has(key)) continue
    const target = key
    const remote = remoteUrls.get(target) || ''
    if (!remote) {
      fail(target)
      continue
    }
    inflight.add(target)
    if (background) backgroundInflight.add(target)
    void withDeadline(storeRemote(target, remote))
      .then((result) => finishStore(target, result))
      .catch(() => finishStore(target, { ok: false, skip: true }))
  }
}

type StoreResult = { ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean }

/** 气泡等缓存时是空白的；plus.io 回调丢了也得放手，让气泡退回远程地址。 */
function withDeadline(task: Promise<StoreResult>): Promise<StoreResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: false, skip: false }), 30000)
    task.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function finishStore(
  key: string,
  result: { ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean },
): void {
  inflight.delete(key)
  backgroundInflight.delete(key)
  if (!result.ok) {
    if (result.skip) skipped.add(key)
    remoteUrls.delete(key)
    fail(key)
    pump()
    return
  }
  remember(key, result)
  deliver(key, result.path)
  pump()
}

function remember(
  key: string,
  result: { path: string; rel: string; bytes: number },
): void {
  const victims = pickCacheEvictions(snapshotRows(), result.bytes)
  for (const victim of victims) {
    const old = rows.get(victim)
    rows.delete(victim)
    remoteUrls.delete(victim)
    if (!old) continue
    revokeBlob(old.path)
    void removeStored(old.rel)
  }
  remoteUrls.delete(key)
  rows.set(key, { path: result.path, rel: result.rel, bytes: result.bytes, at: Date.now() })
  scheduleFlush()
}

function snapshotRows(): Array<{ url: string; bytes: number; at: number }> {
  return [...rows.entries()].map(([key, row]) => ({ url: key, bytes: row.bytes, at: row.at }))
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
  key: string,
  url: string,
): Promise<{ ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean }> {
  if (isApp()) return storeApp(key, url)
  return storeH5(key, url, rows.get(key)?.rel || '')
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
  key: string,
  url: string,
): Promise<{ ok: true; path: string; rel: string; bytes: number } | { ok: false; skip: boolean }> {
  const temp = await downloadTemp(url)
  if (!temp) return { ok: false, skip: false }
  const bytes = await fileBytes(temp)
  if (!mediaCacheAcceptsSize(bytes)) return { ok: false, skip: true }
  const name = `${mediaCacheKey(key)}.${cacheFileExt(url)}`
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
  // 下载临时文件不删的话，每张图在手机上占两份
  src.remove?.(() => {}, () => {})
  if (!copied) return { ok: false, skip: false }
  const path = playableLocal(rel)
  if (!path) return { ok: false, skip: false }
  return { ok: true, path, rel, bytes }
}

/** 本地文件没有 Content-Type，WebView 和系统预览只能看扩展名；认不出的按 jpg。 */
function cacheFileExt(url: string): string {
  const path = url.split(/[?#]/)[0] || ''
  const match = /\.(jpe?g|png|gif|webp|heic)$/i.exec(path)
  return match ? match[1].toLowerCase() : 'jpg'
}

function downloadTemp(url: string): Promise<string> {
  return new Promise((resolve) => {
    uni.downloadFile({
      url,
      timeout: 20000,
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
    const key = mediaCacheIdentity(String(item.url || ''))
    const rel = String(item.rel || '')
    const bytes = Number(item.bytes) || 0
    if (!key || !rel || !mediaCacheAcceptsSize(bytes)) continue
    const path = playableLocal(rel)
    if (!path) continue
    rows.set(key, { path, rel, bytes, at: Number(item.at) || 0 })
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
  return [...rows.entries()].map(([key, row]) => ({
    url: key,
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
    const key = mediaCacheIdentity(item.url)
    if (!key || !mediaCacheAcceptsSize(item.bytes)) continue
    rows.set(key, { path: '', rel: item.rel, bytes: item.bytes, at: item.at })
  }
}

function saveH5Meta(): Promise<void> {
  return writeH5Meta(indexItems())
}

