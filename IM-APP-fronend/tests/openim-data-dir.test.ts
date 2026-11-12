import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupAppSdkDataDir, getAppSdkDataDir, resetAppSdkDataDir, type AppDataIO } from '@/utils/openimDataDir'

function createIO() {
  const created: string[] = []
  const userDirectory = {
    fullPath: '/openim/user-a', isDirectory: true, getDirectory: vi.fn(),
    toLocalURL: vi.fn(() => '_doc/openim/user-a/'),
  }
  const directory = { getDirectory: vi.fn((name, _options, success) => {
    created.push(name)
    success(userDirectory)
  }) }
  const root = { getDirectory: vi.fn((name, _options, success) => {
    created.push(name)
    success(directory)
  }) }
  const io: AppDataIO = {
    PRIVATE_DOC: 2,
    requestFileSystem: vi.fn((_type, success) => success({ root })),
    convertLocalFileSystemURL: vi.fn(() => 'file:///var/mobile/current/doc/openim/user-a/'),
    resolveLocalFileSystemURL: vi.fn((_path, success) => success(userDirectory)),
  }
  return { io, root, directory, userDirectory, created }
}

afterEach(() => vi.restoreAllMocks())

describe('OpenIM App 数据库目录', () => {
  it('首次安装逐级创建目录，创建和验证完成后才返回绝对路径', async () => {
    const { io, created } = createIO()
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/current/doc/openim/user-a/')
    expect(created).toEqual(['openim', 'user-a'])
    expect(io.resolveLocalFileSystemURL).toHaveBeenCalledWith(
      '/var/mobile/current/doc/openim/user-a', expect.any(Function), expect.any(Function),
    )
  })

  it('忽略 iOS 的虚拟 fullPath，使用当前沙盒转换后的路径', async () => {
    const { io, userDirectory } = createIO()
    userDirectory.fullPath = '/old-install/doc/openim/user-a/'
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/current/doc/openim/user-a/')
    expect(io.convertLocalFileSystemURL).toHaveBeenCalledWith('_doc/openim/user-a/')
  })

  it('基座未暴露 PRIVATE_DOC 常量时仍使用文档目录 2，不能选择资源目录 1', async () => {
    const { io } = createIO()
    delete io.PRIVATE_DOC
    await getAppSdkDataDir('user-a', io)
    expect(io.requestFileSystem).toHaveBeenCalledWith(2, expect.any(Function), expect.any(Function))
  })

  it('iOS 目录对象残留旧沙盒 URL 时从当前 _doc 解析 SDK 路径', async () => {
    const { io, userDirectory } = createIO()
    userDirectory.toLocalURL.mockReturnValue('file:///var/mobile/old/doc/openim/user-a/')
    vi.mocked(io.convertLocalFileSystemURL).mockImplementation((path) =>
      path.startsWith('_doc/') ? '/var/mobile/current/doc/openim/user-a/' : path,
    )
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/current/doc/openim/user-a/')
  })

  it('Android 保留绝对路径，并补齐目录末尾斜杠', async () => {
    const { io } = createIO()
    vi.mocked(io.convertLocalFileSystemURL).mockReturnValue('/storage/emulated/0/app/doc/openim/user-a')
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/storage/emulated/0/app/doc/openim/user-a/')
  })

  it.each(['openim', 'user'])('创建 %s 目录失败时不能返回猜测的路径', async (level) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { io, root, directory } = createIO()
    const entry = level === 'openim' ? root : directory
    entry.getDirectory.mockImplementation((_name, _options, _success, fail) => fail({ code: 10 }))
    await expect(getAppSdkDataDir('user-a', io)).rejects.toThrow('无法创建聊天本地存储目录')
    expect(io.convertLocalFileSystemURL).not.toHaveBeenCalled()
  })

  it('requestFileSystem 失败时解析真实 _doc 根目录，仍须创建两个子目录', async () => {
    const { io, root, userDirectory, created } = createIO()
    vi.mocked(io.requestFileSystem).mockImplementation((_type, _success, fail) => fail?.({ code: 1 }))
    vi.mocked(io.resolveLocalFileSystemURL!).mockImplementation((path, success) => {
      success(path === '_doc/' ? root : userDirectory)
    })
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/current/doc/openim/user-a/')
    expect(created).toEqual(['openim', 'user-a'])
  })

  it('根目录不可用时直接失败，不能靠 URL 转换伪造成功', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { io } = createIO()
    vi.mocked(io.requestFileSystem).mockImplementation((_type, _success, fail) => fail?.({ code: 1 }))
    vi.mocked(io.resolveLocalFileSystemURL!).mockImplementation((_path, _success, fail) => fail({ code: 1 }))
    await expect(getAppSdkDataDir('user-a', io)).rejects.toThrow('无法创建聊天本地存储目录')
    expect(io.convertLocalFileSystemURL).not.toHaveBeenCalled()
  })

  it.each(['', '/', '_doc/openim/user-a/', 'https://example/db'])('拒绝无效数据库路径 %s', async (path) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { io } = createIO()
    vi.mocked(io.convertLocalFileSystemURL).mockReturnValue(path)
    await expect(getAppSdkDataDir('user-a', io)).rejects.toThrow('无法创建聊天本地存储目录')
  })

  it('绝对路径解析失败时不能交给 SDK', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { io } = createIO()
    vi.mocked(io.resolveLocalFileSystemURL!).mockImplementation((_path, _success, fail) => fail({ code: 1 }))
    await expect(getAppSdkDataDir('user-a', io)).rejects.toThrow('无法创建聊天本地存储目录')
  })

  it('每次登录都重新确保目录存在，不缓存旧安装的绝对路径', async () => {
    const { io, created } = createIO()
    await getAppSdkDataDir('user-a', io)
    vi.mocked(io.convertLocalFileSystemURL).mockReturnValue('/var/mobile/new-install/doc/openim/user-a/')
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/new-install/doc/openim/user-a/')
    expect(created).toEqual(['openim', 'user-a', 'openim', 'user-a'])
  })

  it('没有 plus.io 时明确失败', async () => {
    await expect(getAppSdkDataDir('user-a')).rejects.toThrow('当前 App 环境无法获取本地存储目录')
  })

  it('备份异常库时移到同级目录保留文件，随后可在原路径创建新库', async () => {
    const { io, directory, userDirectory } = createIO()
    const moveTo = vi.fn((_parent, _name, success) => success(userDirectory))
    const remove = vi.fn()
    Object.assign(userDirectory, { moveTo, remove })
    await expect(backupAppSdkDataDir('user-a', io)).resolves.toBe(true)
    expect(moveTo).toHaveBeenCalledWith(directory, expect.stringMatching(/^user-a\.recovery-\d+$/), expect.any(Function), expect.any(Function))
    expect(remove).not.toHaveBeenCalled()
    await expect(getAppSdkDataDir('user-a', io)).resolves.toBe('/var/mobile/current/doc/openim/user-a/')
  })

  it('备份失败时保留原库，不能改为删除文件', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { io, userDirectory } = createIO()
    const removeRecursively = vi.fn()
    const moveTo = vi.fn((_parent, _name, _success, fail) => fail({ code: 10 }))
    Object.assign(userDirectory, { moveTo, removeRecursively })
    await expect(backupAppSdkDataDir('user-a', io)).resolves.toBe(false)
    expect(removeRecursively).not.toHaveBeenCalled()
  })

  it('原生桥不支持目录移动时不能宣称备份成功', async () => {
    const { io } = createIO()
    await expect(backupAppSdkDataDir('user-a', io)).resolves.toBe(false)
    await expect(backupAppSdkDataDir('user-a')).resolves.toBe(false)
  })

  it('资源卡死时按相对路径删掉该账号的本地库', async () => {
    const removed = vi.fn((success: () => void) => success())
    const io: AppDataIO = {
      PRIVATE_DOC: 2,
      requestFileSystem: vi.fn(),
      convertLocalFileSystemURL: vi.fn(),
      resolveLocalFileSystemURL: vi.fn((_path, success) => success({
        getDirectory: vi.fn(),
        removeRecursively: removed,
      })),
    }
    await expect(resetAppSdkDataDir('user-a', io)).resolves.toBe(true)
    expect(io.resolveLocalFileSystemURL).toHaveBeenCalledWith('_doc/openim/user-a/', expect.any(Function), expect.any(Function))
    expect(removed).toHaveBeenCalledOnce()
  })

  it('iOS 没有 removeRecursively 时逐个删除本地库文件', async () => {
    const removedFiles: string[] = []
    const file = {
      isFile: true,
      getDirectory: vi.fn(),
      remove: vi.fn((success: () => void) => {
        removedFiles.push('db')
        success()
      }),
    }
    const directory = {
      isDirectory: true,
      getDirectory: vi.fn(),
      createReader: () => ({
        readEntries: (success: (entries: unknown[]) => void) => success([file]),
      }),
      remove: vi.fn((success: () => void) => {
        removedFiles.push('dir')
        success()
      }),
    }
    const io: AppDataIO = {
      PRIVATE_DOC: 2,
      requestFileSystem: vi.fn(),
      convertLocalFileSystemURL: vi.fn(() => 'file:///var/mobile/current/doc/openim/user-a/'),
      resolveLocalFileSystemURL: vi.fn((path, success, fail) => {
        if (path === '_doc/openim/user-a/') success(directory)
        else fail({ code: 1 })
      }),
    }
    await expect(resetAppSdkDataDir('user-a', io)).resolves.toBe(true)
    expect(removedFiles).toEqual(['db', 'dir'])
  })
})
