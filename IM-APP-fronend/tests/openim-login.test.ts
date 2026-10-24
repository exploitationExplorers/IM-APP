import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: true,
  asyncApi: vi.fn(),
  dataDir: vi.fn(),
  fetchToken: vi.fn(),
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
vi.mock('@/utils/request', () => ({ getToken: () => 'business-token' }))
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

  it('数据库登录失败后重建目录、重新初始化，再登录一次', async () => {
    failLogin = (attempt) => attempt === 1
    mocks.dataDir.mockResolvedValueOnce('/var/mobile/old/doc/openim/user-a/')
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir).toHaveBeenCalledTimes(2)
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(2)
    expect(loginAttempts).toBe(2)
    const secondInit = mocks.asyncApi.mock.calls.filter((call) => call[0] === IMMethods.InitSDK)[1]
    expect(secondInit[2].dataDir).toBe('/var/mobile/current/doc/openim/user-a/')
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

describe('H5 登录隔离', () => {
  it('H5 不调用 plus.io 或 App InitSDK', async () => {
    mocks.app = false
    vi.stubGlobal('plus', undefined)
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(mocks.dataDir).not.toHaveBeenCalled()
    expect(calledMethods()).not.toContain(IMMethods.InitSDK)
  })
})
