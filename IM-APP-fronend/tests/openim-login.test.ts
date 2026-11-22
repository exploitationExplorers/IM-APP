import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: true,
  asyncApi: vi.fn(),
  dataDir: vi.fn(),
  fetchToken: vi.fn(),
  businessToken: 'business-token',
  events: new Map<string, Set<(data: unknown) => void>>(),
}))

vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: {
    asyncApi: mocks.asyncApi,
    uuid: () => 'login-test',
    subscribe: (event: string, callback: (data: unknown) => void) => {
      if (!mocks.events.has(event)) mocks.events.set(event, new Set())
      mocks.events.get(event)!.add(callback)
    },
    unsubscribe: (event: string, callback: (data: unknown) => void) => mocks.events.get(event)?.delete(callback),
  },
}))
vi.mock('@/utils/platform', () => ({ isApp: () => mocks.app, isAndroid: () => false }))
vi.mock('@/utils/openimDataDir', () => ({ getAppSdkDataDir: mocks.dataDir }))
vi.mock('@/api/im', () => ({ fetchIMToken: mocks.fetchToken }))
vi.mock('@/utils/request', () => ({ getToken: () => mocks.businessToken }))
vi.mock('@/stores/contact', () => ({ useContactStore: vi.fn() }))

import { IMEvents, IMMethods, LoginStatus } from 'openim-uniapp-polyfill'

const dbError = { errCode: 10005, errMsg: 'init database initDB failed: unable to open database file: no such file or directory' }
let login: typeof import('@/utils/openim')
let loginAttempts = 0
let failLogin: (attempt: number) => boolean

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.events.clear()
  mocks.app = true
  mocks.businessToken = 'business-token'
  loginAttempts = 0
  failLogin = () => false
  mocks.dataDir.mockResolvedValue('/var/mobile/current/doc/openim/user-a/')
  mocks.fetchToken.mockResolvedValue({
    userId: 'user-a', token: 'im-token', platform: 1, expireSec: 7200,
    apiAddr: 'https://api.example', wsAddr: 'wss://ws.example',
  })
  vi.stubGlobal('uni', {
    getSystemInfoSync: () => ({ platform: 'ios', uniPlatform: 'app' }),
    requireNativePlugin: () => ({ initSDK: vi.fn() }),
    getStorageSync: () => '',
  })
  vi.stubGlobal('plus', { io: {} })
  mocks.asyncApi.mockImplementation(async (method: string) => {
    if (method === IMMethods.InitSDK) return true
    if (method === IMMethods.GetLoginStatus) return LoginStatus.Logout
    if (method === IMMethods.GetLoginUserID) return 'user-a'
    if (method === IMMethods.Login) {
      loginAttempts += 1
      if (failLogin(loginAttempts)) throw dbError
      mocks.events.get(IMEvents.OnSyncServerFinish)?.forEach((callback) => callback({}))
    }
    if (method === IMMethods.GetConversationListSplit) return []
  })
  login = await import('@/utils/openim')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const calledMethods = () => mocks.asyncApi.mock.calls.map((call) => call[0])

describe('App 首次登录与数据库恢复', () => {
  it('首次登录必须在目录就绪之后初始化 SDK，再登录', async () => {
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir.mock.invocationCallOrder[0]).toBeLessThan(mocks.asyncApi.mock.invocationCallOrder[0])
    expect(calledMethods().indexOf(IMMethods.InitSDK)).toBeLessThan(calledMethods().indexOf(IMMethods.Login))
    expect(mocks.asyncApi).toHaveBeenCalledWith(IMMethods.InitSDK, 'login-test', expect.objectContaining({
      dataDir: '/var/mobile/current/doc/openim/user-a/',
    }))
  })

  it('目录创建失败时不能初始化 SDK 或尝试登录', async () => {
    mocks.dataDir.mockRejectedValueOnce(new Error('无法创建聊天本地存储目录'))
    await expect(login.ensureIMLogin()).rejects.toThrow('无法创建聊天本地存储目录')
    expect(mocks.asyncApi).not.toHaveBeenCalled()
  })

  it('数据库登录失败后修复原生 SDK 实际绑定的目录，再登录一次', async () => {
    failLogin = (attempt) => attempt === 1
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir).toHaveBeenCalledTimes(2)
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(1)
    expect(loginAttempts).toBe(2)
  })

  it('恢复后目录仍不可用时停止登录，不使用旧路径', async () => {
    failLogin = () => true
    mocks.dataDir.mockResolvedValueOnce('/var/mobile/old/').mockRejectedValueOnce(new Error('无法创建聊天本地存储目录'))
    await expect(login.ensureIMLogin()).rejects.toThrow('无法创建聊天本地存储目录')
    expect(loginAttempts).toBe(1)
  })

  it('恢复只尝试一次，仍失败时不缓存已登录状态', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failLogin = () => true
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天本地数据库初始化失败')
    expect(loginAttempts).toBe(2)
    expect(login.imUserId.value).toBe('')
    failLogin = () => false
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir).toHaveBeenCalledTimes(3)
  })

  it('SDK 明确返回初始化失败时不能继续登录', async () => {
    mocks.asyncApi.mockResolvedValueOnce(false)
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天 SDK 初始化失败')
    expect(calledMethods()).toEqual([IMMethods.InitSDK])
  })

  it('已登录会话被复用时不能重复初始化或关闭正在使用的数据库', async () => {
    await login.ensureIMLogin()
    await login.ensureIMLogin()
    expect(mocks.dataDir).toHaveBeenCalledTimes(1)
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(1)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
  })

  it('原生桥只接受首次 InitSDK 时，换号也补回实际绑定的目录', async () => {
    const directories = new Set<string>()
    let nativeDir = ''
    mocks.dataDir.mockImplementation(async (userId: string) => {
      const path = `/var/mobile/current/doc/openim/${userId}/`
      directories.add(path)
      return path
    })
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.InitSDK) {
        if (!nativeDir) nativeDir = args[1].dataDir
        return Promise.resolve(true)
      }
      if (method === IMMethods.Login && !directories.has(nativeDir)) return Promise.reject(dbError)
      return original(method, ...args)
    })
    await login.ensureIMLogin()
    await login.logoutOpenIM()
    directories.clear()
    mocks.fetchToken.mockResolvedValue({
      userId: 'user-b', token: 'im-token-b', platform: 1, expireSec: 7200,
      apiAddr: 'https://api.example', wsAddr: 'wss://ws.example',
    })
    await expect(login.ensureIMLogin()).resolves.toBe('user-b')
    expect(mocks.dataDir).toHaveBeenLastCalledWith('user-a', expect.anything())
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(1)
  })

  it('当前沙盒路径已变化时不能把原生桥忽略的重复初始化当作恢复成功', async () => {
    failLogin = () => true
    mocks.dataDir.mockResolvedValueOnce('/var/mobile/old/doc/openim/user-a/')
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天存储路径已变化')
    expect(loginAttempts).toBe(1)
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(1)
  })

  it('读取会话发现数据库目录丢失时自动补目录并重新登录', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let reads = 0
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit && reads++ === 0) return Promise.reject(dbError)
      return original(method, ...args)
    })
    await expect(login.getConversationList()).resolves.toEqual([])
    expect(mocks.dataDir).toHaveBeenCalledTimes(2)
    expect(loginAttempts).toBe(2)
  })
})

