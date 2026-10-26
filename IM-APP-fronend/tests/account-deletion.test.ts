import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountDeletion } from '@/composables/useAccountDeletion'

const mocks = vi.hoisted(() => ({ requirements: vi.fn(), deleteAccount: vi.fn(), modal: vi.fn() }))
vi.mock('@/api/auth', () => ({ fetchAccountDeletionRequirements: mocks.requirements }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ deleteAccount: mocks.deleteAccount }) }))

describe('账号注销', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirements.mockResolvedValue({ canDelete: true, ownedGroupCount: 0 })
    mocks.deleteAccount.mockResolvedValue(undefined)
    mocks.modal.mockImplementation(options => options.success({ confirm: true }))
    vi.stubGlobal('uni', { showModal: mocks.modal })
  })

  it('只有检查通过、输入密码且明确勾选后才能提交', async () => {
    const state = useAccountDeletion()
    state.password.value = 'test-password'
    state.acknowledged.value = true
    expect(state.canSubmit.value).toBe(false)
    await state.load()
    expect(state.canSubmit.value).toBe(true)
    state.acknowledged.value = false
    await state.submit()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it.each([
    { canDelete: false, ownedGroupCount: 2 },
    { canDelete: true, ownedGroupCount: -1 },
    { canDelete: true, ownedGroupCount: 2 },
  ])('群主或无效的检查结果无法注销：%o', async result => {
    mocks.requirements.mockResolvedValue(result)
    const state = useAccountDeletion()
    state.password.value = 'password'
    state.acknowledged.value = true
    await state.load()
    expect(state.canSubmit.value).toBe(false)
    await state.submit()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('弹窗期间锁定重复点击，确认后只请求一次并清空密码', async () => {
    let confirm: (result: { confirm: boolean }) => void = () => undefined
    mocks.modal.mockImplementation(options => { confirm = options.success })
    const state = useAccountDeletion()
    await state.load()
    state.password.value = 'password'
    state.acknowledged.value = true
    const pending = state.submit()
    await state.submit()
    expect(mocks.modal).toHaveBeenCalledTimes(1)
    confirm({ confirm: true })
    await pending
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.deleteAccount).toHaveBeenCalledWith('password')
    expect(state.password.value).toBe('')
    expect(state.deleting.value).toBe(false)
  })

  it('取消时不注销，服务器失败时保留错误并清空密码', async () => {
    const state = useAccountDeletion()
    await state.load()
    state.acknowledged.value = true
    state.password.value = 'password'
    mocks.modal.mockImplementation(options => options.success({ confirm: false }))
    await state.submit()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    state.password.value = 'password'
    mocks.modal.mockImplementation(options => options.success({ confirm: true }))
    mocks.deleteAccount.mockRejectedValue(new Error('登录密码错误'))
    await state.submit()
    expect(state.error.value).toBe('登录密码错误')
    expect(state.password.value).toBe('')
  })
})
