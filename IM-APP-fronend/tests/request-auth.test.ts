import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({ APP_CONFIG: { apiBaseUrl: 'https://api.example' } }))
vi.mock('@/utils/device', () => ({ getDeviceId: () => 'test-device' }))

type PendingRequest = {
  url: string
  header: Record<string, string>
  success: (response: { statusCode: number; data: unknown }) => void
  fail: (error: { errMsg: string }) => void
}

let api: typeof import('@/utils/request')
let pending: PendingRequest[]
let expired: ReturnType<typeof vi.fn>

function respond(request: PendingRequest, statusCode: number, data: unknown = null, message = 'request failed') {
  request.success({ statusCode, data: { code: statusCode === 200 ? 0 : statusCode, data, message } })
}

async function nextRequest(): Promise<PendingRequest> {
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
  return pending.shift()!
}

beforeEach(async () => {
  vi.resetModules()
  pending = []
  expired = vi.fn()
  const storage = new Map<string, unknown>()
  vi.stubGlobal('sessionStorage', undefined)
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/chat/index' }])
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    request: (options: PendingRequest) => pending.push(options),
    showToast: vi.fn(),
    reLaunch: vi.fn(),
  })
  api = await import('@/utils/request')
  api.setToken('old-access')
  api.setRefreshToken('old-refresh')
  api.setAuthExpiredHandler(expired)
})

afterEach(() => vi.unstubAllGlobals())

function startRequest() {
  // 立即接住拒绝，模拟页面已注册错误处理，避免测试制造未处理的 Promise。
  return api.request({ url: '/me' }).then((value) => value, (error: Error) => error)
}

async function startRefresh() {
  const result = startRequest()
  respond(await nextRequest(), 401, null, '登录已过期')
  const refresh = await nextRequest()
  expect(refresh.url).toBe('https://api.example/auth/token/refresh')
  return { result, refresh }
}

function expectSession(access = 'old-access', refresh = 'old-refresh') {
  expect(api.getToken()).toBe(access)
  expect(api.getRefreshToken()).toBe(refresh)
  expect(expired).not.toHaveBeenCalled()
  expect(uni.reLaunch).not.toHaveBeenCalled()
  expect(uni.showToast).not.toHaveBeenCalled()
}

describe('登录续期失败分类', () => {
  it('续期请求网络超时保留会话，网络恢复后仍可续期', async () => {
    const first = await startRefresh()
    first.refresh.fail({ errMsg: 'request:fail timeout' })
    expect(await first.result).toEqual(new Error('request:fail timeout'))
    expectSession()

    const second = await startRefresh()
    respond(second.refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    const retry = await nextRequest()
    expect(retry.header.Authorization).toBe('Bearer new-access')
    respond(retry, 200, { id: 'user-a' })
    expect(await second.result).toEqual({ id: 'user-a' })
    expectSession('new-access', 'new-refresh')
  })

  it.each([429, 500, 502, 503])('续期返回 %i 时保留会话和原始错误', async (status) => {
    const { result, refresh } = await startRefresh()
    respond(refresh, status, null, '服务暂不可用')
    expect(await result).toEqual(new Error('服务暂不可用'))
    expectSession()
  })

  it.each([403, 500])('续期成功后的业务请求返回 %i 不应注销账号', async (status) => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    respond(await nextRequest(), status, null, '业务请求失败')
    expect(await result).toEqual(new Error('业务请求失败'))
    expectSession('new-access', 'new-refresh')
  })

  it('续期成功后的业务请求超时保留新凭证', async () => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    const retry = await nextRequest()
    retry.fail({ errMsg: 'request:fail timeout' })
    expect(await result).toEqual(new Error('request:fail timeout'))
    expectSession('new-access', 'new-refresh')
  })

  it('服务端明确拒绝刷新凭证时清理会话并跳转一次', async () => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 401, null, '登录已过期，请重新登录')
    expect(await result).toBeInstanceOf(Error)
    expect(api.getToken()).toBe('')
    expect(api.getRefreshToken()).toBe('')
    expect(expired).toHaveBeenCalledOnce()
    expect(uni.reLaunch).toHaveBeenCalledOnce()
  })

  it('新凭证仍收到 401 时清理会话一次', async () => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    respond(await nextRequest(), 401, null, '账号已注销或不可用，请重新登录')
    expect(await result).toBeInstanceOf(Error)
    expect(api.getToken()).toBe('')
    expect(expired).toHaveBeenCalledOnce()
    expect(uni.reLaunch).toHaveBeenCalledOnce()
  })

  it('登录接口密码错误不清理当前会话', async () => {
    const result = api.request({ url: '/auth/login', auth: false, method: 'POST' }).catch((error) => error)
    respond(await nextRequest(), 401, null, '密码错误')
    expect(await result).toEqual(new Error('密码错误'))
    expectSession()
  })

  it('并发 401 共用一次续期', async () => {
    const first = startRequest()
    const second = startRequest()
    respond(await nextRequest(), 401)
    respond(await nextRequest(), 401)
    const refresh = await nextRequest()
    expect(pending).toHaveLength(0)
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    respond(await nextRequest(), 200, 'first')
    respond(await nextRequest(), 200, 'second')
    expect(await Promise.all([first, second])).toEqual(['first', 'second'])
    expectSession('new-access', 'new-refresh')
  })

  it('并发请求遇到续期凭证失效时只清理一次', async () => {
    const first = startRequest()
    const second = startRequest()
    respond(await nextRequest(), 401)
    respond(await nextRequest(), 401)
    respond(await nextRequest(), 401, null, '登录已过期')
    const results = await Promise.all([first, second])
    expect(results.every((result) => result instanceof Error)).toBe(true)
    expect(expired).toHaveBeenCalledOnce()
    expect(uni.reLaunch).toHaveBeenCalledOnce()
  })

  it('续期响应缺少刷新凭证时不覆盖原会话', async () => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 200, { accessToken: 'new-access' }, '响应不完整')
    expect(await result).toEqual(new Error('响应不完整'))
    expectSession()
    expect(pending).toHaveLength(0)
  })

  it('没有刷新凭证的有效会话收到 401 时正常退出', async () => {
    api.setRefreshToken('')
    const result = startRequest()
    respond(await nextRequest(), 401)
    expect(await result).toBeInstanceOf(Error)
    expect(api.getToken()).toBe('')
    expect(expired).toHaveBeenCalledOnce()
  })

  it('未登录时后台请求收到 401 不反复跳转登录页', async () => {
    api.clearToken()
    const result = startRequest()
    respond(await nextRequest(), 401)
    expect(await result).toBeInstanceOf(Error)
    expectSession('', '')
  })
})

