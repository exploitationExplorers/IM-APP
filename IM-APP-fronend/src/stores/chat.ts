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
  hideConversation,
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
  setConversationPin,
  invalidateIMLoginCache,
  waitForSync,
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

/**
 * OnRecvC2CReadReceipt 事件载荷：对方读了「我发的」私聊消息。
 * 回执不带 conversationID，按 clientMsgID（全局唯一）反查已加载会话。
 */
interface C2CReadReceipt {
  userID?: string
  msgIDList?: string[]
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

  /**
   * OpenIM hideConversation 在 H5 WASM 不可用；用本地隐藏列表兜底。
   * 必须全平台落盘：H5 的 uniPlatform 可能是 web 而非 h5，仅判断 h5 会导致不写存储，刷新后全回来。
   */
  const HIDDEN_KEY_PREFIX = 'chat:hidden-conversations:'
  function hiddenStorageKey() {
    return `${HIDDEN_KEY_PREFIX}${imUserId.value || 'anon'}`
  }
  function normalizeHiddenIdList(raw: unknown): string[] {
    const fromArr = (arr: unknown[]) =>
      arr.filter((id): id is string => typeof id === 'string' && !!id)
    if (Array.isArray(raw)) return fromArr(raw)
    if (typeof raw !== 'string' || !raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return fromArr(parsed)
      if (typeof parsed === 'string') {
        const nested: unknown = JSON.parse(parsed)
        if (Array.isArray(nested)) return fromArr(nested)
      }
    } catch {
      /* 忽略损坏数据 */
    }
    return []
  }
  function readHiddenIds(): Set<string> {
    try {
      return new Set(normalizeHiddenIdList(uni.getStorageSync(hiddenStorageKey())))
    } catch {
      return new Set()
    }
  }
  function writeHiddenIds(ids: Set<string>) {
    try {
      uni.setStorageSync(hiddenStorageKey(), Array.from(ids))
    } catch {
      /* 忽略 */
    }
  }
  const hiddenIds = readHiddenIds()

  function syncHiddenIdsFromStorage() {
    const stored = readHiddenIds()
    hiddenIds.clear()
    stored.forEach((id) => hiddenIds.add(id))
  }

  function unhideConversation(conversationId: string) {
    if (!conversationId || !hiddenIds.has(conversationId)) return
    hiddenIds.delete(conversationId)
    writeHiddenIds(hiddenIds)
  }

  watch(imUserId, () => {
    syncHiddenIdsFromStorage()
    if (conversations.value.length) {
      conversations.value = conversations.value.filter((c) => !hiddenIds.has(c.id))
    }
  })

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
    // 已移除的会话：仅普通新消息才取消隐藏；解散/系统通知保持隐藏，避免 H5 刷新又刷回来
    if (hiddenIds.has(message.conversationId)) {
      if (message.notificationKind === 'dissolved' || isIMNotification(item.contentType)) {
        return
      }
      unhideConversation(message.conversationId)
      void conversationOf(message.conversationId).catch(() => undefined)
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
    const incoming = items
      .map((item) => decorateConversation(toConversation(item)))
      .filter((conv) => !hiddenIds.has(conv.id))
    if (!incoming.length) return
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

  /** SDK 有时推单条，有时推数组；解析失败时不能让监听器抛错 */
  function ingestReadReceipts(raw: C2CReadReceipt | C2CReadReceipt[] | null) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    const ids = new Set<string>()
    list.forEach((r) => {
      ;(r?.msgIDList || []).forEach((id) => {
        if (id) ids.add(id)
      })
    })
    if (!ids.size) return
    markLoadedMessagesRead(ids)
  }

