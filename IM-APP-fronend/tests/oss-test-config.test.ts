import { afterEach, describe, expect, it, vi } from 'vitest'

const checkAppRelease = vi.hoisted(() => vi.fn())
vi.mock('@/api/app-release', () => ({ checkAppRelease }))
vi.mock('@/utils/platform', () => ({ isAppPlatform: () => true }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('explicit OSS test mode', () => {
  it('fails closed instead of using the production App API fallback', async () => {
    vi.stubEnv('MODE', 'oss-test')
    vi.stubEnv('VITE_API_BASE_URL', '')
    await expect(import('@/config')).rejects.toThrow('isolated local API')
  })

  it('rejects an inherited production endpoint', async () => {
    vi.stubEnv('MODE', 'oss-test')
    vi.stubEnv('VITE_API_BASE_URL', 'https://production.invalid/api/v1')
    await expect(import('@/config')).rejects.toThrow('production fallback is forbidden')
  })

  it('does not check or install hot updates, including a manual native check', async () => {
    vi.stubEnv('MODE', 'oss-test')
    vi.stubEnv('VITE_API_BASE_URL', 'https://localhost:18443/api/v1')
    const showToast = vi.fn()
    vi.stubGlobal('uni', { showToast })
    const { APP_CONFIG } = await import('@/config')
    expect(APP_CONFIG.ossTest).toBe(true)
    const { checkAndPromptAppUpdate } = await import('@/composables/useAppUpdate')
    expect(await checkAndPromptAppUpdate()).toBe(false)
    expect(await checkAndPromptAppUpdate({ manual: true })).toBe(false)
    expect(checkAppRelease).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledOnce()
  })

  it('leaves ordinary builds in their existing mode', async () => {
    vi.stubEnv('MODE', 'production')
    const { APP_CONFIG } = await import('@/config')
    expect(APP_CONFIG.ossTest).toBe(false)
  })
})
