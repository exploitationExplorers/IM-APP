import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppSdkDataDir, type AppDataIO } from '@/utils/openimDataDir'

function createIO() {
  const created: string[] = []
  const userDirectory = { fullPath: '/openim/user-a', isDirectory: true, getDirectory: vi.fn() }
  const directory = { getDirectory: vi.fn((name, _options, success) => {
    created.push(name)
    success(userDirectory)
  }) }
  const root = { getDirectory: vi.fn((name, _options, success) => {
    created.push(name)
    success(directory)
  }) }
  const io: AppDataIO = {
    PRIVATE_DOC: 1,
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
})
