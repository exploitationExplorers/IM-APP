import { isAppPlatform } from '@/utils/platform'

export type PreviewAsset = {
  path: string
  bytes: number
  at: number
  source: 'local' | 'disk' | 'network' | 'remote'
  blob?: Blob
  ephemeral?: boolean
}
export interface PreviewStorage {
  read(key: string): Promise<PreviewAsset | undefined>
  valid(row: PreviewAsset): Promise<boolean>
  download(url: string): Promise<PreviewAsset>
  write(key: string, row: PreviewAsset): Promise<PreviewAsset>
  touch(key: string, at: number): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  release(row: PreviewAsset): void
}

export const PREVIEW_IMAGE_INDEX_KEY = 'im_preview_images_v1'
const INDEX = PREVIEW_IMAGE_INDEX_KEY
const DB = 'im-preview-images-v1'
const STORE = 'images'
const BUDGET = 200 * 1024 * 1024
const TTL = 30 * 24 * 60 * 60 * 1000
const TIMEOUT = 15000
type SavedRow = { path: string; bytes: number; at: number }

export function previewHTTPError(status: number): Error {
  if (status === 404 || status === 410) return new Error('图片不存在或已被删除')
  if (status === 401 || status === 403) return new Error('图片链接已失效，请重新进入聊天后重试')
  return new Error('图片下载失败，请重试')
}

function nativeInfo(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000)
    try {
      uni.getImageInfo({
        src: path,
        success: () => {
          clearTimeout(timer)
          resolve(true)
        },
        fail: () => {
          clearTimeout(timer)
          resolve(false)
        },
      })
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

function nativeIndex(): Record<string, SavedRow> {
  try {
    const rows: unknown = uni.getStorageSync(INDEX)
    if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
      return Object.fromEntries(
        Object.entries(rows).filter(
          ([, r]) =>
            r &&
            typeof r.path === 'string' &&
            Number.isFinite(r.at) &&
            Number.isFinite(r.bytes) &&
            r.bytes > 0,
        ),
      )
    }
  } catch {
    /* storage unavailable */
  }
  return {}
}

function removeNative(path: string): void {
  try {
    uni.removeSavedFile({ filePath: path, fail: () => undefined })
  } catch {
    /* best effort */
  }
}

function nativeDownload(url: string): Promise<PreviewAsset> {
  return new Promise((resolve, reject) => {
    let settled = false
    let task: UniApp.DownloadTask | undefined
    const finish = (error?: Error, row?: PreviewAsset) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(row!)
    }
    const timer = setTimeout(() => {
      finish(new Error('图片加载超时，请重试'))
      task?.abort()
    }, TIMEOUT)
    try {
      task = uni.downloadFile({
        url,
        timeout: TIMEOUT,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            finish(previewHTTPError(res.statusCode))
            return
          }
          void nativeInfo(res.tempFilePath).then((valid) => {
            if (settled) return
            if (!valid) {
              finish(new Error('图片内容无效或格式不受支持'))
              return
            }
            const asset: PreviewAsset = {
              path: res.tempFilePath,
              bytes: 0,
              at: Date.now(),
              source: 'network',
            }
            try {
              uni.getFileInfo({
                filePath: res.tempFilePath,
                success: (info) => finish(undefined, { ...asset, bytes: info.size }),
                fail: () => finish(undefined, asset),
              })
            } catch {
              finish(undefined, asset)
            }
          })
        },
        fail: () => finish(new Error('图片加载失败，请检查网络后重试')),
      })
    } catch {
      finish(new Error('图片下载不可用，请重新打开后重试'))
    }
  })
}

function nativeStorage(): PreviewStorage {
  return {
    async read(key) {
      const row = nativeIndex()[key]
      return row && { ...row, source: 'disk' }
    },
    valid: (row) => nativeInfo(row.path),
    download: nativeDownload,
    async write(key, row) {
      const savedFilePath = await new Promise<string>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          settled = true
          reject(new Error('图片缓存写入超时'))
        }, 2000)
        try {
          uni.saveFile({
            tempFilePath: row.path,
            success: (r) => {
              clearTimeout(timer)
              if (settled) {
                removeNative(r.savedFilePath)
                return
              }
              settled = true
              resolve(r.savedFilePath)
            },
            fail: (error) => {
              clearTimeout(timer)
              settled = true
              reject(error)
            },
          })
        } catch (error) {
          clearTimeout(timer)
          settled = true
          reject(error)
        }
      })
      const rows = nativeIndex()
      const previous = rows[key]
      rows[key] = { path: savedFilePath, bytes: row.bytes, at: row.at }
      let total = Object.values(rows).reduce((sum, r) => sum + r.bytes, 0)
      const victims: SavedRow[] = []
      for (const [id, item] of Object.entries(rows).sort((a, b) => a[1].at - b[1].at)) {
        if (id !== key && (item.at < Date.now() - TTL || total > BUDGET)) {
          total -= item.bytes
          victims.push(item)
          delete rows[id]
        }
      }
      // saveFile moves the temporary file. If indexing fails, keep displaying
      // the saved path and remove this unindexed file when memory is released.
      try {
        uni.setStorageSync(INDEX, rows)
      } catch {
        return { ...row, path: savedFilePath, ephemeral: true }
      }
      if (previous && previous.path !== savedFilePath) victims.push(previous)
      for (const item of victims) removeNative(item.path)
      return { ...row, path: savedFilePath, source: 'disk' }
    },
    async touch(key, at) {
      const rows = nativeIndex()
      if (rows[key]) {
        rows[key].at = at
        uni.setStorageSync(INDEX, rows)
      }
    },
    async remove(key) {
      const rows = nativeIndex()
      const row = rows[key]
      delete rows[key]
      uni.setStorageSync(INDEX, rows)
      if (row) removeNative(row.path)
    },
    async clear() {
      const rows = nativeIndex()
      uni.removeStorageSync(INDEX)
      for (const row of Object.values(rows)) removeNative(row.path)
    },
    release: (row) => {
      if (row.ephemeral) removeNative(row.path)
    },
  }
}

