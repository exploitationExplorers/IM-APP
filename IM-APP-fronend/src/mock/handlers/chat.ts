import type { ChatMessage, Conversation, MessageType } from '@/types'
import {
  delay,
  genId,
  getMockState,
  mutateMockState,
  resolveCurrentUserId,
} from '../store'
import { mockWs } from '../ws'

export async function mockFetchConversations(): Promise<Conversation[]> {
  await delay()
  const uid = resolveCurrentUserId()
  const s = getMockState()
  const list = s.conversations.filter((c) => {
    const members = s.convMembers[c.id]
    return members?.includes(uid)
  })
  return JSON.parse(JSON.stringify(list)) as Conversation[]
}

export async function mockFetchMessages(conversationId: string): Promise<ChatMessage[]> {
  await delay()
  const uid = resolveCurrentUserId()
  const s = getMockState()
  const members = s.convMembers[conversationId]
  if (!members?.includes(uid)) throw new Error('无权访问会话')
  mutateMockState((st) => {
    const conv = st.conversations.find((c) => c.id === conversationId)
    if (conv) conv.unreadCount = 0
  })
  return JSON.parse(JSON.stringify(s.messages[conversationId] || [])) as ChatMessage[]
}

export async function mockSendMessage(
  conversationId: string,
  type: MessageType,
  content: string,
): Promise<ChatMessage> {
  await delay(200)
  const uid = resolveCurrentUserId()
  const msg: ChatMessage = {
    id: genId('m'),
    conversationId,
    senderId: uid,
    type,
    content,
    createdAt: new Date().toISOString(),
  }
  mutateMockState((s) => {
    const members = s.convMembers[conversationId]
    if (!members?.includes(uid)) throw new Error('无权访问会话')
    if (!s.messages[conversationId]) s.messages[conversationId] = []
    s.messages[conversationId].push(msg)
    const conv = s.conversations.find((c) => c.id === conversationId)
    if (conv) {
      conv.lastMessage = type === 'text' ? content : `[${type}]`
      conv.lastMessageAt = msg.createdAt
    }
  })
  setTimeout(() => mockWs.emit('chat.message', msg), 50)
  return JSON.parse(JSON.stringify(msg)) as ChatMessage
}

export async function mockMarkAllRead() {
  await delay(100)
  mutateMockState((s) => {
    s.conversations.forEach((c) => {
      c.unreadCount = 0
    })
  })
  return { ok: true }
}

export function mockSubscribeChat(handler: (msg: ChatMessage) => void) {
  mockWs.on('chat.message', handler as (data: unknown) => void)
  return () => mockWs.off('chat.message', handler as (data: unknown) => void)
}
