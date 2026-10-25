import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/request', () => ({ ACTIVE_TAB_KEY: 'active', AUTH_SLOTS_KEY: 'slots' }))
vi.mock('@/utils/login-phone', () => ({ LOGIN_REMEMBER_KEYS: [] }))
vi.mock('@/utils/previewImageCache', () => ({ clearPreviewImageCache: async () => {} }))
vi.mock('@/utils/previewImageStorage', () => ({ PREVIEW_IMAGE_INDEX_KEY: 'preview-index' }))
vi.mock('@/api/groupRetention', () => ({ fetchGroupRetentionStates: vi.fn() }))
import { clearAppCache, clearSessionStorage } from '@/utils/app-cache'

afterEach(() => vi.unstubAllGlobals())
describe('visibility tombstones survive disposable cache clearing', () => {
  it.each([clearAppCache, clearSessionStorage])('preserves per-owner bounds while deleting ordinary cache', (clear) => {
    const remove = vi.fn()
    vi.stubGlobal('uni', { getStorageInfoSync: () => ({ keys: [
      'im:group-retention:v1:owner-a', 'im:group-retention:v1:owner-b', 'ordinary-cache', 'preview-index',
    ] }), removeStorageSync: remove })
    clear()
    expect(remove.mock.calls).toEqual([['ordinary-cache']])
  })
})
