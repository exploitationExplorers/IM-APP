<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import ChatBubble from '@/components/ChatBubble.vue'
import EmojiStickerPanel from '@/components/EmojiStickerPanel.vue'
import ImAtActionSheet from '@/components/ImAtActionSheet.vue'
import ImAtMentionPanel from '@/components/ImAtMentionPanel.vue'
import type { AtMentionMember } from '@/components/ImAtMentionPanel.vue'
import ImMessageActionMenu from '@/components/ImMessageActionMenu.vue'
import ImMessageSelectBar from '@/components/ImMessageSelectBar.vue'
import ImQuoteBar from '@/components/ImQuoteBar.vue'
import ImConfirmDialogHost from '@/components/ImConfirmDialogHost.vue'
import ImSuccessToast from '@/components/ImSuccessToast.vue'
import { imConfirm } from '@/composables/useImConfirm'
import ImDesktopGroupMenu from '@/components/desktop/ImDesktopGroupMenu.vue'
import ImDesktopFriendDetail from '@/components/desktop/ImDesktopFriendDetail.vue'
import { useChatMessageActions, type MemberMeta } from '@/composables/useChatMessageActions'
import { useChatComposerInput, type ComposerInputEvent } from '@/composables/useChatComposerInput'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useForwardStore } from '@/stores/forward'
import {
  businessUserIdFromIM,
  chooseLocalFiles,
  ensureIMLogin,
  friendlySendFailMessage,
  imUserId,
  isLikelyChatImage,
  isNotInGroupIMError,
  sameBusinessUserId,
} from '@/utils/openim'
import { pickLocalImages, requestAndroidAlbumPermission } from '@/utils/file-upload'
import {
  CHAT_RENDER_STEP as RENDER_STEP,
  CHAT_RENDER_TAIL as RENDER_TAIL,
} from '@/constants/chat'
import { swallowError } from '@/utils/ignoreError'
import { APP_CONFIG } from '@/config'
import { useContactStore } from '@/stores/contact'
import { fetchContact } from '@/api/contact'
import { fetchGroupReadState, reportGroupReadCursor, resolveIMGroupByIM } from '@/api/im'
import {
  acceptGroupInvitation,
  fetchAllGroupMembers,
  fetchGroupDetail,
  fetchGroupMessagePurges,
} from '@/api/group'
import { safeBack } from '@/utils/nav'
import type { CardPayload, ChatMessage, Conversation, GroupInvitePayload, GroupMember, GroupRole } from '@/types'
import {
  collapseRepeatedGroupNameNotices,
  formatIMNotification,
  isGroupUnavailableError,
  replaceOpenIMAdminLabel,
} from '@/utils/im-notification'
import { getStatusBarHeight } from '@/utils/status-bar'
import { formatChatDayLabel, formatLastSeen, formatMeridiemClock, quoteSummaryOf, quoteThumbOf } from '@/utils/format'
import { perfMarkEnd, perfMarkStart } from '@/utils/perf'
import { imagePreviewUrlOf, playableMediaUrl, previewImagesWithSave, listThumbnailUrl } from '@/utils/chatMedia'
import { resetMediaCacheQueue } from '@/utils/mediaCache'
import { isIOSApp } from '@/utils/platform'
import {
  isAnnouncementDismissed,
  rememberDismissedAnnouncement,
} from '@/utils/group-announcement'

const props = withDefaults(
  defineProps<{
    /** H5 PC 三栏内嵌，不走 navigateTo */
    embedded?: boolean
    conversationId?: string
    type?: 'private' | 'group'
    title?: string
    avatar?: string
    /** 桌面端从会话列表关键词搜索跳入时定位到该消息 */
    clientMsgId?: string
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
  dissolved: []
}>()

const chatStore = useChatStore()
const userStore = useUserStore()
const contactStore = useContactStore()
const forwardStore = useForwardStore()
const successVisible = ref(false)
const showGroupMenu = ref(false)
const showFriendDetail = ref(false)
const friendDetailId = ref('')

const statusBarHeight = getStatusBarHeight()
/** iOS Safari 键盘弹起时 visualViewport 高度；空则用 CSS 100dvh */
const vvHeightPx = ref(0)
const keyboardOpen = ref(false)

const activeConversationId = ref('')
const roomTitle = ref('聊天')
const peerAvatar = ref(APP_CONFIG.defaultAvatarUrl)
const chatType = ref<'private' | 'group'>('group')
/** 业务侧的好友 / 群 ID，仅用于跳资料页 */
const businessId = ref('')
/** 私聊对方最近上线，顶栏展示离线时间 */
const peerLastSeenAt = ref('')
const memberCount = ref(0)
const myRole = ref<'owner' | 'admin' | 'member'>('member')
/** 进入会话后拿到的会话对象，用于反查资料页所需的业务 ID */
const convRef = ref<Conversation | null>(null)
const memberRemarkMap = ref<Record<string, string>>({})
/** 群主展示名，系统通知里的 imAdmin 用这个替换 */
const groupOwnerName = ref('')
/** 群成员业务头像（业务用户 ID 索引），IM 快照头像为空或损坏时兜底用 */
const memberAvatarMap = ref<Record<string, string>>({})
/** 群禁言状态（群详情接口）：本人被禁言 / 全员禁言时禁用输入区 */
const canChat = ref(true)
const denyReason = ref('')
const myMutedUntil = ref<string | null>(null)
/** 群成员角色 / 禁言元信息（业务用户 ID 索引），供长按菜单做权限与禁言项判断 */
const memberMetaMap = ref<Record<string, MemberMeta>>({})
/** 被「移除该成员并删除消息」清理过的成员：业务用户 ID → 水位时间(ms)，见 loadMessagePurges */
const purgedMap = ref<Record<string, number>>({})
/** 群成员完整列表，供输入 @ 提及面板使用 */
const groupMembersForAt = ref<GroupMember[]>([])
/** 输入 @ 后弹出的提及面板 */
const atMentionVisible = ref(false)
const atMentionKeyword = ref('')
/** 当前触发提及的 `@` 在输入框中的起始下标 */
const atMentionStart = ref(-1)
/** 当前群公告正文，房间顶栏横幅用 */
const announcementText = ref('')
/**
 * `uni.setStorageSync` 不是响应式数据源。
 * 当用户点「不再提示」后，需要显式触发一次 computed 重算，保证横幅立刻收起。
 */
const announcementDismissEpoch = ref(0)
/** 群是否已被解散（APP 端 GetByID 已过滤 status<>'active'，进入时 404 即视为解散） */
const groupDissolved = ref(false)
let muteExpireTimer: ReturnType<typeof setTimeout> | null = null
let groupReadPollTimer: ReturnType<typeof setInterval> | null = null
/** 仅追踪本次会话内新发出的群消息已读，避免历史消息误触发轮询 */
const GROUP_READ_POLL_INTERVAL_MS = 15_000
const GROUP_READ_POLL_MAX_MS = 3 * 60_000
let groupReadPollStartedAt = 0
let groupReadReportTimer: ReturnType<typeof setTimeout> | null = null
const composerInput = useChatComposerInput(isIOSApp)
const { input, inputEpoch } = composerInput
const inputRef = ref<{ $el?: HTMLElement } | HTMLTextAreaElement | null>(null)
/**
 * 消息列表倒置（scroll-view 与内层各 scaleY(-1)）：scrollTop=0 即视觉底部。
 * 上翻加载的旧消息落在滚动远端，视口不会被推走；新消息、图片撑高、键盘顶起都天然贴底，
 * 不再需要任何「补偿滚动」，iOS 惯性滚动也不会被打断。
 * scroll-into-view 在倒置下算反了方向，统一用 scroll-top 定位。
 */
const msgScrollTop = ref(0)
let msgScrollTopNonce = 0
/** 用户停在底部时才自动贴底；往上翻历史时来新消息不再拽回去 */
const stickToBottom = ref(true)
let lastListScrollTop = 0
const loadingOlder = ref(false)
const friendRemarkMap = ref<Record<string, string>>({})
const focusedMsgId = ref('')
const showPlusPanel = ref(false)
const showEmojiPanel = ref(false)
const voiceMode = ref(false)
const recording = ref(false)
const recordingSeconds = ref(0)
const voiceDraft = ref<{ path: string; duration: number } | null>(null)

let recorder: UniApp.RecorderManager | null = null
let browserRecorder: { stream: MediaStream; mediaRecorder: MediaRecorder } | null = null
let recordingTimer: ReturnType<typeof setInterval> | null = null

/** 通知类没有可读正文时不渲染；群禁言等系统提示要保留，例如 `张三: [全体禁言]` */
function isVisibleMessage(m: ChatMessage): boolean {
  if (
    m.type === 'image' ||
    m.type === 'voice' ||
    m.type === 'video' ||
    m.type === 'file' ||
    m.type === 'card' ||
    m.type === 'groupInvite'
  ) {
    return true
  }
  if (m.type === 'system') {
    const text = m.content.trim()
    return !!text && !text.startsWith('{')
  }
  return !!m.content
}

/**
 * 群内被管理员「移除并删除消息」清理过的成员，其水位之前发的消息对所有人都隐藏。
 * 必须带 sendTime 判断：只按用户过滤会把「被重新拉进群后新发的消息」也一起藏掉。
 * createdAt 就是 OpenIM 的 sendTime，和后端 purged_at 同源，可以直接比较。
 */
function isPurgedMessage(m: ChatMessage): boolean {
  if (chatType.value !== 'group' || isMine(m)) return false
  const uid = businessUserIdFromIM(m.senderId)
  if (!uid) return false
  const purgedAt = purgedMap.value[uid]
  if (!purgedAt) return false
  const sentAt = Date.parse(m.createdAt)
  // 时间解析不出来时按「隐藏」处理，与管理员「删除消息」的意图一致
  return !Number.isFinite(sentAt) || sentAt < purgedAt
}

const messages = computed(() =>
  collapseRepeatedGroupNameNotices(
    (chatStore.messagesMap[activeConversationId.value] || [])
      .filter(isVisibleMessage)
      .filter((m) => !isPurgedMessage(m)),
  ),
)

/**
 * 平时只挂载尾部气泡；上翻时按批往前扩（扩出来的在滚动远端，不影响视口）。
 * renderFromId 记「最早挂载的那条」，新消息进来不会把窗口顶部的气泡挤掉。
 */
const renderFromId = ref('')
const renderMessages = computed(() => {
  const all = messages.value
  if (!renderFromId.value) return all.length > RENDER_TAIL ? all.slice(-RENDER_TAIL) : all
  const idx = all.findIndex((m) => m.id === renderFromId.value)
  return idx > 0 ? all.slice(idx) : all
})

/** 往更早扩一批已在内存里的消息；已经全部挂载返回 false */
function revealOlderMessages(step = RENDER_STEP): boolean {
  const all = messages.value
  const shown = renderMessages.value.length
  if (shown >= all.length) return false
  renderFromId.value = all[Math.max(0, all.length - shown - step)].id
  return true
}

function renderAllMessages() {
  renderFromId.value = messages.value[0]?.id || ''
}

let roomFirstMessagesMarked = false
watch(
  () => messages.value.length,
  (len) => {
    if (len > 0 && !roomFirstMessagesMarked) {
      roomFirstMessagesMarked = true
      perfMarkEnd('chat:room-first-messages', `${len} visible`)
    }
  },
)

/** 点开用 1280 中图。系统预览直接拉原图会黑屏，气泡里仍是小图。 */
function openImagePreview(message: ChatMessage) {
  const imageMessages = messages.value
    .filter((m) => m.type === 'image' && (m.sourceUrl || m.content))
    .filter((m) => imagePreviewUrlOf(m))
  const urls = imageMessages.map(imagePreviewUrlOf)
  const current = imagePreviewUrlOf(message)
  if (!current) return
  const list = urls.length ? urls : [current]
  const thumbnails = imageMessages.map((m) => playableMediaUrl(listThumbnailUrl(m.content || m.sourceUrl || '')))
  const originals = imageMessages.map((m) =>
    playableMediaUrl((m.sourceUrl || m.content || '').trim()),
  )
  void previewImagesWithSave(
    list,
    list.includes(current) ? current : list[0],
    thumbnails,
    originals,
  )
}

watch(
  () => {
    const list = chatStore.messagesMap[activeConversationId.value] || []
    // 带上 message.id：第二条公告正文不同时 key 会变；同正文双推也能靠 id 触发横幅刷新
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      const key = m?.systemEventKey
      if (
        key &&
        (key.startsWith('group-member:') ||
          key.startsWith('group-mute:') ||
          key.startsWith('group-announce:') ||
          key.startsWith('group-purge:'))
      ) {
        return `${key}:${m.id}`
      }
    }
    return ''
  },
  (key, prev) => {
    if (!prev || !key || key === prev) return
    void refreshGroupMeta()
  },
)
// 消息里的 sendID 是 OpenIM 用户 ID，不是业务用户 ID。
// 不用 computed 盯全局 ref：H5 热更新时 computed 会和 imUserId 脱节。
// 登录完成后立刻写入，并在 imUserId 后续变化时跟上，避免历史先渲染、ID 后到，自己的消息停在左边。
const myId = ref('')
watch(imUserId, (id) => {
  if (id) myId.value = id
})
const myAvatar = computed(() => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl)
const settingsStore = useChatSettingsStore()

function isMine(message: ChatMessage): boolean {
  // 发送中的占位消息一定属于自己，避免 myId 还没拿到时跑到左边
  if (message.status === 'sending') return true
  const me = myId.value || imUserId.value
  if (!me || !message.senderId) return false
  // 业务 UUID 和去掉横线的 OpenIM id 是同一个人，大小写也不稳定
  return sameBusinessUserId(message.senderId, me)
}

