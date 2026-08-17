import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { IMEvents, OnlineState, SessionType } from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage, Conversation } from '@/types'
import { resolveIMGroup, resolveIMPeer } from '@/api/im'
import {
  ensureIMLogin,
  getConversationList,
  getHistoryMessages,
  getOneConversation,
  clearConversationMessages,
  markConversationRead,
  onIMEvent,
  onUserStatusChanged,
  deleteLocalMessage,
  revokeMessage,
  sendForwardMessage,
  sendImageMessage,
  sendQuoteMessage,
  sendTextMessage,
  sendVoiceMessage,
  subscribeUsersStatus,
  unsubscribeUsersStatus,
  getSubscribeUsersStatus,
  targetOf,
  toChatMessage,
  toConversation,
  conversationIdOf,
  imUserId,
} from '@/utils/openim'
import { isIMNotification } from '@/utils/im-notification'
import { playMessageSound, vibrateShort } from '@/utils/notify'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { MessageReceiveOptType } from 'openim-uniapp-polyfill'

const PAGE_SIZE = 20

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  /** OpenIM 原始消息，引用 / 转发需要完整 MessageItem */
  const rawMessages = ref<Record<string, MessageItem>>({})
  const loading = ref(false)
  /** 会话是否已翻到最早一条 */
  const historyEnd = ref<Record<string, boolean>>({})
  /** OpenIM userID → 在线状态（0=离线 1=在线） */
  const onlineStatus = ref<Record<string, OnlineState>>({})
  /** 当前已订阅在线状态的用户 ID 集合 */
  const subscribedUserIDs = ref<Set<string>>(new Set())
  let unsubscribers: Array<() => void> = []

  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  )

  function rememberRaw(item: MessageItem) {
    if (!item?.clientMsgID) return
    rawMessages.value = { ...rawMessages.value, [item.clientMsgID]: item }
  }

  function appendMessage(item: MessageItem) {
    if (!item?.clientMsgID) return
    rememberRaw(item)
    const message = toChatMessage(item)
    if (!message.conversationId) return
    const list = messagesMap.value[message.conversationId] || []
    if (list.some((m) => m.id === message.id)) return
    messagesMap.value = {
      ...messagesMap.value,
      [message.conversationId]: [...list, message],
    }
  }

  /** SDK 有时推单条，有时推数组；解析失败时不能让监听器抛错把后续消息吃掉 */
  function ingestIncoming(raw: MessageItem | MessageItem[] | null) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    if (!list.length) return
    list.forEach(appendMessage)
    // 收到消息后统一尝试提示音：一批消息只响一次
    maybeNotifyIncoming(list)
  }

  /**
   * 收到他人消息时播放提示音并震动。规则：
   * - 自己发的消息不响；
   * - 全局「消息免打扰」开启时不响；
   * - 全局「声音」关闭时不响；
   * - 会话级 recvMsgOpt 为 NotReceive(1)/NotNotify(2)（免打扰）时不响。
   * 私聊与群聊一视同仁，满足「不管群聊还是私聊收到消息都要提示音」。
   */
  function maybeNotifyIncoming(list: MessageItem[]) {
    const settings = useChatSettingsStore()
    if (settings.noDisturb || !settings.sound) return
    const audible = list.some((item) => {
      if (item.sendID === imUserId.value) return false
      // 群禁言/改资料等 OpenIM 通知：参考站只在聊天里出系统提示，不响铃
      if (isIMNotification(item.contentType)) return false
      const conv = conversations.value.find((c) => c.id === conversationIdOf(item))
      const opt = conv?.recvMsgOpt
      if (opt === MessageReceiveOptType.NotReceive || opt === MessageReceiveOptType.NotNotify) {
        return false
      }
      return true
    })
    if (!audible) return
    playMessageSound()
    if (settings.vibration) vibrateShort()
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
      onIMEvent<MessageItem>(IMEvents.OnRecvNewMessage, ingestIncoming),
      onIMEvent<MessageItem[]>(IMEvents.OnRecvNewMessages, ingestIncoming),
      onIMEvent<ConversationItem[]>(IMEvents.OnConversationChanged, upsertConversations),
      onIMEvent<ConversationItem[]>(IMEvents.OnNewConversation, upsertConversations),
      onIMEvent<{ conversationID: string; clientMsgID: string }>(
        IMEvents.OnNewRecvMessageRevoked,
        (info) => dropRevokedMessage(info.conversationID, info.clientMsgID),
      ),
      onUserStatusChanged((state) => {
        console.log('[online] 状态变更事件:', state)
        onlineStatus.value[state.userID] = state.status
      }),
    ]
  }

  function unsubscribeRealtime() {
    unsubscribers.forEach((off) => off())
    unsubscribers = []
  }

  async function loadConversations() {
    console.log('[chat] loadConversations start')
    loading.value = true
    try {
      await ensureIMLogin()
      subscribeRealtime()
      const list = await getConversationList()
      console.log('[chat] getConversationList count:', list.length)
      conversations.value = sortConversations(list.map(toConversation))
      console.log('[chat] conversations mapped, will refresh online status')
      refreshOnlineStatus().catch((e) => console.warn('[chat] 刷新在线状态失败', e))
    } finally {
      loading.value = false
    }
  }

  // 兜底：会话列表变化时（包括 HMR/热更新后）自动刷新在线状态订阅
  watch(
    () => conversations.value.map((c) => c.peerUserId).filter(Boolean),
    () => {
      console.log('[chat] conversations changed, refresh online status')
      refreshOnlineStatus().catch((e) => console.warn('[chat] 刷新在线状态失败', e))
    },
    { immediate: true, deep: true },
  )

  /**
   * 订阅所有私聊对方的在线状态，并查询一次当前状态。
   * 会话变化时自动 diff：新增订阅、移除不再需要的订阅。
   */
  async function refreshOnlineStatus() {
    const userIDs = [
      ...new Set(
        conversations.value
          .filter((c) => c.type === 'private' && c.peerUserId)
          .map((c) => c.peerUserId!),
      ),
    ]
    console.log('[online] 私聊会话 peerUserIds:', userIDs)
    if (!userIDs.length && !subscribedUserIDs.value.size) return

    // 退订已不在列表中的用户
    const toUnsubscribe = [...subscribedUserIDs.value].filter((id) => !userIDs.includes(id))
    if (toUnsubscribe.length) {
      await unsubscribeUsersStatus(toUnsubscribe).catch(() => {})
      toUnsubscribe.forEach((id) => subscribedUserIDs.value.delete(id))
    }

    // 订阅新增用户
    const toSubscribe = userIDs.filter((id) => !subscribedUserIDs.value.has(id))
    if (toSubscribe.length) {
      console.log('[online] 订阅用户:', toSubscribe)
      const states = await subscribeUsersStatus(toSubscribe).catch((e) => {
        console.warn('[online] subscribeUsersStatus 失败:', e)
        return [] as { userID: string; status: OnlineState }[]
      })
      console.log('[online] 订阅返回:', states)
      states.forEach((s) => {
        onlineStatus.value[s.userID] = s.status
      })
      toSubscribe.forEach((id) => subscribedUserIDs.value.add(id))
    }

    // 再查询一次所有已订阅用户的最新状态，补齐事件推送可能漏掉的状态
    const allStates = await getSubscribeUsersStatus().catch((e) => {
      console.warn('[online] getSubscribeUsersStatus 失败:', e)
      return [] as { userID: string; status: OnlineState }[]
    })
    console.log('[online] 查询全部状态:', allStates)
    allStates.forEach((s) => {
      onlineStatus.value[s.userID] = s.status
    })
  }

  /** 判断某个 OpenIM 用户是否在线 */
  function isPeerOnline(userID: string): boolean {
    return userID ? onlineStatus.value[userID] === OnlineState.Online : false
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
    subscribeRealtime()

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
    const item = await getGroupOrPeerConversation(sourceId, isGroup)
    upsertConversations([item])
    return toConversation(item)
  }

  async function getGroupOrPeerConversation(sourceId: string, isGroup: boolean) {
    const sessionType = isGroup ? SessionType.Group : SessionType.Single
    try {
      return await getOneConversation(sourceId, sessionType)
    } catch (e) {
      const msg = (e as Error).message || ''
      if (isGroup && msg.includes('10006')) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        try {
          return await getOneConversation(sourceId, sessionType)
        } catch {
          throw new Error('群聊暂不可用，请稍后重试')
        }
      }
      throw e
    }
  }

  async function findConversationById(conversationId: string) {
    const list = await getConversationList()
    return list.find((c) => c.conversationID === conversationId)
  }

  async function loadMessages(conversationId: string) {
    const { messageList, isEnd } = await getHistoryMessages(conversationId, PAGE_SIZE)
    messageList.forEach(rememberRaw)
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
    messageList.forEach(rememberRaw)
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: [...messageList.map(toChatMessage), ...list],
    }
    return true
  }

  /** 已读是副作用，标记失败不该挡住会话展示；未读数下次拉列表会自愈 */
  async function markAsRead(conversationId: string) {
    try {
      await markConversationRead(conversationId)
    } catch (e) {
      console.warn('[chat] 标记已读失败', e)
    }
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (conv) conv.unreadCount = 0
  }

  function requireConversation(conversationId: string): Conversation {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) throw new Error('会话不存在')
    return conv
  }

  async function clearHistory(conversationId: string) {
    await clearConversationMessages(conversationId)
    const ids = (messagesMap.value[conversationId] || []).map((m) => m.id)
    messagesMap.value = { ...messagesMap.value, [conversationId]: [] }
    historyEnd.value = { ...historyEnd.value, [conversationId]: true }
    if (ids.length) {
      const nextRaw = { ...rawMessages.value }
      ids.forEach((id) => {
        delete nextRaw[id]
      })
      rawMessages.value = nextRaw
    }
    patchConversation(conversationId, { lastMessage: '', lastMessageAt: '' })
  }

  /** 局部更新本地会话（如置顶、会话级免打扰），命中才重排，保证 UI 即时反映 */
  function patchConversation(conversationId: string, patch: Partial<Conversation>) {
    const idx = conversations.value.findIndex((c) => c.id === conversationId)
    if (idx < 0) return
    const copy = [...conversations.value]
    copy[idx] = { ...copy[idx], ...patch }
    conversations.value = sortConversations(copy)
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
      rememberRaw(sent)
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

  async function sendQuote(conversationId: string, text: string, quoteMessageId: string, senderId: string) {
    const quote = rawMessages.value[quoteMessageId]
    if (!quote) throw new Error('原消息不存在')
    const target = targetOf(requireConversation(conversationId))
    const placeholder = placeholderOf(conversationId, senderId, 'text', text)
    placeholder.quote = {
      senderNickname: quote.senderNickname || '',
      content: toChatMessage(quote).content || '[消息]',
    }
    await sendWithPlaceholder(conversationId, placeholder, () => sendQuoteMessage(target, text, quote))
  }

  async function removeLocal(conversationId: string, messageId: string) {
    await deleteLocalMessage(conversationId, messageId).catch(() => undefined)
    const list = messagesMap.value[conversationId] || []
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: list.filter((m) => m.id !== messageId),
    }
    const nextRaw = { ...rawMessages.value }
    delete nextRaw[messageId]
    rawMessages.value = nextRaw
  }

  async function removeLocalMany(conversationId: string, messageIds: string[]) {
    for (const id of messageIds) {
      await removeLocal(conversationId, id)
    }
  }

  async function forwardToConversation(targetConversationId: string, messageIds: string[]) {
    const target = targetOf(requireConversation(targetConversationId))
    for (const id of messageIds) {
      const raw = rawMessages.value[id]
      if (!raw) throw new Error('原消息不存在')
      await sendForwardMessage(target, raw)
    }
  }

  function getRawMessage(messageId: string): MessageItem | undefined {
    return rawMessages.value[messageId]
  }

  async function markAllAsRead() {
    await Promise.all(conversations.value.map((c) => markAsRead(c.id)))
    conversations.value = conversations.value.map((c) => ({ ...c, unreadCount: 0 }))
  }

  function reset() {
    unsubscribeRealtime()
    conversations.value = []
    messagesMap.value = {}
    rawMessages.value = {}
    historyEnd.value = {}
    onlineStatus.value = {}
    subscribedUserIDs.value.clear()
  }

  return {
    conversations,
    messagesMap,
    loading,
    historyEnd,
    totalUnread,
    onlineStatus,
    isPeerOnline,
    loadConversations,
    enterConversation,
    loadMessages,
    loadMoreMessages,
    markAsRead,
    sendText,
    sendImage,
    sendVoice,
    sendQuote,
    recall,
    removeLocal,
    removeLocalMany,
    forwardToConversation,
    getRawMessage,
    markAllAsRead,
    subscribeRealtime,
    unsubscribeRealtime,
    patchConversation,
    clearHistory,
    reset,
  }
})

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  })
}
