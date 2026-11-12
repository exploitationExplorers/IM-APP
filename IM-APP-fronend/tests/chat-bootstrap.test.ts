import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  ensureLogin: vi.fn(),
  conversations: vi.fn(),
  events: new Map<string, (data: unknown) => void>(),
  pendingError: new Error('聊天记录正在同步，完成后会自动刷新'),
}))

vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: {
    asyncApi: vi.fn(async () => []), uuid: () => 'bootstrap-test',
    subscribe: (event: string, handler: (data: unknown) => void) => mocks.events.set(event, handler),
    unsubscribe: (event: string) => mocks.events.delete(event),
  },
}))
vi.mock('@/utils/openim', async (original) => ({
  ...(await original<typeof import('@/utils/openim')>()),
  ensureIMLogin: mocks.ensureLogin,
  getConversationList: mocks.conversations,
  isIMSyncPendingError: (error: unknown) => error === mocks.pendingError,
  subscribeUsersStatus: vi.fn(async () => []),
  getSubscribeUsersStatus: vi.fn(async () => []),
}))
vi.mock('@/utils/platform', () => ({ isApp: () => true, isAndroid: () => false }))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/api/contact', () => ({ fetchBlacklist: vi.fn(async () => ({ items: [] })) }))
vi.mock('@/api/group', () => ({ fetchPendingJoinRequestGroups: vi.fn(async () => []) }))
vi.mock('@/stores/contact', () => ({ useContactStore: () => ({
  remarkByUserId: {}, remarkOf: () => '', ensureRemarkIndex: async () => {},
}) }))

import { IMEvents } from 'openim-uniapp-polyfill'
import { useChatStore } from '@/stores/chat'
import { groupRetention } from '@/utils/groupRetention'

let store: ReturnType<typeof useChatStore>
const nativeConversation = Object.freeze({
  ConversationID: 'si_me_peer', ConversationType: 1, UserID: 'peer',
  ShowName: '好友', LatestMsg: '', LatestMsgSendTime: 1792843200000,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.events.clear()
  mocks.ensureLogin.mockResolvedValue('me')
  mocks.conversations.mockReset()
  vi.stubGlobal('uni', { getStorageSync: () => '', setStorageSync: vi.fn() })
  setActivePinia(createPinia())
  groupRetention.setOwner('')
  store = useChatStore()
})

afterEach(() => {
  store.reset()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('大账号聊天首屏同步', () => {
  it('同步完成事件丢失时也会自动重读，成功后停止重试', async () => {
    mocks.conversations.mockRejectedValueOnce(mocks.pendingError).mockResolvedValueOnce([nativeConversation])
    await expect(store.loadConversations()).rejects.toBe(mocks.pendingError)
    expect(store.loading).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.conversations.map((item) => item.id)).toEqual(['si_me_peer'])
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.conversations).toHaveBeenCalledTimes(2)
    expect(mocks.ensureLogin).toHaveBeenCalledTimes(2)
  })

  it('同步完成事件到来后立刻读列表，不必等下一次重试', async () => {
    mocks.conversations.mockRejectedValueOnce(mocks.pendingError).mockResolvedValueOnce([nativeConversation])
    await expect(store.loadConversations()).rejects.toBe(mocks.pendingError)
    mocks.events.get(IMEvents.OnSyncServerFinish)!({})
    await vi.advanceTimersByTimeAsync(0)
    expect(store.conversations).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.conversations).toHaveBeenCalledTimes(2)
  })

  it('登录预热和下拉刷新并发时只发出一次会话读取', async () => {
    let finish!: (items: unknown[]) => void
    mocks.conversations.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = store.loadConversations()
    const second = store.loadConversations()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.conversations).toHaveBeenCalledOnce()
    finish([nativeConversation])
    await Promise.all([first, second])
    expect(store.conversations).toHaveLength(1)
  })

  it('退出账号后取消自动重试', async () => {
    mocks.conversations.mockRejectedValue(mocks.pendingError)
    await expect(store.loadConversations()).rejects.toBe(mocks.pendingError)
    store.reset()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.conversations).toHaveBeenCalledOnce()
    expect(store.conversations).toEqual([])
  })

  it('旧账号迟到的读取不能覆盖新账号会话', async () => {
    let finishOld!: (items: unknown[]) => void
    mocks.conversations.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    const old = store.loadConversations()
    await vi.advanceTimersByTimeAsync(0)
    store.reset()
    mocks.conversations.mockResolvedValueOnce([nativeConversation])
    await store.loadConversations()
    finishOld([{ ...nativeConversation, ConversationID: 'si_old_peer' }])
    await old
    expect(store.conversations.map((item) => item.id)).toEqual(['si_me_peer'])
  })

  it('实际错误保留错误态，不反复读取或显示成无消息', async () => {
    mocks.conversations.mockRejectedValue(new Error('database failure'))
    await expect(store.loadConversations()).rejects.toThrow('database failure')
    expect(store.conversationLoadError).toBe('database failure')
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.conversations).toHaveBeenCalledOnce()
  })
})
