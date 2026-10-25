import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const consent = vi.hoisted(() => ({ allowed: false }))
vi.mock('@/utils/privacy-consent', () => ({ requirePrivacyConsent: () => {
  if (!consent.allowed) throw new Error('privacy required')
} }))

import { IMEvents, IMMethods } from 'openim-uniapp-polyfill/src/types/enum'
let sdk: typeof import('@/utils/app-store-openim').default
const native = vi.fn()
const init = vi.fn()
const login = vi.fn()
const addListener = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  consent.allowed = false
  vi.stubGlobal('uni', { requireNativePlugin: native.mockImplementation((name: string) => {
    if (name === 'globalEvent') return { addEventListener: addListener, removeEventListener: vi.fn() }
    return { [IMMethods.InitSDK]: init, [IMMethods.Login]: login }
  }) })
  sdk = (await import('@/utils/app-store-openim')).default
})
afterEach(() => vi.unstubAllGlobals())

describe('商店原生桥不提前实例化', () => {
  it('导入库、读取枚举、生成 uuid 均不加载插件', () => {
    expect(sdk.IMMethods.InitSDK).toBe(IMMethods.InitSDK)
    expect(sdk.uuid()).toBeTruthy()
    expect(native).not.toHaveBeenCalled()
  })

  it('未授权的调用/订阅/同步桥读取均被阻止', async () => {
    await expect(sdk.asyncApi(IMMethods.InitSDK, 'id', {})).rejects.toThrow('privacy required')
    expect(() => sdk.subscribe(IMEvents.OnRecvNewMessage, vi.fn())).toThrow('privacy required')
    expect(() => sdk.nomalApi.sendMessage).toThrow('privacy required')
    expect(native).not.toHaveBeenCalled()
  })

  it('同意后保留同步 InitSDK 的 false 返回和 JSON 返回', async () => {
    consent.allowed = true
    init.mockReturnValueOnce(false).mockReturnValueOnce('{"errCode":0,"data":true}')
    expect(await sdk.asyncApi(IMMethods.InitSDK, 'id', { apiAddr: 'https://app.example' })).toBe(false)
    expect(await sdk.asyncApi(IMMethods.InitSDK, 'id', {})).toEqual({ errCode: 0, data: true })
    expect(native).toHaveBeenCalledTimes(1)
  })

  it('保留异步信封、PascalCase 数据与错误码', async () => {
    consent.allowed = true
    login.mockImplementationOnce((_id: unknown, _params: unknown, cb: (value: unknown) => void) => {
      cb({ errCode: 0, data: '{"VideoElem":{"VideoUrl":"https://cdn.example/a.mp4"}}' })
    })
    expect(await sdk.asyncApi(IMMethods.Login, 'id', {})).toEqual({
      errCode: 0, data: { VideoElem: { VideoUrl: 'https://cdn.example/a.mp4' } },
    })
    login.mockImplementationOnce((_id: unknown, _params: unknown, cb: (value: unknown) => void) => cb({ errCode: 10005, errMsg: 'database unavailable' }))
    await expect(sdk.asyncApi(IMMethods.Login, 'id', {})).rejects.toMatchObject({ errCode: 10005 })
  })

  it('授权后订阅使用同一个原生回调', () => {
    consent.allowed = true
    const callback = vi.fn()
    sdk.subscribe(IMEvents.OnRecvNewMessage, callback)
    expect(addListener).toHaveBeenCalledWith(IMEvents.OnRecvNewMessage, callback)
  })
})