/** 联系人 id → 资料，避免每条气泡 contacts.find 扫全表 */
const contactById = computed(() => {
  const map = new Map<string, (typeof contactStore.contacts)[number]>()
  for (const c of contactStore.contacts) map.set(c.id, c)
  return map
})

function avatarOf(message: ChatMessage): string {
  return message.senderAvatar || fallbackAvatarOf(message)
}

/** 业务侧头像兜底：IM 快照头像为空或损坏时，用业务联系人 / 群成员头像，避免显示灰色占位 */
function fallbackAvatarOf(message: ChatMessage): string {
  if (isMine(message)) {
    return myAvatar.value
  }
  const uid = businessUserIdFromIM(message.senderId)
  if (!uid) {
    return chatType.value === 'group' ? APP_CONFIG.defaultAvatarUrl : peerAvatar.value
  }
  const groupAvatar = chatType.value === 'group' ? memberAvatarMap.value[uid] : ''
  if (groupAvatar) return groupAvatar
  const contact = contactById.value.get(uid)
  if (contact?.avatar) return contact.avatar
  return chatType.value === 'group' ? APP_CONFIG.defaultAvatarUrl : peerAvatar.value
}

function friendRemarkOf(uid: string): string {
  return contactStore.remarkOf(uid) || friendRemarkMap.value[uid] || ''
}

function nicknameOf(message: ChatMessage): string {
  if (chatType.value !== 'group' || message.senderId === myId.value) return ''
  const uid = businessUserIdFromIM(message.senderId)
  if (!uid) return message.senderNickname || ''
  const friendRemark = friendRemarkOf(uid)
  if (friendRemark) return friendRemark
  const mr = memberRemarkMap.value[uid]
  if (mr) return mr
  if (message.senderNickname) return message.senderNickname
  const contact = contactById.value.get(uid)
  return contact?.remark?.trim() || contact?.nickname || ''
}

/**
 * 气泡上的头衔：群主/管理员才挂徽章，普通成员与私聊返回 member（不显示）。
 * 自己的消息也带上（自己是群主/管理员时同样露头衔），成员表按业务 ID 索引，
 * 与昵称/备注走同一套 ID 映射。成员表没拉到时不显示徽章，不影响聊天。
 */
function roleOf(message: ChatMessage): GroupRole {
  if (chatType.value !== 'group') return 'member'
  if (message.senderId === myId.value) return myRole.value
  const uid = businessUserIdFromIM(message.senderId)
  if (!uid) return 'member'
  return memberMetaMap.value[uid]?.role || 'member'
}

/**
 * 私聊与群聊共用同一套单双勾。群聊的“已读”表示至少一名其他成员已读。
 */
function readStateOf(message: ChatMessage): 'read' | 'unread' | undefined {
	if (!isMine(message)) return undefined
  if (message.status !== 'sent') return undefined
	if (chatType.value === 'group') return message.groupHasRead ? 'read' : 'unread'
	return message.hasRead ? 'read' : 'unread'
}

function ownPendingGroupMessages(): ChatMessage[] {
  if (chatType.value !== 'group') return []
  return messages.value.filter(
    (m) => isMine(m) && m.status === 'sent' && !!m.seq && m.trackGroupRead && !m.groupHasRead,
  )
}

async function refreshGroupReadState(): Promise<void> {
  const pending = ownPendingGroupMessages()
  if (!activeConversationId.value || pending.length === 0) return
  try {
    const state = await fetchGroupReadState(activeConversationId.value)
    const maxSeq = Number(state.maxOtherReadSeq || 0)
    for (const message of messages.value) {
      if (isMine(message) && message.seq && message.seq <= maxSeq) message.groupHasRead = true
    }
    if (ownPendingGroupMessages().length === 0) stopGroupReadPolling()
  } catch { /* 轮询失败不影响聊天；下一轮自动恢复 */ }
}

function startGroupReadPolling(): void {
  if (chatType.value !== 'group' || groupReadPollTimer || ownPendingGroupMessages().length === 0) return
  groupReadPollStartedAt = Date.now()
  void refreshGroupReadState()
  groupReadPollTimer = setInterval(() => {
    if (Date.now() - groupReadPollStartedAt > GROUP_READ_POLL_MAX_MS) {
      stopGroupReadPolling()
      return
    }
    void refreshGroupReadState()
  }, GROUP_READ_POLL_INTERVAL_MS)
}

function stopGroupReadPolling(): void {
  if (groupReadPollTimer) clearInterval(groupReadPollTimer)
  groupReadPollTimer = null
  groupReadPollStartedAt = 0
}

function scheduleGroupReadReport(): void {
  if (chatType.value !== 'group' || !activeConversationId.value) return
  if (groupReadReportTimer) clearTimeout(groupReadReportTimer)
  groupReadReportTimer = setTimeout(() => {
    groupReadReportTimer = null
    void reportGroupReadCursor(activeConversationId.value).catch(swallowError('上报群已读失败'))
  }, 1000)
}

watch(
  () => {
    if (chatType.value !== 'group') return ''
    const last = messages.value[messages.value.length - 1]
    return `${myId.value}|${messages.value.length}|${last?.id || ''}|${last?.status || ''}|${last?.seq || 0}`
  },
  () => {
    if (chatType.value !== 'group') return
    scheduleGroupReadReport()
    startGroupReadPolling()
  },
)

function calendarDayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** 跨天时在消息上方出「昨天 / 星期X / 10月14日」，同一天只出一次 */
function dayLabelOf(message: ChatMessage, index: number): string {
  const key = calendarDayKey(message.createdAt)
  if (!key) return ''
  const prev = index > 0 ? renderMessages.value[index - 1] : undefined
  if (prev && calendarDayKey(prev.createdAt) === key) return ''
  return formatChatDayLabel(message.createdAt)
}

function systemClockOf(message: ChatMessage): string {
  return formatMeridiemClock(message.createdAt)
}

const presenceText = computed(() => {
  if (chatType.value !== 'private') return ''
  const peer = convRef.value?.peerUserId || ''
  return formatLastSeen(peerLastSeenAt.value, peer ? chatStore.isPeerOnline(peer) : false)
})

async function loadPeerPresence() {
  if (chatType.value !== 'private') {
    peerLastSeenAt.value = ''
    return
  }
  let id = businessId.value
  if (!id) {
    try {
      id = await resolveBusinessTarget()
    } catch {
      id = ''
    }
    if (id) businessId.value = id
  }
  if (!id) return
  try {
    const contact = await fetchContact(id)
    peerLastSeenAt.value = contact.lastSeenAt || ''
  } catch {
    peerLastSeenAt.value = ''
  }
}

function systemTextOf(message: ChatMessage): string {
  // 有原始通知体时现场按好友备注重排「X 邀请 Y」，避免入库时备注索引未就绪
  const raw = chatStore.getRawMessage(message.id)
  if (raw && Number(raw.contentType) >= 1000) {
    const text = formatIMNotification(raw, (userId) => {
      const biz = businessUserIdFromIM(userId) || userId
      return friendRemarkOf(biz) || contactStore.remarkOf(biz) || ''
    })
    if (text) return replaceOpenIMAdminLabel(text, groupOwnerName.value)
  }
  return replaceOpenIMAdminLabel(message.content, groupOwnerName.value)
}

function refreshPrivateTitle() {
  if (chatType.value !== 'private' || !businessId.value) return
  const remark = contactStore.remarkOf(businessId.value)
  if (remark) {
    roomTitle.value = remark
    return
  }
  const contact = contactStore.contacts.find(
    (c) => c.id === businessId.value || sameBusinessUserId(c.id, businessId.value),
  )
  if (contact?.nickname) roomTitle.value = contact.nickname
}

watch(
  () => contactStore.remarkByUserId,
  () => {
    if (chatType.value === 'private') refreshPrivateTitle()
  },
  { deep: true },
)

const enterToSend = computed(() => settingsStore.enterToSend)
const hasInput = computed(() => input.value.trim().length > 0)
/**
 * App 软键盘：开回车发送用 send。
 * H5/PC：一律 return，避免 uni confirm-type=send 吞掉 Shift+Enter；发送改由 keydown 处理。
 */
const composerConfirmType = computed(() => {
  if (isH5ComposerPlatform()) return 'return'
  return enterToSend.value ? 'send' : 'return'
})

/** 被禁言（单人 / 全员）时隐藏输入区，换成居中提示条 */
const composerBlocked = computed(() => chatType.value === 'group' && !canChat.value)

const showAnnouncementBanner = computed(() => {
  if (chatType.value !== 'group') return false
  // 依赖这个 epoch：否则存储变化后 computed 不会自动重算
  void announcementDismissEpoch.value
  const text = announcementText.value.trim()
  if (!text) return false
  return !isAnnouncementDismissed(imUserId.value || myId.value, activeConversationId.value, text)
})

const blockTip = computed(() => {
  if (denyReason.value === 'group_muted') return '群主已开启全员禁言'
  if (denyReason.value === 'member_muted') return '您已经被禁言'
  return '当前群暂无法发言'
})

watch(composerBlocked, (blocked) => {
  if (!blocked) return
  showPlusPanel.value = false
  showEmojiPanel.value = false
  if (recording.value) stopVoiceRecord()
  voiceMode.value = false
})

/** 禁言条右侧「检查禁言状态」：重新拉群详情，已解禁则输入区自动恢复，未解禁提示剩余时间 */
const checkingMute = ref(false)
async function checkMuteStatus() {
  if (checkingMute.value) return
  checkingMute.value = true
  try {
    const ok = await refreshGroupMeta()
    if (!ok) {
      uni.showToast({ title: '检查失败，请稍后重试', icon: 'none' })
    } else if (composerBlocked.value) {
      uni.showToast({ title: blockTip.value, icon: 'none' })
    } else {
      uni.showToast({ title: '禁言已解除，可以正常发言', icon: 'none' })
    }
  } finally {
    checkingMute.value = false
  }
}

const actions = useChatMessageActions({
  conversationId: activeConversationId,
  chatType,
  businessId,
  myId,
  myRole,
  input,
  nicknameOf,
  publicAtNameOf,
  isMine,
  visibleMessages: messages,
  conversationTitle: roomTitle,
  peerDisplayName: roomTitle,
  memberMeta: memberMetaMap,
  onMuteChanged: () => {
    void refreshGroupMeta()
  },
  onRetry: (m) => onRetry(m),
})

const pinnedMessage = computed(
  () => chatStore.conversations.find((c) => c.id === activeConversationId.value)?.pinnedMessage || null,
)
const dismissedPinId = ref('')
const visiblePinnedBanner = computed(() => {
  const pin = pinnedMessage.value
  if (!pin?.clientMsgID) return null
  if (dismissedPinId.value && dismissedPinId.value === pin.clientMsgID && pin.scope === 'shared') {
    return null
  }
  return pin
})

watch(
  () => pinnedMessage.value?.clientMsgID,
  (id) => {
    if (id && id !== dismissedPinId.value) dismissedPinId.value = ''
  },
)

/** 定位到某条消息并居中。倒置列表里 scrollTop 增大 = 内容往下移，按视觉中心差值换算 */
function scrollToMessage(id: string) {
  focusedMsgId.value = id
  stickToBottom.value = false
  const all = messages.value
  const idx = all.findIndex((m) => m.id === id)
  if (idx >= 0 && !renderMessages.value.some((m) => m.id === id)) {
    renderFromId.value = all[Math.max(0, idx - 10)].id
  }
  nextTick(() => {
    setTimeout(() => {
      uni
        .createSelectorQuery()
        .select('.msg-list')
        .boundingClientRect()
        .select(`#msg_${id}`)
        .boundingClientRect()
        .exec((res) => {
          const box = res?.[0] as UniApp.NodeInfo | null
          const el = res?.[1] as UniApp.NodeInfo | null
          if (!box || !el) return
          const boxCenter = Number(box.top || 0) + Number(box.height || 0) / 2
          const elCenter = Number(el.top || 0) + Number(el.height || 0) / 2
          setMsgScrollTop(lastListScrollTop + boxCenter - elCenter)
        })
    }, 30)
  })
  setTimeout(() => {
    if (focusedMsgId.value === id) focusedMsgId.value = ''
  }, 1600)
}

