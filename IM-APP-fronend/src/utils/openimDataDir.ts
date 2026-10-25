interface DirectoryEntry {
  fullPath?: string
  isDirectory?: boolean
  toLocalURL?: () => string
  getDirectory: (
    name: string,
    options: { create: boolean },
    success: (entry: DirectoryEntry) => void,
    fail: (error: unknown) => void,
  ) => void
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
      io.requestFileSystem(io.PRIVATE_DOC ?? 1, (fs) => {
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
    const userDirectory = await createDirectory(directory, safeUserId)
    const relative = `_doc/openim/${safeUserId}/`
    // iOS 的 fullPath 可能是虚拟路径；以当前沙盒的绝对路径为准，不能沿用上次安装的路径。
    const path = io.convertLocalFileSystemURL(userDirectory.toLocalURL?.() || relative)
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
