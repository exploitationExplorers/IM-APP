interface DirectoryEntry {
  fullPath?: string
  isDirectory?: boolean
  isFile?: boolean
  toLocalURL?: () => string
  remove?: (success: () => void, fail: (error: unknown) => void) => void
  removeRecursively?: (success: () => void, fail: (error: unknown) => void) => void
  createReader?: () => {
    // 5+ 的类型声明写成单个目录，真实回调应返回数组，读取后再验证。
    readEntries: (success: (entries: unknown) => void, fail: (error: unknown) => void) => void
  }
  getDirectory: (
    name: string,
    options: { create: boolean },
    success: (entry: DirectoryEntry) => void,
    fail: (error: unknown) => void,
  ) => void
}

interface MovableDirectoryEntry extends DirectoryEntry {
  moveTo: (
    parent: DirectoryEntry,
    name: string,
    success: () => void,
    fail: (error: unknown) => void,
  ) => void
}

function canMoveDirectory(entry: DirectoryEntry): entry is MovableDirectoryEntry {
  return entry.isDirectory !== false && 'moveTo' in entry && typeof entry.moveTo === 'function'
}

export interface AppDataIO {
  PRIVATE_DOC?: number
  convertLocalFileSystemURL: (path: string) => string
  requestFileSystem: (
    type: number,
    success: (fs: { root?: DirectoryEntry }) => void,
    fail?: (error: unknown) => void,
  ) => void
  resolveLocalFileSystemURL?: (
    path: string,
    success: (entry: DirectoryEntry) => void,
    fail: (error: unknown) => void,
  ) => void
}

function directoryError(error: unknown): Error {
  console.error('[im] prepare database directory failed', error)
  return new Error('无法创建聊天本地存储目录，请检查手机可用空间后重新打开 App')
}

function createDirectory(parent: DirectoryEntry, name: string): Promise<DirectoryEntry> {
  return new Promise((resolve, reject) => {
    parent.getDirectory(name, { create: true }, resolve, reject)
  })
}

async function documentRoot(io: AppDataIO): Promise<DirectoryEntry> {
  try {
    return await new Promise<DirectoryEntry>((resolve, reject) => {
      // 5+ 的 PRIVATE_DOC 是 2；1 是资源目录 PRIVATE_WWW，iOS 安装包内不可写。
      io.requestFileSystem(io.PRIVATE_DOC ?? 2, (fs) => {
        if (!fs.root?.getDirectory) reject(new Error('App document root is unavailable'))
        else resolve(fs.root)
      }, reject)
    })
  } catch (error) {
    // 部分基座 requestFileSystem 不可用；必须解析真实根目录，不能仅转换一个路径字符串。
    if (!io.resolveLocalFileSystemURL) throw error
    return new Promise((resolve, reject) => {
      io.resolveLocalFileSystemURL!('_doc/', resolve, reject)
    })
  }
}

/** 每次重新登录都确保目录存在；不会创建、清空或删除 SDK 的数据库文件。 */
export async function getAppSdkDataDir(userId: string, io?: AppDataIO): Promise<string> {
  if (!io) throw new Error('当前 App 环境无法获取本地存储目录')
  const safeUserId = userId.replace(/[^0-9a-z_-]/gi, '')
  if (!safeUserId) throw new Error('聊天用户标识无效')
  try {
    const root = await documentRoot(io)
    const directory = await createDirectory(root, 'openim')
    await createDirectory(directory, safeUserId)
    const relative = `_doc/openim/${safeUserId}/`
    // 从当前 _doc 解析，目录对象上的 fullPath/toLocalURL 可能残留 iOS 旧沙盒路径。
    const path = io.convertLocalFileSystemURL(relative)
      .replace(/^file:\/\//, '').replace(/\/+$/, '')
    if (!path.startsWith('/') || path === '' || path.includes('://')) {
      throw new Error('App database directory is not an absolute local path')
    }
    if (io.resolveLocalFileSystemURL) {
      await new Promise<void>((resolve, reject) => {
        io.resolveLocalFileSystemURL!(path, (entry) => {
          if (entry.isDirectory === false) reject(new Error('App database path is not a directory'))
          else resolve()
        }, reject)
      })
    }
    return `${path}/`
  } catch (error) {
    throw directoryError(error)
  }
}

/** 隔离无法打开的旧库，保留原始文件；SDK 下一次登录在原路径重建。 */
export async function backupAppSdkDataDir(userId: string, io?: AppDataIO): Promise<boolean> {
  if (!io?.resolveLocalFileSystemURL) return false
  const safeUserId = userId.replace(/[^0-9a-z_-]/gi, '')
  if (!safeUserId) return false
  try {
    const entry = await resolveEntry(io, `_doc/openim/${safeUserId}/`)
    if (!entry || !canMoveDirectory(entry)) return false
    const parent = await createDirectory(await documentRoot(io), 'openim')
    await new Promise<void>((resolve, reject) => {
      entry.moveTo(parent, `${safeUserId}.recovery-${Date.now()}`, () => resolve(), reject)
    })
    return true
  } catch (error) {
    console.error('[im] backup database directory failed', error)
    return false
  }
}

/**
 * 删掉该账号的 OpenIM 本地库。只在资源初始化反复失败时调用。
 * 服务端会话还在，下次登录会重新同步；未发出的本地消息会丢。
 * iOS 的 DirectoryEntry 经常没有 removeRecursively，要自己逐个删。
 */
export async function resetAppSdkDataDir(userId: string, io?: AppDataIO): Promise<boolean> {
  if (!io?.resolveLocalFileSystemURL) return false
  const safeUserId = userId.replace(/[^0-9a-z_-]/gi, '')
  if (!safeUserId) return false
  const relative = `_doc/openim/${safeUserId}`
  const candidates = [`${relative}/`, relative]
  if (io.convertLocalFileSystemURL) {
    const converted = io.convertLocalFileSystemURL(`${relative}/`)
    const absolute = String(converted || '').replace(/^file:\/\//, '').replace(/\/+$/, '')
    if (absolute.startsWith('/')) candidates.push(`${absolute}/`, absolute)
  }
  for (const path of candidates) {
    if (await removeResolvedDirectory(io, path)) return true
  }
  return false
}

function resolveEntry(io: AppDataIO, path: string): Promise<DirectoryEntry | undefined> {
  return new Promise((resolve) => {
    io.resolveLocalFileSystemURL!(path, (entry) => resolve(entry), () => resolve(undefined))
  })
}

async function removeResolvedDirectory(io: AppDataIO, path: string): Promise<boolean> {
  const entry = await resolveEntry(io, path)
  if (!entry) return false
  try {
    await removeEntry(entry)
    return true
  } catch (error) {
    console.error('[im] reset database directory failed', error)
    return false
  }
}

function removeEntry(entry: DirectoryEntry): Promise<void> {
  if (entry.removeRecursively) {
    return new Promise((resolve, reject) => entry.removeRecursively!(() => resolve(), reject))
  }
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.()
    if (!reader || entry.isFile) {
      if (!entry.remove) {
        reject(new Error('无法删除聊天本地库'))
        return
      }
      entry.remove(() => resolve(), reject)
      return
    }
    reader.readEntries((children) => {
      if (!Array.isArray(children)) {
        reject(new Error('App database directory entries are invalid'))
        return
      }
      void (async () => {
        for (const child of children) await removeEntry(child)
        if (!entry.remove) {
          resolve()
          return
        }
        entry.remove(() => resolve(), reject)
      })().catch(reject)
    }, reject)
  })
}