/** 点击引用块：翻历史定位并滚到原消息（与搜索跳转共用 locateMessage） */
async function onQuoteClick(clientMsgId: string) {
  if (!activeConversationId.value || !clientMsgId) return
  stickToBottom.value = false
  uni.showLoading({ title: '定位中…', mask: true })
  try {
    const found = await chatStore.locateMessage(activeConversationId.value, clientMsgId)
    await nextTick()
    if (found) {
      scrollToMessage(clientMsgId)
    } else {
      uni.showToast({ title: '未找到该条消息', icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '定位失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function jumpToPinnedMessage() {
  const id = pinnedMessage.value?.clientMsgID
  if (!id) return
  scrollToMessage(id)
}

async function dismissPinnedBanner() {
  const pin = pinnedMessage.value
  if (!pin) return
  if (pin.scope === 'self') {
    try {
      await chatStore.unpinChatMessage(activeConversationId.value, false)
    } catch (e) {
      uni.showToast({ title: (e as Error)?.message || '取消置顶失败', icon: 'none' })
    }
    return
  }
  // 共享置顶：有管理权限则真正取消；普通成员仅本端收起横幅
  const canUnpinShared =
    chatType.value === 'private' || myRole.value === 'owner' || myRole.value === 'admin'
  if (canUnpinShared) {
    try {
      await chatStore.unpinChatMessage(activeConversationId.value, true)
    } catch (e) {
      uni.showToast({ title: (e as Error)?.message || '取消置顶失败', icon: 'none' })
    }
    return
  }
  dismissedPinId.value = pin.clientMsgID
}

/** onLoad 刚拉过群详情时 onShow 会紧跟着触发，跳过重复请求 */
let groupMetaLoadedAt = 0

onShow(() => {
  // 回到前台的「补拉当前会话」由 chatStore.resyncAfterResume 统一负责
  // （本组件在桌面端是内嵌的，收不到页面级 onShow，所以统一走 store 那条路径，
  //  见下方 watch(conversationId, ...) 的报备）。这里不再重复拉一次。
	if (chatType.value === 'group') {
    if (Date.now() - groupMetaLoadedAt > 2000) {
      void refreshGroupMeta()
    }
    scheduleGroupReadReport()
    startGroupReadPolling()
  }
  if (chatType.value === 'private') {
    refreshPrivateTitle()
    void loadPeerPresence()
  }
  if (forwardStore.consumeSucceeded()) {
    actions.cancelSelect()
    successVisible.value = true
    return
  }
  // 转发页点返回/取消后，选择态和引用不能继续占着输入栏
  if (actions.selecting.value && actions.selectMode.value === 'forward' && forwardStore.messageIds.length === 0) {
    actions.cancelSelect()
  }
})

onHide(() => {
  stopGroupReadPolling()
  if (groupReadReportTimer) clearTimeout(groupReadReportTimer)
  groupReadReportTimer = null
})

onUnload(() => {
  if (typeof window !== 'undefined') window.removeEventListener('paste', onWindowPaste)
  stopGroupReadPolling()
  if (groupReadReportTimer) clearTimeout(groupReadReportTimer)
  groupReadReportTimer = null
  if (muteExpireTimer) {
    clearTimeout(muteExpireTimer)
    muteExpireTimer = null
  }
  if (dissolveExitTimer) {
    clearTimeout(dissolveExitTimer)
    dissolveExitTimer = null
  }
  chatStore.setOnIncomingForDissolve(null)
  chatStore.setOnGroupUnavailable(null)
  chatStore.trimConversationMemory(activeConversationId.value)
})

/**
 * 群已解散的统一出口：提示「该群已解散」并回到聊天列表。
 * 触发源：群详情 404、实时解散通知、OpenIM errCode=10006 等。
 */
let roomExited = false
let dissolveExitTimer: ReturnType<typeof setTimeout> | null = null

function leaveRoomAfterToast(title: string) {
  if (roomExited) return
  roomExited = true
  stopGroupReadPolling()
  uni.showToast({ title, icon: 'none', duration: 2000 })
  if (props.embedded) {
    emit('dissolved')
    return
  }
  dissolveExitTimer = setTimeout(() => {
    dissolveExitTimer = null
    uni.switchTab({ url: '/pages/chat/index' })
  }, 400)
}

function exitDissolvedRoom() {
  leaveRoomAfterToast(props.embedded ? '这个聊天已不存在' : '该群已解散')
}

/** 业务库仍有记录但 OpenIM 侧已不在群（1002 等），与「群已解散」区分 */
function exitUnavailableGroupRoom() {
  leaveRoomAfterToast(props.embedded ? '这个聊天已不存在' : '你已不在该群聊')
}

/**
 * 用户在房间时收到群解散通知时，自动提示并返回聊天列表。
 * 通过 chatStore.setOnIncomingForDissolve 注册回调，避开 messagesMap 的 reactive watch。
 */
function handleIncomingForDissolve(message: { conversationId?: string; notificationKind?: string }) {
  if (chatType.value !== 'group') return
  if (message.conversationId !== activeConversationId.value) return
  if (message.notificationKind !== 'dissolved') return
  exitDissolvedRoom()
}
chatStore.setOnIncomingForDissolve(handleIncomingForDissolve)

function handleGroupUnavailable(payload: { conversationId: string }) {
  if (chatType.value !== 'group') return
  if (payload.conversationId !== activeConversationId.value) return
  exitUnavailableGroupRoom()
}
chatStore.setOnGroupUnavailable(handleGroupUnavailable)

// 把当前会话报备给 store。
// 桌面端（H5 三栏布局）本组件是内嵌的、不是页面，页面级 onShow/onHide 不触发，
// 「回到前台补拉当前会话」只能由 chatStore.resyncAfterResume 代劳。
watch(
  activeConversationId,
  (id) => {
    resetMediaCacheQueue()
    chatStore.setActiveConversation(id)
  },
  { immediate: true },
)

/** onShow 重拉群详情发现已解散（如 App 后台期间群被解散）时，同样提示并退出 */
watch(groupDissolved, (dissolved) => {
  if (dissolved) exitDissolvedRoom()
})

watch(
  () => props.conversationId,
  () => {
    showGroupMenu.value = false
    showFriendDetail.value = false
  },
)

onLoad(async (query) => {
  if (props.embedded) return
  await bootstrapRoom(query as Record<string, string | undefined>)
})

function syncVisualViewport() {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  if (!vv) return
  // 布局视口与可视视口差值大 → 键盘顶起来了；用 vv.height 撑满可编辑区域，消掉灰缝
  const layoutH = window.innerHeight || 0
  const offset = Math.max(0, vv.offsetTop || 0)
  const visible = Math.max(0, Math.round(vv.height + offset))
  const gap = layoutH - vv.height
  keyboardOpen.value = gap > 80
  vvHeightPx.value = keyboardOpen.value ? visible : 0
}

onMounted(() => {
  if (typeof window !== 'undefined' && isH5ComposerPlatform()) {
    window.addEventListener('paste', onWindowPaste)
    // 捕获阶段处理 Enter：uni-textarea 的 @keydown 会丢 shiftKey，导致 Shift+Enter 被当成发送
    window.addEventListener('keydown', onComposerKeydown, true)
    window.addEventListener('wheel', onMsgListWheel, { passive: false })
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', syncVisualViewport)
      vv.addEventListener('scroll', syncVisualViewport)
      syncVisualViewport()
    }
  }
  if (!props.embedded || !props.conversationId) return
  void bootstrapRoom({
    conversationId: props.conversationId,
    type: props.type,
    title: props.title,
    avatar: props.avatar,
    clientMsgId: props.clientMsgId,
  })
})

/** SDK 资源未就绪时原文含 errCode / withStack，不直接展示 */
function roomOpenErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  if (!message || /errCode=|withStack|not load resource|10004|10005/.test(message)) {
    return '聊天记录还在同步，请稍后再试'
  }
  return message
}

async function bootstrapRoom(query: Record<string, string | undefined>) {
  roomExited = false
  roomFirstMessagesMarked = false
  perfMarkStart('chat:room-first-messages')
  roomTitle.value = decodeURIComponent(String(query?.title || '聊天'))
  peerAvatar.value = decodeURIComponent(String(query?.avatar || APP_CONFIG.defaultAvatarUrl))
  chatType.value = String(query?.type || 'group') === 'private' ? 'private' : 'group'
  businessId.value = String(query?.targetId || '')
  if (!props.embedded) {
    uni.setNavigationBarTitle({ title: '' })
    uni.hideNavigationBarLoading?.()
  }

  try {
    const convIdHint = String(query?.conversationId || '')
    if (convIdHint) activeConversationId.value = convIdHint

    await ensureIMLogin()
    // 必须在拉历史之前写上。本地库很快时，消息会先于 enterConversation 画出来，
    // 此时 myId 仍为空，自己的气泡会落在左边，App 滚动列表不一定会再改位置。
    if (imUserId.value) myId.value = imUserId.value

    const enterTask = (async () => {
      perfMarkStart('chat:room-enter-conversation')
      const conv = await chatStore.enterConversation({
        conversationId: convIdHint,
        type: chatType.value,
        businessId: businessId.value,
      })
      perfMarkEnd('chat:room-enter-conversation')
      return conv
    })()

    const loadTask = (async () => {
      if (convIdHint) {
        return chatStore.loadMessages(convIdHint).catch((e: unknown) => {
          const message = e instanceof Error ? e.message : ''
          if (chatType.value === 'group' && message.includes('10006')) {
            exitDissolvedRoom()
            return
          }
          throw e
        })
      }
      const conv = await enterTask
      return chatStore.loadMessages(conv.id).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : ''
        if (chatType.value === 'group' && message.includes('10006')) {
          exitDissolvedRoom()
          return
        }
        throw e
      })
    })()

    const groupMetaTask = (async () => {
      if (chatType.value !== 'group') return
      perfMarkStart('chat:room-group-meta')
      try {
        const conv = await enterTask
        convRef.value = conv
        if (!businessId.value) {
          try {
            businessId.value = await resolveBusinessTarget()
          } catch {
            businessId.value = ''
          }
        }
        if (businessId.value) {
          await refreshGroupMeta()
        }
      } finally {
        perfMarkEnd('chat:room-group-meta')
      }
    })()

    const conv = await enterTask
    convRef.value = conv
    activeConversationId.value = conv.id
    if (!query?.title) roomTitle.value = conv.title

    myId.value = imUserId.value
    if (!myId.value) {
      throw new Error('当前 IM 用户 ID 未初始化，请重新登录')
    }

    if (chatType.value === 'private') {
      void contactStore.ensureRemarkIndex().then(() => refreshPrivateTitle())
      refreshPrivateTitle()
      void loadPeerPresence()
    } else if (chatType.value === 'group') {
      // 邀请人/被邀请人系统提示依赖备注索引
      void contactStore.ensureRemarkIndex()
    }

    await Promise.all([loadTask, groupMetaTask])
    if (chatType.value === 'group') {
      try {
        await chatStore.assertConversationAccessible(conv)
      } catch (e) {
        if (isGroupUnavailableError((e as Error)?.message)) {
          exitUnavailableGroupRoom()
          return
        }
      }
    }
    if (chatType.value === 'group' && groupDissolved.value) {
      exitDissolvedRoom()
      return
    }
    const focusId = String(query?.clientMsgId || props.clientMsgId || '')
    if (focusId) {
      renderFromId.value = ''
      stickToBottom.value = false
      const found = await chatStore.locateMessage(conv.id, focusId)
      await nextTick()
      if (found) {
        stickToBottom.value = false
        scrollToMessage(focusId)
      } else {
        uni.showToast({ title: '未找到该条聊天记录', icon: 'none' })
        scrollToBottom(true)
      }
    } else {
      renderFromId.value = ''
      stickToBottom.value = true
      await nextTick()
      scrollToBottom(true)
    }
    // 电脑端切换会话后直接进入可输入态，不用再点一次输入框；
    // 聚焦会改输入区高度，延后再贴一次底，避免最新消息被挡住。
    if (props.embedded) {
      focusComposer()
      setTimeout(() => {
        if (stickToBottom.value) scrollToBottom(true)
      }, 220)
    }
  } catch (e) {
    console.error('[chat] 打开会话失败', e)
    uni.showToast({ title: roomOpenErrorText(e), icon: 'none', duration: 2500 })
  }
}

let loadingMore = false
/**
 * 倒置列表的 scrolltolower = 视觉上接近顶部（lower-threshold 提前量预加载）。
 * 先扩内存里已有的，再向 SDK 要更早一页；追加都在滚动远端，不需要任何位置补偿。
 */
async function onReachOldest() {
  if (revealOlderMessages()) return
  const convId = activeConversationId.value
  if (!convId || loadingMore) return
  loadingMore = true
  loadingOlder.value = true
  try {
    // 一页全是不可见通知时列表不会变长，用户停在顶端也就收不到下一次触发，这里连拉几页
    for (let i = 0; i < 3; i++) {
      const before = messages.value.length
      const added = await chatStore.loadMoreMessages(convId)
      if (convId !== activeConversationId.value) return
      if (!added) break
      if (messages.value.length > before) {
        renderAllMessages()
        break
      }
    }
  } finally {
    loadingMore = false
    loadingOlder.value = false
  }
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  const minute = String(Math.floor(total / 60)).padStart(2, '0')
  const second = String(total % 60).padStart(2, '0')
  return `${minute}:${second}`
}

function clearRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
}

function cleanupBrowserRecorder() {
  if (browserRecorder) {
    browserRecorder.stream.getTracks().forEach((track) => track.stop())
    browserRecorder = null
  }
  recorder = null
}

/** uni scroll-top 同值不触发：在目标值上交替叠 0 / 0.5px，肉眼不可见 */
function setMsgScrollTop(top: number) {
  msgScrollTopNonce = msgScrollTopNonce ? 0 : 0.5
  msgScrollTop.value = Math.max(0, top) + msgScrollTopNonce
}

let collapseWindowTimer: ReturnType<typeof setTimeout> | null = null

/** 回到底部后再把挂载窗口收回尾部：裁掉的都在滚动远端，先滚后裁才不会因 scrollTop 被夹而闪 */
function collapseRenderWindowSoon() {
  if (collapseWindowTimer) clearTimeout(collapseWindowTimer)
  collapseWindowTimer = setTimeout(() => {
    collapseWindowTimer = null
    if (stickToBottom.value && lastListScrollTop < 60) renderFromId.value = ''
  }, 300)
}

/** 贴底 = scrollTop 归零；倒置列表里内容撑高不会让底部移位，无需重试 */
function scrollToBottom(force = false) {
  // 自己发消息必须贴底。手指标志在 iOS / 部分安卓上可能停在 true，不能因此把发送结果留在屏幕外
  if (userHoldingList && !force) return
  if (!force && !stickToBottom.value) return
  stickToBottom.value = true
  setMsgScrollTop(0)
  if (renderFromId.value) collapseRenderWindowSoon()
}

