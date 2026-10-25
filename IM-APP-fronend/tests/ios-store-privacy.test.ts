import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ appStore: true, apiBaseUrl: 'https://app.example/api/v1' }))
vi.mock('@/config', () => ({ APP_CONFIG: config }))

import { acceptPrivacyConsent, hasPrivacyConsent, PRIVACY_CONSENT_KEY } from '@/utils/privacy-consent'
import { getDeviceId } from '@/utils/device'
import { request } from '@/utils/request'
import { clearLoginPassword } from '@/utils/login-phone'
import { stashOldPassword, consumeOldPassword, clearOldPassword } from '@/utils/password-state'
import { requireSecureEndpoint, storeMediaUrl } from '@/utils/app-store-network'

let storage: Map<string, unknown>
const network = vi.fn()
const setStorage = vi.fn()

beforeEach(() => {
  config.appStore = true
  storage = new Map()
  vi.clearAllMocks()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key) || '',
    setStorageSync: setStorage.mockImplementation((key: string, value: unknown) => storage.set(key, value)),
    removeStorageSync: (key: string) => storage.delete(key),
    request: network,
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('商店包隐私授权边界', () => {
  it('旧 token 存在时，未同意仍不能请求或生成设备标识', async () => {
    storage.set('im_token', 'old-session')
    expect(hasPrivacyConsent()).toBe(false)
    await expect(request({ url: '/me' })).rejects.toThrow('请先阅读')
    expect(() => getDeviceId()).toThrow('请先阅读')
    expect(network).not.toHaveBeenCalled()
    expect(setStorage).not.toHaveBeenCalled()
  })

  it('记录显式同意后生成稳定随机标识，不读取硬件型号', () => {
    acceptPrivacyConsent()
    expect(hasPrivacyConsent()).toBe(true)
    const id = getDeviceId()
    expect(getDeviceId()).toBe(id)
    expect(id).toMatch(/^web_/)
  })

  it('过期的政策同意不能继续授权', () => {
    storage.set(PRIVACY_CONSENT_KEY, 'old-version')
    expect(hasPrivacyConsent()).toBe(false)
  })

  it('普通 Android/H5 构建保留现有启动行为', () => {
    config.appStore = false
    expect(hasPrivacyConsent()).toBe(true)
  })
})

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

describe('商店包安全传输', () => {
  it('仅允许 HTTPS API 和 WSS，拒绝明文及 URL 凭据', () => {
    expect(requireSecureEndpoint('https://app.example/api')).toBe('https://app.example/api')
    expect(requireSecureEndpoint('wss://app.example/ws', 'ws')).toBe('wss://app.example/ws')
    for (const url of ['http://app.example/api', 'https://user:password@app.example/api', 'relative']) {
      expect(() => requireSecureEndpoint(url)).toThrow()
    }
    expect(() => requireSecureEndpoint('ws://app.example/ws', 'ws')).toThrow()
  })

  it('已同意后也不能通过 request 绕过 HTTPS', async () => {
    acceptPrivacyConsent()
    await expect(request({ url: 'http://insecure.example/api' })).rejects.toThrow('安全连接')
    expect(network).not.toHaveBeenCalled()
  })

  it('旧存储地址通过 HTTPS 网关访问，保留编码和查询串', () => {
    expect(storeMediaUrl('http://8.154.44.197/object/a%20b.jpg?width=128&x=a%2Fb'))
      .toBe('https://app.example/object/a%20b.jpg?width=128&x=a%2Fb')
    expect(storeMediaUrl('http://untrusted.example/a.jpg')).toBe('')
    expect(storeMediaUrl('http://8.154.44.197/unknown/a.jpg')).toBe('')
  })

  it('HTTPS OSS 签名逐字节保持，HTTP 签名禁止访问', () => {
    const secure = 'https://bucket.oss-cn-hongkong.aliyuncs.com/a.jpg?OSSAccessKeyId=id&Signature=a%2Fb'
    expect(storeMediaUrl(secure)).toBe(secure)
    expect(storeMediaUrl(secure.replace('https:', 'http:'))).toBe('')
  })
})
