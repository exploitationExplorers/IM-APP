import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { IMEvents, SessionType } from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage, Conversation } from '@/types'
import { resolveIMGroup, resolveIMPeer } from '@/api/im'
import {
  ensureIMLogin,
  getConversationList,
  getHistoryMessages,
  getOneConversation,
  markConversationRead,
  onIMEvent,
  revokeMessage,
  sendImageMessage,
  sendTextMessage,
  sendVoiceMessage,
  targetOf,
  toChatMessage,
  toConversation,
} from '@/utils/openim'

const PAGE_SIZE = 20

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const loading = ref(false)
  /** 会话是否已翻到最早一条 */
  const historyEnd = ref<Record<string, boolean>>({})
  let unsubscribers: Array<() => void> = []

  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  )

  function appendMessage(item: MessageItem) {
    const message = toChatMessage(item)
    const list = messagesMap.value[message.conversationId] || []
    if (list.some((m) => m.id === message.id)) return
    messagesMap.value = {
      ...messagesMap.value,
      [message.conversationId]: [...list, message],
    }
  }

  function upsertConversations(items: ConversationItem[]) {
    const incoming = items.map(toConversation)
    const merged = [...conversations.value]
    incoming.forEach((conv) => {
      const idx = merged.findIndex((c) => c.id === conv.id)
      if (idx >= 0) merged[idx] = conv
      else merged.push(conv)
    })
    conversations.value = sortConversations(merged)
  }

  function dropRevokedMessage(conversationId: string, clientMsgId: string) {
    const list = messagesMap.value[conversationId]
    if (!list) return
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: list.map((m) =>
        m.id === clientMsgId
          ? { ...m, type: 'system' as const, content: '消息已撤回' }
          : m,
      ),
    }
  }

  function subscribeRealtime() {
    unsubscribeRealtime()
    unsubscribers = [
      onIMEvent<MessageItem>(IMEvents.OnRecvNewMessage, appendMessage),
      onIMEvent<MessageItem[]>(IMEvents.OnRecvNewMessages, (list) => list.forEach(appendMessage)),
      onIMEvent<ConversationItem[]>(IMEvents.OnConversationChanged, upsertConversations),
      onIMEvent<ConversationItem[]>(IMEvents.OnNewConversation, upsertConversations),
      onIMEvent<{ conversationID: string; clientMsgID: string }>(
        IMEvents.OnNewRecvMessageRevoked,
        (info) => dropRevokedMessage(info.conversationID, info.clientMsgID),
      ),
    ]
  }

  function unsubscribeRealtime() {
    unsubscribers.forEach((off) => off())
    unsubscribers = []
  }

  async function loadConversations() {
    loading.value = true
    try {
      await ensureIMLogin()
      subscribeRealtime()
      conversations.value = sortConversations((await getConversationList()).map(toConversation))
    } finally {
      loading.value = false
    }
  }

  /**
   * 进入会话。列表点进来时已有 OpenIM 会话 ID；
   * 从通讯录或群资料点进来只有业务 ID，需要先向后端换取 OpenIM ID 并做可聊天预检。
   */
  async function enterConversation(params: {
    conversationId?: string
    type: 'private' | 'group'
    businessId?: string
  }): Promise<Conversation> {
    await ensureIMLogin()

    const cached = params.conversationId
      ? conversations.value.find((c) => c.id === params.conversationId)
      : undefined
    if (cached) return cached

    if (params.conversationId) {
      const item = await findConversationById(params.conversationId)
      if (item) {
        upsertConversations([item])
        return toConversation(item)
      }
    }

    if (!params.businessId) throw new Error('缺少会话目标')

    const isGroup = params.type === 'group'
    const target = isGroup
      ? await resolveIMGroup(params.businessId)
      : await resolveIMPeer(params.businessId)
    if (!target.canChat) throw new Error(target.denyReason || '当前无法发起会话')

    const sourceId = isGroup
      ? (target as { imGroupId: string }).imGroupId
      : (target as { imUserId: string }).imUserId
    const item = await getOneConversation(
      sourceId,
      isGroup ? SessionType.Group : SessionType.Single,
    )
    upsertConversations([item])
    return toConversation(item)
  }

  async function findConversationById(conversationId: string) {
    const list = await getConversationList()
    return list.find((c) => c.conversationID === conversationId)
  }

  async function loadMessages(conversationId: string) {
    const { messageList, isEnd } = await getHistoryMessages(conversationId, PAGE_SIZE)
    messagesMap.value = { ...messagesMap.value, [conversationId]: messageList.map(toChatMessage) }
    historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
    await markAsRead(conversationId)
  }

  /** 上滑加载更早的消息，返回本次是否有新增 */
  async function loadMoreMessages(conversationId: string): Promise<boolean> {
    if (historyEnd.value[conversationId]) return false
    const list = messagesMap.value[conversationId] || []
    if (!list.length) return false
    const { messageList, isEnd } = await getHistoryMessages(
      conversationId,
      PAGE_SIZE,
      list[0].id,
    )
    historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
    if (!messageList.length) return false
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: [...messageList.map(toChatMessage), ...list],
    }
    return true
  }

  async function markAsRead(conversationId: string) {
    await markConversationRead(conversationId)
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) conv.unreadCount = 0
  }

  function requireConversation(conversationId: string): Conversation {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) throw new Error('会话不存在')
    return conv
  }

  /** 发送前先占位，SDK 返回后用真实消息替换，失败则标红 */
  async function sendWithPlaceholder(
    conversationId: string,
    placeholder: ChatMessage,
    send: () => Promise<MessageItem>,
  ) {
    const list = messagesMap.value[conversationId] || []
    messagesMap.value = { ...messagesMap.value, [conversationId]: [...list, placeholder] }
    try {
      const sent = await send()
      replaceMessage(conversationId, placeholder.id, toChatMessage(sent))
    } catch (e) {
      replaceMessage(conversationId, placeholder.id, { ...placeholder, status: 'failed' })
      throw new Error((e as Error)?.message || '发送失败')
    }
  }

  function replaceMessage(conversationId: string, tempId: string, message: ChatMessage) {
    const list = messagesMap.value[conversationId] || []
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: list.map((m) => (m.id === tempId ? message : m)),
    }
  }

  function placeholderOf(
    conversationId: string,
    senderId: string,
    type: ChatMessage['type'],
    content: string,
  ): ChatMessage {
    return {
      id: `local_${Date.now()}`,
      conversationId,
      senderId,
      type,
      content,
      createdAt: new Date().toISOString(),
      status: 'sending',
    }
  }

  async function sendText(conversationId: string, content: string, senderId: string) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'text', content),
      () => sendTextMessage(target, content),
    )
  }

  async function sendImage(conversationId: string, filePath: string, senderId: string) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'image', filePath),
      () => sendImageMessage(target, filePath),
    )
  }

  async function sendVoice(
    conversationId: string,
    path: string,
    duration: number,
    senderId: string,
  ) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'voice', JSON.stringify({ path, duration })),
      () => sendVoiceMessage(target, path, duration),
    )
  }

  /** 撤回权限由 OpenIM 与后端判定，这里只负责发起和本地回显 */
  async function recall(conversationId: string, messageId: string) {
    await revokeMessage(conversationId, messageId)
    dropRevokedMessage(conversationId, messageId)
  }

  async function markAllAsRead() {
    await Promise.all(conversations.value.map((c) => markConversationRead(c.id)))
    conversations.value = conversations.value.map((c) => ({ ...c, unreadCount: 0 }))
  }

  function reset() {
    unsubscribeRealtime()
    conversations.value = []
    messagesMap.value = {}
    historyEnd.value = {}
  }

  return {
    conversations,
    messagesMap,
    loading,
    historyEnd,
    totalUnread,
    loadConversations,
    enterConversation,
    loadMessages,
    loadMoreMessages,
    markAsRead,
    sendText,
    sendImage,
    sendVoice,
    recall,
    markAllAsRead,
    unsubscribeRealtime,
    reset,
  }
})

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  })
}