/** 手指按在消息列表上：此时不做自动贴底，避免和滑动对拉 */
let userHoldingList = false
function onMsgListTouchStart() {
  userHoldingList = true
}
function onMsgListTouchEnd() {
  userHoldingList = false
}

/** 离开底部时钉住当前渲染窗口顶部，避免尾部 slice(-48) 被新消息挤掉导致往上跳 */
function pinRenderWindowTop() {
  if (renderFromId.value) return
  const first = renderMessages.value[0]?.id
  if (first) renderFromId.value = first
}

function onMsgScroll(e: { detail?: { scrollTop?: number } }) {
  const top = Number(e.detail?.scrollTop || 0)
  lastListScrollTop = top
  // 倒置后 scrollTop 就是离底部的距离；回调里不改 scroll-top，避免和手势对拉
  if (top < 60) stickToBottom.value = true
  else if (top > 120) {
    if (stickToBottom.value) pinRenderWindowTop()
    stickToBottom.value = false
  }
}

/**
 * H5 桌面：列表倒置，滚轮/触控板方向要再翻回来。
 * uni-scroll-view 里有两层 .uni-scroll-view，外层只是包裹；真正 overflow 的是内容节点的父元素。
 * 滚错节点再 preventDefault，滚轮会被吃掉、列表完全不动。触摸滑动不走这里。
 */
function onMsgListWheel(e: WheelEvent) {
  if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  const node = e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null
  const root = node?.closest('.msg-list')
  const scroller = root?.querySelector('.uni-scroll-view-content')?.parentElement
  if (!(scroller instanceof HTMLElement)) return
  const max = scroller.scrollHeight - scroller.clientHeight
  if (max <= 1) return
  e.preventDefault()
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1
  const next = Math.min(max, Math.max(0, scroller.scrollTop - e.deltaY * unit))
  scroller.scrollTop = next
  // 滚轮不保证触发 @scroll，这里同步贴底状态，避免翻历史时来新消息又贴回去
  lastListScrollTop = next
  if (next < 60) stickToBottom.value = true
  else if (next > 120) {
    if (stickToBottom.value) pinRenderWindowTop()
    stickToBottom.value = false
  }
}

function jumpToBottom() {
  userHoldingList = false
  stickToBottom.value = true
  setMsgScrollTop(0)
  collapseRenderWindowSoon()
}

watch(
  () => messages.value[messages.value.length - 1]?.id,
  (id, prev) => {
    if (!id || id === prev) return
    // 正在上翻看历史：钉住窗口顶部，只追加新消息，绝不贴底、不挤掉正在看的气泡
    if (!stickToBottom.value) {
      pinRenderWindowTop()
      return
    }
    nextTick(() => scrollToBottom())
  },
)

/** H5 同步实际 DOM；iOS App 另外通过 inputEpoch 重置原生输入控件。 */
function setComposerText(text: string) {
  input.value = text
  if (!isH5ComposerPlatform()) return
  const el = getComposerTextareaEl()
  if (el && el.value !== text) el.value = text
}

async function onSend() {
  if (composerBlocked.value) return
  // H5 回车发送：以 textarea 实值为准，避免 v-model 滞后读到空串又把 DOM 旧字留着
  if (isH5ComposerPlatform()) {
    const el = getComposerTextareaEl()
    if (el && el.value !== input.value) input.value = el.value
  }
  const text = input.value.trim()
  if (!text) return
  // 发送前先快照：失败要回填输入；atList 无论成败都清空，避免残留劫持后续普通消息
  const pendingAt = [...actions.atList.value]
  const hadQuote = !!actions.quote.value
  const conversationId = activeConversationId.value
  const draft = composerInput.clearForSend()
  setComposerText('')
  userHoldingList = false
  actions.atList.value = []
  showPlusPanel.value = false
  closeAtMention()
  try {
    if (actions.quote.value) {
      await chatStore.sendQuote(
        activeConversationId.value,
        text,
        actions.quote.value.id,
        imUserId.value || myId.value,
      )
      actions.clearQuote()
    } else if (pendingAt.length > 0) {
      await chatStore.sendAtText(
        activeConversationId.value,
        text,
        imUserId.value || myId.value,
        pendingAt,
      )
    } else {
      await chatStore.sendText(activeConversationId.value, text, imUserId.value || myId.value)
    }
    scrollToBottom(true)
  } catch (e) {
    // 只恢复尚未编辑过的草稿，不能覆盖用户正在输入的下一条消息。
    if (activeConversationId.value === conversationId && composerInput.restoreAfterFailure(draft)) {
      setComposerText(input.value)
    }
    if (hadQuote && !actions.quote.value) {
      /* quote 已清则不再恢复，避免重复引用 */
    }
    if (isGroupUnavailableError((e as Error)?.message) || isNotInGroupIMError(e)) {
      exitUnavailableGroupRoom()
      return
    }
    // 非好友/拉黑/禁言等：气泡红叹号之外再给一句人话，和后台失败原因对齐
    uni.showToast({ title: friendlySendFailMessage(e), icon: 'none', duration: 2500 })
  } finally {
    focusComposer()
  }
}

/** uni-app textarea 的 focus 属性：切会话时先 false 再 true 才能重新抢焦点 */
const composerFocusFlag = ref(false)

function focusComposer() {
  if (!isH5ComposerPlatform()) return
  if (composerBlocked.value || voiceMode.value) return
  composerFocusFlag.value = false
  const apply = () => {
    composerFocusFlag.value = true
    const el = getComposerTextareaEl()
    if (!el) return
    // 与 v-model 对齐，避免清空后 DOM 仍是旧内容、光标落在「幽灵字」末尾
    if (el.value !== input.value) el.value = input.value
    el.focus()
    const len = el.value.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      /* 部分内嵌 textarea 不允许设置选区 */
    }
  }
  nextTick(apply)
  // 消息列表/群资料异步渲染后还要再抢一次，否则会落在文档 body 上
  setTimeout(apply, 40)
  setTimeout(apply, 160)
}

function isH5ComposerPlatform(): boolean {
  try {
    const platform = uni.getSystemInfoSync().uniPlatform
    return platform === 'web' || platform === 'h5'
  } catch {
    return false
  }
}

function getComposerTextareaEl(preferred?: EventTarget | null): HTMLTextAreaElement | null {
  if (preferred instanceof HTMLTextAreaElement) return preferred
  const raw = inputRef.value
  if (raw instanceof HTMLTextAreaElement) return raw
  const wrapped = (raw as { $el?: HTMLElement } | null)?.$el
  if (wrapped instanceof HTMLTextAreaElement) return wrapped
  if (wrapped?.querySelector) {
    const nested = wrapped.querySelector('textarea')
    if (nested instanceof HTMLTextAreaElement) return nested
  }
  return null
}

let lastSendTriggerAt = 0

function triggerSend() {
  if (Date.now() - lastSendTriggerAt < 200) return
  lastSendTriggerAt = Date.now()
  void onSend()
}

function onConfirmSend(e?: ComposerInputEvent) {
  if (!composerInput.isCurrentEvent(e)) return
  // H5 已在 keydown 处理；此处只服务 App 软键盘「发送」
  if (isH5ComposerPlatform()) return
  if (!enterToSend.value) return
  // 部分机型点键盘发送时，v-model 已经空了，字还在事件里
  const fromEvent = typeof e?.detail === 'object' ? e.detail?.value : undefined
  if (typeof fromEvent === 'string' && fromEvent.trim() && !input.value.trim()) {
    input.value = fromEvent
  }
  triggerSend()
}

function onComposerFocus(e: ComposerInputEvent) {
  if (composerInput.isCurrentEvent(e)) composerFocusFlag.value = true
}

function onComposerBlur(e: ComposerInputEvent) {
  if (composerInput.isCurrentEvent(e)) composerFocusFlag.value = false
}

/** 输入框触到 max-height 后，把光标行滚进可视区（粘贴/换行常见） */
function scrollComposerCaretIntoView(preferred?: EventTarget | null) {
  if (!isH5ComposerPlatform()) return
  const el = getComposerTextareaEl(preferred)
  if (!el) return
  const run = () => {
    try {
      el.scrollTop = el.scrollHeight
    } catch {
      /* ignore */
    }
  }
  nextTick(run)
  requestAnimationFrame(run)
}

function composerPasteTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  if (el?.closest('.composer-row .input-wrap')) return true
  const composer = getComposerTextareaEl(target)
  return !!composer && (target === composer || document.activeElement === composer)
}

function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const file of Array.from(data.files || [])) {
    if (file.type.startsWith('image/')) files.push(file)
  }
  if (files.length || !data.items) return files
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

/** H5/PC：粘贴图片先确认，避免「粘贴完自己就发出去」 */
function onWindowPaste(e: Event) {
  const event = e as ClipboardEvent
  if (!isH5ComposerPlatform() || composerBlocked.value || voiceMode.value) return
  if (!composerPasteTarget(event.target)) return
  const files = clipboardImageFiles(event.clipboardData).slice(0, MAX_PICK_COUNT)
  if (!files.length) return
  event.preventDefault()
  const tip = files.length === 1 ? '发送这张图片？' : `发送这 ${files.length} 张图片？`
  void uni
    .showModal({
      title: '发送图片',
      content: tip,
      confirmText: '发送',
      cancelText: '取消',
    })
    .then((res) => {
      if (res.confirm) void sendPastedImages(files)
    })
}

async function sendPastedImages(files: File[]) {
  if (!activeConversationId.value) {
    uni.showToast({ title: '会话未就绪', icon: 'none' })
    return
  }
  const jobs = files.map((file) => {
    const path = URL.createObjectURL(file)
    return chatStore.prepareOutgoingImage(activeConversationId.value, path, imUserId.value || myId.value)
  })
  await nextTick()
  scrollToBottom(true)
  await sendImageJobs(jobs, (path) => URL.revokeObjectURL(path))
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('paste', onWindowPaste)
    window.removeEventListener('keydown', onComposerKeydown, true)
    const vv = window.visualViewport
    if (vv) {
      vv.removeEventListener('resize', syncVisualViewport)
      vv.removeEventListener('scroll', syncVisualViewport)
    }
    window.removeEventListener('wheel', onMsgListWheel)
  }
  if (collapseWindowTimer) clearTimeout(collapseWindowTimer)
  // 用 onUnmounted 而不是页面级的 onUnload：桌面端内嵌时 onUnload 不会触发，
  // 留下过期的 activeConversationId 会让补拉去拉一个已经关掉的会话。
  chatStore.setActiveConversation('')
})

/**
 * H5/PC 回车：开「回车发送」时 Enter 发送、Shift+Enter 换行；
 * 关时 Enter 自然换行，并滚到输入框最后一排。
 * 挂在 window 捕获阶段：组件 @keydown 读不到真实 shiftKey。
 */
