import { APP_CONFIG } from '@/config'
import { request } from '@/utils/request'
import type { ChatMessage, Conversation, MessageType } from '@/types'
import {
  mockFetchConversations,
  mockFetchMessages,
  mockMarkAllRead,
  mockSendMessage,
  mockSubscribeChat,
} from '@/mock/handlers/chat'

export async function fetchConversations(): Promise<Conversation[]> {
  if (APP_CONFIG.useMock) {
    return mockFetchConversations()
  }
  return request<Conversation[]>({ url: '/conversations', method: 'GET' })
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  if (APP_CONFIG.useMock) {
    return mockFetchMessages(conversationId)
  }
  return request<ChatMessage[]>({
    url: `/conversations/${conversationId}/messages`,
    method: 'GET',
  })
}

export async function sendMessage(
  conversationId: string,
  type: MessageType,
  content: string,
): Promise<ChatMessage> {
  if (APP_CONFIG.useMock) {
    return mockSendMessage(conversationId, type, content)
  }
  return request<ChatMessage>({
    url: `/conversations/${conversationId}/messages`,
    method: 'POST',
    data: { type, content },
  })
}

export async function markAllRead() {
  if (APP_CONFIG.useMock) {
    return mockMarkAllRead()
  }
  return request<{ ok: boolean }>({ url: '/conversations/read-all', method: 'POST' })
}

export function subscribeChatMessages(handler: (msg: ChatMessage) => void): () => void {
  if (APP_CONFIG.useMock) {
    return mockSubscribeChat(handler)
  }
  // 真实 WS 由 stores/chat 通过 wsClient 订阅
  return () => undefined
}
