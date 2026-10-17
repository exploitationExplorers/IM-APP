const H5_DB = 'im-media-cache'
const MAX_FILE_BYTES = 4 * 1024 * 1024

function acceptsFile(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_FILE_BYTES
}
const H5_META = 'meta'
const H5_BLOB = 'blob'

export type H5CacheHit = { ok: true; path: string; rel: string; bytes: number }
export type H5CacheMiss = { ok: false; skip: boolean }
export type H5MetaRow = { url: string; rel: string; bytes: number; at: number }

function openH5(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('没有 IndexedDB'))
      return
    }
    const req = indexedDB.open(H5_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(H5_META)) db.createObjectStore(H5_META)
      if (!db.objectStoreNames.contains(H5_BLOB)) db.createObjectStore(H5_BLOB)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function readH5Meta(): Promise<H5MetaRow[]> {
  return openH5().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction(H5_META, 'readonly')
        const req = tx.objectStore(H5_META).openCursor()
        const out: H5MetaRow[] = []
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) {
            db.close()
            resolve(out)
            return
          }
          const value = cursor.value as { rel?: string; bytes?: number; at?: number }
          out.push({
            url: String(cursor.key),
            rel: String(value?.rel || cursor.key),
            bytes: Number(value?.bytes) || 0,
            at: Number(value?.at) || 0,
          })
          cursor.continue()
        }
        req.onerror = () => {
          db.close()
          resolve(out)
        }
      }),
  )
}

export function writeH5Meta(items: H5MetaRow[]): Promise<void> {
  return openH5().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(H5_META, 'readwrite')
        const store = tx.objectStore(H5_META)
        store.clear()
        for (const item of items) {
          store.put({ rel: item.rel, bytes: item.bytes, at: item.at }, item.url)
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

export async function storeH5(url: string): Promise<H5CacheHit | H5CacheMiss> {
  const db = await openH5()
  const existing = await idbGet<Blob>(db, H5_BLOB, url)
  if (existing && acceptsFile(existing.size)) {
    db.close()
    return { ok: true, path: URL.createObjectURL(existing), rel: url, bytes: existing.size }
  }
  const fetched = await fetchBlob(url)
  if (!fetched.ok) {
    db.close()
    return fetched
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(H5_BLOB, 'readwrite')
    tx.objectStore(H5_BLOB).put(fetched.blob, url)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return { ok: true, path: URL.createObjectURL(fetched.blob), rel: url, bytes: fetched.blob.size }
}

export function deleteH5(url: string): Promise<void> {
  return openH5().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction([H5_META, H5_BLOB], 'readwrite')
        tx.objectStore(H5_META).delete(url)
        tx.objectStore(H5_BLOB).delete(url)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          resolve()
        }
      }),
  )
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => resolve(undefined)
  })
}

function fetchBlob(url: string): Promise<{ ok: true; blob: Blob } | H5CacheMiss> {
  return fetch(url, { credentials: 'omit', mode: 'cors' })
    .then(async (response) => {
      if (!response.ok) return { ok: false as const, skip: false }
      const blob = await response.blob()
      if (!acceptsFile(blob.size)) return { ok: false as const, skip: true }
      return { ok: true as const, blob }
    })
    .catch(() => ({ ok: false as const, skip: true }))
}
