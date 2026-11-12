import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: true,
  asyncApi: vi.fn(),
  dataDir: vi.fn(),
  backupDataDir: vi.fn(async () => true),
  resetDataDir: vi.fn(async () => true),
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
vi.mock('@/utils/openimDataDir', () => ({
  backupAppSdkDataDir: mocks.backupDataDir,
  getAppSdkDataDir: mocks.dataDir,
  resetAppSdkDataDir: mocks.resetDataDir,
}))
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
  mocks.backupDataDir.mockResolvedValue(true)
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

describe('会话资源未就绪恢复', () => {
  const resourceError = {
    errCode: 10005,
    errMsg: 'error *errors.withStack not implement CodeError: not load resource: 10004 Resource initialization incomplete',
  }

  it('H5 状态仍为 Logged 时实际 Logout/Login 后重读会话', async () => {
    const app = false
    mocks.app = app
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let loggedOut = false
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetLoginStatus) return Promise.resolve(loggedOut ? LoginStatus.Logout : LoginStatus.Logged)
      if (method === IMMethods.Logout) loggedOut = true
      if (method === IMMethods.GetConversationListSplit && loginAttempts < 2) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    // 复现旧恢复流程：只失效前端缓存时，Logged 分支仍会跳过真正的 Login。
    login.invalidateIMLoginCache()
    await login.ensureIMLogin()
    expect(loginAttempts).toBe(1)
    const result = login.getConversationList(200, 50).then(
      (value) => ({ value }), (error: Error) => ({ error: error.message }),
    )
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ value: [] })
    expect(calledMethods()).toContain(IMMethods.Logout)
    expect(loginAttempts).toBe(2)
    expect(mocks.asyncApi).toHaveBeenLastCalledWith(IMMethods.GetConversationListSplit, 'login-test', { offset: 200, count: 50 })
  })

  it('同步尚未结束时继续等待，不中断正在进行的同步', async () => {
    await login.ensureIMLogin()
    mocks.events.get(IMEvents.OnConnectSuccess)?.forEach((callback) => callback({}))
    mocks.events.get(IMEvents.OnSyncServerStart)?.forEach((callback) => callback({}))
    const original = mocks.asyncApi.getMockImplementation()!
    let syncing = true
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit && syncing) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    const result = login.getConversationList().then(
      (value) => ({ value }), (error: Error) => ({ error: error.message }),
    )
    await vi.advanceTimersByTimeAsync(2500)
    syncing = false
    mocks.events.get(IMEvents.OnSyncServerFinish)?.forEach((callback) => callback({}))
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ value: [] })
    expect(loginAttempts).toBe(1)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
  })

  it('同步窗口内短暂未就绪时重试成功，不关闭正在同步的数据库', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let reads = 0
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit && reads++ === 0) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    const result = login.getConversationList().then(
      (value) => ({ value }), (error: Error) => ({ error: error.message }),
    )
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ value: [] })
    expect(loginAttempts).toBe(1)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
  })

  it('App 持续未就绪时保留会话和本地库，允许后续重试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    const result = login.getConversationList().catch((error: Error) => error.message)
    await vi.runAllTimersAsync()
    expect(await result).toBe('聊天记录正在同步，完成后会自动刷新')
    expect(loginAttempts).toBe(1)
    expect(login.imSyncPending.value).toBe(true)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
  })

  it('大账号超过一分钟才同步完成时，重试不重登、不删除本地库', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await login.ensureIMLogin()
    const removed = vi.fn((ok: () => void) => ok())
    const runtime = plus as { io: { resolveLocalFileSystemURL?: (path: string, ok: (entry: { removeRecursively: typeof removed }) => void, fail: () => void) => void } }
    runtime.io.resolveLocalFileSystemURL = (_path, ok) => ok({ removeRecursively: removed })
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit && syncing) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    let syncing = true
    for (let i = 0; i < 2; i++) {
      const result = login.getConversationList().catch((error: Error) => error)
      await vi.runAllTimersAsync()
      expect(login.isIMSyncPendingError(await result)).toBe(true)
    }
    syncing = false
    mocks.events.get(IMEvents.OnSyncServerFinish)?.forEach((callback) => callback({}))
    await expect(login.getConversationList()).resolves.toEqual([])
    expect(login.imSyncPending.value).toBe(false)
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
    expect(mocks.backupDataDir).not.toHaveBeenCalled()
    expect(loginAttempts).toBe(1)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
  })

  it('同步进度兼容 iOS JSON/PascalCase，完成和退出后清理状态', async () => {
    await login.ensureIMLogin()
    const emit = (event: IMEvents, data: unknown) => mocks.events.get(event)?.forEach((callback) => callback(data))
    emit(IMEvents.OnSyncServerStart, {})
    emit(IMEvents.OnSyncServerProgress, { data: JSON.stringify({ Progress: 42 }) })
    expect(login.imSyncPending.value).toBe(true)
    expect(login.imSyncProgress.value).toBe(42)
    emit(IMEvents.OnSyncServerProgress, { data: 'invalid' })
    expect(login.imSyncProgress.value).toBe(42)
    emit(IMEvents.OnSyncServerFinish, {})
    expect(login.imSyncPending.value).toBe(false)
    emit(IMEvents.OnSyncServerStart, {})
    emit(IMEvents.OnSyncServerProgress, { data: 12 })
    await login.logoutOpenIM()
    expect(login.imSyncPending.value).toBe(false)
    expect(login.imSyncProgress.value).toBeNull()
  })

  it('同步中返回空列表不能误判成没有聊天，完成后空账号才返回空列表', async () => {
    await login.ensureIMLogin()
    mocks.events.get(IMEvents.OnSyncServerStart)?.forEach((callback) => callback({}))
    const error = await login.getConversationList().catch((failure: unknown) => failure)
    expect(login.isIMSyncPendingError(error)).toBe(true)
    expect(login.imSyncPending.value).toBe(true)
    mocks.events.get(IMEvents.OnSyncServerFinish)?.forEach((callback) => callback({}))
    await expect(login.getConversationList()).resolves.toEqual([])
    expect(login.imSyncPending.value).toBe(false)
    expect(loginAttempts).toBe(1)
  })

  it('普通 10005 错误不当作资源未就绪重登', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit) return Promise.reject({ errCode: 10005, errMsg: 'invalid conversation data' })
      return original(method, ...args)
    })
    await expect(login.getConversationList()).rejects.toThrow('invalid conversation data')
    expect(loginAttempts).toBe(1)
    expect(calledMethods()).not.toContain(IMMethods.Logout)
  })

  it('H5 多个会话读取并发失败时只执行一轮会话恢复', async () => {
    mocks.app = false
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit && loginAttempts < 2) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    const result = Promise.all([login.getConversationList(), login.getConversationList()])
    await vi.runAllTimersAsync()
    expect(await result).toEqual([[], []])
    expect(loginAttempts).toBe(2)
  })

  it('退避期间退出登录后不恢复旧账号或再次读取会话', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit) return Promise.reject(resourceError)
      return original(method, ...args)
    })
    const result = login.getConversationList().catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(100)
    await login.logoutOpenIM()
    await vi.runAllTimersAsync()
    expect(await result).toBe('已退出登录')
    expect(loginAttempts).toBe(1)
    expect(calledMethods().filter((method) => method === IMMethods.GetConversationListSplit)).toHaveLength(1)
    expect(login.imUserId.value).toBe('')
  })

  it('退出后原生返回的旧会话列表不能再交给界面', async () => {
    await login.ensureIMLogin()
    const original = mocks.asyncApi.getMockImplementation()!
    let finishRead!: (list: unknown[]) => void
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.GetConversationListSplit) return new Promise((resolve) => { finishRead = resolve })
      return original(method, ...args)
    })
    const result = login.getConversationList().catch((error: Error) => error.message)
    await login.logoutOpenIM()
    finishRead([{ conversationID: 'old-account-conversation' }])
    expect(await result).toBe('已退出登录')
  })

  it.each([IMMethods.GetOneConversation, IMMethods.GetAdvancedHistoryMessageList])(
    'H5 %s 资源未就绪时也不能被 Logged 状态跳过恢复', async (targetMethod) => {
      mocks.app = false
      await login.ensureIMLogin()
      const original = mocks.asyncApi.getMockImplementation()!
      const expected = targetMethod === IMMethods.GetOneConversation
        ? { conversationID: 'sg_test', conversationType: 3, groupID: 'test' }
        : { messageList: [], isEnd: true }
      let loggedOut = false
      mocks.asyncApi.mockImplementation((method, ...args) => {
        if (method === IMMethods.GetLoginStatus) return Promise.resolve(loggedOut ? LoginStatus.Logout : LoginStatus.Logged)
        if (method === IMMethods.Logout) loggedOut = true
        if (method === targetMethod) return loginAttempts < 2 ? Promise.reject(resourceError) : Promise.resolve(expected)
        return original(method, ...args)
      })
      const request = targetMethod === IMMethods.GetOneConversation
        ? login.getOneConversation('test', 3)
        : login.getHistoryMessages('sg_test')
      const result = request.then((value) => ({ value }), (error: Error) => ({ error: error.message }))
      await vi.runAllTimersAsync()
      expect(await result).toEqual({ value: expected })
      expect(calledMethods()).toContain(IMMethods.Logout)
      expect(loginAttempts).toBe(2)
    },
  )

  it.each([IMMethods.GetOneConversation, IMMethods.GetAdvancedHistoryMessageList])(
    'App %s 资源未就绪时不能打断大账号同步', async (targetMethod) => {
      await login.ensureIMLogin()
      const original = mocks.asyncApi.getMockImplementation()!
      mocks.asyncApi.mockImplementation((method, ...args) => {
        if (method === targetMethod) return Promise.reject(resourceError)
        return original(method, ...args)
      })
      const request = targetMethod === IMMethods.GetOneConversation
        ? login.getOneConversation('test', 3)
        : login.getHistoryMessages('sg_test')
      const result = request.catch((error: Error) => error)
      await vi.runAllTimersAsync()
      expect(login.isIMSyncPendingError(await result)).toBe(true)
      expect(loginAttempts).toBe(1)
      expect(calledMethods()).not.toContain(IMMethods.Logout)
      expect(mocks.resetDataDir).not.toHaveBeenCalled()
    },
  )

  it.each([IMMethods.GetOneConversation, IMMethods.GetAdvancedHistoryMessageList])(
    '%s 的旧请求不能在退出后触发新账号恢复', async (targetMethod) => {
      await login.ensureIMLogin()
      const original = mocks.asyncApi.getMockImplementation()!
      mocks.asyncApi.mockImplementation((method, ...args) => {
        if (method === targetMethod) return Promise.reject(resourceError)
        return original(method, ...args)
      })
      const request = targetMethod === IMMethods.GetOneConversation
        ? login.getOneConversation('test', 3)
        : login.getHistoryMessages('sg_test')
      const result = request.catch((error: Error) => error.message)
      await vi.advanceTimersByTimeAsync(100)
      await login.logoutOpenIM()
      await vi.runAllTimersAsync()
      expect(await result).toBe('已退出登录')
      expect(loginAttempts).toBe(1)
      expect(login.imUserId.value).toBe('')
    },
  )
})

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

  it.each([
    dbError,
    { errCode: 10005, errMsg: 'database disk image is malformed' },
    { errCode: 10005, errMsg: 'file is not a database' },
  ])('登录反复打不开旧库时备份原库并重建，不依赖读取会话触发（$errMsg）', async (error) => {
    vi.stubGlobal('plus', { io: { resolveLocalFileSystemURL: vi.fn() } })
    failLogin = (attempt) => attempt <= 2
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => original(method, ...args).catch((failure: unknown) => {
      throw method === IMMethods.Login ? error : failure
    }))
    await expect(login.ensureIMLogin()).resolves.toBe('user-a')
    expect(loginAttempts).toBe(3)
    expect(mocks.backupDataDir).toHaveBeenCalledOnce()
    expect(mocks.backupDataDir).toHaveBeenCalledWith('user-a', plus.io)
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
    expect(mocks.dataDir).toHaveBeenCalledTimes(3)
    expect(calledMethods().filter((method) => method === IMMethods.InitSDK)).toHaveLength(1)
    const logoutIndex = calledMethods().indexOf(IMMethods.Logout)
    expect(mocks.asyncApi.mock.invocationCallOrder[logoutIndex]).toBeLessThan(mocks.backupDataDir.mock.invocationCallOrder[0])
    expect(mocks.backupDataDir.mock.invocationCallOrder[0]).toBeLessThan(mocks.dataDir.mock.invocationCallOrder[2])
  })

  it('原库无法备份时保留文件并停止恢复，不调用删除本地库', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('plus', { io: { resolveLocalFileSystemURL: vi.fn() } })
    failLogin = () => true
    mocks.backupDataDir.mockResolvedValue(false)
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天本地数据库初始化失败')
    expect(loginAttempts).toBe(2)
    expect(mocks.backupDataDir).toHaveBeenCalledOnce()
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
    expect(login.imUserId.value).toBe('')
  })

  it('新库仍打不开时每个进程只备份一次，下拉重试不能不断重建', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('plus', { io: { resolveLocalFileSystemURL: vi.fn() } })
    failLogin = () => true
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天本地数据库初始化失败')
    expect(loginAttempts).toBe(3)
    await expect(login.ensureIMLogin()).rejects.toThrow('聊天本地数据库初始化失败')
    expect(loginAttempts).toBe(5)
    expect(mocks.backupDataDir).toHaveBeenCalledOnce()
    expect(login.imUserId.value).toBe('')
  })

  it('目录修复后变为网络错误时不备份数据库', async () => {
    vi.stubGlobal('plus', { io: { resolveLocalFileSystemURL: vi.fn() } })
    const original = mocks.asyncApi.getMockImplementation()!
    mocks.asyncApi.mockImplementation((method, ...args) => {
      if (method === IMMethods.Login) {
        loginAttempts += 1
        return Promise.reject(loginAttempts === 1 ? dbError : new Error('network unavailable'))
      }
      return original(method, ...args)
    })
    await expect(login.ensureIMLogin()).rejects.toThrow('network unavailable')
    expect(mocks.backupDataDir).not.toHaveBeenCalled()
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
  })

  it('备份期间退出时不能再次登录旧账号', async () => {
    vi.stubGlobal('plus', { io: { resolveLocalFileSystemURL: vi.fn() } })
    failLogin = () => true
    let finishBackup!: (success: boolean) => void
    mocks.backupDataDir.mockImplementationOnce(() => new Promise((resolve) => { finishBackup = resolve }))
    const result = login.ensureIMLogin().catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.backupDataDir).toHaveBeenCalledOnce()
    const logout = login.logoutOpenIM()
    finishBackup(true)
    expect(await result).toBe('已退出登录')
    await logout
    expect(loginAttempts).toBe(2)
    expect(login.imUserId.value).toBe('')
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

  it('H5 数据库错误不触发原生目录备份或重建', async () => {
    mocks.app = false
    vi.stubGlobal('plus', undefined)
    failLogin = () => true
    const result = login.ensureIMLogin().catch((error: Error) => error.message)
    await vi.runAllTimersAsync()
    expect(await result).toContain('unable to open database file')
    expect(mocks.dataDir).not.toHaveBeenCalled()
    expect(mocks.backupDataDir).not.toHaveBeenCalled()
    expect(mocks.resetDataDir).not.toHaveBeenCalled()
    expect(calledMethods()).not.toContain(IMMethods.InitSDK)
  })
})
