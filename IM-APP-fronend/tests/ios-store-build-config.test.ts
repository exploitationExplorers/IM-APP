import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
const { validateStoreEnv } = createRequire(import.meta.url)('../scripts/check-ios-store.cjs')

const env = {
  VITE_DISTRIBUTION: 'app-store',
  VITE_API_BASE_URL: 'https://app.example/api/v1',
  VITE_IM_API_URL: 'https://app.example/openim-api',
  VITE_IM_WS_URL: 'wss://app.example/openim-ws',
  VITE_PRIVACY_POLICY_URL: 'https://app.example/privacy',
  VITE_USER_AGREEMENT_URL: 'https://app.example/agreement',
  VITE_APP_STORE_ID: '123456789',
}

describe('App Store 发布配置校验', () => {
  it('允许填写完整的独立商店配置', () => {
    expect(validateStoreEnv(env)).toEqual([])
  })

  it('拒绝缺失正式隐私/协议或商店 ID 的包', () => {
    const errors = validateStoreEnv({ ...env, VITE_PRIVACY_POLICY_URL: '', VITE_USER_AGREEMENT_URL: '', VITE_APP_STORE_ID: '' })
    expect(errors).toHaveLength(3)
  })

  it.each(['http://app.example/api', 'https://8.154.44.197/api', 'https://user:password@app.example/api'])('拒绝不合格服务地址 %s', (url) => {
    expect(validateStoreEnv({ ...env, VITE_API_BASE_URL: url })).toHaveLength(1)
  })

  it('拒绝明文 WebSocket 和混用普通渠道', () => {
    expect(validateStoreEnv({ ...env, VITE_IM_WS_URL: 'ws://app.example/ws', VITE_DISTRIBUTION: 'test' })).toHaveLength(2)
  })
})
