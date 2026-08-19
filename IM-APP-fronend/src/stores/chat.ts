import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { IMEvents, OnlineState, SessionType } from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage, Conversation } from '@/types'
import { recallMessage, resolveIMGroup, resolveIMGroupByIM, resolveIMPeer } from '@/api/im'
import {
  businessUserIdFromIM,
  ensureIMLogin,
  getConversationList,
  getHistoryMessages,
  getOneConversation,
  clearConversationMessages,
  markConversationRead,
  onIMEvent,
  onUserStatusChanged,
  deleteLocalMessage,
  sendAtTextMessage,
  sendCardMessage,
  sendFileMessage,
  sendForwardMessage,
  sendImageMessage,
  sendImageUrlMessage,
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
  resolveMessageSeq,
  resetConversationGroupAtType,
  seqOf,
} from '@/utils/openim'
import { isIMNotification, isGroupAnnouncementNotice, replaceOpenIMAdminLabel } from '@/utils/im-notification'
import { playMessageSound, vibrateShort } from '@/utils/notify'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useContactStore } from '@/stores/contact'
import { MessageReceiveOptType } from 'openim-uniapp-polyfill'
import {
  GroupAtType,
  highlightTagsOf,
  isAtMeType,
  unreadAnnouncementState,
  writeUnreadAnnouncement,
} from '@/utils/group-announcement'

const PAGE_SIZE = 20

