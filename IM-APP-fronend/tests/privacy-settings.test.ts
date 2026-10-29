import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivacySettings } from '@/types'

vi.mock('@/api/user', () => ({
  fetchPrivacySettings: vi.fn(),
  updatePrivacySettings: vi.fn(),
}))

import { fetchPrivacySettings, updatePrivacySettings } from '@/api/user'
import { usePrivacySettings } from '@/composables/usePrivacySettings'

const enabled: PrivacySettings = { requireFriendApproval: true, requireGroupApproval: true }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchPrivacySettings).mockResolvedValue({ ...enabled })
  vi.mocked(updatePrivacySettings).mockImplementation(async (value) => ({ ...value }))
})

describe('隐私设置加载和保存', () => {
  it('加载前不可写，不能把界面默认值覆盖到真实设置', async () => {
    const state = usePrivacySettings()
    expect(state.settings.value).toEqual(enabled)
    expect(await state.save('requireFriendApproval', false)).toBe(false)
    expect(updatePrivacySettings).not.toHaveBeenCalled()
    await state.load()
    expect(state.disabled.value).toBe(false)
  })

  it('尊重服务端明确关闭的选项，保存另一项不会将其误开启', async () => {
    vi.mocked(fetchPrivacySettings).mockResolvedValue({ requireFriendApproval: false, requireGroupApproval: false })
    const state = usePrivacySettings()
    await state.load()
    await state.save('requireGroupApproval', true)
    expect(updatePrivacySettings).toHaveBeenCalledWith({ requireFriendApproval: false, requireGroupApproval: true })
  })

  it('加载失败时保持禁用，可再次加载恢复', async () => {
    vi.mocked(fetchPrivacySettings).mockRejectedValueOnce(new Error('offline'))
    const state = usePrivacySettings()
    await expect(state.load()).rejects.toThrow('offline')
    expect(state.disabled.value).toBe(true)
    await state.save('requireFriendApproval', false)
    expect(updatePrivacySettings).not.toHaveBeenCalled()
    await state.load()
    expect(state.disabled.value).toBe(false)
  })

  it('并发点击不产生未保存的第二个开关值，保存失败回滚', async () => {
    let rejectSave!: (reason: Error) => void
    vi.mocked(updatePrivacySettings).mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject }))
    const state = usePrivacySettings()
    await state.load()
    const firstSave = state.save('requireFriendApproval', false)
    expect(state.disabled.value).toBe(true)
    expect(await state.save('requireGroupApproval', false)).toBe(false)
    expect(state.settings.value.requireGroupApproval).toBe(true)
    rejectSave(new Error('save failed'))
    await expect(firstSave).rejects.toThrow('save failed')
    expect(state.settings.value).toEqual(enabled)
    expect(state.disabled.value).toBe(false)
    expect(updatePrivacySettings).toHaveBeenCalledTimes(1)
  })

  it('重新进入时读取后台批量调整后的设置', async () => {
    const state = usePrivacySettings()
    await state.load()
    await state.save('requireFriendApproval', false)
    await state.load()
    expect(state.settings.value).toEqual(enabled)
  })
})