function onComposerKeydown(e: KeyboardEvent) {
  if (!isH5ComposerPlatform()) return
  if (e.key !== 'Enter') return
  if (e.isComposing || e.keyCode === 229) return
  if (!composerPasteTarget(e.target)) return

  if (enterToSend.value) {
    if (e.shiftKey) {
      e.preventDefault()
      e.stopImmediatePropagation()
      const el = getComposerTextareaEl(e.target)
      if (!el) return
      // DOM 与 v-model 偶发不同步（自动化 fill / IME），以 textarea 实值为准
      const val = el.value || input.value
      const start = el.selectionStart ?? val.length
      const end = el.selectionEnd ?? start
      input.value = `${val.slice(0, start)}\n${val.slice(end)}`
      void nextTick(() => {
        const pos = start + 1
        try {
          el.selectionStart = pos
          el.selectionEnd = pos
        } catch {
          /* ignore */
        }
        el.focus()
        scrollComposerCaretIntoView(el)
      })
      return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
    // 发送前把 DOM 值刷回 v-model，避免 Enter 时 input 仍是空串
    const el = getComposerTextareaEl(e.target)
    if (el && el.value !== input.value) input.value = el.value
    triggerSend()
    return
  }
  nextTick(() => scrollComposerCaretIntoView(e.target))
}

/** 重发：先二次确认，再按原类型重新发送 */
function onRetry(m: ChatMessage) {
  uni.showModal({
    title: '重新发送',
    content: '是否重新发送这条消息？',
    confirmText: '重发',
    confirmColor: '#e54d42',
    success: (res) => {
      if (res.confirm) doRetry(m)
    },
  })
}

/** 重发失败的文本/图片/语音/文件消息：按原类型重新发送，成功后移除旧的失败气泡 */
async function doRetry(m: ChatMessage) {
  if (!activeConversationId.value) return
  const senderId = imUserId.value || myId.value
  try {
    if (m.type === 'text') {
      await chatStore.sendText(activeConversationId.value, m.content, senderId)
    } else if (m.type === 'image') {
      if (/^(https?|blob|file):/.test(m.content)) {
        await chatStore.sendImageUrl(activeConversationId.value, m.content, senderId)
      } else {
        await chatStore.sendImage(activeConversationId.value, m.content, senderId)
      }
    } else if (m.type === 'voice') {
      let path = ''
      let duration = 0
      try {
        const meta = JSON.parse(m.content) as { path?: string; duration?: number }
        path = meta.path || ''
        duration = Number(meta.duration || 0)
      } catch {
        path = m.content
      }
      if (path) await chatStore.sendVoice(activeConversationId.value, path, duration, senderId)
    } else if (m.type === 'file') {
      const name = m.content.split(/[\\/]/).filter(Boolean).pop() || '文件'
      await chatStore.sendFile(activeConversationId.value, m.content, name, senderId)
    } else if (m.type === 'video') {
      let path = m.content
      let duration = 0
      let snapshot = ''
      try {
        const meta = JSON.parse(m.content) as { url?: string; duration?: number; snapshotUrl?: string }
        path = meta.url || m.content
        duration = Number(meta.duration || 0)
        snapshot = meta.snapshotUrl || ''
      } catch {
        /* 旧失败气泡可能直接存路径 */
      }
      if (path) await chatStore.sendVideo(activeConversationId.value, path, senderId, duration, snapshot)
    }
    await chatStore.removeLocal(activeConversationId.value, m.id).catch(() => undefined)
    await nextTick()
    scrollToBottom(true)
  } catch (e) {
    uni.showToast({ title: friendlySendFailMessage(e), icon: 'none', duration: 2500 })
  }
}

function goBack() {
  if (props.embedded) {
    emit('close')
    return
  }
  safeBack('/pages/chat/index')
}

/**
 * 解析资料页所需的「业务 ID」。
 * 通讯录 / 好友详情进来时已带 targetId（业务 ID），直接用；
 * 聊天列表点进来只有 OpenIM 会话 ID，需要根据会话反查：
 *  - 私聊：OpenIM 用户 ID 逆运算回业务 UUID（与 resolveIMPeer 同一套 ID）。
 *  - 群聊：OpenIM 群 ID → 后端反查出对外 public ID（群资料页与 resolveIMGroup 需要它）。
 */
async function resolveBusinessTarget(): Promise<string> {
  if (businessId.value) return businessId.value
  const conv = convRef.value
  if (!conv) return ''
  if (chatType.value === 'private') {
    return businessUserIdFromIM(conv.peerUserId || '')
  }
  if (conv.groupId) {
    try {
      const target = await resolveIMGroupByIM(conv.groupId)
      return target.businessGroupId
    } catch {
      return ''
    }
  }
  return ''
}

/** 拉群成员元信息：长按菜单的禁言/踢人权限、头像与备注兜底、@ 提及列表 */
async function loadGroupMembersMeta(groupId: string): Promise<void> {
  try {
    const members = await fetchAllGroupMembers(groupId)
    const meta: Record<string, MemberMeta> = {}
    const avatars: Record<string, string> = {}
    const remarks: Record<string, string> = {}
    for (const m of members) {
      meta[m.id] = { role: m.role, isMuted: !!m.isMuted }
      if (m.avatar) avatars[m.id] = m.avatar
      const remark = m.memberRemark?.trim()
      if (remark) remarks[m.id] = remark
    }
    memberMetaMap.value = meta
    memberAvatarMap.value = avatars
    memberRemarkMap.value = remarks
    groupMembersForAt.value = members
    void fillFriendRemarks(members.map((m) => m.id))
  } catch {
    // 成员列表失败不阻断聊天；管控项由后端兜底
  }
}

/**
 * 拉「移除该成员并删除消息」的清理水位。和成员名单一样在 refreshGroupMeta 里刷新，
 * 所以收到成员变更通知（含被踢）时其他成员也会跟着更新，把被清理成员的历史消息隐藏掉。
 */
async function loadMessagePurges(groupId: string): Promise<void> {
  try {
    const items = await fetchGroupMessagePurges(groupId)
    const next: Record<string, number> = {}
    for (const it of items) {
      const ts = Date.parse(it.purgedAt)
      if (it.userId && Number.isFinite(ts)) next[it.userId] = ts
    }
    purgedMap.value = next
  } catch {
    // 拉取失败不阻断聊天；下次进群/成员变更时会再拉
  }
}

/** 业务 UUID → OpenIM userID（去连字符） */
function openIMUserIdOf(businessUserId: string): string {
  return businessUserId.replace(/-/g, '').toLowerCase()
}

/**
 * 群成员备注只从好友索引取，绝不对非好友打 GET /contacts/:id。
 * 旧逻辑对「不在通讯录当前页」的成员逐个 fetchContact，群内非好友会刷一堆 404「好友不存在」。
 */
async function fillFriendRemarks(userIds: string[]) {
  try {
    await contactStore.ensureFriendIndex()
  } catch {
    /* 索引失败不阻断聊天；气泡仍有群昵称/昵称 */
  }
  const found: Record<string, string> = {}
  for (const id of new Set(userIds)) {
    if (!id || id === myId.value) continue
    const remark = contactStore.remarkOf(id)?.trim()
    if (remark) found[id] = remark
  }
  if (Object.keys(found).length) {
    friendRemarkMap.value = { ...friendRemarkMap.value, ...found }
  }
}

/** 本地 UI（气泡/列表）可优先好友备注；会同步出去的 @ 正文绝不能用备注。 */
function memberDisplayName(m: GroupMember): string {
  return friendRemarkOf(m.id) || m.memberRemark?.trim() || m.groupNickname || m.nickname || '成员'
}

/** @ 提及写入消息体的公开名：群昵称 > 用户昵称，不含好友备注 */
function memberPublicAtName(m: GroupMember): string {
  return (m.groupNickname || m.nickname || '成员').trim() || '成员'
}

/** 从消息解析 @ 用公开名：不能走 nicknameOf（会优先好友备注） */
function publicAtNameOf(message: ChatMessage): string {
  const uid = businessUserIdFromIM(message.senderId)
  if (uid) {
    const member = groupMembersForAt.value.find((m) => sameBusinessUserId(m.id, uid))
    if (member) return memberPublicAtName(member)
  }
  return (message.senderNickname || '用户').trim() || '用户'
}

const canAtAll = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
/** @ 面板拉成员中：App 上进群后立刻打 @ 时名单常还没到，先显示加载而不是「无匹配」 */
const atMentionLoading = ref(false)

const atMentionMembers = computed<AtMentionMember[]>(() => {
  const me = myId.value
  const meIm = (imUserId.value || myId.value || '').toLowerCase().replace(/-/g, '')
  return groupMembersForAt.value
    .filter((m) => {
      if (!m.id) return false
      // myId 在房间里是 OpenIM id（无横线），成员 id 是业务 UUID——不能直接 ===
      const mid = openIMUserIdOf(m.id)
      if (meIm && mid === meIm) return false
      if (me && (m.id === me || sameBusinessUserId(m.id, me) || mid === openIMUserIdOf(me))) return false
      return true
    })
    .map((m) => ({
      id: m.id,
      imUserId: openIMUserIdOf(m.id),
      // 面板可显示备注名；真正写入 atList / 正文用 publicName，避免对方看到我的备注
      name: memberDisplayName(m),
      publicName: memberPublicAtName(m),
      avatar: m.avatar || APP_CONFIG.defaultAvatarUrl,
    }))
})

/** 输入框末尾是否处于「刚打了 @」的提及态。
 * 匹配：行首或空白后的 `@关键字`（关键字不含空白与 @）。
 * App 中文输入法偶发插入全角 ＠，统一成半角再匹配。
 */
function syncAtMentionFromInput(e?: ComposerInputEvent) {
  // 显式接管输入，避免 v-model 在过滤旧控件事件之前先把已发送的文字写回来。
  const currentValue = e && isH5ComposerPlatform() ? getComposerTextareaEl()?.value : undefined
  if (e && !composerInput.onInput(e, currentValue)) return
  // 粘贴/换行后输入框触到 max-height，需主动滚到光标行
  const pasteTarget = e && 'target' in e ? (e as Event).target : null
  scrollComposerCaretIntoView(pasteTarget)
  if (chatType.value !== 'group' || composerBlocked.value) {
    closeAtMention()
    return
  }
  const text = input.value.replace(/\uFF20/g, '@')
  if (text !== input.value) input.value = text
  const match = /(^|[\s\n])@([^\s@]*)$/.exec(text)
  if (!match) {
    closeAtMention()
    return
  }
  const atIndex = text.length - (match[2]?.length || 0) - 1
  atMentionStart.value = atIndex
  atMentionKeyword.value = match[2] || ''
  atMentionVisible.value = true
  showPlusPanel.value = false
  showEmojiPanel.value = false
  // 成员名单没到就 await 拉；只 fire-and-forget 时 App 上会一直显示「无匹配成员」
  if (!groupMembersForAt.value.length && businessId.value) {
    atMentionLoading.value = true
    void loadGroupMembersMeta(businessId.value).finally(() => {
      atMentionLoading.value = false
    })
  }
}

function closeAtMention() {
  atMentionVisible.value = false
  atMentionKeyword.value = ''
  atMentionStart.value = -1
}

/** 用选中的提及替换输入中的 `@关键字`，并写入 atList */
function applyAtMention(name: string, imUserId: string) {
  const start = atMentionStart.value
  if (start < 0) {
    closeAtMention()
    return
  }
  const before = input.value.slice(0, start)
  const rest = input.value.slice(start).replace(/^@[^\s@]*/, '')
  const token = `@${name} `
  input.value = `${before}${token}${rest}`
  if (imUserId && !actions.atList.value.some((a) => a.atUserID === imUserId)) {
    actions.atList.value.push({ atUserID: imUserId, groupNickname: name })
  }
  closeAtMention()
}

function onAtMentionSelect(member: AtMentionMember) {
  // 正文必须用公开名，否则对方会在消息里看到我给 TA 的备注
  applyAtMention(member.publicName || member.name, member.imUserId)
}

function onAtMentionSelectAll() {
  if (!canAtAll.value) {
    uni.showToast({ title: '仅群主或管理员可以@所有人', icon: 'none' })
    return
  }
  applyAtMention('所有人', 'AtAllTag')
}

watch(input, () => {
  syncAtMentionFromInput()
})

/** 进群 / 退群 / 踢人 / 禁言后标题旁人数与禁言状态要跟着变，不能只在首次进入时拉一次。返回群详情是否拉取成功（「检查禁言状态」用它区分失败） */
async function refreshGroupMeta(): Promise<boolean> {
  if (chatType.value !== 'group') return false
  let gid = businessId.value
  if (!gid) {
    try {
      gid = await resolveBusinessTarget()
    } catch {
      return false
    }
  }
  if (!gid) return false
  businessId.value = gid
  let detailApplied = false
  try {
    const detail = await fetchGroupDetail(gid).catch((e: unknown) => {
        const msg = (e as Error)?.message || ''
        // APP 端 GetByID 过滤了已解散群，返回 404「群不存在或无权访问」，
        // 与已解散语义对齐，避免被静默吞掉后还继续去 OpenIM 拉历史（errCode 10006）
        if (isGroupUnavailableError(msg)) {
          groupDissolved.value = true
          return null
        }
        return null
      })
    // 拿到 detail 说明群有效，重置解散标记
    if (detail) {
      groupDissolved.value = false
    }
    if (detail) {
	  memberCount.value = detail.memberCount || 0
	  myRole.value = detail.myRole || 'member'
	  groupOwnerName.value = detail.ownerName || ''
	  applyGroupChatPermission(detail)
      announcementText.value = (detail.announcement || '').trim()
      detailApplied = true
    }
  } catch {
    // 人数刷新失败时保留当前值
  }
  if (detailApplied) {
    groupMetaLoadedAt = Date.now()
    // App 进群后立刻打 @ 依赖这份名单；并行拉，失败不挡进房
    void loadGroupMembersMeta(gid)
    // 和成员名单一起刷新：成员变更通知（含被踢）到达时上面那个 watcher 会调到这里，
    // 所以其他成员的界面也能跟着把被清理成员的消息隐藏掉。
    void loadMessagePurges(gid)
  }
  return detailApplied
}

/**
 * 群详情的发言权限 → 输入区禁用状态。
 * detail 实际返回 canChat/isMuted/allMuted，不下发 denyReason/mutedUntil：
 * 禁言原因本地推导（服务端若下发 denyReason 则优先）；截止时间从成员列表里自己的 mutedUntil 兜底。
 */
function applyGroupChatPermission(
  detail: { canChat?: boolean; denyReason?: string; isMuted?: boolean; allMuted?: boolean; mutedUntil?: string | null },
  self?: { isMuted?: boolean; mutedUntil?: string | null },
) {
  canChat.value = detail.canChat !== false
  myMutedUntil.value = detail.mutedUntil || self?.mutedUntil || null
  if (canChat.value) {
    denyReason.value = ''
  } else if (detail.denyReason) {
    denyReason.value = detail.denyReason
  } else if (detail.isMuted || self?.isMuted) {
    denyReason.value = 'member_muted'
  } else if (detail.allMuted) {
    denyReason.value = 'group_muted'
  } else {
    denyReason.value = 'unknown'
  }
  scheduleMuteExpiry()
}

/**
 * 禁言自然到期时自动刷新恢复输入区。30 天禁言超出 setTimeout 上限（约 24.8 天），
 * 单次最多等 12 小时，到期没解除就再续一期。
 */
function scheduleMuteExpiry() {
  if (muteExpireTimer) {
    clearTimeout(muteExpireTimer)
    muteExpireTimer = null
  }
  if (!composerBlocked.value) return
  const until = myMutedUntil.value ? new Date(myMutedUntil.value).getTime() : 0
  if (!until || Number.isNaN(until)) return
  if (until <= Date.now()) {
    void refreshGroupMeta()
    return
  }
  const delay = Math.min(until - Date.now(), 12 * 60 * 60 * 1000)
  muteExpireTimer = setTimeout(() => {
    muteExpireTimer = null
    scheduleMuteExpiry()
  }, delay)
}

function openFriendDetailModal(userId: string) {
  if (!userId) return
  friendDetailId.value = userId
  showFriendDetail.value = true
  showGroupMenu.value = false
}

function copyHeaderTitle() {
  const name = String(roomTitle.value || '').trim()
  if (!name) return
  uni.setClipboardData({
    data: name,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

async function goToProfile() {
  const id = await resolveBusinessTarget()
  if (!id) {
    uni.showToast({ title: '暂无可跳转的资料', icon: 'none' })
    return
  }
  if (chatType.value === 'private') {
    if (props.embedded) {
      openFriendDetailModal(id)
      return
    }
    uni.navigateTo({
      url: `/pages/contacts/friend-detail?id=${encodeURIComponent(id)}`,
    })
    return
  }
  // H5 PC 三栏：点标题打开群信息小窗，不跳整页
  if (props.embedded) {
    businessId.value = id
    showGroupMenu.value = true
    return
  }
  uni.navigateTo({
    url: `/pages/group/detail?id=${encodeURIComponent(id)}&code=group`,
  })
}

/** H5 PC 三栏：群聊右上角显示下拉菜单，不跳转整页详情 */
async function onHeaderMoreClick() {
  if (props.embedded && chatType.value === 'group') {
    if (!businessId.value) {
      try {
        businessId.value = await resolveBusinessTarget()
      } catch {
        businessId.value = ''
      }
    }
    if (!businessId.value) {
      uni.showToast({ title: '暂无可跳转的资料', icon: 'none' })
      return
    }
    showGroupMenu.value = !showGroupMenu.value
    return
  }
  goToProfile()
}

function resolveSenderBusinessId(message: ChatMessage): string {
  if (chatType.value === 'private' && businessId.value) return businessId.value
  return businessUserIdFromIM(message.senderId)
}

/** 按业务用户 ID 打开资料页：好友进好友详情，非好友进公开资料页（群内带 groupId 便于加好友） */
async function openProfileById(userId: string) {
  if (!userId) return
  if (chatType.value === 'private') {
    if (props.embedded) {
      openFriendDetailModal(userId)
      return
    }
    uni.navigateTo({ url: `/pages/contacts/friend-detail?id=${encodeURIComponent(userId)}` })
    return
  }

  try {
    await contactStore.ensureFriendIndex()
  } catch {
    // 通讯录拉失败时按非好友打开资料页
  }
  const friend = contactStore.isFriend(userId)
  // 群里点好友头像：直接私聊
  if (friend && chatType.value === 'group') {
    const member = groupMembersForAt.value.find((m) => sameBusinessUserId(m.id, userId))
    const title =
      contactStore.remarkOf(userId) ||
      member?.memberRemark?.trim() ||
      member?.groupNickname ||
      member?.nickname ||
      '好友'
    const avatar =
      memberAvatarMap.value[userId] ||
      member?.avatar ||
      APP_CONFIG.defaultAvatarUrl
    if (props.embedded) {
      contactStore.openChatWithContactDesktop(userId, title, avatar)
    } else {
      contactStore.openChatWithContact(userId, title, avatar)
    }
    return
  }
  if (props.embedded && friend) {
    openFriendDetailModal(userId)
    return
  }
  // 群内非好友资料页带 groupId，加好友时走群来源接口（群主/管理员豁免禁止互加）
  const groupParam =
    chatType.value === 'group' && businessId.value
      ? `&groupId=${encodeURIComponent(businessId.value)}`
      : ''
  const path = friend
    ? `/pages/contacts/friend-detail?id=${encodeURIComponent(userId)}`
    : `/pages/contacts/user-profile?id=${encodeURIComponent(userId)}${groupParam}`
  uni.navigateTo({ url: path })
}

function openAnnouncement() {
  if (!businessId.value) return
  uni.navigateTo({
    url: `/pages/group/announcement?id=${encodeURIComponent(businessId.value)}`,
  })
}

async function dismissAnnouncementBanner() {
  const text = announcementText.value.trim()
  if (text) {
    rememberDismissedAnnouncement(imUserId.value || myId.value, activeConversationId.value, text)
  }
  announcementDismissEpoch.value += 1
  await chatStore.dismissGroupAnnouncement(activeConversationId.value)
}

async function onAvatarClick(message: ChatMessage) {
  if (message.senderId === myId.value) return
  const userId = resolveSenderBusinessId(message)
  if (!userId) {
    uni.showToast({ title: '无法打开资料', icon: 'none' })
    return
  }
  await openProfileById(userId)
}

/** 群聊长按对方头像：弹出 @TA 面板（对齐参考站） */
const atSheetVisible = ref(false)
const atSheetMessage = ref<ChatMessage | null>(null)

function onAvatarLongpress(message: ChatMessage) {
  if (chatType.value !== 'group' || isMine(message) || actions.selecting.value) return
  atSheetMessage.value = message
  atSheetVisible.value = true
}

function closeAtSheet() {
  atSheetVisible.value = false
  atSheetMessage.value = null
}

function confirmAtFromSheet() {
  const message = atSheetMessage.value
  closeAtSheet()
  if (!message) return
  if (!actions.isSenderInGroup(message)) {
    actions.notifySenderLeftGroup()
    return
  }
  actions.atUser(message, publicAtNameOf(message))
}

/** 名片消息点「查看」：直接进对应好友详情页 */
function onViewCard(card: CardPayload) {
  if (!card.userId) {
    uni.showToast({ title: '名片信息缺失', icon: 'none' })
    return
  }
  void openProfileById(card.userId)
}

/** 入群邀请卡片：先确认再申请（对齐参考站） */
async function onGroupInviteApply(invite: GroupInvitePayload) {
  if (!invite.token) {
    uni.showToast({ title: '邀请已失效', icon: 'none' })
    return
  }
  const confirmed = await imConfirm({
    title: '确认加入群聊?',
    content: '确认加入群聊?',
    cancelText: '取消',
    confirmText: '确认',
  })
  if (!confirmed) return

  uni.showLoading({ title: '处理中...', mask: true })
  try {
    const res = await acceptGroupInvitation(invite.token)
    uni.hideLoading()
    if (res.nextAction === 'joined' || res.nextAction === 'already_member') {
      uni.showToast({ title: res.nextAction === 'already_member' ? '你已在群中' : '已加入群聊', icon: 'success' })
      const gid = res.group?.id || invite.groupId
      if (gid) {
        setTimeout(() => {
          uni.navigateTo({ url: `/pages/chat/room?type=group&targetId=${encodeURIComponent(gid)}` })
        }, 400)
      }
      return
    }
    if (res.nextAction === 'pending_approval') {
      uni.showToast({ title: '已提交入群申请，等待管理员审核', icon: 'none' })
      return
    }
    uni.showToast({ title: '处理完成', icon: 'none' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '申请失败', icon: 'none' })
  }
}

function requestAudioPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    const authorize = (
      uni as unknown as {
        authorize?: (options: { scope: string; success: () => void; fail: () => void }) => void
      }
    ).authorize
    if (typeof authorize === 'function') {
      authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: () => {
          uni.showToast({ title: '需要录音权限', icon: 'none' })
          resolve(false)
        },
      })
      return
    }
    resolve(true)
  })
}