type BlobRow = { blob: Blob; at: number; bytes: number }
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      reject(new Error('图片缓存不可用'))
    }, 2000)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      clearTimeout(timer)
      if (expired) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const timer = setTimeout(() => {
        try {
          tx.abort()
        } catch {
          /* Transaction may have just completed. */
        }
        reject(new Error('图片缓存操作超时'))
      }, 2000)
      let value: T
      tx.oncomplete = () => {
        clearTimeout(timer)
        resolve(value)
      }
      tx.onerror = tx.onabort = () => {
        clearTimeout(timer)
        reject(tx.error || new Error('图片缓存不可用'))
      }
      try {
        action(tx.objectStore(STORE), (out) => {
          value = out
        })
      } catch (error) {
        clearTimeout(timer)
        try {
          tx.abort()
        } catch {
          /* Already aborted. */
        }
        reject(error)
      }
    })
  } finally {
    db.close()
  }
}

async function webDownload(url: string): Promise<PreviewAsset> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    let response: Response
    try {
      response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('图片加载超时，请重试')
      // Existing third-party images may not enable CORS. The viewer still uses
      // image load/error events and a deadline; never claim this is a cache hit.
      if (error instanceof TypeError)
        return { path: url, bytes: 0, at: Date.now(), source: 'remote' }
      throw error
    }
    if (!response.ok) throw previewHTTPError(response.status)
    const blob = await response.blob()
    if (
      !blob.size ||
      (blob.type && !/^image\//i.test(blob.type) && blob.type !== 'application/octet-stream')
    )
      throw new Error('图片内容无效或格式不受支持')
    return {
      path: URL.createObjectURL(blob),
      blob,
      bytes: blob.size,
      at: Date.now(),
      source: 'network',
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('图片加载超时，请重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function webStorage(): PreviewStorage {
  return {
    async read(key) {
      const row = await transaction<BlobRow | undefined>('readonly', (store, out) => {
        const req = store.get(key)
        req.onsuccess = () => out(req.result as BlobRow | undefined)
      })
      if (!row || !(row.blob instanceof Blob) || !row.blob.size || !Number.isFinite(row.at))
        return undefined
      return {
        path: URL.createObjectURL(row.blob),
        bytes: row.blob.size,
        at: row.at,
        source: 'disk',
      }
    },
    async valid(row) {
      return row.path.startsWith('blob:')
    },
    download: webDownload,
    async write(key, row) {
      if (!row.blob) return row
      await transaction<void>('readwrite', (store) => {
        store.put({ blob: row.blob, bytes: row.bytes, at: row.at }, key)
        const entries: Array<{ key: IDBValidKey; at: number; bytes: number }> = []
        const req = store.openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (cursor) {
            const item = cursor.value as BlobRow
            if (
              !(item?.blob instanceof Blob) ||
              !Number.isFinite(item.at) ||
              !Number.isFinite(item.bytes) ||
              item.bytes <= 0
            ) {
              cursor.delete()
              cursor.continue()
              return
            }
            entries.push({ key: cursor.key, at: item.at, bytes: item.bytes })
            cursor.continue()
            return
          }
          let total = entries.reduce((sum, item) => sum + item.bytes, 0)
          for (const item of entries.sort((a, b) => a.at - b.at)) {
            if (item.key !== key && (item.at < Date.now() - TTL || total > BUDGET)) {
              store.delete(item.key)
              total -= item.bytes
            }
          }
        }
      })
      return row
    },
    async touch(key, at) {
      await transaction<void>('readwrite', (store) => {
        const req = store.get(key)
        req.onsuccess = () => {
          if (req.result) store.put({ ...req.result, at }, key)
        }
      })
    },
    async remove(key) {
      await transaction<void>('readwrite', (store) => {
        store.delete(key)
      })
    },
    async clear() {
      await transaction<void>('readwrite', (store) => {
        store.clear()
      }).catch(() => undefined)
    },
    release(row) {
      if (row.path.startsWith('blob:')) URL.revokeObjectURL(row.path)
    },
  }
}

/** Platform selection is lazy: native plus/uni may not be ready at module import. */
export function createPreviewStorage(): PreviewStorage {
  let storage: PreviewStorage | undefined
  const get = () => (storage ??= isAppPlatform() ? nativeStorage() : webStorage())
  return {
    read: (k) => get().read(k),
    valid: (r) => get().valid(r),
    download: (u) => get().download(u),
    write: (k, r) => get().write(k, r),
    touch: (k, t) => get().touch(k, t),
    remove: (k) => get().remove(k),
    clear: () => get().clear(),
    release: (r) => get().release(r),
  }
}
