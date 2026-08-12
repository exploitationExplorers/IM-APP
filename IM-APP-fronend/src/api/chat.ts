import { request } from '@/utils/request'
import type { ChatMessage, Conversation, MessageType } from '@/types'

export async function fetchConversations(): Promise<Conversation[]> {
  return request<Conversation[]>({ url: '/conversations', method: 'GET' })
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
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
  return request<ChatMessage>({
    url: `/conversations/${conversationId}/messages`,
    method: 'POST',
    data: { type, content },
  })
}

export async function markAllRead() {
  return request<{ ok: boolean }>({ url: '/conversations/read-all', method: 'POST' })
}