function persistVoiceFile(tempPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.saveFile({
      tempFilePath: tempPath,
      success: (res) => resolve(res.savedFilePath || tempPath),
      fail: () => {
        try {
          const converted = plus?.io?.convertLocalFileSystemURL?.(tempPath)
          resolve(converted || tempPath)
        } catch {
          reject(new Error('录音文件保存失败'))
        }
      },
    })
  })
}

async function startVoiceRecord() {
  if (recording.value) return

  let uniRecorder: UniApp.RecorderManager | null = null
  // H5 的 uni.getRecorderManager 只是打印 not supported 的桩，网页端直接走 MediaRecorder
  // #ifndef H5
  uniRecorder = uni.getRecorderManager?.() || null
  // #endif
  if (uniRecorder) {
    const ok = await requestAudioPermission()
    if (!ok) return

    recorder = uniRecorder
    voiceMode.value = true
    recording.value = true
    recordingSeconds.value = 0
    voiceDraft.value = null
    clearRecordingTimer()

    recorder.onStop((res: { tempFilePath?: string; duration?: number }) => {
      recording.value = false
      clearRecordingTimer()
      const rawPath = res.tempFilePath || ''
      const rawDuration = Number(res.duration || 0)
      const duration =
        rawDuration > 0 ? Math.max(1, Math.round(rawDuration / 1000)) : Math.max(1, recordingSeconds.value)
      if (!rawPath) {
        voiceMode.value = false
        uni.showToast({ title: '录音文件无效', icon: 'none' })
        return
      }
      persistVoiceFile(rawPath)
        .then((path) => {
          voiceDraft.value = { path, duration }
        })
        .catch(() => {
          voiceMode.value = false
          voiceDraft.value = null
          uni.showToast({ title: '录音文件保存失败', icon: 'none' })
        })
    })

    recorder.onError(() => {
      recording.value = false
      clearRecordingTimer()
      voiceMode.value = false
      voiceDraft.value = null
      cleanupBrowserRecorder()
      uni.showToast({ title: '录音失败', icon: 'none' })
    })

    // mp3 两端都能播；安卓 aac(ADTS) 在 iOS 上常被误当成 m4a 直接 MediaError
    recorder.start({ format: 'mp3' })
    recordingTimer = setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= 60) {
        stopVoiceRecord()
      }
    }, 1000)
    return
  }

  const canUseBrowserRecorder =
    typeof window !== 'undefined' &&
    (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    (
      (!!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined') ||
      !!(navigator as Navigator & { getUserMedia?: unknown; webkitGetUserMedia?: unknown }).getUserMedia ||
      !!(navigator as Navigator & { getUserMedia?: unknown; webkitGetUserMedia?: unknown }).webkitGetUserMedia
    )

  if (!canUseBrowserRecorder) {
    uni.showToast({ title: 'H5 浏览器需允许麦克风权限，并在 HTTPS/localhost 环境下使用', icon: 'none' })
    return
  }

  const ok = await requestAudioPermission()
  if (!ok) return

  voiceMode.value = true
  recording.value = true
  recordingSeconds.value = 0
  voiceDraft.value = null
  clearRecordingTimer()

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // iOS 原生播放器解不了 WebM/Opus，浏览器支持时优先录 AAC(mp4)
    const mimeType = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find(
      (type) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type),
    )
    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const chunks: BlobPart[] = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      recording.value = false
      clearRecordingTimer()
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
      const path = URL.createObjectURL(blob)
      voiceDraft.value = { path, duration: Math.max(1, recordingSeconds.value) }
      stream.getTracks().forEach((track) => track.stop())
      browserRecorder = null
      recorder = null
    }

    mediaRecorder.onerror = () => {
      recording.value = false
      clearRecordingTimer()
      voiceMode.value = false
      voiceDraft.value = null
      stream.getTracks().forEach((track) => track.stop())
      browserRecorder = null
      recorder = null
      uni.showToast({ title: '录音失败', icon: 'none' })
    }

    browserRecorder = { stream, mediaRecorder }
    mediaRecorder.start()
    recordingTimer = setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= 60) {
        stopVoiceRecord()
      }
    }, 1000)
  } catch {
    uni.showToast({ title: '当前平台不支持录音', icon: 'none' })
    voiceMode.value = false
    recording.value = false
  }
}

function stopVoiceRecord() {
  if (!recording.value) return

  if (browserRecorder && browserRecorder.mediaRecorder && browserRecorder.mediaRecorder.state !== 'inactive') {
    browserRecorder.mediaRecorder.stop()
    return
  }

  if (!recorder) return
  recorder.stop()
}

async function waitForVoiceDraft(timeoutMs = 3000): Promise<{ path: string; duration: number } | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (voiceDraft.value?.path) return voiceDraft.value
    if (!recording.value && !voiceDraft.value?.path) return null
    await new Promise((r) => setTimeout(r, 50))
  }
  return voiceDraft.value?.path ? voiceDraft.value : null
}

