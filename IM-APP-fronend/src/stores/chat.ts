import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { IMEvents, MessageType, OnlineState, SessionType } from 'openim-uniapp-polyfill'
import type { ConversationItem, MessageItem } from 'openim-uniapp-polyfill'
import type { ChatMessage, Conversation, ConversationPinnedMessage } from '@/types'
import { fetchBlacklist } from '@/api/contact'
import { recallMessage, resolveIMGroup, resolveIMGroupByIM, resolveIMPeer } from '@/api/im'
import {
  businessUserIdFromIM,
  peerIdFromSingleConversation,
  sameBusinessUserId,
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
  sendVideoMessage,
  sendVoiceMessage,
  subscribeUsersStatus,
  unsubscribeUsersStatus,
  getSubscribeUsersStatus,
  targetOf,
  toChatMessage,
  toConversation,
  conversationIdOf,
  coerceMessage,
  imUserId,
  resolveMessageSeq,
  resetConversationGroupAtType,
  seqOf,
  setConversationPin,
  setConversationPinnedMessage,
  sendMessagePinSync,
  messagePinPayloadOf,
  invalidateIMLoginCache,
  waitForSync,
  isNotInGroupIMError,
} from '@/utils/openim'
import { quoteSummaryOf, quoteThumbOf } from '@/utils/format'
import { mergeVideoContent } from '@/utils/chatMedia'
import { groupRetention } from '@/utils/groupRetention'
import {
  isIMNotification,
  isGroupAnnouncementNotice,
  isGroupUnavailableError,
  replaceOpenIMAdminLabel,
} from '@/utils/im-notification'
import { playMessageSound, vibrateShort } from '@/utils/notify'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useContactStore } from '@/stores/contact'
import { MessageReceiveOptType } from 'openim-uniapp-polyfill'
import {
  effectiveGroupAtType,
  GroupAtType,
  highlightTagsOf,
  isAtMeType,
  unreadAnnouncementState,
  writeUnreadAnnouncement,
} from '@/utils/group-announcement'
import { perfMarkEnd, perfMarkStart } from '@/utils/perf'
import {
  CHAT_HISTORY_PAGE_SIZE as PAGE_SIZE,
  MESSAGE_WINDOW_SIZE,
  RAW_MESSAGE_WINDOW_SIZE,
} from '@/constants/chat'

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
  /** 退群 / 被踢 / OpenIM 无权限时通知当前房间退出 */
  let onGroupUnavailable: ((payload: { conversationId: string }) => void) | null = null
  /**
   * 当前打开的会话 ID，由 room.vue 登记。
   *
   * 桌面端（H5 三栏布局）room.vue 是内嵌组件而非页面，页面级 onShow/onHide 不会触发，
   * 所以「回到前台补拉当前会话」这件事只能由 store 代劳——room.vue 在这里报备自己是谁。
   */
  let activeConversationId = ''
  let sessionGeneration = 0
  let retentionTimer: ReturnType<typeof setTimeout> | undefined

  function sanitizeRetentionPreview(conv: Conversation): Conversation {
    const latest = { seq: conv.lastMessageSeq }
    if (groupRetention.removed(conv.id, latest))
      return { ...conv, lastMessage: '', lastMessageAt: '', unreadCount: 0, groupAtType: 0, highlightTags: [] }
    const unreadCount = groupRetention.unread(conv.id, latest, conv.unreadCount)
    return unreadCount === conv.unreadCount ? conv : { ...conv, unreadCount }
  }

  function pruneRetainedHistory(ids: string[]) {
    for (const id of ids) {
      const old = messagesMap.value[id]
      if (old) messagesMap.value = { ...messagesMap.value, [id]: groupRetention.filter(id, old) }
    }
    const next = { ...rawMessages.value }
    for (const [key, raw] of Object.entries(next)) {
      if (groupRetention.removed(conversationIdOf(raw), raw)) delete next[key]
    }
    rawMessages.value = next
    conversations.value = conversations.value.map(sanitizeRetentionPreview)
  }

  function scheduleRetentionSync() {
    if (retentionTimer !== undefined) return
    retentionTimer = setTimeout(async () => {
      retentionTimer = undefined
      if (!unsubscribers.length || !imUserId.value) return
      await groupRetention.sync(conversations.value.map((c) => c.id))
      if (unsubscribers.length) scheduleRetentionSync()
    }, 30_000)
  }

  /**
   * OpenIM hideConversation 在 H5 WASM 不可用；用本地隐藏列表兜底。
   * 必须全平台落盘：H5 的 uniPlatform 可能是 web 而非 h5，仅判断 h5 会导致不写存储，刷新后全回来。
   */
  const HIDDEN_KEY_PREFIX = 'chat:hidden-conversations:'
  const EXITED_GROUP_KEY_PREFIX = 'chat:exited-group-conversations:'
  /** 我拉黑的对方业务用户 key（去横线小写），用于会话列表永久剔除 */
  const BLOCKED_PEER_KEY_PREFIX = 'chat:blocked-peers:'
  function hiddenStorageKey() {
    return `${HIDDEN_KEY_PREFIX}${imUserId.value || 'anon'}`
  }
  function exitedGroupStorageKey() {
    return `${EXITED_GROUP_KEY_PREFIX}${imUserId.value || 'anon'}`
  }
  function blockedPeerStorageKey() {
    return `${BLOCKED_PEER_KEY_PREFIX}${imUserId.value || 'anon'}`
  }
  function normalizePeerKey(id: string) {
    const biz = businessUserIdFromIM(id) || id
    return biz.replace(/-/g, '').toLowerCase()
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

  function readBlockedPeerKeys(): Set<string> {
    try {
      return new Set(normalizeHiddenIdList(uni.getStorageSync(blockedPeerStorageKey())))
    } catch {
      return new Set()
    }
  }
  function writeBlockedPeerKeys(ids: Set<string>) {
    try {
      uni.setStorageSync(blockedPeerStorageKey(), Array.from(ids))
    } catch {
      /* 忽略 */
    }
  }
  const blockedPeerKeys = readBlockedPeerKeys()

  function isBlockedPeer(peerUserId?: string) {
    if (!peerUserId) return false
    return blockedPeerKeys.has(normalizePeerKey(peerUserId))
  }

  function markPeerBlocked(contactId: string) {
    if (!contactId) return
    blockedPeerKeys.add(normalizePeerKey(contactId))
    writeBlockedPeerKeys(blockedPeerKeys)
  }

  function markPeerUnblocked(contactId: string) {
    if (!contactId) return
    blockedPeerKeys.delete(normalizePeerKey(contactId))
    writeBlockedPeerKeys(blockedPeerKeys)
  }

  function readExitedGroupIds(): Set<string> {
    try {
      return new Set(normalizeHiddenIdList(uni.getStorageSync(exitedGroupStorageKey())))
    } catch {
      return new Set()
    }
  }

  function writeExitedGroupIds(ids: Set<string>) {
    try {
      uni.setStorageSync(exitedGroupStorageKey(), Array.from(ids))
    } catch {
      /* 忽略 */
    }
  }

  const exitedGroupIds = readExitedGroupIds()

  function syncHiddenIdsFromStorage() {
    const stored = readHiddenIds()
    hiddenIds.clear()
    stored.forEach((id) => hiddenIds.add(id))
  }

  function syncExitedGroupIdsFromStorage() {
    const stored = readExitedGroupIds()
    exitedGroupIds.clear()
    stored.forEach((id) => exitedGroupIds.add(id))
  }

  function syncBlockedPeerKeysFromStorage() {
    const stored = readBlockedPeerKeys()
    blockedPeerKeys.clear()
    stored.forEach((id) => blockedPeerKeys.add(id))
  }

  function unhideConversation(conversationId: string) {
    if (!conversationId || !hiddenIds.has(conversationId)) return
    const conv = conversations.value.find((c) => c.id === conversationId)
    const peer =
      conv?.peerUserId || peerIdFromSingleConversation(conversationId, imUserId.value)
    // 拉黑对象的会话即使本地曾隐藏，也不因进房/新消息自动取消隐藏
    if (peer && isBlockedPeer(peer)) return
    hiddenIds.delete(conversationId)
    writeHiddenIds(hiddenIds)
  }

  function shouldShowConversation(conv: Conversation) {
    if (hiddenIds.has(conv.id) || exitedGroupIds.has(conv.id)) return false
    if (conv.type === 'private' && isBlockedPeer(conv.peerUserId)) return false
    return true
  }

  /** 按业务好友 ID 把对应私聊从列表隐藏（拉黑 / 删好友共用） */
  async function hidePrivateConversationByContactId(contactId: string) {
    if (!contactId) return
    const match = conversations.value.find(
      (c) => c.type === 'private' && sameBusinessUserId(c.peerUserId || '', contactId),
    )
    if (match) {
      await hideConversationLocal(match.id)
      return
    }
    conversations.value = conversations.value.filter(
      (c) => !(c.type === 'private' && sameBusinessUserId(c.peerUserId || '', contactId)),
    )
  }

  /** 拉黑后立刻从聊天列表移除该私聊，并记入本地黑名单 peer 集合 */
  async function hideConversationForBlockedContact(contactId: string) {
    if (!contactId) return
    markPeerBlocked(contactId)
    await hidePrivateConversationByContactId(contactId)
  }

  /** 删除好友后会话仍会留在 OpenIM 列表；本地立刻隐藏，避免「删了人聊天还在」 */
  async function hideConversationForDeletedContact(contactId: string) {
    await hidePrivateConversationByContactId(contactId)
  }

  /** 解除拉黑：允许会话再次出现（有新消息或主动打开时） */
  function restoreConversationAfterUnblock(contactId: string) {
    markPeerUnblocked(contactId)
  }

  /**
   * 用服务端黑名单对齐本地 peer 集合，供会话列表过滤（不是黑名单页滚动加载）。
   * 服务端 limit 上限就是 100；传 500 会被压回 100，还会让人误以为一次拉半千。
   * 并发去重：进聊天页 + 登录后常会同时触发 loadConversations，避免打两遍。
   */
  let blockedSyncInFlight: Promise<void> | null = null
  async function syncBlockedPeersFromServer() {
    if (blockedSyncInFlight) return blockedSyncInFlight
    blockedSyncInFlight = (async () => {
      try {
        // 后端 ListBlockedUsers：limit>100 一律按 100
        const res = await fetchBlacklist({ limit: 100 })
        blockedPeerKeys.clear()
        for (const u of res.items || []) {
          if (u?.id) blockedPeerKeys.add(normalizePeerKey(u.id))
        }
        writeBlockedPeerKeys(blockedPeerKeys)
        if (conversations.value.length && blockedPeerKeys.size) {
          conversations.value = conversations.value.filter(shouldShowConversation)
        }
      } catch {
        /* 黑名单接口失败不挡会话列表 */
      }
    })().finally(() => {
      blockedSyncInFlight = null
    })
    return blockedSyncInFlight
  }

  watch(imUserId, () => {
    syncHiddenIdsFromStorage()
    syncExitedGroupIdsFromStorage()
    syncBlockedPeerKeysFromStorage()
    if (conversations.value.length) {
      conversations.value = conversations.value.filter(shouldShowConversation)
    }
  })

  /** 底部/侧栏总未读：免打扰会话（recvMsgOpt=1/2）不计入，避免红点继续提示 */
  const totalUnread = computed(() =>
    conversations.value.reduce((sum, c) => {
      const opt = c.recvMsgOpt
      if (opt === MessageReceiveOptType.NotReceive || opt === MessageReceiveOptType.NotNotify) {
        return sum
      }
      return sum + (c.unreadCount || 0)
    }, 0),
  )

  function rememberRaw(item: MessageItem) {
    if (!item?.clientMsgID) return
    if (groupRetention.removed(conversationIdOf(item), item)) return
    rawMessages.value = { ...rawMessages.value, [item.clientMsgID]: item }
    // 当前会话的历史仍可继续翻阅、引用和转发，原始消息随会话退出时统一回收。
    if (conversationIdOf(item) !== activeConversationId) {
      trimRawMessagesWindow(conversationIdOf(item))
    }
  }

  /** 裁剪单会话 rawMessages，避免无界增长 */
  function trimRawMessagesWindow(conversationId: string) {
    if (!conversationId) return
    const list = messagesMap.value[conversationId] || []
    if (list.length <= RAW_MESSAGE_WINDOW_SIZE) return
    const keepIds = new Set(list.slice(-RAW_MESSAGE_WINDOW_SIZE).map((m) => m.id))
    const nextRaw = { ...rawMessages.value }
    let changed = false
    for (const id of Object.keys(nextRaw)) {
      const item = nextRaw[id]
      if (item && conversationIdOf(item) === conversationId && !keepIds.has(id)) {
        delete nextRaw[id]
        changed = true
      }
    }
    if (changed) rawMessages.value = nextRaw
  }

  /** 裁剪单会话 messagesMap，保留最近 MESSAGE_WINDOW_SIZE 条 */
  function trimMessageWindow(conversationId: string) {
    const list = messagesMap.value[conversationId]
    if (!list || list.length <= MESSAGE_WINDOW_SIZE) return
    const trimmed = list.slice(-MESSAGE_WINDOW_SIZE)
    const removedIds = list.slice(0, list.length - MESSAGE_WINDOW_SIZE).map((m) => m.id)
    messagesMap.value = { ...messagesMap.value, [conversationId]: trimmed }
    if (removedIds.length) {
      const nextRaw = { ...rawMessages.value }
      removedIds.forEach((id) => {
        delete nextRaw[id]
      })
      rawMessages.value = nextRaw
    }
    historyEnd.value = { ...historyEnd.value, [conversationId]: false }
  }

  /** 离开聊天室时释放非当前会话内存（可选 aggressive） */
  function trimConversationMemory(activeConversationId: string) {
    if (!activeConversationId) return
    for (const cid of Object.keys(messagesMap.value)) {
      if (cid !== activeConversationId) {
        const ids = (messagesMap.value[cid] || []).map((m) => m.id)
        delete messagesMap.value[cid]
        if (ids.length) {
          const nextRaw = { ...rawMessages.value }
          ids.forEach((id) => delete nextRaw[id])
          rawMessages.value = nextRaw
        }
      } else {
        trimMessageWindow(cid)
        trimRawMessagesWindow(cid)
      }
    }
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
      highlightTags: highlightTagsOf(
        effectiveGroupAtType(conv.groupAtType, conv.unreadCount),
        unread,
      ),
    })
  }

  function decorateConversation(conv: Conversation): Conversation {
    conv = sanitizeRetentionPreview(conv)
    const stored = unreadAnnouncementState(announcementOwnerId(), conv.id)
    const unread =
      stored === true || (stored !== false && conv.groupAtType === GroupAtType.AtGroupNotice)
    if (stored === undefined && conv.groupAtType === GroupAtType.AtGroupNotice) {
      writeUnreadAnnouncement(announcementOwnerId(), conv.id, true)
    }
    const next = {
      ...conv,
      highlightTags: highlightTagsOf(effectiveGroupAtType(conv.groupAtType, conv.unreadCount), unread),
    }
    if (next.lastMessage) {
      next.lastMessage = replaceOpenIMAdminLabel(next.lastMessage)
    }
    if (next.type === 'private') {
      if (!next.peerUserId) {
        const derived = peerIdFromSingleConversation(next.id, imUserId.value)
        if (derived) next.peerUserId = derived
      }
      if (next.peerUserId) {
        const remark = useContactStore().remarkOf(next.peerUserId)
        if (remark) next.title = remark
      }
    }
    return sanitizeRetentionPreview(next)
  }

  function applyContactRemarks() {
    if (!conversations.value.length) return
    conversations.value = conversations.value.map((c) => decorateConversation(c))
  }

  watch(
    () => useContactStore().remarkByUserId,
    () => applyContactRemarks(),
    { deep: true },
  )

  function appendMessage(item: MessageItem) {
    if (!item?.clientMsgID) return
    const incomingConversationId = conversationIdOf(item)
    if (groupRetention.removed(incomingConversationId, item)) return
    // 退出群与普通“删除会话”不同：OpenIM 异步退群完成前仍可能推送尾部消息，
    // 这些消息不能把已经退出的群重新插回会话列表。
    if (incomingConversationId && exitedGroupIds.has(incomingConversationId)) return

    // 共享置顶同步：静默写入本端会话 ex，不进气泡、不响铃
    if (Number(item.contentType) === MessageType.CustomMessage) {
      const pin = messagePinPayloadOf(item)
      if (pin && incomingConversationId) {
        rememberRaw(item)
        void applyIncomingMessagePin(incomingConversationId, pin)
        return
      }
    }

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
    // 我拉黑的对方：会话保持消失，不因对方再发消息刷回列表
    if (hiddenIds.has(message.conversationId)) {
      if (message.notificationKind === 'dissolved' || isIMNotification(item.contentType)) {
        return
      }
      const peer = item.sendID === imUserId.value ? item.recvID : item.sendID
      if (isBlockedPeer(peer) || isBlockedPeer(businessUserIdFromIM(peer || ''))) {
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
    // 正在看这个会话时不要按 200 条硬裁：上翻历史可能已超过 WINDOW，
    // 新消息一来 slice(-200) 会把正在看的旧气泡删掉，视口往上跳。
    // 当前会话保留正在浏览的历史，离开房间后由 trimConversationMemory 回收。
    if (message.conversationId !== activeConversationId) {
      trimMessageWindow(message.conversationId)
    }
    // 列表预览不能只等 OnConversationChanged：事件慢/丢时会话行会一直挂旧文案
    const isSelf = item.sendID === imUserId.value
    const viewing = !!activeConversationId && message.conversationId === activeConversationId
    patchConversation(message.conversationId, {
      lastMessage: previewOf(message),
      lastMessageAt: message.createdAt,
      lastMessageSeq: message.seq,
      lastMessageId: message.id,
      ...(viewing || isSelf
        ? { unreadCount: 0 }
        : {
            unreadCount:
              (conversations.value.find((c) => c.id === message.conversationId)?.unreadCount || 0) +
              (isIMNotification(item.contentType) ? 0 : 1),
          }),
    })
    if (viewing) {
      void markAsRead(message.conversationId)
    }
  }

  async function applyIncomingMessagePin(
    conversationId: string,
    pin: {
      action: 'pin' | 'unpin'
      clientMsgID: string
      preview: string
      senderNickname: string
      messageType: string
    },
  ) {
    const next: ConversationPinnedMessage | null =
      pin.action === 'unpin'
        ? null
        : {
            clientMsgID: pin.clientMsgID,
            preview: pin.preview,
            senderNickname: pin.senderNickname,
            messageType: pin.messageType,
            scope: 'shared',
            pinnedAt: Date.now(),
          }
    try {
      await setConversationPinnedMessage(conversationId, next)
    } catch {
      /* 写 ex 失败时仍更新本地横幅 */
    }
    patchConversation(conversationId, { pinnedMessage: next })
  }

  /** 置顶 / 取消置顶某条消息；shared 时同步给会话对方或群成员 */
  async function pinChatMessage(
    conversationId: string,
    message: ChatMessage,
    scope: 'self' | 'shared',
    displayNickname?: string,
  ) {
    const preview = quoteSummaryOf(message.type, message.content)
    const pinned: ConversationPinnedMessage = {
      clientMsgID: message.id,
      preview,
      senderNickname: (displayNickname || message.senderNickname || '').trim(),
      messageType: message.type,
      scope,
      pinnedAt: Date.now(),
    }
    await setConversationPinnedMessage(conversationId, pinned)
    patchConversation(conversationId, { pinnedMessage: pinned })
    if (scope === 'shared') {
      const conv = requireConversation(conversationId)
      await sendMessagePinSync(targetOf(conv), {
        action: 'pin',
        clientMsgID: pinned.clientMsgID,
        preview: pinned.preview,
        senderNickname: pinned.senderNickname,
        messageType: pinned.messageType,
      })
    }
  }

  async function unpinChatMessage(conversationId: string, syncShared = true) {
    const prev = conversations.value.find((c) => c.id === conversationId)?.pinnedMessage
    await setConversationPinnedMessage(conversationId, null)
    patchConversation(conversationId, { pinnedMessage: null })
    if (syncShared && prev?.scope === 'shared') {
      const conv = requireConversation(conversationId)
      await sendMessagePinSync(targetOf(conv), {
        action: 'unpin',
        clientMsgID: prev.clientMsgID,
        preview: '',
        senderNickname: '',
        messageType: prev.messageType || 'text',
      }).catch(() => undefined)
    }
  }

  /** SDK 有时推单条，有时推数组；解析失败时不能让监听器抛错把后续消息吃掉 */
  function ingestIncoming(raw: MessageItem | MessageItem[] | null) {
    const source = Array.isArray(raw) ? raw : raw ? [raw] : []
    // App PascalCase 必须先归一，否则 clientMsgID/会话 id 为空会被静默丢弃
    const list = source
      .map((item) => coerceMessage(item) || item)
      .filter((item): item is MessageItem => !!item?.clientMsgID)
      .filter((item) => !groupRetention.removed(conversationIdOf(item), item))
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
      .filter((conv) => shouldShowConversation(conv))
    if (!incoming.length) return
    const merged = [...conversations.value]
    incoming.forEach((conv) => {
      const idx = merged.findIndex((c) => c.id === conv.id)
      if (idx >= 0) merged[idx] = keepNewerPreview(merged[idx], conv)
      else merged.push(conv)
    })
    conversations.value = sortConversations(merged.filter(shouldShowConversation))
  }

  /** SDK 会话预览偶发滞后时，不要把本地刚发出的 [图片] 盖回旧文本 */
  function keepNewerPreview(prev: Conversation, next: Conversation): Conversation {
    const prevTime = new Date(prev.lastMessageAt).getTime() || 0
    const nextTime = new Date(next.lastMessageAt).getTime() || 0
    let merged =
      prev.lastMessage && prevTime > nextTime
        ? { ...next, lastMessage: prev.lastMessage, lastMessageAt: prev.lastMessageAt,
            lastMessageSeq: prev.lastMessageSeq, lastMessageId: prev.lastMessageId }
        : next
    // 正在看的会话：SDK 推回未读也不要盖掉本地已清的红点
    if (activeConversationId && merged.id === activeConversationId) {
      merged = { ...merged, unreadCount: 0 }
    } else if (!(prev.unreadCount || 0) && (merged.unreadCount || 0) > 0) {
      // 本地刚 markAsRead 后 SDK 偶发带回旧 unread，不要把红点弹回来
      const prevAt = prevTime
      const nextAt = nextTime
      if (prevAt >= nextAt) {
        merged = { ...merged, unreadCount: 0 }
      }
    }
    // 本地刚写入的置顶横幅优先于 SDK 尚未带回 ex 的会话快照
    const prevPinAt = prev.pinnedMessage?.pinnedAt || 0
    const nextPinAt = next.pinnedMessage?.pinnedAt || 0
    if (prev.pinnedMessage && prevPinAt >= nextPinAt) {
      merged = { ...merged, pinnedMessage: prev.pinnedMessage }
    } else if (!next.pinnedMessage && prev.pinnedMessage === null) {
      merged = { ...merged, pinnedMessage: null }
    }
    // SDK 同步偶发滞后：未读已为 0 时不应再展示 @ 强提醒；本地已清 @ 时也不被 SDK 推回
    if (merged.type === 'group') {
      const hasUnreadAnn = unreadAnnouncementState(announcementOwnerId(), merged.id) === true
      const atType = effectiveGroupAtType(merged.groupAtType, merged.unreadCount)
      const prevAtType = effectiveGroupAtType(prev.groupAtType, prev.unreadCount)
      const clearedLocally = !isAtMeType(prevAtType) && isAtMeType(atType)
      if (!(merged.unreadCount || 0) && isAtMeType(merged.groupAtType)) {
        merged = {
          ...merged,
          groupAtType: GroupAtType.AtNormal,
          highlightTags: highlightTagsOf(GroupAtType.AtNormal, hasUnreadAnn),
        }
      } else if (clearedLocally && !(merged.unreadCount || 0)) {
        merged = {
          ...merged,
          groupAtType: GroupAtType.AtNormal,
          highlightTags: highlightTagsOf(GroupAtType.AtNormal, hasUnreadAnn),
        }
      } else if (atType !== merged.groupAtType) {
        merged = {
          ...merged,
          highlightTags: highlightTagsOf(atType, hasUnreadAnn),
        }
      }
    }
    return sanitizeRetentionPreview(merged)
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
      // 断线重连（含 SDK 自动重连）后补拉一次：断线期间漏掉的推送靠这一步找回。
      // resyncAfterResume 自带 3 秒节流，重复触发只跑一次。
      onIMEvent(IMEvents.OnConnectSuccess, () => {
        void resyncAfterResume()
      }),
      // 离线消息补偿写完本地库后才算齐；OnConnectSuccess 早于同步结束，
      // 且离线条往往不再逐条 OnRecvNewMessage，必须在 Finish 后强制重拉 UI。
      onIMEvent(IMEvents.OnSyncServerFinish, () => {
        void refreshAfterServerSync()
      }),
      onUserStatusChanged((state) => {
        onlineStatus.value[state.userID] = state.status
      }),
      groupRetention.subscribe(pruneRetainedHistory),
    ]
    scheduleRetentionSync()
  }

  function unsubscribeRealtime() {
    unsubscribers.forEach((off) => off())
    unsubscribers = []
    if (retentionTimer !== undefined) clearTimeout(retentionTimer)
    retentionTimer = undefined
  }

  async function loadConversations() {
    perfMarkStart('chat:load-conversations')
    loading.value = true
    try {
      await ensureIMLogin()
      syncHiddenIdsFromStorage()
      syncBlockedPeerKeysFromStorage()
      // 黑名单对齐与拉会话并行：别串行等 blocked 再 getConversationList（图里那条常拖慢进首页）
      const blockedSync = syncBlockedPeersFromServer()
      subscribeRealtime()
      let list
      try {
        ;[list] = await Promise.all([getConversationList(), blockedSync])
      } catch (e) {
        const msg = (e as Error)?.message || ''
        if (msg.includes('10004') || msg.includes('10005')) {
          invalidateIMLoginCache()
          await ensureIMLogin()
          syncHiddenIdsFromStorage()
          syncBlockedPeerKeysFromStorage()
          await waitForSync(5000)
          const retryBlocked = syncBlockedPeersFromServer()
          ;[list] = await Promise.all([getConversationList(), retryBlocked])
        } else {
          throw e
        }
      }
      // ★ 必须先对账再过滤：仍留在 exitedGroupIds 里的会话会被下面的 filter 直接筛掉，
      //   那样就永远没机会做成员校验恢复了（见 reconcileExitedGroups）。
      await reconcileExitedGroups(list)
      await groupRetention.sync(list.map((item) => String(item.conversationID || (item as unknown as Record<string, unknown>).ConversationID || '')))
      const prevById = new Map(conversations.value.map((c) => [c.id, c]))
      conversations.value = sortConversations(
        list
          .map((item) => {
            const mapped = decorateConversation(toConversation(item))
            const prev = prevById.get(mapped.id)
            return prev ? keepNewerPreview(prev, mapped) : mapped
          })
          .filter(shouldShowConversation),
      )
      refreshOnlineStatus().catch(() => undefined)
      // 备注索引与通讯录分页解耦：拉全量备注后再盖一次会话标题
      void useContactStore()
        .ensureRemarkIndex()
        .then(() => applyContactRemarks())
    } finally {
      loading.value = false
      perfMarkEnd('chat:load-conversations')
    }
  }

  // 补拉的重入与抖动保护：页面快速来回切换、以及重连事件连续触发时只跑一次。
  let resyncing = false
  let lastResyncAt = 0
  const RESYNC_MIN_INTERVAL_MS = 3000
  /** 同步完成刷新不与 resync 共用节流，否则 ConnectSuccess 刚跑完会吞掉 Finish */
  let syncRefreshing = false
  let pendingSyncRefresh = false

  /**
   * 回到前台 / 重新可见 / 断线重连后主动补拉一次会话列表。
   *
   * 为什么必须有：新消息只通过 OpenIM 推送（subscribeRealtime）进 UI，
   * 全仓库没有轮询、也没有恢复时的补拉。App 切后台、浏览器标签被节流、
   * 切 VPN、断网重连都会漏掉推送，而漏掉之后没有任何机制补回来——
   * 那一端就永久停在旧数据上，表现为「手机和电脑互相看不到」。
   *
   * 只做「重新可见」这一个触发点，不做定时轮询（轮询会放大接口压力）。
   */
  async function resyncAfterResume() {
    if (resyncing) return
    const now = Date.now()
    if (now - lastResyncAt < RESYNC_MIN_INTERVAL_MS) return
    lastResyncAt = now
    resyncing = true
    try {
      // loadConversations 内部已有 ensureIMLogin + subscribeRealtime + 10004/10005 重登重试
      await loadConversations()
      // 顺带把当前打开的会话补拉一次：内嵌的 room.vue 收不到页面级 onShow
      const active = activeConversationId
      if (active) await loadMessages(active).catch(() => undefined)
    } catch {
      // 补拉失败不影响正常使用，下次恢复可见还会再试
    } finally {
      resyncing = false
    }
  }

  /**
   * 服务端同步结束后从本地库重拉会话 / 当前房间。
   * 不走 resyncAfterResume 的 3s 节流：ConnectSuccess 往往早于 Finish，
   * 若被节流吞掉，离线期间的消息会永远停在旧快照上。
   */
  async function refreshAfterServerSync() {
    if (syncRefreshing) {
      pendingSyncRefresh = true
      return
    }
    syncRefreshing = true
    try {
      do {
        pendingSyncRefresh = false
        await loadConversations().catch(() => undefined)
        const active = activeConversationId
        if (active) await loadMessages(active).catch(() => undefined)
      } while (pendingSyncRefresh)
    } finally {
      syncRefreshing = false
    }
  }

  // 兜底：会话列表变化时（包括 HMR/热更新后）自动刷新在线状态订阅
  watch(
    () => conversations.value.map((c) => c.peerUserId).filter(Boolean),
    () => {
      refreshOnlineStatus().catch(() => undefined)
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
      const states = await subscribeUsersStatus(toSubscribe).catch(() => [] as { userID: string; status: OnlineState }[])
      states.forEach((s) => {
        onlineStatus.value[s.userID] = s.status
      })
      toSubscribe.forEach((id) => subscribedUserIDs.value.add(id))
    }

    // 再查询一次所有已订阅用户的最新状态，补齐事件推送可能漏掉的状态
    const allStates = await getSubscribeUsersStatus().catch(() => [] as { userID: string; status: OnlineState }[])
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
    if (cached) {
      unhideConversation(cached.id)
      // 列表点进已缓存会话：权限校验后台进行，不阻塞首屏拉历史
      if (cached.type === 'group') {
        void assertConversationAccessible(cached).catch(() => undefined)
      }
      return cached
    }

    if (params.conversationId) {
      const item = await findConversationById(params.conversationId)
      if (item) {
        const mapped = toConversation(item)
        unhideConversation(mapped.id)
        upsertConversations([item])
        if (mapped.type === 'group') {
          void assertConversationAccessible(mapped).catch(() => undefined)
        }
        return mapped
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
    if (isGroup) allowGroupConversation(item.conversationID)
    upsertConversations([item])
    return toConversation(item)
  }

  async function assertConversationAccessible(conversation: Conversation): Promise<void> {
    if (conversation.type !== 'group') return
    if (!conversation.groupId) throw new Error('群聊信息不完整，请刷新会话列表')
    try {
      await resolveIMGroupByIM(conversation.groupId)
      allowGroupConversation(conversation.id)
    } catch (e) {
      const message = (e as Error)?.message || ''
      if (!message.includes('群聊不存在或无权访问')) throw e
      await removeExitedGroupConversation(conversation.id)
      throw new Error('你已退出该群聊或群聊已解散')
    }
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
    perfMarkStart('chat:load-messages')
    let existing = messagesMap.value[conversationId] || []
    perfMarkStart('chat:load-messages:sdk')
    const { messageList, isEnd } = await getHistoryMessages(conversationId, PAGE_SIZE)
    existing = groupRetention.filter(conversationId, existing)
    perfMarkEnd('chat:load-messages:sdk', `${messageList.length} msgs`)
    messageList.forEach(rememberRaw)
    const mapped = messageList
      .filter((item) => !messagePinPayloadOf(item) && !groupRetention.removed(conversationId, item))
      .map(toChatMessage)
    // App 历史接口偶发空结果时不要把房间里刚发出的消息整表冲掉
    if (!mapped.length && existing.length) {
      historyEnd.value = { ...historyEnd.value, [conversationId]: false }
      await markAsRead(conversationId)
      perfMarkEnd('chat:load-messages', 'empty-skip')
      return
    }
    // 已读回执先于历史快照落在本地的（H5 缓存偶发滞后），不要回退成未读
    const readIds = new Set(existing.filter((m) => m.hasRead).map((m) => m.id))
    const withRead = readIds.size
      ? mapped.map((m) => (m.hasRead || !readIds.has(m.id) ? m : { ...m, hasRead: true }))
      : mapped
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: groupRetention.filter(conversationId, mergeLocalPending(withRead, existing)),
    }
    historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
    trimMessageWindow(conversationId)
    await markAsRead(conversationId)
    perfMarkEnd('chat:load-messages', conversationId)
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
    perfMarkStart('chat:load-more-messages')
    const list = messagesMap.value[conversationId] || []
    if (!list.length) {
      perfMarkEnd('chat:load-more-messages', 'no-list')
      return false
    }
    const { messageList, isEnd } = await getHistoryMessages(
      conversationId,
      PAGE_SIZE,
      list[0].id,
    )
    historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
    if (!messageList.length) {
      perfMarkEnd('chat:load-more-messages', 'empty')
      return false
    }
    messageList.forEach(rememberRaw)
    const older = messageList.filter((item) => !messagePinPayloadOf(item) && !groupRetention.removed(conversationId, item)).map(toChatMessage)
    if (!older.length) {
      perfMarkEnd('chat:load-more-messages', 'empty-mapped')
      return false
    }
    // 禁止此处 trimMessageWindow：slice(-WINDOW) 会裁掉刚 prepend 的旧消息，
    // 列表几乎不变却仍 return true → scroll-into-view 跳动（消息多了上滑卡）。
    // 离开聊天室时由 trimConversationMemory 回收。
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: groupRetention.filter(conversationId, [...older, ...list]),
    }
    perfMarkEnd('chat:load-more-messages', `${older.length} msgs`)
    return true
  }

  /**
   * 搜索结果跳转：从当前列表往更早的历史翻，直到命中 clientMsgID。
   * 命中后保留「目标及其之后的消息」，避免窗口裁剪把刚翻到的旧消息丢掉。
   */
  async function locateMessage(conversationId: string, clientMsgId: string): Promise<boolean> {
    if (!conversationId || !clientMsgId) return false
    const has = () => (messagesMap.value[conversationId] || []).some((m) => m.id === clientMsgId)
    if (!messagesMap.value[conversationId]?.length) {
      await loadMessages(conversationId)
    }
    if (has()) return true
    const maxPages = 20
    for (let i = 0; i < maxPages; i++) {
      if (historyEnd.value[conversationId]) return false
      const list = messagesMap.value[conversationId] || []
      const anchor = list[0]?.id
      if (!anchor) return false
      const { messageList, isEnd } = await getHistoryMessages(conversationId, PAGE_SIZE, anchor)
      historyEnd.value = { ...historyEnd.value, [conversationId]: isEnd }
      if (!messageList.length) return false
      messageList.forEach(rememberRaw)
      const older = messageList.filter((item) => !messagePinPayloadOf(item) && !groupRetention.removed(conversationId, item)).map(toChatMessage)
      const merged = groupRetention.filter(conversationId, [...older, ...list])
      messagesMap.value = { ...messagesMap.value, [conversationId]: merged }
      if (merged.some((m) => m.id === clientMsgId)) {
        retainFromMessage(conversationId, clientMsgId)
        return true
      }
      if (isEnd || merged.length > 500) return false
    }
    return false
  }

  function retainFromMessage(conversationId: string, clientMsgId: string) {
    const list = messagesMap.value[conversationId] || []
    const index = list.findIndex((m) => m.id === clientMsgId)
    if (index <= 0) return
    const removed = list.slice(0, index)
    messagesMap.value = { ...messagesMap.value, [conversationId]: list.slice(index) }
    const nextRaw = { ...rawMessages.value }
    removed.forEach((m) => {
      delete nextRaw[m.id]
    })
    rawMessages.value = nextRaw
    historyEnd.value = { ...historyEnd.value, [conversationId]: false }
  }

  /** 已读是副作用，标记失败不该挡住会话展示；未读数下次拉列表会自愈 */
  async function markAsRead(conversationId: string) {
    try {
      await markConversationRead(conversationId)
    } catch (e) {
      console.warn('[chat] 标记已读失败', e)
    }
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) return
    conv.unreadCount = 0
    // 进房即视为看过公告提醒，避免会话行 [有新公告] 一直挂着
    if (conv.type === 'group') {
      writeUnreadAnnouncement(announcementOwnerId(), conversationId, false)
    }
    // 对齐微信：进入群聊并标记已读后，会话列表不再保留 [有人@我] / [有新公告]
    if (conv.type === 'group' && isAtMeType(conv.groupAtType)) {
      patchConversation(conversationId, {
        groupAtType: GroupAtType.AtNormal,
        highlightTags: highlightTagsOf(GroupAtType.AtNormal, false),
      })
      await resetConversationGroupAtType(conversationId).catch(() => undefined)
    } else if (conv.type === 'group') {
      patchConversation(conversationId, {
        highlightTags: highlightTagsOf(
          effectiveGroupAtType(conv.groupAtType, 0),
          false,
        ),
      })
    }
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
    patchConversation(conversationId, { lastMessage: '', lastMessageAt: '', lastMessageSeq: undefined, lastMessageId: undefined })
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

  function allowGroupConversation(conversationId: string) {
    if (!conversationId || !exitedGroupIds.has(conversationId)) return
    exitedGroupIds.delete(conversationId)
    writeExitedGroupIds(exitedGroupIds)
    unhideConversation(conversationId)
  }

  /**
   * 修「被重新拉进群，但会话列表里看不到该群」。
   *
   * 退出/被移出群时会把会话 ID 写进 exitedGroupIds 并持久化，列表加载时据此直接筛掉；
   * 唯一的解除入口 allowGroupConversation 只在「主动打开该会话」时才走到，
   * 可这个会话已经被筛掉了、在列表里点不到 —— 死锁。从通讯录进群能恢复，
   * 正是因为那条路不经过这个过滤（conversationOf 里的 allowGroupConversation）。
   *
   * 修法：每次拉会话列表时主动对账 —— 又出现在 OpenIM 列表里的群，说明多半被重新加回去了，
   * 向后端确认成员身份后恢复显示；仍不是成员就保持隐藏（原设计意图不变）。
   */
  async function reconcileExitedGroups(list: ConversationItem[]): Promise<void> {
    if (!exitedGroupIds.size) return
    const candidates = list
      .map((item) => toConversation(item))
      .filter((conv) => conv.type === 'group' && exitedGroupIds.has(conv.id))
    if (!candidates.length) return
    await Promise.allSettled(
      candidates.map(async (conv) => {
        if (!conv.groupId) return
        try {
          // 后端成员校验；已不是成员会抛「群聊不存在或无权访问」，保持隐藏
          await resolveIMGroupByIM(conv.groupId)
          allowGroupConversation(conv.id)
        } catch {
          /* 仍不是成员，保持隐藏 */
        }
      }),
    )
  }

  /** 退出/被移出群后永久隐藏会话；只有重新入群并通过后端成员校验才允许恢复。 */
  async function removeExitedGroupConversation(conversationId: string) {
    if (!conversationId) return
    const messageIds = (messagesMap.value[conversationId] || []).map((message) => message.id)
    conversations.value = conversations.value.filter((conversation) => conversation.id !== conversationId)
    messagesMap.value = { ...messagesMap.value, [conversationId]: [] }
    historyEnd.value = { ...historyEnd.value, [conversationId]: true }
    if (messageIds.length) {
      const nextRaw = { ...rawMessages.value }
      messageIds.forEach((id) => delete nextRaw[id])
      rawMessages.value = nextRaw
    }
    hiddenIds.add(conversationId)
    exitedGroupIds.add(conversationId)
    writeHiddenIds(hiddenIds)
    writeExitedGroupIds(exitedGroupIds)
    // “退出群并删除对话”需要清消息 + 隐藏会话；任何一个 SDK 能力失败都不回滚
    // 本地退出状态，否则异步 OpenIM 退群窗口内会话会再次出现。
    await Promise.allSettled([
      clearConversationMessages(conversationId),
      hideConversation(conversationId),
    ])
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
    if (exitedGroupIds.has(conversationId)) {
      throw new Error('你已退出该群聊，不能发送消息')
    }
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
    alreadyInserted = false,
  ) {
    const generation = sessionGeneration
    if (!alreadyInserted) {
      const list = messagesMap.value[conversationId] || []
      messagesMap.value = { ...messagesMap.value, [conversationId]: [...list, placeholder] }
    }
    try {
      const sent = await send()
      if (generation !== sessionGeneration) throw new Error('登录状态已变化，请重新进入会话')
      rememberRaw(sent)
      const mapped = toChatMessage(sent)
      const withCover =
        placeholder.type === 'video' && mapped.type === 'video'
          ? { ...mapped, content: mergeVideoContent(mapped.content, placeholder.content) }
          : placeholder.type === 'image' && mapped.type === 'image' && !mapped.content?.trim() && placeholder.content
            ? { ...mapped, content: placeholder.content }
            : mapped
      const isGroup = requireConversation(conversationId).type === 'group'
      const delivered = isGroup ? { ...withCover, trackGroupRead: true } : withCover
      replaceMessage(conversationId, placeholder.id, delivered)
      // A new preview must carry its own seq (including unknown/zero), not the
      // previous message's expired seq. Keep a newer realtime/parallel send.
      await reappearConversation(conversationId)
      if (generation !== sessionGeneration) throw new Error('登录状态已变化，请重新进入会话')
      const current = requireConversation(conversationId)
      const newerSeq = !!current.lastMessageSeq && !!withCover.seq && current.lastMessageSeq > withCover.seq
      const newerTime = (Date.parse(current.lastMessageAt) || 0) > (Date.parse(withCover.createdAt) || 0)
      if (!current.lastMessage || (!newerSeq && !newerTime)) {
        patchConversation(conversationId, sanitizeRetentionPreview({
          ...current,
          lastMessage: previewOf(withCover),
          lastMessageAt: withCover.createdAt,
          lastMessageSeq: withCover.seq,
          lastMessageId: withCover.id,
        }))
      }
      // App 原生发送成功回调经常暂时没有 seq；群聊已读游标必须依赖 seq。
      // 后台短轮询本地库补齐，不阻塞发送成功 UI，也不会按群成员数放大请求量。
      if (isGroup && !withCover.seq) {
        void resolveMessageSeq(conversationId, withCover.id, sent).then((resolved) => {
          if (!resolved.seq || generation !== sessionGeneration ||
            !messagesMap.value[conversationId]?.some((m) => m.id === withCover.id)) return
          const resolvedRaw = resolved.message || rawMessages.value[withCover.id]
          if (groupRetention.removed(conversationId, { seq: resolved.seq })) {
            const nextRaw = { ...rawMessages.value }
            delete nextRaw[withCover.id]
            rawMessages.value = nextRaw
          } else if (resolvedRaw) {
            rememberRaw({ ...resolvedRaw, seq: resolved.seq })
          }
          replaceMessage(conversationId, withCover.id, {
            ...delivered,
            seq: resolved.seq,
            trackGroupRead: true,
          })
          const preview = conversations.value.find((c) => c.id === conversationId)
          if (preview?.lastMessageId === withCover.id) {
            patchConversation(conversationId, sanitizeRetentionPreview({ ...preview, lastMessageSeq: resolved.seq }))
          }
        }).catch(() => undefined)
      }
    } catch (e) {
      // A send/seq callback from the previous account must not reinsert its
      // placeholder or raw message into the next account's store after reset.
      if (generation !== sessionGeneration) throw e
      replaceMessage(conversationId, placeholder.id, { ...placeholder, status: 'failed' })
      const msg = (e as Error)?.message || ''
      if (isNotInGroupIMError(e) || isGroupUnavailableError(msg)) {
        void removeExitedGroupConversation(conversationId)
        onGroupUnavailable?.({ conversationId })
        throw new Error('GROUP_UNAVAILABLE')
      }
      throw new Error(msg || '发送失败')
    }
  }

  function previewOf(message: ChatMessage): string {
    if (message.type === 'image') return '[图片]'
    if (message.type === 'voice') return '[语音]'
    if (message.type === 'video') return '[视频]'
    if (message.type === 'file') return '[文件]'
    if (message.type === 'card') return '[名片]'
    if (message.type === 'groupInvite') return '[群邀请]'
    return message.content
  }

  function replaceMessage(conversationId: string, tempId: string, message: ChatMessage) {
    const list = messagesMap.value[conversationId] || []
    // 自己发的消息有时先被 OnRecvNewMessage 插进列表，占位再换成同一条 clientMsgID，就会出现两条。
    // 撤回按这个 id 命中，所以两条会一起撤掉。
    let replaced = false
    const next: ChatMessage[] = []
    for (const m of list) {
      if (m.id === message.id && m.id !== tempId) continue
      if (m.id === tempId) {
        next.push(message)
        replaced = true
        continue
      }
      next.push(m)
    }
    if (!replaced && !next.some((m) => m.id === message.id)) next.push(message)
    messagesMap.value = {
      ...messagesMap.value,
      [conversationId]: groupRetention.filter(conversationId, next),
    }
  }

  // 占位气泡 id 的自增序号：同一毫秒内连发多条时，只用 Date.now() 会撞 id，
  // 那样 replaceMessage 会把两条一起替换掉。
  let placeholderSeq = 0

  function placeholderOf(
    conversationId: string,
    senderId: string,
    type: ChatMessage['type'],
    content: string,
  ): ChatMessage {
    placeholderSeq += 1
    return {
      id: `local_${Date.now()}_${placeholderSeq}`,
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
      () =>
        sendAtTextMessage(
          target,
          content,
          atUsers.map((a) => a.atUserID),
          atUsers,
        ),
    )
  }

  async function sendImage(conversationId: string, filePath: string, senderId: string) {
    const job = prepareOutgoingImage(conversationId, filePath, senderId)
    await deliverOutgoingImage(job)
  }

  /** 选图后立刻插入占位，压缩和上传交给 deliverOutgoingImage，可按并发池调用 */
  function prepareOutgoingImage(conversationId: string, filePath: string, senderId: string) {
    requireConversation(conversationId)
    const placeholder = placeholderOf(conversationId, senderId, 'image', filePath)
    const list = messagesMap.value[conversationId] || []
    messagesMap.value = { ...messagesMap.value, [conversationId]: [...list, placeholder] }
    return { conversationId, filePath, placeholder }
  }

  async function h5ImagePreview(filePath: string): Promise<string> {
    try {
      if (
        typeof window !== 'undefined' &&
        uni.getSystemInfoSync().uniPlatform === 'web' &&
        filePath &&
        !/^https?:\/\//i.test(filePath) &&
        !filePath.startsWith('blob:')
      ) {
        const blob = await fetch(filePath).then((r) => r.blob())
        return URL.createObjectURL(blob)
      }
    } catch {
      /* 预览失败仍用原路径发送 */
    }
    return filePath
  }

  async function deliverOutgoingImage(job: {
    conversationId: string
    filePath: string
    placeholder: ChatMessage
  }) {
    const preview = await h5ImagePreview(job.filePath)
    let placeholder = job.placeholder
    if (preview !== placeholder.content) {
      placeholder = { ...placeholder, content: preview }
      replaceMessage(job.conversationId, placeholder.id, placeholder)
    }
    const target = targetOf(requireConversation(job.conversationId))
    await sendWithPlaceholder(
      job.conversationId,
      placeholder,
      () => sendImageMessage(target, job.filePath),
      true,
    )
  }

  async function sendVideo(
    conversationId: string,
    filePath: string,
    senderId: string,
    duration = 0,
    snapshotPath = '',
  ) {
    const target = targetOf(requireConversation(conversationId))
    const content = JSON.stringify({
      url: filePath,
      snapshotUrl: snapshotPath,
      duration,
    })
    await sendWithPlaceholder(
      conversationId,
      placeholderOf(conversationId, senderId, 'video', content),
      () => sendVideoMessage(target, filePath, duration, snapshotPath),
    )
  }

  /** 发送好友名片：占位与气泡渲染共用同一份 content JSON；群聊禁止 */
  async function sendCard(
    conversationId: string,
    friend: { id: string; nickname: string; avatar?: string },
    senderId: string,
  ) {
    const conv = requireConversation(conversationId)
    if (conv.type === 'group') {
      throw new Error('群内不可分享个人名片')
    }
    const target = targetOf(conv)
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
    const quoted = toChatMessage(quote)
    const placeholder = placeholderOf(conversationId, senderId, 'text', text)
    placeholder.quote = {
      senderNickname: quoted.senderNickname || '',
      thumbUrl: quoteThumbOf(quoted.type, quoted.content, quoted.senderAvatar) || undefined,
      content: quoteSummaryOf(quoted.type, quoted.content),
      clientMsgId: quoteMessageId || quoted.id || undefined,
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

  /** 一键清掉所有会话未读（含群 @ 提醒），仅处理仍有未读的会话 */
  async function markAllAsRead() {
    const targets = conversations.value.filter(
      (c) => (c.unreadCount || 0) > 0 || isAtMeType(c.groupAtType),
    )
    if (!targets.length) return
    await Promise.all(targets.map((c) => markAsRead(c.id)))
  }

  function reset() {
    sessionGeneration++
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

  function setOnGroupUnavailable(fn: ((payload: { conversationId: string }) => void) | null) {
    onGroupUnavailable = fn
  }

  /** room.vue 进入/离开房间时登记，供 resyncAfterResume 补拉当前会话 */
  function setActiveConversation(conversationId: string) {
    activeConversationId = conversationId || ''
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
    resyncAfterResume,
    enterConversation,
    assertConversationAccessible,
    loadMessages,
    loadMoreMessages,
    locateMessage,
    markAsRead,
    sendText,
    sendAtText,
    setOnIncomingForDissolve,
    setOnGroupUnavailable,
    setActiveConversation,
    sendImage,
    prepareOutgoingImage,
    deliverOutgoingImage,
    sendCard,
    sendFile,
    sendImageUrl,
    sendVideo,
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
    pinChatMessage,
    unpinChatMessage,
    hideConversationLocal,
    hideConversationForBlockedContact,
    hideConversationForDeletedContact,
    restoreConversationAfterUnblock,
    removeExitedGroupConversation,
    reappearConversation,
    applyContactRemarks,
    dismissGroupAnnouncement,
    clearHistory,
    reset,
    trimConversationMemory,
  }
})

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  })
}
