import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLoginPassword } from '@/utils/login-phone'
import { stashOldPassword, consumeOldPassword, clearOldPassword } from '@/utils/password-state'
import { getDeviceId } from '@/utils/device'

let storage: Map<string, unknown>
const setStorage = vi.fn()
const systemInfo = vi.fn()

beforeEach(() => {
  storage = new Map()
  vi.clearAllMocks()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: setStorage.mockImplementation((key: string, value: unknown) => storage.set(key, value)),
    removeStorageSync: (key: string) => storage.delete(key),
    getSystemInfoSync: systemInfo,
  })
  clearOldPassword()
})

afterEach(() => vi.unstubAllGlobals())

describe('密码迁移和一次性交接', () => {
  it('清理历史明文，旧密码交接不写入 storage 且只能读取一次', () => {
    storage.set('im_login_password', 'legacy-login')
    storage.set('password_change_old', 'legacy-old')
    clearLoginPassword()
    stashOldPassword('new-old-password')
    expect(storage.has('im_login_password')).toBe(false)
    expect(storage.has('password_change_old')).toBe(false)
    expect(setStorage).not.toHaveBeenCalled()
    expect(consumeOldPassword()).toBe('new-old-password')
    expect(consumeOldPassword()).toBe('')
  })

  it('会话结束后不保留待交接密码，不读取遗留明文', () => {
    stashOldPassword('secret')
    clearOldPassword()
    storage.set('password_change_old', 'stale-secret')
    expect(consumeOldPassword()).toBe('')
    expect(storage.has('password_change_old')).toBe(false)
  })
})

describe('会话设备标识', () => {
  it('新标识在同一设备上稳定，生成时不读取硬件型号', () => {
    const id = getDeviceId()
    expect(id).toBeTruthy()
    expect(getDeviceId()).toBe(id)
    expect(setStorage).toHaveBeenCalledTimes(1)
    expect(systemInfo).not.toHaveBeenCalled()
  })

  it('升级时继续使用已有设备标识，保留会话绑定', () => {
    storage.set('im_device_id', 'ios_existing-device')
    expect(getDeviceId()).toBe('ios_existing-device')
    expect(setStorage).not.toHaveBeenCalled()
    expect(systemInfo).not.toHaveBeenCalled()
  })
})
