import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChatMessage, Conversation } from '@/types'
import {
  fetchConversations,
  fetchMessages,
  markAllRead,
  sendMessage as apiSendMessage,
  subscribeChatMessages,
} from '@/api/chat'
import { wsClient } from '@/utils/websocket'
import { APP_CONFIG } from '@/config'

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const loading = ref(false)
  let unsubMock: (() => void) | null = null
  let unsubWs: (() => void) | null = null

  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  )

  function handleIncomingMessage(msg: ChatMessage) {
    const convId = msg.conversationId
    const list = messagesMap.value[convId] || []
    if (!list.some((m) => m.id === msg.id)) {
      messagesMap.value = { ...messagesMap.value, [convId]: [...list, msg] }
    }
    const conv = conversations.value.find((c) => c.id === convId)
    if (conv) {
      conv.lastMessage = msg.type === 'text' ? msg.content : `[${msg.type}]`
      conv.lastMessageAt = msg.createdAt
    }
  }

  function subscribeRealtime() {
    unsubscribeRealtime()
    if (APP_CONFIG.useMock) {
      unsubMock = subscribeChatMessages(handleIncomingMessage)
    } else {
      const handler = (data: unknown) => handleIncomingMessage(data as ChatMessage)
      unsubWs = wsClient.on('chat.message', handler)
    }
  }

  function unsubscribeRealtime() {
    unsubMock?.()
    unsubWs?.()
    unsubMock = null
    unsubWs = null
  }

  async function loadConversations() {
    loading.value = true
    try {
      conversations.value = await fetchConversations()
      subscribeRealtime()
      syncTabBadge()
    } finally {
      loading.value = false
    }
  }

  async function loadMessages(conversationId: string) {
    const list = await fetchMessages(conversationId)
    messagesMap.value = { ...messagesMap.value, [conversationId]: list }
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) {
      conv.unreadCount = 0
      syncTabBadge()
    }
  }

  async function sendText(conversationId: string, content: string, senderId: string) {
    const temp: ChatMessage = {
      id: `local_${Date.now()}`,
      conversationId,
      senderId,
      type: 'text',
      content,
      createdAt: new Date().toISOString(),
      status: 'sending',
    }
    const list = messagesMap.value[conversationId] || []
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: [...list, temp],
    }

    try {
      const saved = await apiSendMessage(conversationId, 'text', content)
      const next = (messagesMap.value[conversationId] || []).map((m) =>
        m.id === temp.id ? { ...saved, status: 'sent' as const } : m,
      )
      messagesMap.value = { ...messagesMap.value, [conversationId]: next }
      const conv = conversations.value.find((c) => c.id === conversationId)
      if (conv) {
        conv.lastMessage = content
        conv.lastMessageAt = saved.createdAt
      }
    } catch {
      const next = (messagesMap.value[conversationId] || []).map((m) =>
        m.id === temp.id ? { ...m, status: 'failed' as const } : m,
      )
      messagesMap.value = { ...messagesMap.value, [conversationId]: next }
      throw new Error('发送失败')
    }
  }

  async function markAllAsRead() {
    await markAllRead()
    conversations.value = conversations.value.map((c) => ({ ...c, unreadCount: 0 }))
    syncTabBadge()
  }

  function syncTabBadge() {
    // 自定义底栏 ImTabBar 直接读 totalUnread，系统 tabBar 已隐藏
  }

  return {
    conversations,
    messagesMap,
    loading,
    totalUnread,
    loadConversations,
    loadMessages,
    sendText,
    markAllAsRead,
    syncTabBadge,
    unsubscribeRealtime,
  }
})