async function sendVoiceDraft() {
  if (composerBlocked.value) {
    uni.showToast({ title: blockTip.value, icon: 'none' })
    return
  }
  if (recording.value) {
    stopVoiceRecord()
    const draftAfterStop = await waitForVoiceDraft()
    if (!draftAfterStop?.path) {
      uni.showToast({ title: '请先录音', icon: 'none' })
      return
    }
  }

  if (!voiceDraft.value?.path) {
    uni.showToast({ title: '请先录音', icon: 'none' })
    return
  }

  const draft = voiceDraft.value
  // 点了发送就退出语音条、恢复正常输入框；失败时气泡在列表里标红并 toast 提示
  voiceDraft.value = null
  voiceMode.value = false
  recordingSeconds.value = 0

  try {
    await chatStore.sendVoice(
      activeConversationId.value,
      draft.path,
      draft.duration,
      imUserId.value || myId.value,
    )
    await nextTick()
    scrollToBottom(true)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function cancelVoiceDraft() {
  voiceDraft.value = null
  voiceMode.value = false
  recordingSeconds.value = 0
  recording.value = false
  clearRecordingTimer()
  cleanupBrowserRecorder()
}

function onEmoji() {
  showEmojiPanel.value = !showEmojiPanel.value
  if (showEmojiPanel.value) {
    showPlusPanel.value = false
    closeAtMention()
  }
}

function onEmojiSelect(value: string) {
  input.value += value
  showEmojiPanel.value = false
}

async function onStickerSelect(url: string) {
  if (!url || composerBlocked.value) return
  showEmojiPanel.value = false
  try {
    await chatStore.sendImageUrl(activeConversationId.value, url, imUserId.value || myId.value)
    await nextTick()
    scrollToBottom(true)
  } catch (e) {
    uni.showToast({ title: friendlySendFailMessage(e), icon: 'none', duration: 2500 })
  }
}

function onPlus() {
  actions.clearTextSelecting()
  showPlusPanel.value = !showPlusPanel.value
  if (showPlusPanel.value) {
    showEmojiPanel.value = false
    closeAtMention()
  }
}

/** 相册 / 文件一次最多可选数量（资料图一次发完，避免卡在 9 张要分两次） */
const MAX_PICK_COUNT = 20

function onPlayVideo(message: ChatMessage) {
  uni.navigateTo({
    url: `/pages/chat/video-viewer?conversationId=${encodeURIComponent(activeConversationId.value)}&messageId=${encodeURIComponent(message.id)}&content=${encodeURIComponent(message.content)}&senderNickname=${encodeURIComponent(message.senderNickname || '')}&createdAt=${encodeURIComponent(message.createdAt)}`,
  })
}

function chooseFailToast(err: { errMsg?: string } | undefined, fallback: string) {
  const msg = String(err?.errMsg || '')
  if (/cancel/i.test(msg)) return
  uni.showToast({ title: msg.replace(/^[^:]+:\s*/, '') || fallback, icon: 'none' })
}

/** 多图/文件发送失败时拼进 toast，英文拒绝码翻成人话 */
function sendFailReason(e: unknown): string {
  return friendlySendFailMessage(e)
}

function requestAlbumAccess(): Promise<void> {
  return requestAndroidAlbumPermission()
}

function afterPlusClosed(run: () => void) {
  showPlusPanel.value = false
  // 华为等机：加号面板收起动画未完就调选图会被挡住
  setTimeout(run, 320)
}

async function sendImageJobs(
  jobs: Array<{ conversationId: string; filePath: string; placeholder: ChatMessage }>,
  revokePath?: (filePath: string) => void,
) {
  let failed = 0
  let firstReason = ''
  const queue = [...jobs]
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift()
      if (!job) return
      let sent = false
      try {
        await chatStore.deliverOutgoingImage(job)
        sent = true
        await nextTick()
        scrollToBottom(true)
      } catch (e) {
        failed += 1
        if (!firstReason) firstReason = sendFailReason(e)
      } finally {
        if (sent) revokePath?.(job.filePath)
      }
    }
  })
  await Promise.all(workers)
  if (failed) {
    uni.showToast({
      title: firstReason ? `${failed} 张图片发送失败：${firstReason}` : `${failed} 张图片发送失败`,
      icon: 'none',
    })
  }
}

async function sendPickedImagePaths(paths: string[]) {
  const list = paths.filter(Boolean).slice(0, MAX_PICK_COUNT)
  if (!list.length) {
    uni.showToast({ title: '未获取到图片，请重试', icon: 'none' })
    return
  }
  const jobs = list.map((path) =>
    chatStore.prepareOutgoingImage(activeConversationId.value, path, imUserId.value || myId.value),
  )
  await nextTick()
  scrollToBottom(true)
  await sendImageJobs(jobs)
}

/** 相册多选：一次最多 20 张；华为走 pickLocalImages 的 gallery 兜底 */
function pickImage() {
  afterPlusClosed(() => {
    void pickLocalImages({ count: MAX_PICK_COUNT, sourceType: ['album'], materialize: false })
      .then((paths) => sendPickedImagePaths(paths))
      .catch((e) => {
        if (String((e as Error)?.message || '') === 'cancel') return
        uni.showToast({
          title: (e as Error)?.message || '无法打开相册，请检查相册权限',
          icon: 'none',
        })
      })
  })
}

/** 相机拍照即发（与相册同一套 pickLocalImages，含权限/路径兜底） */
function pickCamera() {
  afterPlusClosed(() => {
    void pickLocalImages({ count: 1, sourceType: ['camera'], materialize: false })
      .then((paths) => sendPickedImagePaths(paths))
      .catch((e) => {
        if (String((e as Error)?.message || '') === 'cancel') return
        uni.showToast({
          title: (e as Error)?.message || '无法打开相机',
          icon: 'none',
        })
      })
  })
}

/** 选视频发送：相册或拍摄，走系统自带 chooseVideo，不依赖 chooseMedia 模块 */
function pickVideo() {
  afterPlusClosed(() => {
    void requestAlbumAccess().then(() => {
      uni.chooseVideo({
        sourceType: ['album', 'camera'],
        compressed: true,
        maxDuration: 60,
        fail: (err) => chooseFailToast(err, '无法选择视频'),
        success: async (res) => {
          const picked = res as { tempFilePath: string; tempFile?: File; duration?: number; thumbTempFilePath?: string }
          let path = picked.tempFilePath
          let ownedBlob = ''
          if (typeof File !== 'undefined' && picked.tempFile instanceof File) {
            ownedBlob = URL.createObjectURL(picked.tempFile)
            path = ownedBlob
          }
          let sent = false
          try {
            await chatStore.sendVideo(
              activeConversationId.value,
              path,
              imUserId.value || myId.value,
              Number(picked.duration || 0),
              picked.thumbTempFilePath || '',
            )
            sent = true
            await nextTick()
            scrollToBottom(true)
          } catch (e) {
            uni.showToast({ title: (e as Error).message || '视频发送失败', icon: 'none' })
          } finally {
            if (sent && ownedBlob) URL.revokeObjectURL(ownedBlob)
          }
        },
      })
    })
  })
}

