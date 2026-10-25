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

/**
 * identity 是忽略临时签名参数后的稳定缓存键；exactUrl 才是本次真实的下载地址。
 * legacyKey 兼容升级前用完整签名 URL 写入的 IndexedDB 记录。
 */
export async function storeH5(
  identity: string,
  exactUrl: string,
  legacyKey = '',
): Promise<H5CacheHit | H5CacheMiss> {
  const db = await openH5()
  try {
    const current = await idbGet<Blob>(db, H5_BLOB, identity)
    if (current) {
      if (acceptsFile(current.size)) {
        return { ok: true, path: URL.createObjectURL(current), rel: identity, bytes: current.size }
      }
      await idbDelete(db, H5_BLOB, identity)
      return { ok: false, skip: true }
    }

    if (legacyKey && legacyKey !== identity) {
      const legacy = await idbGet<Blob>(db, H5_BLOB, legacyKey)
      if (legacy) {
        if (!acceptsFile(legacy.size)) {
          await idbDelete(db, H5_BLOB, legacyKey)
          return { ok: false, skip: true }
        }
        await idbPut(db, H5_BLOB, legacy, identity)
        await idbDelete(db, H5_BLOB, legacyKey)
        return { ok: true, path: URL.createObjectURL(legacy), rel: identity, bytes: legacy.size }
      }
    }

    const fetched = await fetchBlob(exactUrl)
    if (!fetched.ok) return fetched
    await idbPut(db, H5_BLOB, fetched.blob, identity)
    return {
      ok: true,
      path: URL.createObjectURL(fetched.blob),
      rel: identity,
      bytes: fetched.blob.size,
    }
  } finally {
    db.close()
  }
}

export function deleteH5(key: string, legacyKey = ''): Promise<void> {
  return openH5().then(
    (db) =>
      new Promise((resolve) => {
        const tx = db.transaction([H5_META, H5_BLOB], 'readwrite')
        const keys = legacyKey && legacyKey !== key ? [key, legacyKey] : [key]
        for (const item of keys) {
          tx.objectStore(H5_META).delete(item)
          tx.objectStore(H5_BLOB).delete(item)
        }
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

function idbPut<T>(db: IDBDatabase, storeName: string, value: T, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
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