  /**
   * 把已读回执落到已加载的消息上，房间内实时把「未读」翻成「已读」。
   * clientMsgID 全局唯一，直接扫所有已加载会话按 ID 命中；未加载的消息无需处理，
   * 下次拉历史时 SDK 本地库的 isRead 会带出已读状态。
   */
  function markLoadedMessagesRead(ids: Set<string>) {
    const next: Record<string, ChatMessage[]> = {}
    let changed = false
    for (const [conversationId, list] of Object.entries(messagesMap.value)) {
      if (!list.some((m) => ids.has(m.id) && !m.hasRead)) continue
      next[conversationId] = list.map((m) => (ids.has(m.id) ? { ...m, hasRead: true } : m))
      changed = true
    }
    if (changed) messagesMap.value = { ...messagesMap.value, ...next }
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
      // 私聊已读回执：对方进入会话标记已读后，把自己发过的消息翻成已读
      onIMEvent<C2CReadReceipt[]>(IMEvents.OnRecvC2CReadReceipt, ingestReadReceipts),
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
      syncHiddenIdsFromStorage()
      subscribeRealtime()
      let list
      try {
        list = await getConversationList()
      } catch (e) {
        const msg = (e as Error)?.message || ''
        if (msg.includes('10004') || msg.includes('10005')) {
          invalidateIMLoginCache()
          await ensureIMLogin()
          syncHiddenIdsFromStorage()
          await waitForSync(5000)
          list = await getConversationList()
        } else {
          throw e
        }
      }
      console.log('[chat] getConversationList count:', list.length)
      const prevById = new Map(conversations.value.map((c) => [c.id, c]))
      conversations.value = sortConversations(
        list
          .filter((item) => {
            const id = (item as { conversationID?: string }).conversationID || ''
            return !hiddenIds.has(id)
          })
          .map((item) => {
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

    if (params.conversationId) {
      unhideConversation(params.conversationId)
    }

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
    // 私聊被对方拉黑也不阻断进入：能进聊天看历史，发送消息时 OpenIM BeforeSingle 会拦截并标失败感叹号；
    // 其余 denyReason（非好友/对方注销等）仍需阻断。
    const muteOnly = isGroup && (target.denyReason === 'group_muted' || target.denyReason === 'member_muted')
    const blockedByPeer = target.denyReason === 'blocked'
    if (!target.canChat && !muteOnly && !blockedByPeer) throw new Error(target.denyReason || '当前无法发起会话')

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
    // 已读回执先于历史快照落在本地的（H5 缓存偶发滞后），不要回退成未读
    const readIds = new Set(existing.filter((m) => m.hasRead).map((m) => m.id))
    const withRead = readIds.size
      ? mapped.map((m) => (m.hasRead || !readIds.has(m.id) ? m : { ...m, hasRead: true }))
      : mapped
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: mergeLocalPending(withRead, existing),
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

  /**
   * 切换会话置顶状态。OpenIM 云同步，多端一致。
   * 乐观更新：先 patchConversation 翻转 pinned 字段，失败时回滚。
   */
  async function togglePin(conversationId: string) {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) return
    const next = !conv.pinned
    // 乐观更新：先翻本地值，失败再回滚
    patchConversation(conversationId, { pinned: next })
    try {
      await setConversationPin(conversationId, next)
    } catch (e) {
      patchConversation(conversationId, { pinned: !next })
      throw new Error((e as Error)?.message || '置顶失败')
    }
  }

  /**
   * 从聊天列表移除（本地隐藏）。SDK 不会再推送该会话，
   * 直到有新消息触发 OnNewConversation / OnConversationChanged。
   * 失败回滚：重新拉回会话（conversationOf 内部会通过 upsertConversations 重新插入 + 排序）。
   * H5 平台 SDK 不支持 hideConversation，用本地持久化列表（hiddenIds）保证
   * 刷新/重连后仍生效；收到新消息时再出现。
   */
  async function hideConversationLocal(conversationId: string) {
    conversations.value = conversations.value.filter((c) => c.id !== conversationId)
    hiddenIds.add(conversationId)
    writeHiddenIds(hiddenIds)
    try {
      await hideConversation(conversationId)
    } catch (e) {
      // H5 不支持 hide 时 openim 已吞错；若真失败且已从列表移除，仍保留本地隐藏，避免回滚又出现
      console.warn('[chat] hideConversation 调用失败，已保留本地隐藏', conversationId, e)
    }
  }

  /** 局部更新本地会话（如置顶、会话级免打扰），命中才重排，保证 UI 即时反映 */
  function patchConversation(conversationId: string, patch: Partial<Conversation>) {
    const idx = conversations.value.findIndex((c) => c.id === conversationId)
    if (idx < 0) return
    const copy = [...conversations.value]
    copy[idx] = { ...copy[idx], ...patch }
    conversations.value = sortConversations(copy)
  }

  /**
   * 让一个被隐藏的会话重新出现在列表顶部。
   * - 自己给已隐藏会话主动发消息时触发；
   * - 从 hiddenIds 移除 + 从 SDK 重新拉取会话信息（conversationOf 内部走 upsertConversations 插入列表）。
   * - 失败回滚：hiddenIds 重新加入。
   */
  async function reappearConversation(conversationId: string) {
    if (!hiddenIds.has(conversationId)) return
    unhideConversation(conversationId)
    try {
      await conversationOf(conversationId)
    } catch (e) {
      hiddenIds.add(conversationId)
      writeHiddenIds(hiddenIds)
      throw e
    }
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
      // 自己给已隐藏的会话主动发消息时，让该会话重新出现在列表顶部
      await reappearConversation(conversationId)
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
    const failedMessageIds: string[] = []
    for (const id of messageIds) {
      try {
        const raw = rawMessages.value[id]
        if (!raw) throw new Error('原消息不存在')
        await sendForwardMessage(target, raw)
      } catch {
        // 单条失败不能阻断同批次后续消息；调用方统一展示汇总结果。
        failedMessageIds.push(id)
      }
    }
    return { total: messageIds.length, failedMessageIds }
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
    togglePin,
    hideConversationLocal,
    reappearConversation,
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
