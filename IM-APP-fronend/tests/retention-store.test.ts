import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Conversation } from '@/types'

const mocks = vi.hoisted(() => ({
  events: new Map<string, (value: unknown) => void>(),
  fetch: vi.fn(),
  asyncApi: vi.fn(),
  play: vi.fn(),
  send: vi.fn(),
  resolveSeq: vi.fn(),
  clearHistory: vi.fn(),
}))
vi.mock('@/utils/openim', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/openim')>()),
  sendTextMessage: mocks.send,
  resolveMessageSeq: mocks.resolveSeq,
  clearConversationMessages: mocks.clearHistory,
}))
vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: {
    asyncApi: mocks.asyncApi,
    uuid: () => 'retention-test',
    subscribe: (event: string, callback: (value: unknown) => void) => mocks.events.set(event, callback),
    unsubscribe: (event: string) => mocks.events.delete(event),
  },
}))
vi.mock('@/utils/platform', () => ({ isApp: () => true, isH5: () => false, isAndroid: () => false }))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/api/groupRetention', () => ({ fetchGroupRetentionStates: mocks.fetch }))
vi.mock('@/api/contact', () => ({ fetchBlacklist: vi.fn(async () => ({ items: [] })) }))
vi.mock('@/stores/contact', () => ({ useContactStore: () => ({ remarkByUserId: {}, remarkOf: () => '', ensureRemarkIndex: async () => {} }) }))
vi.mock('@/stores/chatSettings', () => ({ useChatSettingsStore: () => ({ noDisturb: false, sound: true, vibration: false }) }))
vi.mock('@/utils/notify', () => ({ playMessageSound: mocks.play, vibrateShort: vi.fn() }))

import { IMEvents } from 'openim-uniapp-polyfill'
import { groupRetention } from '@/utils/groupRetention'
import { imUserId } from '@/utils/openim'
import { useChatStore } from '@/stores/chat'

const a = 'sg_11111111111141118111111111111111'
const b = 'sg_22222222222242228222222222222222'
const direct = 'si_owner_peer'
function conversation(id: string, latest = 99): Conversation {
  return { id, type: id.startsWith('sg_') ? 'group' : 'private', title: 'test', avatar: '',
    lastMessage: 'old preview', lastMessageAt: '2026-10-18T00:00:00Z', lastMessageSeq: latest, unreadCount: 99, highlightTags: ['[有人@我]'], groupAtType: 1 }
}
function nativeMessage(id: string, seq: number, clientMsgID: string) {
  return Object.freeze({ ClientMsgID: clientMsgID, ContentType: 101, SessionType: id.startsWith('sg_') ? 3 : 1,
    GroupID: id.startsWith('sg_') ? id.slice(3) : '', SendID: 'peer', RecvID: 'owner', Seq: String(seq), SendTime: 1792281600000,
    TextElem: Object.freeze({ Content: `message ${seq}` }) })
}
// Send wrappers normalize clientMsgID before returning to the store; keep the
// other frozen PascalCase fields to exercise native-safe mapping as well.
function sendReply(id: string, seq: number, clientMsgID: string) {
  return Object.freeze({ ...nativeMessage(id, seq, clientMsgID), clientMsgID })
}