/** OnNewRecvMessageRevoked 事件载荷；conversationID 仅 App 原生插件可能携带 */
interface RevokedNotice {
  conversationID?: string
  clientMsgID: string
  revokerID?: string
  revokerNickname?: string
  seq?: number
}

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
  /**
   * 群解散通知 hook：chat-room 页面注册，实时收到 notificationKind === 'dissolved'
   * 时自动 toast + 返回。挂在 store 外避免大 messagesMap 的 reactive watch 触发循环。
   */
  let onIncomingForDissolve: ((m: ChatMessage) => void) | null = null

  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  )

  function rememberRaw(item: MessageItem) {
    if (!item?.clientMsgID) return
    rawMessages.value = { ...rawMessages.value, [item.clientMsgID]: item }
  }

  function announcementOwnerId() {
    return imUserId.value || 'anon'
  }

  function setUnreadAnnouncement(conversationId: string, unread: boolean) {
    if (!conversationId) return
    writeUnreadAnnouncement(announcementOwnerId(), conversationId, unread)
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) return
    patchConversation(conversationId, {
      highlightTags: highlightTagsOf(unread ? conv.groupAtType : GroupAtType.AtNormal, unread),
    })
  }

  function decorateConversation(conv: Conversation): Conversation {
    const stored = unreadAnnouncementState(announcementOwnerId(), conv.id)
    const unread =
      stored === true || (stored !== false && conv.groupAtType === GroupAtType.AtGroupNotice)
    if (stored === undefined && conv.groupAtType === GroupAtType.AtGroupNotice) {
      writeUnreadAnnouncement(announcementOwnerId(), conv.id, true)
    }
    const next = { ...conv, highlightTags: highlightTagsOf(conv.groupAtType, unread) }
    if (next.lastMessage) {
      next.lastMessage = replaceOpenIMAdminLabel(next.lastMessage)
    }
    if (next.type === 'private' && next.peerUserId) {
      const contactStore = useContactStore()
      const bizId = businessUserIdFromIM(next.peerUserId)
      const contact = contactStore.contacts.find((c) => c.id === bizId)
      const remark = contact?.remark?.trim()
      if (remark) next.title = remark
    }
    return next
  }

  function applyContactRemarks() {
    if (!conversations.value.length) return
    conversations.value = conversations.value.map((c) => decorateConversation(c))
  }

  watch(
    () =>
      useContactStore()
        .contacts.map((c) => `${c.id}:${c.remark || ''}`)
        .join('|'),
    () => applyContactRemarks(),
  )

  function appendMessage(item: MessageItem) {
    if (!item?.clientMsgID) return
    rememberRaw(item)
    const message = toChatMessage(item)
    if (!message.conversationId) return
    if (isGroupAnnouncementNotice(item.contentType)) {
      setUnreadAnnouncement(message.conversationId, true)
    }
    // 群解散通知时通知当前房间自动返回；hook 由 room.vue 注册
    if (message.notificationKind === 'dissolved') {
      onIncomingForDissolve?.(message)
    }
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

  /** App 原生 OnConversationChanged 可能推单条对象，H5 WASM 则是数组 */
  function upsertConversations(raw: ConversationItem | ConversationItem[] | null) {
    const items = Array.isArray(raw) ? raw : raw ? [raw] : []
    if (!items.length) return
    const incoming = items.map((item) => decorateConversation(toConversation(item)))
    const merged = [...conversations.value]
    incoming.forEach((conv) => {
      const idx = merged.findIndex((c) => c.id === conv.id)
      if (idx >= 0) merged[idx] = keepNewerPreview(merged[idx], conv)
      else merged.push(conv)
    })
    conversations.value = sortConversations(merged)
  }

  /** SDK 会话预览偶发滞后时，不要把本地刚发出的 [图片] 盖回旧文本 */
  function keepNewerPreview(prev: Conversation, next: Conversation): Conversation {
    const prevTime = new Date(prev.lastMessageAt).getTime() || 0
    const nextTime = new Date(next.lastMessageAt).getTime() || 0
    if (prev.lastMessage && prevTime > nextTime) {
      return { ...next, lastMessage: prev.lastMessage, lastMessageAt: prev.lastMessageAt }
    }
    return next
  }

  function dropRevokedMessage(conversationId: string, clientMsgId: string, tip = '消息已撤回') {
    const list = messagesMap.value[conversationId]
    if (!list) return
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: list.map((m) =>
        m.id === clientMsgId
          ? { ...m, type: 'system' as const, content: tip }
          : m,
      ),
    }
  }

  /**
   * 撤回通知里没有 conversationID（web SDK 的 RevokedInfo 不带该字段），
   * 按 clientMsgID 在已加载的会话里反查；消息没加载过就无需处理。
   */
  function findConversationIdByMsgId(clientMsgId: string): string {
    for (const [conversationId, list] of Object.entries(messagesMap.value)) {
      if (list.some((m) => m.id === clientMsgId)) return conversationId
    }
    return ''
  }

  function subscribeRealtime() {
    unsubscribeRealtime()
    unsubscribers = [
      onIMEvent<MessageItem>(IMEvents.OnRecvNewMessage, ingestIncoming),
      onIMEvent<MessageItem[]>(IMEvents.OnRecvNewMessages, ingestIncoming),
      onIMEvent<ConversationItem[]>(IMEvents.OnConversationChanged, upsertConversations),
      onIMEvent<ConversationItem[]>(IMEvents.OnNewConversation, upsertConversations),
      onIMEvent<RevokedNotice>(
        IMEvents.OnNewRecvMessageRevoked,
        (info) => {
          const conversationId = info.conversationID || findConversationIdByMsgId(info.clientMsgID)
          if (!conversationId) return
          // App 原生插件回调可能带 conversationID，web SDK 不带（RevokedInfo 无此字段）
          const tip =
            info.revokerID && info.revokerID === imUserId.value
              ? '你撤回了一条消息'
              : `${info.revokerNickname || '对方'} 撤回了一条消息`
          dropRevokedMessage(conversationId, info.clientMsgID, tip)
        },
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
      const prevById = new Map(conversations.value.map((c) => [c.id, c]))
      conversations.value = sortConversations(
        list.map((item) => {
          const mapped = decorateConversation(toConversation(item))
          const prev = prevById.get(mapped.id)
          return prev ? keepNewerPreview(prev, mapped) : mapped
        }),
      )
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
    // 群聊禁言（单人/全员）不阻断进入：能进群看历史，只是输入区禁用（房间页按 denyReason 处理）；
    // 私聊的拉黑/非好友/对方注销等 denyReason 仍需阻断。
    const muteOnly = isGroup && (target.denyReason === 'group_muted' || target.denyReason === 'member_muted')
    if (!target.canChat && !muteOnly) throw new Error(target.denyReason || '当前无法发起会话')

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

  async function conversationOf(conversationId: string): Promise<Conversation | undefined> {
    const cached = conversations.value.find((c) => c.id === conversationId)
    if (cached) return cached
    const item = await findConversationById(conversationId).catch(() => undefined)
    if (!item) return undefined
    upsertConversations([item])
    return toConversation(item)
  }

  async function loadMessages(conversationId: string) {
    const existing = messagesMap.value[conversationId] || []
    const { messageList, isEnd } = await getHistoryMessages(conversationId, PAGE_SIZE)
    messageList.forEach(rememberRaw)
    const mapped = messageList.map(toChatMessage)
    // App 历史接口偶发空结果时不要把房间里刚发出的消息整表冲掉
    if (!mapped.length && existing.length) {
      historyEnd.value = { ...historyEnd.value, [conversationId]: false }
      await markAsRead(conversationId)
      return
    }
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: mergeLocalPending(mapped, existing),
    }
    historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
    await markAsRead(conversationId)
  }

  /** 历史还没跟上 SDK 时，保留本地发送中 / 刚发出的图片，避免返回再进入就消失 */
  function mergeLocalPending(history: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
    const historyIds = new Set(history.map((m) => m.id))
    const pending = existing.filter((m) => {
      if (historyIds.has(m.id)) return false
      if (m.status === 'sending' || m.status === 'failed') return true
      if (m.status !== 'sent') return false
      const age = Date.now() - new Date(m.createdAt).getTime()
      return age >= 0 && age < 60_000
    })
    return pending.length ? [...history, ...pending] : history
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

  /** 「不再提示」：清掉会话列表 [有新公告]；若当前不是 @ 强提醒，再清 OpenIM groupAtType */
  async function dismissGroupAnnouncement(conversationId: string) {
    const conv = conversations.value.find((c) => c.id === conversationId)
    writeUnreadAnnouncement(announcementOwnerId(), conversationId, false)
    const keepAt = isAtMeType(conv?.groupAtType) ? conv?.groupAtType : GroupAtType.AtNormal
    patchConversation(conversationId, {
      groupAtType: keepAt,
      highlightTags: highlightTagsOf(keepAt, false),
    })
    if (!isAtMeType(conv?.groupAtType)) {
      await resetConversationGroupAtType(conversationId).catch(() => undefined)
    }
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
      const mapped = toChatMessage(sent)
      replaceMessage(conversationId, placeholder.id, mapped)
      patchConversation(conversationId, {
        lastMessage: previewOf(mapped),
        lastMessageAt: mapped.createdAt,
      })
    } catch (e) {
      replaceMessage(conversationId, placeholder.id, { ...placeholder, status: 'failed' })
      throw new Error((e as Error)?.message || '发送失败')
    }
  }

  function previewOf(message: ChatMessage): string {
    if (message.type === 'image') return '[图片]'
    if (message.type === 'voice') return '[语音]'
    if (message.type === 'file') return '[文件]'
    if (message.type === 'card') return '[名片]'
    return message.content
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

  async function sendAtText(
    conversationId: string,
    content: string,
    senderId: string,
    atUsers: Array<{ atUserID: string; groupNickname: string }>,
  ) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'text', content),
      () => sendAtTextMessage(target, content, atUsers.map((a) => a.atUserID), atUsers),
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

  /** 发送好友名片：占位与气泡渲染共用同一份 content JSON */
  async function sendCard(
    conversationId: string,
    friend: { id: string; nickname: string; avatar?: string },
    senderId: string,
  ) {
    const target = targetOf(requireConversation(conversationId))
    const card = {
      userId: friend.id,
      nickname: friend.nickname || '',
      avatar: friend.avatar || '',
    }
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'card', JSON.stringify(card)),
      () =>
        sendCardMessage(target, {
          businessUserId: friend.id,
          nickname: card.nickname,
          avatar: card.avatar,
        }),
    )
  }

  /** 发送本地文件：占位阶段展示文件名，发送成功后替换为真实消息 */
  async function sendFile(
    conversationId: string,
    filePath: string,
    fileName: string,
    senderId: string,
  ) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'file', fileName),
      () => sendFileMessage(target, filePath, fileName),
    )
  }

  /** 发送已有 URL 的图片（收藏转发场景，不再二次上传） */
  async function sendImageUrl(conversationId: string, url: string, senderId: string) {
    const target = targetOf(requireConversation(conversationId))
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'image', url),
      () => sendImageUrlMessage(target, url),
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

  /**
   * 撤回：统一走后端 POST /im/messages/recall，由服务端校验权限/时间窗并同步 OpenIM。
   * peerId 用业务侧 ID（私聊=对方业务用户 UUID，群聊=数字群 ID）；
   * 调用方已解析过业务 ID 时可通过 peerId 传入，避免群聊再反查一次。
   */
  async function recall(
    conversationId: string,
    messageId: string,
    opts?: { peerId?: string; reason?: string },
  ) {
    const conv = await conversationOf(conversationId)
    if (!conv) throw new Error('会话信息丢失，请返回聊天列表后重试')
    // H5 WASM 发送成功通常已带 seq；App 原生回调经常 seq=0，且历史接口偶发空结果，
    // 不能在这里直接判「不支持撤回」，否则接口根本发不出去。
    const resolved = await resolveMessageSeq(conversationId, messageId, rawMessages.value[messageId])
    const seq = seqOf(resolved.message) || resolved.seq
    if (resolved.message) rememberRaw(resolved.message)
    if (!seq) {
      console.warn('[recall] 本地与最新历史都没拿到 seq，clientMsgID=', messageId)
      throw new Error('该消息暂不可撤回，请稍后重试')
    }
    const peerType = conv.type === 'group' ? ('group' as const) : ('c2c' as const)
    let peerId = opts?.peerId || ''
    if (!peerId) {
      if (peerType === 'c2c') {
        peerId = businessUserIdFromIM(conv.peerUserId || '')
      } else if (conv.groupId) {
        try {
          peerId = (await resolveIMGroupByIM(conv.groupId)).businessGroupId
        } catch {
          // 反查失败留给接口报“消息不存在”，不再额外提示
        }
      }
    }
    if (!peerId) throw new Error('缺少会话对方信息，无法撤回')
    await recallMessage({
      peerType,
      peerId,
      clientMsgId: messageId,
      seq,
      reason: opts?.reason,
    })
    // 管理员撤他人消息时提示要带原发送者，撤自己时提示「你」
    const original = (messagesMap.value[conversationId] || []).find((m) => m.id === messageId)
    const tip =
      original?.senderId === imUserId.value
        ? '你撤回了一条消息'
        : `你撤回了 ${original?.senderNickname || '成员'} 的一条消息`
    dropRevokedMessage(conversationId, messageId, tip)
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

  function setOnIncomingForDissolve(fn: ((m: ChatMessage) => void) | null) {
    onIncomingForDissolve = fn
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
    sendAtText,
    setOnIncomingForDissolve,
    sendImage,
    sendCard,
    sendFile,
    sendImageUrl,
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
    applyContactRemarks,
    dismissGroupAnnouncement,
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
