import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  token: 'business-token',
  refresh: 'refresh-token',
  revoke: vi.fn(),
  unregister: vi.fn(),
  logoutIM: vi.fn(),
  clearCache: vi.fn(),
  reset: vi.fn(),
  clearMassHistory: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  loginByPassword: vi.fn(), loginBySms: vi.fn(), registerBySms: vi.fn(),
  fetchProfile: vi.fn(), refreshAuthToken: vi.fn(), logoutCurrentDevice: mocks.revoke,
}))
vi.mock('@/api/user', () => ({ updateMyPublicId: vi.fn(), updateProfile: vi.fn() }))
vi.mock('@/utils/request', () => ({
  getToken: () => mocks.token,
  getRefreshToken: () => mocks.refresh,
  clearToken: () => { mocks.token = ''; mocks.refresh = '' },
  setToken: vi.fn(), setRefreshToken: vi.fn(),
  persistTokenAsync: vi.fn(), persistRefreshTokenAsync: vi.fn(),
}))
vi.mock('@/utils/openim', () => ({ initOpenIM: vi.fn(), logoutOpenIM: mocks.logoutIM }))
vi.mock('@/utils/app-cache', () => ({ clearSessionStorage: mocks.clearCache }))
vi.mock('@/utils/friend-request-badge', () => ({ clearFriendRequestBadge: vi.fn() }))
vi.mock('@/utils/push-register', () => ({ syncPushRegistration: vi.fn(), unregisterPushRegistration: mocks.unregister }))
vi.mock('@/utils/perf', () => ({ perfColdStartDone: vi.fn() }))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ reset: mocks.reset }) }))
vi.mock('@/stores/contact', () => ({ useContactStore: () => ({ reset: mocks.reset }) }))
vi.mock('@/stores/group', () => ({ useGroupStore: () => ({ reset: mocks.reset }) }))
vi.mock('@/stores/massSend', () => ({
  useMassSendStore: () => ({ resetAll: mocks.reset, clearHistory: mocks.clearMassHistory }),
}))
vi.mock('@/stores/chatSettings', () => ({ useChatSettingsStore: vi.fn() }))

import { useUserStore } from '@/stores/user'
import { readLoginPhone, saveLoginPhone } from '@/utils/login-phone'
import { consumeOldPassword, stashOldPassword } from '@/utils/password-state'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.token = 'business-token'
  mocks.refresh = 'refresh-token'
  mocks.revoke.mockResolvedValue(undefined)
  mocks.unregister.mockResolvedValue(undefined)
  mocks.logoutIM.mockResolvedValue(undefined)
  const storage = new Map<string, unknown>()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    reLaunch: vi.fn(),
  })
  setActivePinia(createPinia())
  saveLoginPhone('+86', '13800138000')
  stashOldPassword('old-password')
})

afterEach(() => vi.unstubAllGlobals())

describe('账号注销后的会话清理', () => {
  it('账号删除后清本地会话和 SDK，不再调用已失效的鉴权接口', async () => {
    const store = useUserStore()
    await store.logoutAfterAccountDeletion()
    expect(store.isLoggedIn).toBe(false)
    expect(mocks.token).toBe('')
    expect(mocks.refresh).toBe('')
    expect(readLoginPhone()).toBeNull()
    expect(consumeOldPassword()).toBe('')
    expect(mocks.clearCache).toHaveBeenCalledOnce()
    expect(mocks.logoutIM).toHaveBeenCalledOnce()
    expect(mocks.reset).toHaveBeenCalledTimes(4)
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.unregister).not.toHaveBeenCalled()
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/auth/sign-in' })
  })

  it('普通退出仍撤销服务端会话和推送登记，并保留记住的手机号', async () => {
    const store = useUserStore()
    await store.logout()
    expect(store.isLoggedIn).toBe(false)
    expect(mocks.revoke).toHaveBeenCalledOnce()
    expect(mocks.unregister).toHaveBeenCalledOnce()
    expect(readLoginPhone()?.phone).toBe('13800138000')
    expect(consumeOldPassword()).toBe('')
  })

  it('会话失效时清除密码交接状态', () => {
    const store = useUserStore()
    store.invalidateSession()
    expect(store.isLoggedIn).toBe(false)
    expect(consumeOldPassword()).toBe('')
  })
})