let store: ReturnType<typeof useChatStore>
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.resolveSeq.mockResolvedValue({ seq: 0 })
  mocks.events.clear()
  vi.stubGlobal('uni', { getStorageSync: () => undefined, setStorageSync: vi.fn() })
  setActivePinia(createPinia())
  groupRetention.setOwner('')
  groupRetention.setOwner('retention-store-owner')
  imUserId.value = 'owner'
  mocks.fetch.mockResolvedValue({ items: [{ conversationId: a, minVisibleSeq: 100, revision: 1, updatedAt: '2026-10-18T00:00:00Z' }] })
  store = useChatStore()
  store.conversations = [conversation(a), conversation(b), conversation(direct)]
  store.subscribeRealtime()
})
afterEach(() => {
  store.reset()
  groupRetention.setOwner('')
  imUserId.value = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('real Pinia chat store + frozen native SDK events + durable retention', () => {
  it('prunes only the applied group and prevents expired events from resurrecting messages or notifications', async () => {
    const receive = mocks.events.get(IMEvents.OnRecvNewMessage)!
    receive({ data: nativeMessage(a, 99, 'old-a') })
    receive({ data: nativeMessage(b, 99, 'old-b') })
    receive({ data: nativeMessage(direct, 99, 'old-direct') })
    expect(store.getRawMessage('old-a')).toBeDefined()
    await groupRetention.sync([a])
    expect(store.messagesMap[a]).toEqual([])
    expect(store.messagesMap[b]).toHaveLength(1)
    expect(store.messagesMap[direct]).toHaveLength(1)
    expect(store.getRawMessage('old-a')).toBeUndefined()
    expect(store.getRawMessage('old-b')).toBeDefined()
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({ lastMessage: '', unreadCount: 0, groupAtType: 0, highlightTags: [] })
    mocks.play.mockClear()
    receive({ data: nativeMessage(a, 99, 'late-old-a') })
    expect(store.messagesMap[a]).toEqual([])
    expect(mocks.play).not.toHaveBeenCalled()
    receive({ data: nativeMessage(a, 100, 'new-a') })
    expect(store.messagesMap[a].map((m) => m.id)).toEqual(['new-a'])
    expect(mocks.play).toHaveBeenCalledTimes(1)
  })

  it('updates unread prefixes without clearing retained messages, unsubscribes and cancels polling', async () => {
    store.conversations = [conversation(a, 105)]
    await groupRetention.sync([a])
    expect(store.conversations[0].unreadCount).toBe(6)
    expect(store.conversations[0].lastMessage).toBe('old preview')
    store.unsubscribeRealtime()
    expect(mocks.events.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    mocks.fetch.mockResolvedValue({ items: [{ conversationId: a, minVisibleSeq: 200, revision: 2, updatedAt: '2026-10-18T00:01:00Z' }] })
    await groupRetention.sync([a], true)
    expect(store.conversations[0].unreadCount).toBe(6)
  })

  it('does not retain an expired preview seq after a new successful native send', async () => {
    await groupRetention.sync([a])
    mocks.send.mockResolvedValue(sendReply(a, 105, 'sent-new'))
    await store.sendText(a, 'new message', 'owner')
    await groupRetention.sync([a], true)
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({
      lastMessage: 'message 105', lastMessageSeq: 105, lastMessageId: 'sent-new',
    })
  })

  it('fences delayed seq resolution to its own preview and prunes expired native ACKs', async () => {
    await groupRetention.sync([a])
    let finishFirst!: (value: { seq: number }) => void
    let finishSecond!: (value: { seq: number }) => void
    mocks.resolveSeq.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
    mocks.send.mockResolvedValueOnce(sendReply(a, 0, 'first'))
      .mockResolvedValueOnce(sendReply(a, 0, 'second'))
    await store.sendText(a, 'first', 'owner')
    await store.sendText(a, 'second', 'owner')
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({ lastMessageId: 'second', lastMessageSeq: undefined })
    finishFirst({ seq: 99 })
    await Promise.resolve()
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({ lastMessageId: 'second', lastMessage: 'message 0', lastMessageSeq: undefined })
    expect(store.messagesMap[a].some((m) => m.id === 'first')).toBe(false)
    expect(store.getRawMessage('first')).toBeUndefined()
    finishSecond({ seq: 106 })
    await Promise.resolve()
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({ lastMessageId: 'second', lastMessageSeq: 106 })
    expect(store.getRawMessage('second')).toMatchObject({ seq: 106 })
    mocks.send.mockResolvedValueOnce(sendReply(a, 0, 'expired'))
    mocks.resolveSeq.mockResolvedValueOnce({ seq: 98 })
    await store.sendText(a, 'expired', 'owner')
    await Promise.resolve()
    expect(store.conversations.find((c) => c.id === a)?.lastMessage).toBe('')
    expect(store.getRawMessage('expired')).toBeUndefined()
  })

  it('keeps preview identity and seq together when a stale SDK conversation snapshot arrives', async () => {
    await groupRetention.sync([a])
    mocks.send.mockResolvedValue(sendReply(a, 105, 'local-latest'))
    await store.sendText(a, 'latest', 'owner')
    const receive = mocks.events.get(IMEvents.OnConversationChanged)!
    receive({ data: Object.freeze({ ConversationID: a, ConversationType: 3, ShowName: 'group',
      LatestMsg: JSON.stringify(nativeMessage(a, 99, 'sdk-old')), LatestMsgSendTime: 1000 }) })
    expect(store.conversations.find((c) => c.id === a)).toMatchObject({
      lastMessage: 'message 105', lastMessageSeq: 105, lastMessageId: 'local-latest',
    })
  })

  it('clears preview seq and identity when manually clearing history', async () => {
    await store.clearHistory(a)
    expect(mocks.clearHistory).toHaveBeenCalledWith(a)
    const cleared = store.conversations.find((c) => c.id === a)!
    expect(cleared.lastMessage).toBe('')
    expect(cleared.lastMessageSeq).toBeUndefined()
    expect(cleared.lastMessageId).toBeUndefined()
  })

  it('does not resurrect a cleared message through native delayed seq resolution', async () => {
    let finish!: (value: { seq: number; message: unknown }) => void
    mocks.resolveSeq.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    mocks.send.mockResolvedValue(sendReply(a, 0, 'cleared-pending'))
    await store.sendText(a, 'pending', 'owner')
    expect(store.getRawMessage('cleared-pending')).toBeDefined()
    await store.clearHistory(a)
    finish({ seq: 105, message: sendReply(a, 105, 'cleared-pending') })
    await Promise.resolve()
    expect(store.messagesMap[a]).toEqual([])
    expect(store.getRawMessage('cleared-pending')).toBeUndefined()
    expect(store.conversations.find((c) => c.id === a)?.lastMessage).toBe('')
  })

  it('does not insert a previous account send completion after reset', async () => {
    let finish!: (value: unknown) => void
    mocks.send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = expect(store.sendText(a, 'old owner', 'owner')).rejects.toThrow('登录状态已变化')
    store.reset()
    store.conversations = [conversation(a)]
    finish(sendReply(a, 105, 'previous-owner'))
    await pending
    expect(store.messagesMap).toEqual({})
    expect(store.getRawMessage('previous-owner')).toBeUndefined()
    expect(store.conversations[0].lastMessage).toBe('old preview')
  })

  it('does not insert a previous account seq callback into the next account', async () => {
    let finish!: (value: { seq: number; message: unknown }) => void
    mocks.resolveSeq.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    mocks.send.mockResolvedValue(sendReply(a, 0, 'old-owner-seq'))
    await store.sendText(a, 'old owner', 'owner')
    store.reset()
    store.conversations = [conversation(a)]
    finish({ seq: 105, message: sendReply(a, 105, 'old-owner-seq') })
    await Promise.resolve()
    expect(store.messagesMap).toEqual({})
    expect(store.getRawMessage('old-owner-seq')).toBeUndefined()
    expect(store.conversations[0].lastMessage).toBe('old preview')
  })
})
