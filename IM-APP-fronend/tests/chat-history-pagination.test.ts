import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage, Conversation } from '@/types'

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  history: vi.fn(),
  events: new Map<string, (data: unknown) => void>(),
}))

vi.mock('openim-uniapp-polyfill', async () => ({
  ...(await import('../node_modules/openim-uniapp-polyfill/src/types/enum')),
  default: {
    asyncApi: vi.fn(), uuid: () => 'history-test',
    subscribe: (event: string, handler: (data: unknown) => void) => mocks.events.set(event, handler),
    unsubscribe: (event: string) => mocks.events.delete(event),
  },
}))
vi.mock('@/utils/openim', async (original) => ({
  ...(await original<typeof import('@/utils/openim')>()),
  getHistoryMessages: mocks.history,
  markConversationRead: vi.fn(async () => {}),
}))
vi.mock('@/utils/platform', () => ({
  isApp: () => mocks.platform !== 'h5',
  isAndroid: () => mocks.platform === 'android',
  isH5: () => mocks.platform === 'h5',
}))
vi.mock('@/utils/request', () => ({ getToken: () => '' }))
vi.mock('@/api/contact', () => ({ fetchBlacklist: vi.fn(async () => ({ items: [] })) }))
vi.mock('@/stores/contact', () => ({ useContactStore: () => ({ remarkByUserId: {}, remarkOf: () => '' }) }))
vi.mock('@/stores/chatSettings', () => ({ useChatSettingsStore: () => ({ noDisturb: true }) }))
vi.mock('@/utils/notify', () => ({ playMessageSound: vi.fn(), vibrateShort: vi.fn() }))

import { IMEvents } from 'openim-uniapp-polyfill'
import { useChatStore } from '@/stores/chat'
import { groupRetention } from '@/utils/groupRetention'
import { MESSAGE_WINDOW_SIZE } from '@/constants/chat'

const conversationId = 'sg_11111111111141118111111111111111'
let store: ReturnType<typeof useChatStore>

function rawMessage(index: number): MessageItem {
  return {
    clientMsgID: `msg-${index}`, contentType: 101, sessionType: 3,
    sendID: 'peer', recvID: 'me', groupID: conversationId.slice(3),
    sendTime: 1792843200000 + index, textElem: { content: `message ${index}` },
  } as MessageItem
}

function seedHistory(count: number) {
  store.messagesMap[conversationId] = Array.from({ length: count }, (_, index): ChatMessage => ({
    id: `msg-${index}`, conversationId, senderId: 'peer', type: 'text',
    content: `message ${index}`, createdAt: '2026-10-24T12:00:00Z', status: 'sent',
  }))
  store.historyEnd[conversationId] = false
}

function historyPage(start: number, isEnd = false) {
  return { messageList: Array.from({ length: 20 }, (_, i) => rawMessage(start + i)), isEnd }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.events.clear()
  mocks.history.mockReset()
  vi.stubGlobal('uni', { getStorageSync: () => '', setStorageSync: vi.fn() })
  setActivePinia(createPinia())
  groupRetention.setOwner('')
  store = useChatStore()
  store.conversations = [{ id: conversationId, type: 'group', title: 'test', avatar: '',
    lastMessage: '', lastMessageAt: '2026-10-24T12:00:00Z', unreadCount: 0 } as Conversation]
  store.setActiveConversation(conversationId)
})

afterEach(() => {
  store.reset()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(['ios', 'android', 'h5'])('历史持续翻页（%s）', (platform) => {
  beforeEach(() => { mocks.platform = platform })

  it.each([400, 800, 1200])('已有 %i 条消息后仍按最早消息继续翻页', async (count) => {
    seedHistory(count)
    mocks.history.mockResolvedValueOnce(historyPage(-20)).mockResolvedValueOnce(historyPage(-40))
    expect(await store.loadMoreMessages(conversationId)).toBe(true)
    expect(await store.loadMoreMessages(conversationId)).toBe(true)
    expect(mocks.history.mock.calls).toEqual([
      [conversationId, 20, 'msg-0'], [conversationId, 20, 'msg--20'],
    ])
    expect(store.messagesMap[conversationId]).toHaveLength(count + 40)
    expect(store.messagesMap[conversationId][0].id).toBe('msg--40')
    expect(store.messagesMap[conversationId].at(-1)?.id).toBe(`msg-${count - 1}`)
    expect(store.historyEnd[conversationId]).toBe(false)
  })

  it('SDK 返回历史结束后才停止继续请求', async () => {
    seedHistory(800)
    mocks.history.mockResolvedValueOnce(historyPage(-20, true))
    expect(await store.loadMoreMessages(conversationId)).toBe(true)
    expect(await store.loadMoreMessages(conversationId)).toBe(false)
    expect(mocks.history).toHaveBeenCalledTimes(1)
    expect(store.messagesMap[conversationId]).toHaveLength(820)
    expect(store.historyEnd[conversationId]).toBe(true)
  })

  it('翻过 400 条后收到新消息，保留正在看的旧消息及其原始数据', async () => {
    seedHistory(800)
    mocks.history.mockResolvedValueOnce(historyPage(-20))
    await store.loadMoreMessages(conversationId)
    store.subscribeRealtime()
    const raw = rawMessage(800)
    const incoming = platform === 'h5' ? raw : Object.freeze({
      ClientMsgID: raw.clientMsgID, ContentType: 101, SessionType: 3,
      GroupID: raw.groupID, SendID: 'peer', RecvID: 'me', SendTime: raw.sendTime,
      TextElem: Object.freeze({ Content: 'message 800' }),
    })
    mocks.events.get(IMEvents.OnRecvNewMessage)!({ data: incoming })
    expect(store.messagesMap[conversationId]).toHaveLength(821)
    expect(store.messagesMap[conversationId][0].id).toBe('msg--20')
    expect(store.messagesMap[conversationId].at(-1)?.id).toBe('msg-800')
    expect(store.getRawMessage('msg--20')).toBeDefined()
    expect(store.historyEnd[conversationId]).toBe(false)
  })

  it('离开会话后仍可回收内存，返回会话后可以再次翻页', async () => {
    seedHistory(800)
    store.trimConversationMemory(conversationId)
    expect(store.messagesMap[conversationId]).toHaveLength(MESSAGE_WINDOW_SIZE)
    expect(store.historyEnd[conversationId]).toBe(false)
    mocks.history.mockResolvedValueOnce(historyPage(580))
    expect(await store.loadMoreMessages(conversationId)).toBe(true)
    expect(mocks.history).toHaveBeenCalledWith(conversationId, 20, 'msg-600')
    expect(store.messagesMap[conversationId][0].id).toBe('msg-580')
  })
})