describe('在途认证请求与账号切换', () => {
  it.each([200, 401])('换号后旧续期响应 %i 不覆盖或注销新会话', async (status) => {
    const { result, refresh } = await startRefresh()
    api.setToken('other-access')
    api.setRefreshToken('other-refresh')
    respond(refresh, status, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    expect(await result).toEqual(new Error('登录状态已变更，请重试'))
    expectSession('other-access', 'other-refresh')
    expect(pending).toHaveLength(0)
  })

  it('主动退出后旧续期结果不恢复已退出的会话', async () => {
    const { result, refresh } = await startRefresh()
    api.clearToken()
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    expect(await result).toEqual(new Error('登录状态已变更，请重试'))
    expectSession('', '')
  })

  it('旧业务请求的延迟 401 不触发新账号的续期或登出', async () => {
    const result = startRequest()
    const oldRequest = await nextRequest()
    api.setToken('other-access')
    api.setRefreshToken('other-refresh')
    respond(oldRequest, 401)
    expect(await result).toEqual(new Error('登录状态已变更，请重试'))
    expectSession('other-access', 'other-refresh')
    expect(pending).toHaveLength(0)
  })

  it('业务重试的延迟 401 不清理已经切换的账号', async () => {
    const { result, refresh } = await startRefresh()
    respond(refresh, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' })
    const retry = await nextRequest()
    api.setToken('other-access')
    api.setRefreshToken('other-refresh')
    respond(retry, 401)
    expect(await result).toEqual(new Error('登录状态已变更，请重试'))
    expectSession('other-access', 'other-refresh')
  })
})

describe('H5 标签页会话兼容', () => {
  beforeEach(() => {
    const session = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => session.get(key) || null,
      setItem: (key: string, value: string) => session.set(key, value),
    })
    api.setToken('old-access')
    api.setRefreshToken('old-refresh')
  })

  it('H5 续期网络失败同样保留当前标签页的会话', async () => {
    const { result, refresh } = await startRefresh()
    refresh.fail({ errMsg: 'request:fail timeout' })
    expect(await result).toEqual(new Error('request:fail timeout'))
    expectSession()
  })

  it('H5 当前标签页真正过期时保留其他标签页账号', async () => {
    const slots = JSON.parse(uni.getStorageSync(api.AUTH_SLOTS_KEY))
    slots.other = { access: 'other-access', refresh: 'other-refresh', at: Date.now() }
    uni.setStorageSync(api.AUTH_SLOTS_KEY, JSON.stringify(slots))
    const { result, refresh } = await startRefresh()
    respond(refresh, 401)
    expect(await result).toBeInstanceOf(Error)
    expect(api.getToken()).toBe('')
    expect(JSON.parse(uni.getStorageSync(api.AUTH_SLOTS_KEY))).toEqual({ other: slots.other })
    expect(expired).toHaveBeenCalledOnce()
  })
})