/** 选好友发名片：群聊禁止分享个人名片 */
function pickCard() {
  showPlusPanel.value = false
  if (chatType.value === 'group') {
    uni.showToast({ title: '群内不可分享个人名片', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/chat/card-picker?conversationId=${encodeURIComponent(activeConversationId.value)}&title=${encodeURIComponent(roomTitle.value)}`,
  })
}

/** 选本地文件发送：图片按图片消息发（避免华为走「文件」选截图变成文件气泡） */
async function pickFile() {
  showPlusPanel.value = false
  try {
    const files = await chooseLocalFiles(MAX_PICK_COUNT)
    let failed = 0
    let failText = ''
    for (const file of files) {
      try {
        const asImage = isLikelyChatImage(file.name) || isLikelyChatImage(file.path)
        if (asImage) {
          await chatStore.sendImage(activeConversationId.value, file.path, imUserId.value || myId.value)
        } else {
          await chatStore.sendFile(activeConversationId.value, file.path, file.name, imUserId.value || myId.value)
        }
        await nextTick()
        scrollToBottom(true)
      } catch (e) {
        failed++
        if (!failText) failText = friendlySendFailMessage(e)
      }
    }
    if (failed) {
      uni.showToast({
        title: failText ? `${failed} 个文件发送失败：${failText}` : `${failed} 个文件发送失败`,
        icon: 'none',
        duration: 2500,
      })
    }
  } catch (e) {
    const msg = (e as Error).message
    if (msg && !msg.includes('未选择')) {
      uni.showToast({ title: msg || '发送失败', icon: 'none' })
    }
  }
}

/** 从我的收藏挑一条发送 */
function pickFavorite() {
  showPlusPanel.value = false
  uni.navigateTo({
    url: `/pages/chat/favorite-picker?conversationId=${encodeURIComponent(activeConversationId.value)}&title=${encodeURIComponent(roomTitle.value)}`,
  })
}
</script>

<template>
  <view
    class="room"
    :class="{ 'room-embedded': embedded, 'room-keyboard': keyboardOpen }"
    :style="vvHeightPx ? { height: vvHeightPx + 'px' } : undefined"
  >
    <view
      class="chat-header"
      :style="{ paddingTop: embedded ? '0px' : statusBarHeight + 'px' }"
    >
      <view
        v-if="!embedded"
        class="back-btn"
        @click="goBack"
      >
        ‹
      </view>
      <!-- <text v-if="chatType === 'group' && memberCount > 0" class="member-count">{{ memberCount }}</text> -->
      <view
        class="header-title"
        @click="goToProfile"
        @longpress.stop="copyHeaderTitle"
      >
        <text
          class="header-title-text"
          selectable
        >
          {{ roomTitle }}
        </text>
        <text
          v-if="presenceText"
          class="header-presence"
        >
          {{ presenceText }}
        </text>
      </view>
      <view class="header-icon-wrap">
        <view
          class="header-icon"
          @click.stop="onHeaderMoreClick"
        >
          ⋯
        </view>
      </view>
    </view>

    <ImDesktopGroupMenu
      v-if="embedded && chatType === 'group' && businessId && activeConversationId"
      v-model="showGroupMenu"
      :group-id="businessId"
      :conversation-id="activeConversationId"
      @open-friend="openFriendDetailModal"
    />

    <ImDesktopFriendDetail
      v-if="embedded"
      v-model="showFriendDetail"
      :contact-id="friendDetailId"
    />

    <view
      v-if="showAnnouncementBanner"
      class="announce-bar"
    >
      <image
        class="announce-icon"
        src="/static/icons/icon-megaphone.svg"
        mode="aspectFit"
      />
      <text
        class="announce-text"
        @click="openAnnouncement"
      >
        {{ announcementText }}
      </text>
      <text
        class="announce-dismiss"
        @click.stop="dismissAnnouncementBanner"
      >
        不再提示
      </text>
    </view>

    <view
      v-if="visiblePinnedBanner"
      class="pin-bar"
      @click="jumpToPinnedMessage"
    >
      <view class="pin-bar-accent" />
      <view class="pin-bar-body">
        <text class="pin-bar-label">
          置顶消息
        </text>
        <text class="pin-bar-preview">
          {{ visiblePinnedBanner.preview || '消息' }}
        </text>
      </view>
      <text
        class="pin-bar-close"
        @click.stop="dismissPinnedBanner"
      >
        ×
      </text>
    </view>

    <!-- 不开 scroll-with-animation：uni 的滚动动画是 transform 假动画 + 过渡结束才提交 scrollTop，
         发送后连续两次贴底会在动画中途重测位置，最终落点偏小导致最新消息下半截被视口切掉 -->
    <scroll-view
      scroll-y
      class="msg-list"
      :scroll-top="msgScrollTop"
      :lower-threshold="600"
      @scroll="onMsgScroll"
      @scrolltolower="onReachOldest"
      @touchstart="onMsgListTouchStart"
      @touchend="onMsgListTouchEnd"
      @touchcancel="onMsgListTouchEnd"
    >
      <view class="msg-flip">
        <view
          v-if="loadingOlder"
          class="msg-loading-older"
        >
          <text class="msg-loading-older-text">
            加载中…
          </text>
        </view>
        <view
          v-for="(m, msgIndex) in renderMessages"
          :id="`msg_${m.id}`"
          :key="`${myId || 'pending'}-${m.id}`"
          class="msg-row"
          :class="{ selecting: actions.selecting.value, focused: focusedMsgId === m.id }"
          @click="actions.selecting.value ? actions.toggleSelect(m) : undefined"
        >
          <view
            v-if="actions.selecting.value && m.type !== 'system'"
            class="msg-check"
            :class="{ on: actions.selectedIds.value.has(m.id) }"
          >
            <text v-if="actions.selectedIds.value.has(m.id)">
              ✓
            </text>
          </view>
          <view
            v-if="dayLabelOf(m, msgIndex)"
            class="day-chip"
          >
            <text class="day-chip-text">
              {{ dayLabelOf(m, msgIndex) }}
            </text>
          </view>
          <view
            v-if="m.type === 'system'"
            class="sys-tip"
          >
            <text class="sys-tip-text">
              {{ systemTextOf(m) }}
            </text>
            <text
              v-if="systemClockOf(m)"
              class="sys-tip-time"
            >
              {{ systemClockOf(m) }}
            </text>
          </view>
          <ChatBubble
            v-else
            :message="m"
            :mine="isMine(m)"
            :avatar="avatarOf(m)"
            :fallback-avatar="fallbackAvatarOf(m)"
            :nickname="nicknameOf(m)"
            :role="roleOf(m)"
            :read-state="readStateOf(m)"
            :text-selecting="actions.textSelectingId.value === m.id"
            :selecting="actions.selecting.value"
            @avatar-click="onAvatarClick(m)"
            @avatar-longpress="onAvatarLongpress(m)"
            @select-click="actions.toggleSelect(m)"
            @card-view="onViewCard"
            @group-invite-apply="onGroupInviteApply"
            @longpress="(e) => actions.openMenu(m, e)"
            @retry="onRetry(m)"
            @play-video="onPlayVideo"
            @preview-image="openImagePreview"
            @quote-click="onQuoteClick"
          />
        </view>
      </view>
    </scroll-view>

    <view
      v-if="!stickToBottom"
      class="jump-bottom"
      @click.stop="jumpToBottom"
    >
      ↓
    </view>

    <view
      v-if="actions.selecting.value"
      class="composer"
      :class="{ 'safe-bottom': !keyboardOpen }"
    >
      <ImMessageSelectBar
        :count="actions.selectedCount.value"
        :mode="actions.selectMode.value"
        :show-revoke="actions.canRevokeOthers.value"
        @cancel="actions.cancelSelect"
        @forward="actions.onSelectForward"
        @remove="actions.onSelectDelete"
        @revoke="actions.onSelectRevoke"
      />
    </view>
    <view
      v-else
      class="composer"
      :class="{ 'safe-bottom': !keyboardOpen }"
    >
      <ImQuoteBar
        v-if="actions.quote.value"
        :nickname="nicknameOf(actions.quote.value) || actions.quote.value.senderNickname || '我'"
        :thumb="quoteThumbOf(actions.quote.value.type, actions.quote.value.content, avatarOf(actions.quote.value))"
        :text="quoteSummaryOf(actions.quote.value.type, actions.quote.value.content)"
        @close="actions.clearQuote"
      />
      <view
        v-if="composerBlocked"
        class="composer-blocked"
      >
        <text class="composer-blocked-tip">
          🔇 {{ blockTip }}
        </text>
        <view
          class="mute-check-btn"
          :class="{ checking: checkingMute }"
          @click="checkMuteStatus"
        >
          {{ checkingMute ? '检查中…' : '检查禁言状态' }}
        </view>
      </view>

      <template v-else>
        <!-- @ 提及面板：贴在输入栏上方（对齐参考站） -->
        <ImAtMentionPanel
          v-if="chatType === 'group'"
          :visible="atMentionVisible"
          :can-at-all="canAtAll"
          :keyword="atMentionKeyword"
          :members="atMentionMembers"
          :loading="atMentionLoading"
          @close="closeAtMention"
          @select-all="onAtMentionSelectAll"
          @select="onAtMentionSelect"
        />

        <view
          v-if="voiceMode"
          class="voice-bar"
        >
          <view
            class="voice-trash"
            @click="cancelVoiceDraft"
          >
            🗑
          </view>

          <view
            class="voice-middle"
            @click="recording ? stopVoiceRecord() : undefined"
          >
            <view
              class="record-dot"
              :class="{ active: recording }"
            />
            <text class="record-time">
              {{ formatDuration(recordingSeconds) }}
            </text>
          </view>

          <view class="voice-actions">
            <view
              class="send-gray-btn"
              @click="recording ? stopVoiceRecord() : sendVoiceDraft()"
            >
              <text>{{ recording ? '结束' : '发送' }}</text>
            </view>
            <view
              class="send-icon-btn"
              @click="sendVoiceDraft"
            >
              ↑
            </view>
          </view>
        </view>

        <view
          v-else
          class="composer-row"
        >
          <view
            class="tool"
            @click="startVoiceRecord"
          >
            <image
              class="tool-icon"
              src="/static/icon-mic.png"
              mode="aspectFit"
            />
          </view>
          <view class="input-wrap">
            <textarea
              :key="inputEpoch"
              ref="inputRef"
              :value="input"
              :data-composer-epoch="inputEpoch"
              class="input"
              :focus="composerFocusFlag"
              :maxlength="-1"
              :auto-height="true"
              :confirm-type="composerConfirmType"
              :confirm-hold="true"
              :show-confirm-bar="false"
              :disable-default-padding="true"
              :hold-keyboard="true"
              :adjust-position="!isH5ComposerPlatform()"
              placeholder="输入消息"
              placeholder-style="color:#B0B0B0"
              :cursor-spacing="20"
              @input="syncAtMentionFromInput"
              @confirm="onConfirmSend"
              @focus="onComposerFocus"
              @blur="onComposerBlur"
            />
            <text
              class="emoji"
              @click="onEmoji"
            >
              ☺
            </text>
          </view>
          <view
            class="tool"
            @click="onPlus"
          >
            ＋
          </view>
          <view
            v-if="hasInput"
            class="send-btn"
            @tap.stop="triggerSend"
          >
            传送
          </view>
        </view>
      </template>

      <view
        v-if="showPlusPanel && !composerBlocked"
        class="plus-panel"
      >
        <view
          class="plus-item"
          @click="pickCamera"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-camera.png"
              mode="aspectFit"
            />
          </view>
          <text>相机</text>
        </view>
        <view
          class="plus-item"
          @click="pickImage"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-photo.png"
              mode="aspectFit"
            />
          </view>
          <text>照片</text>
        </view>
        <view
          class="plus-item"
          @click="pickVideo"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-video.svg"
              mode="aspectFit"
            />
          </view>
          <text>视频</text>
        </view>
        <view
          v-if="chatType !== 'group'"
          class="plus-item"
          @click="pickCard"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-card.png"
              mode="aspectFit"
            />
          </view>
          <text>名片</text>
        </view>
        <view
          class="plus-item"
          @click="pickFile"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-file.png"
              mode="aspectFit"
            />
          </view>
          <text>文件</text>
        </view>
        <view
          class="plus-item"
          @click="pickFavorite"
        >
          <view class="plus-icon">
            <image
              class="plus-icon-img"
              src="/static/icon-favorite.png"
              mode="aspectFit"
            />
          </view>
          <text>收藏</text>
        </view>
      </view>

      <EmojiStickerPanel
        v-if="showEmojiPanel && !composerBlocked"
        class="emoji-panel-shell"
        @select="onEmojiSelect"
        @sticker="onStickerSelect"
        @close="showEmojiPanel = false"
      />
    </view>

    <ImMessageActionMenu
      v-if="actions.menuVisible.value"
      :items="actions.menuItems.value"
      :x="actions.menuPosition.value?.x"
      :y="actions.menuPosition.value?.y"
      @select="actions.onMenuSelect"
      @close="actions.closeMenu"
    />
    <ImAtActionSheet
      :visible="atSheetVisible"
      @at="confirmAtFromSheet"
      @cancel="closeAtSheet"
    />
    <ImSuccessToast
      :visible="successVisible"
      text="转发成功"
      placement="top"
      @close="successVisible = false"
    />
    <ImConfirmDialogHost />
  </view>
</template>

<style scoped lang="scss">
.room {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #e6e8ee;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}

.room-embedded {
  height: 100%;
}

/* 键盘弹起：高度已由 visualViewport 内联设定，禁止再叠 home indicator 空隙 */
.room-keyboard {
  transition: height 0.08s linear;
}

.chat-header {
  display: flex;
  align-items: center;
  min-height: 94rpx;
  height: auto;
  padding: 8rpx 26rpx;
  box-sizing: content-box;
  background: #ffffff;
  border-bottom: 1rpx solid #ececec;
  flex-shrink: 0;
  position: relative;
  z-index: 20;
  overflow: visible;
}

.back-btn {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52rpx;
  color: #1a1a1a;
  line-height: 1;
  flex-shrink: 0;
}

.member-count {
  margin-right: 12rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: #111;
  flex-shrink: 0;
}

.header-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.header-title-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  lines: 1;
  font-size: 34rpx;
  font-weight: 700;
  color: #111;
  user-select: text;
  -webkit-user-select: text;
}

.header-presence {
  display: block;
  margin-top: 2rpx;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.3;
  color: #8a8f9c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-icon-wrap {
  position: relative;
  flex-shrink: 0;
}

.header-icon {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
  color: #444;
  flex-shrink: 0;
  cursor: pointer;
}

.announce-bar {
  display: flex;
  align-items: center;
  height: 72rpx;
  padding: 0 24rpx;
  background: #ffffff;
  border-bottom: 1rpx solid #ececec;
  flex-shrink: 0;
}

.announce-icon {
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
}

.announce-text {
  flex: 1;
  min-width: 0;
  margin: 0 16rpx;
  font-size: 26rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announce-dismiss {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #0a2fc2;
}

.pin-bar {
  display: flex;
  align-items: stretch;
  min-height: 72rpx;
  padding: 10rpx 20rpx 10rpx 0;
  background: #f7f8fa;
  border-bottom: 1rpx solid #ececec;
  flex-shrink: 0;
  cursor: pointer;
}

.pin-bar-accent {
  width: 6rpx;
  margin: 8rpx 0 8rpx 16rpx;
  border-radius: 6rpx;
  background: #0a2fc2;
  flex-shrink: 0;
}

.pin-bar-body {
  flex: 1;
  min-width: 0;
  margin: 0 16rpx;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2rpx;
}

.pin-bar-label {
  font-size: 22rpx;
  line-height: 28rpx;
  color: #0a2fc2;
  font-weight: 600;
}

.pin-bar-preview {
  font-size: 26rpx;
  line-height: 34rpx;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-bar-close {
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  margin-top: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  line-height: 1;
  color: #8a8f9c;
}

/* 倒置列表：外层翻一次让 scrollTop=0 落在视觉底部，内层再翻回来保证内容正向 */
.msg-list {
  flex: 1;
  height: 0;
  background: #e6e8ee;
  transform: scaleY(-1);
}

.msg-list :deep(.uni-scroll-view),
.msg-list :deep(.uni-scroll-view-content) {
  background: #e6e8ee;
  /* 新消息插在滚动起点，浏览器滚动锚定可能把它顶出视口；贴底统一由代码控制 */
  overflow-anchor: none;
}

/* 至少撑满视口：消息少时从顶部开始排，与微信一致 */
.msg-flip {
  min-height: 100%;
  padding-bottom: 16rpx;
  box-sizing: border-box;
  transform: scaleY(-1);
}

.msg-loading-older {
  display: flex;
  justify-content: center;
  padding: 16rpx 0;
}

.msg-loading-older-text {
  font-size: 24rpx;
  color: #9aa0ab;
}

.jump-bottom {
  position: absolute;
  right: 28rpx;
  bottom: 168rpx;
  z-index: 30;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  line-height: 1;
  color: #333;
}

.msg-row {
  width: 100%;
  box-sizing: border-box;
}

.msg-row.focused {
  background: rgba(10, 47, 194, 0.08);
}

.msg-row.selecting {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  padding-left: 8rpx;
}

.msg-row.selecting :deep(.row) {
  flex: 1;
  min-width: 0;
}

.msg-check {
  width: 40rpx;
  height: 40rpx;
  margin: 28rpx 8rpx 0 16rpx;
  border-radius: 50%;
  border: 3rpx solid #c8ccd6;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 22rpx;
  flex-shrink: 0;
}

.msg-check.on {
  border-color: #0a2fc2;
  background: #0a2fc2;
}

.day-chip {
  display: flex;
  justify-content: center;
  flex: 0 0 100%;
  width: 100%;
  padding: 8rpx 0 4rpx;
  box-sizing: border-box;
}

.day-chip-text {
  font-size: 24rpx;
  color: #8a8f9c;
  line-height: 1.4;
}

.sys-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 12rpx 32rpx;
}

.sys-tip-text {
  font-size: 22rpx;
  color: #333333;
  text-align: center;
  line-height: 1.5;
}

.sys-tip-time {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a8f9c;
  line-height: 1.4;
}

.composer {
  background: #f7f7f7;
  border-top: 1rpx solid #e8e8e8;
  flex-shrink: 0;
}

.emoji-panel-shell {
  display: block;
}

.composer-row {
  display: flex;
  align-items: flex-end;
  padding: 16rpx 20rpx;
  gap: 12rpx;
}

/** 被禁言 / 全员禁言时替代输入区：左侧禁言提示，右侧检查禁言状态按钮 */
.composer-blocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  padding: 0 32rpx;
}

.composer-blocked-tip {
  flex: 1;
  color: #999;
  font-size: 26rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mute-check-btn {
  flex-shrink: 0;
  margin-left: 24rpx;
  height: 56rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  border-radius: 28rpx;
  border: 1rpx solid #0a2fc2;
  color: #0a2fc2;
  font-size: 24rpx;
}

.mute-check-btn.checking {
  opacity: 0.5;
}

.tool {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: #333;
}

.tool-icon {
  width: 44rpx;
  height: 44rpx;
}

.send-btn {
  min-width: 120rpx;
  height: 64rpx;
  padding: 0 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18rpx;
  background: #0a2fc2;
  color: #fff;
  font-size: 26rpx;
  font-weight: 600;
}

.input-wrap {
  flex: 1;
  position: relative;
  background: #fff;
  border-radius: 36rpx;
  min-height: 72rpx;
  padding: 8rpx 72rpx 8rpx 16rpx;
  box-sizing: border-box;
}

.input {
  width: 100%;
  font-size: 16px;
  line-height: 24px;
  min-height: 24px;
  max-height: 144px;
  color: #1a1a1a;
  text-align: left;
  box-sizing: border-box;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  display: block;
  word-break: break-word;
  overflow-y: auto;
  padding: 0;
  margin: 0;
}

.input-wrap :deep(.uni-textarea-wrapper),
.input-wrap :deep(.uni-textarea-textarea),
.input-wrap :deep(textarea) {
  font-size: 16px !important;
  line-height: 24px !important;
  min-height: 24px !important;
  max-height: 144px !important;
  overflow-y: auto !important;
  padding: 0 !important;
}

.input-wrap :deep(.uni-textarea-compute),
.input-wrap :deep(.uni-textarea-compute-auto-height) {
  font-size: 16px !important;
  line-height: 24px !important;
}

.input-wrap :deep(.uni-textarea-line) {
  height: 0 !important;
  overflow: hidden !important;
}

.emoji {
  position: absolute;
  right: 20rpx;
  bottom: 12rpx;
  font-size: 36rpx;
  color: #666;
  line-height: 1;
}

.voice-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  background: #f2f2f2;
}

.voice-trash {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: #666;
  background: transparent;
}

.voice-middle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 76rpx;
  background: #f6f6f6;
  border-radius: 18rpx;
}

.record-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #ff4d4f;
}

.record-dot.active {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.record-time {
  font-size: 28rpx;
  color: #333;
  font-weight: 600;
}

.voice-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.send-gray-btn {
  min-width: 132rpx;
  height: 68rpx;
  border-radius: 20rpx;
  background: #d9d9d9;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  padding: 0 18rpx;
}

.send-icon-btn {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #1a73ff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 700;
}

.plus-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 28rpx 24rpx;
  padding: 24rpx 32rpx 32rpx;
  background: #f0f0f0;
}

.plus-item {
  width: 140rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #666;
  font-size: 24rpx;
  gap: 12rpx;
}

.plus-icon {
  width: 100rpx;
  height: 100rpx;
  background: #fff;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44rpx;
}

.plus-icon-img {
  width: 56rpx;
  height: 56rpx;
}
</style>