describe('数据库会话操作串行执行', () => {
  it('退出进行中的原生 Logout 未完成前，新登录必须等待', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let finishLogout!: () => void
    let nativeStatus = LoginStatus.Logged
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetLoginStatus) return Promise.resolve(nativeStatus)
      if (method === IMMethods.Logout) return new Promise<void>((resolve) => {
        finishLogout = () => { nativeStatus = LoginStatus.Logout; resolve() }
      })
      return original(method, ...args)
    })
    const logout = login.logoutOpenIM()
    await vi.waitFor(() => expect(finishLogout).toBeTypeOf('function'))
    const nextLogin = login.ensureIMLogin()
    await vi.advanceTimersByTimeAsync(10)
    expect(loginAttempts).toBe(1)
    finishLogout()
    await logout
    await expect(nextLogin).resolves.toBe('user-a')
    expect(loginAttempts).toBe(2)
  })

  it('退出界面等待超时后，原生 Logout 仍须完成才能放行新登录', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let finishLogout!: () => void
    let nativeStatus = LoginStatus.Logged
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetLoginStatus) return Promise.resolve(nativeStatus)
      if (method === IMMethods.Logout) return new Promise<void>((resolve) => {
        finishLogout = () => { nativeStatus = LoginStatus.Logout; resolve() }
      })
      return original(method, ...args)
    })
    const logout = login.logoutOpenIM()
    await vi.waitFor(() => expect(finishLogout).toBeTypeOf('function'))
    await vi.advanceTimersByTimeAsync(3100)
    await logout
    const nextLogin = login.ensureIMLogin()
    await vi.advanceTimersByTimeAsync(10)
    expect(loginAttempts).toBe(1)
    finishLogout()
    await expect(nextLogin).resolves.toBe('user-a')
    expect(loginAttempts).toBe(2)
  })

  it('退出发生在初始化目录等待期间时，不继续登录旧会话', async () => {
    let finishDirectory!: (path: string) => void
    mocks.dataDir.mockImplementationOnce(() => new Promise<string>((resolve) => { finishDirectory = resolve }))
    const pending = login.ensureIMLogin().catch((error: Error) => error)
    await vi.waitFor(() => expect(finishDirectory).toBeTypeOf('function'))
    mocks.businessToken = ''
    const logout = login.logoutOpenIM()
    finishDirectory('/var/mobile/current/doc/openim/user-a/')
    expect(await pending).toEqual(new Error('已退出登录'))
    await logout
    expect(loginAttempts).toBe(0)
    expect(login.imUserId.value).toBe('')
  })

  it('退出发生在复用会话状态查询期间时，不重新拉起旧账号', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let finishStatus!: (id: string) => void
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetLoginUserID) return new Promise<string>((resolve) => { finishStatus = resolve })
      return original(method, ...args)
    })
    const pending = login.ensureIMLogin().catch((error: Error) => error)
    await vi.waitFor(() => expect(finishStatus).toBeTypeOf('function'))
    const logout = login.logoutOpenIM()
    finishStatus('user-a')
    expect(await pending).toEqual(new Error('已退出登录'))
    await logout
    expect(loginAttempts).toBe(1)
    expect(login.imUserId.value).toBe('')
  })
})

describe('H5 登录隔离', () => {
  it('H5 不调用 plus.io 或 App InitSDK', async () => {
    mocks.app = false
    vi.stubGlobal('plus', undefined)
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir).not.toHaveBeenCalled()
    expect(calledMethods()).not.toContain(IMMethods.InitSDK)
  })
})
