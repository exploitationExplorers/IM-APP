<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from 'vue'
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
import { useChatMessageActions, type MemberMeta } from '@/composables/useChatMessageActions'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useForwardStore } from '@/stores/forward'
import { businessUserIdFromIM, chooseLocalFiles, ensureIMLogin, imUserId, isNotInGroupIMError } from '@/utils/openim'
import { APP_CONFIG } from '@/config'
import { useContactStore } from '@/stores/contact'
import { fetchGroupReadState, reportGroupReadCursor, resolveIMGroupByIM } from '@/api/im'
import { acceptGroupInvitation, fetchAllGroupMembers, fetchGroupDetail } from '@/api/group'
import { safeBack } from '@/utils/nav'
import type { CardPayload, ChatMessage, Conversation, GroupInvitePayload, GroupMember } from '@/types'
import { collapseRepeatedGroupNameNotices, isGroupUnavailableError, replaceOpenIMAdminLabel } from '@/utils/im-notification'
import { getStatusBarHeight } from '@/utils/status-bar'
import { quoteSummaryOf, quoteThumbOf } from '@/utils/format'
import { perfMarkEnd, perfMarkStart } from '@/utils/perf'
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

const statusBarHeight = getStatusBarHeight()

const conversationId = ref('')
const title = ref('聊天')
const peerAvatar = ref(APP_CONFIG.defaultAvatarUrl)
const chatType = ref<'private' | 'group'>('group')
/** 业务侧的好友 / 群 ID，仅用于跳资料页 */
const businessId = ref('')
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
const input = ref('')
const inputRef = ref<{ $el?: HTMLElement } | HTMLTextAreaElement | null>(null)
const scrollInto = ref('')
const showPlusPanel = ref(false)
const showEmojiPanel = ref(false)
const voiceMode = ref(false)
const recording = ref(false)
const recordingSeconds = ref(0)
const voiceDraft = ref<{ path: string; duration: number } | null>(null)

let recorder: any = null
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

const messages = computed(() =>
  collapseRepeatedGroupNameNotices(
    (chatStore.messagesMap[conversationId.value] || []).filter(isVisibleMessage),
  ),
)

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

/** 图片预览列表：点开任意图片后可左右滑动查看本会话其它图片 */
const imagePreviewUrls = computed(() =>
  messages.value.filter((m) => m.type === 'image' && m.content).map((m) => m.content),
)

watch(
  () =>
    (chatStore.messagesMap[conversationId.value] || [])
      .map((m) => m.systemEventKey)
      .filter(
        (key): key is string =>
          !!key &&
          (key.startsWith('group-member:') ||
            key.startsWith('group-mute:') ||
            key.startsWith('group-announce:')),
      )
      .join('|'),
  (keys, prev) => {
    if (!prev || keys === prev) return
    void refreshGroupMeta()
  },
)
// 消息里的 sendID 是 OpenIM 用户 ID，不是业务用户 ID
// 用 ref 快照而不是 computed：避免 H5/热更新下 computed 与全局 ref 不同步导致 mine 判断失效
const myId = ref('')
const myAvatar = computed(() => userStore.profile?.avatar || APP_CONFIG.defaultAvatarUrl)
const settingsStore = useChatSettingsStore()

function isMine(message: ChatMessage): boolean {
  if (myId.value && message.senderId === myId.value) return true
  // 发送中的占位消息一定属于自己，避免 myId 还没拿到时跑到左边
  if (message.status === 'sending') return true
  return false
}

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
  const contact = contactStore.contacts.find((c) => c.id === uid)
  if (contact?.avatar) return contact.avatar
  return chatType.value === 'group' ? APP_CONFIG.defaultAvatarUrl : peerAvatar.value
}

function nicknameOf(message: ChatMessage): string {
  if (chatType.value !== 'group' || message.senderId === myId.value) return ''
  const uid = businessUserIdFromIM(message.senderId)
  if (!uid) return message.senderNickname || ''
  const mr = memberRemarkMap.value[uid]
  if (mr) return mr
  if (message.senderNickname) return message.senderNickname
  const contact = contactStore.contacts.find((c) => c.id === uid)
  return contact?.remark?.trim() || contact?.nickname || ''
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
  if (!conversationId.value || pending.length === 0) return
  try {
    const state = await fetchGroupReadState(conversationId.value)
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
  if (chatType.value !== 'group' || !conversationId.value) return
  if (groupReadReportTimer) clearTimeout(groupReadReportTimer)
  groupReadReportTimer = setTimeout(() => {
    groupReadReportTimer = null
    void reportGroupReadCursor(conversationId.value).catch(() => undefined)
  }, 1000)
}

watch(
  () => `${myId.value}|${messages.value.map((m) => `${m.id}:${m.status}:${m.seq || 0}`).join('|')}`,
  () => {
    if (chatType.value !== 'group') return
    scheduleGroupReadReport()
    startGroupReadPolling()
  },
)

function systemTextOf(message: ChatMessage): string {
  return replaceOpenIMAdminLabel(message.content, groupOwnerName.value)
}

function refreshPrivateTitle() {
  if (chatType.value !== 'private' || !businessId.value) return
  const contact = contactStore.contacts.find((c) => c.id === businessId.value)
  const remark = contact?.remark?.trim()
  if (remark) {
    title.value = remark
    return
  }
  if (contact?.nickname) title.value = contact.nickname
}

const enterToSend = computed(() => settingsStore.enterToSend)
const hasInput = computed(() => input.value.trim().length > 0)
/** 关闭回车发送时用 return（非 done），H5 才允许 Enter 自然换行 */
const composerConfirmType = computed(() => (enterToSend.value ? 'send' : 'return'))

/** 被禁言（单人 / 全员）时隐藏输入区，换成居中提示条 */
const composerBlocked = computed(() => chatType.value === 'group' && !canChat.value)

const showAnnouncementBanner = computed(() => {
  if (chatType.value !== 'group') return false
  // 依赖这个 epoch：否则存储变化后 computed 不会自动重算
  void announcementDismissEpoch.value
  const text = announcementText.value.trim()
  if (!text) return false
  return !isAnnouncementDismissed(imUserId.value || myId.value, conversationId.value, text)
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
  conversationId,
  chatType,
  businessId,
  myId,
  myRole,
  input,
  nicknameOf,
  isMine,
  visibleMessages: messages,
  conversationTitle: title,
  memberMeta: memberMetaMap,
  onMuteChanged: () => {
    void refreshGroupMeta()
  },
})

/** onLoad 刚拉过群详情时 onShow 会紧跟着触发，跳过重复请求 */
let groupMetaLoadedAt = 0

onShow(() => {
	if (chatType.value === 'group') {
    if (Date.now() - groupMetaLoadedAt > 2000) {
      void refreshGroupMeta()
    }
    scheduleGroupReadReport()
    startGroupReadPolling()
  }
  if (chatType.value === 'private') refreshPrivateTitle()
  if (!forwardStore.consumeSucceeded()) return
  actions.cancelSelect()
  successVisible.value = true
})

onHide(() => {
  stopGroupReadPolling()
  if (groupReadReportTimer) clearTimeout(groupReadReportTimer)
  groupReadReportTimer = null
})

onUnload(() => {
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
  chatStore.trimConversationMemory(conversationId.value)
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
  if (message.conversationId !== conversationId.value) return
  if (message.notificationKind !== 'dissolved') return
  exitDissolvedRoom()
}
chatStore.setOnIncomingForDissolve(handleIncomingForDissolve)

function handleGroupUnavailable(payload: { conversationId: string }) {
  if (chatType.value !== 'group') return
  if (payload.conversationId !== conversationId.value) return
  exitUnavailableGroupRoom()
}
chatStore.setOnGroupUnavailable(handleGroupUnavailable)

/** onShow 重拉群详情发现已解散（如 App 后台期间群被解散）时，同样提示并退出 */
watch(groupDissolved, (dissolved) => {
  if (dissolved) exitDissolvedRoom()
})

watch(
  () => props.conversationId,
  () => {
    showGroupMenu.value = false
  },
)

onLoad(async (query) => {
  if (props.embedded) return
  await bootstrapRoom(query as Record<string, string | undefined>)
})

onMounted(() => {
  if (!props.embedded || !props.conversationId) return
  void bootstrapRoom({
    conversationId: props.conversationId,
    type: props.type,
    title: props.title,
    avatar: props.avatar,
  })
})

async function bootstrapRoom(query: Record<string, string | undefined>) {
  roomExited = false
  roomFirstMessagesMarked = false
  perfMarkStart('chat:room-first-messages')
  title.value = decodeURIComponent(String(query?.title || '聊天'))
  peerAvatar.value = decodeURIComponent(String(query?.avatar || APP_CONFIG.defaultAvatarUrl))
  chatType.value = String(query?.type || 'group') === 'private' ? 'private' : 'group'
  businessId.value = String(query?.targetId || '')
  if (!props.embedded) {
    uni.setNavigationBarTitle({ title: '' })
    uni.hideNavigationBarLoading?.()
  }

  try {
    const convIdHint = String(query?.conversationId || '')
    if (convIdHint) conversationId.value = convIdHint

    await ensureIMLogin()

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
        return chatStore.loadMessages(convIdHint).catch((e: any) => {
          if (chatType.value === 'group' && e?.message?.includes('10006')) {
            exitDissolvedRoom()
            return
          }
          throw e
        })
      }
      const conv = await enterTask
      return chatStore.loadMessages(conv.id).catch((e: any) => {
        if (chatType.value === 'group' && e?.message?.includes('10006')) {
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
    conversationId.value = conv.id
    if (!query?.title) title.value = conv.title

    myId.value = imUserId.value
    if (!myId.value) {
      throw new Error('当前 IM 用户 ID 未初始化，请重新登录')
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
    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('[chat] 打开会话失败', e)
    uni.showToast({ title: (e as Error)?.message || '会话打开失败', icon: 'none', duration: 4000 })
  }
}

async function onScrollToUpper() {
  if (!conversationId.value) return
  const anchor = messages.value[0]?.id
  const added = await chatStore.loadMoreMessages(conversationId.value)
  if (!added || !anchor) return
  await nextTick()
  scrollInto.value = `msg_${anchor}`
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

function scrollToAnchorBottom() {
  // 先清空再指向锚点：连续发送/连续收消息时值相同不会重复触发滚动，跨一帧重设才能每次都滚
  scrollInto.value = ''
  nextTick(() => {
    scrollInto.value = 'bottom-anchor'
  })
}

function scrollToBottom() {
  scrollToAnchorBottom()
  const last = messages.value[messages.value.length - 1]
  // 图片等消息在资源加载完成后才撑开高度（占位换真实 URL 还会二次加载），
  // 分多个时段重贴底部；直设 scrollTop 是绝对定位，重复校准幂等无副作用
  if (last && last.type !== 'text' && last.type !== 'system') {
    ;[150, 400, 900].forEach((delay) => setTimeout(scrollToAnchorBottom, delay))
  }
}

watch(
  () => messages.value[messages.value.length - 1]?.id,
  (id, prev) => {
    if (id && id !== prev) {
      nextTick(() => scrollToBottom())
    }
  },
)

async function onSend() {
  if (composerBlocked.value) return
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  showPlusPanel.value = false
  closeAtMention()
  try {
    if (actions.quote.value) {
      await chatStore.sendQuote(
        conversationId.value,
        text,
        actions.quote.value.id,
        imUserId.value || myId.value,
      )
      actions.clearQuote()
    } else if (actions.atList.value.length > 0) {
      await chatStore.sendAtText(
        conversationId.value,
        text,
        imUserId.value || myId.value,
        actions.atList.value,
      )
      actions.atList.value = []
    } else {
      await chatStore.sendText(conversationId.value, text, imUserId.value || myId.value)
    }
    await nextTick()
    scrollToBottom()
  } catch (e) {
    // 发送失败（如被对方拉黑、网络异常）：消息气泡已由 store 标为 failed（红色感叹号），
    // 用户点感叹号可重发，这里不弹 toast 打扰，避免出现 blocked 等原始错误提示。
    if (isGroupUnavailableError((e as Error)?.message) || isNotInGroupIMError(e)) {
      exitUnavailableGroupRoom()
      return
    }
    console.warn('[room] 发送失败', (e as Error)?.message)
  }
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

function onConfirmSend() {
  if (!enterToSend.value) return
  triggerSend()
}

/** 回车发送开启时：Shift+Enter 换行（uni-app send 模式会拦截 Enter） */
function onComposerKeydown(e: KeyboardEvent) {
  if (!enterToSend.value || e.key !== 'Enter' || !e.shiftKey) return
  if (!isH5ComposerPlatform()) return
  e.preventDefault()
  e.stopPropagation()
  const el = getComposerTextareaEl(e.target)
  if (!el) return
  const start = el.selectionStart ?? input.value.length
  const end = el.selectionEnd ?? start
  const val = input.value
  input.value = `${val.slice(0, start)}\n${val.slice(end)}`
  void nextTick(() => {
    const pos = start + 1
    el.selectionStart = pos
    el.selectionEnd = pos
    el.focus()
  })
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
  if (!conversationId.value) return
  const senderId = imUserId.value || myId.value
  try {
    if (m.type === 'text') {
      await chatStore.sendText(conversationId.value, m.content, senderId)
    } else if (m.type === 'image') {
      if (/^(https?|blob|file):/.test(m.content)) {
        await chatStore.sendImageUrl(conversationId.value, m.content, senderId)
      } else {
        await chatStore.sendImage(conversationId.value, m.content, senderId)
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
      if (path) await chatStore.sendVoice(conversationId.value, path, duration, senderId)
    } else if (m.type === 'file') {
      const name = m.content.split(/[\\/]/).filter(Boolean).pop() || '文件'
      await chatStore.sendFile(conversationId.value, m.content, name, senderId)
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
      if (path) await chatStore.sendVideo(conversationId.value, path, senderId, duration, snapshot)
    }
    await chatStore.removeLocal(conversationId.value, m.id).catch(() => undefined)
    await nextTick()
    scrollToBottom()
  } catch (e) {
    uni.showToast({ title: (e as Error)?.message || '重发失败', icon: 'none' })
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
  } catch {
    // 成员列表失败不阻断聊天；管控项由后端兜底
  }
}

/** 业务 UUID → OpenIM userID（去连字符） */
function openIMUserIdOf(businessUserId: string): string {
  return businessUserId.replace(/-/g, '').toLowerCase()
}

function memberDisplayName(m: GroupMember): string {
  return m.memberRemark?.trim() || m.groupNickname || m.nickname || '成员'
}

const canAtAll = computed(() => myRole.value === 'owner' || myRole.value === 'admin')

const atMentionMembers = computed<AtMentionMember[]>(() => {
  const me = myId.value
  const meIm = (imUserId.value || '').toLowerCase()
  return groupMembersForAt.value
    .filter((m) => {
      if (!m.id) return false
      if (me && m.id === me) return false
      if (meIm && openIMUserIdOf(m.id) === meIm) return false
      return true
    })
    .map((m) => ({
      id: m.id,
      imUserId: openIMUserIdOf(m.id),
      name: memberDisplayName(m),
      avatar: m.avatar || APP_CONFIG.defaultAvatarUrl,
    }))
})

/** 输入框末尾是否处于「刚打了 @」的提及态。
 * 匹配：行首或空白后的 `@关键字`（关键字不含空白与 @）。
 */
function syncAtMentionFromInput(e?: Event | { detail?: { value?: string } }) {
  // App 端 @input 有时早于 v-model 落库，优先用事件值
  const detail = e && 'detail' in e ? e.detail : undefined
  if (detail && typeof detail.value === 'string') {
    input.value = detail.value
  }
  if (chatType.value !== 'group' || composerBlocked.value) {
    closeAtMention()
    return
  }
  const text = input.value
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
  // 成员列表尚未就绪时补拉一次，避免面板空白
  if (!groupMembersForAt.value.length && businessId.value) {
    void loadGroupMembersMeta(businessId.value)
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
  applyAtMention(member.name, member.imUserId)
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
    void loadGroupMembersMeta(gid)
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

async function goToProfile() {
  const id = await resolveBusinessTarget()
  if (!id) {
    uni.showToast({ title: '暂无可跳转的资料', icon: 'none' })
    return
  }
  if (chatType.value === 'private') {
    uni.navigateTo({
      url: `/pages/contacts/friend-detail?id=${encodeURIComponent(id)}`,
    })
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
    uni.navigateTo({ url: `/pages/contacts/friend-detail?id=${encodeURIComponent(userId)}` })
    return
  }

  if (!contactStore.contacts.length) {
    try {
      await contactStore.loadDirectory()
    } catch {
      // 通讯录拉失败时按非好友打开资料页
    }
  }
  const isFriend = contactStore.contacts.some((c) => c.id === userId)
  // 群内非好友资料页带 groupId，加好友时走群来源接口（受 allowMemberAddFriend 限制）
  const groupParam =
    chatType.value === 'group' && businessId.value
      ? `&groupId=${encodeURIComponent(businessId.value)}`
      : ''
  const path = isFriend
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
    rememberDismissedAnnouncement(imUserId.value || myId.value, conversationId.value, text)
  }
  announcementDismissEpoch.value += 1
  await chatStore.dismissGroupAnnouncement(conversationId.value)
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
  const displayName = nicknameOf(message) || message.senderNickname || ''
  actions.atUser(message, displayName)
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
    const authorize = (uni as any).authorize
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

  const uniRecorder = (uni as any).getRecorderManager?.()
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

    recorder.start({ format: 'aac' })
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
      !!(navigator as any).getUserMedia ||
      !!(navigator as any).webkitGetUserMedia
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
    const mediaRecorder = new MediaRecorder(stream)
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
    recorder = mediaRecorder
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
      conversationId.value,
      draft.path,
      draft.duration,
      imUserId.value || myId.value,
    )
    await nextTick()
    scrollToBottom()
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
    await chatStore.sendImageUrl(conversationId.value, url, imUserId.value || myId.value)
    await nextTick()
    scrollToBottom()
  } catch (e) {
    uni.showToast({
      title: e instanceof Error ? e.message : '发送失败',
      icon: 'none',
    })
  }
}

function onPlus() {
  showPlusPanel.value = !showPlusPanel.value
  if (showPlusPanel.value) {
    showEmojiPanel.value = false
    closeAtMention()
  }
}

/** 相册 / 文件一次最多可选数量 */
const MAX_PICK_COUNT = 9

function onPlayVideo(message: ChatMessage) {
  uni.navigateTo({
    url: `/pages/chat/video-viewer?conversationId=${encodeURIComponent(conversationId.value)}&messageId=${encodeURIComponent(message.id)}&content=${encodeURIComponent(message.content)}&senderNickname=${encodeURIComponent(message.senderNickname || '')}&createdAt=${encodeURIComponent(message.createdAt)}`,
  })
}

function chooseFailToast(err: { errMsg?: string } | undefined, fallback: string) {
  const msg = String(err?.errMsg || '')
  if (/cancel/i.test(msg)) return
  uni.showToast({ title: msg.replace(/^[^:]+:\s*/, '') || fallback, icon: 'none' })
}

function requestAlbumAccess(): Promise<void> {
  return new Promise((resolve) => {
    // H5 / 小程序没有 HTML5+ 运行时，相册权限由浏览器或 uni.chooseImage 自行处理
    let uniPlatform = ''
    try {
      uniPlatform = uni.getSystemInfoSync().uniPlatform || ''
    } catch {
      resolve()
      return
    }
    if (uniPlatform !== 'app') {
      resolve()
      return
    }
    const os = String(uni.getSystemInfoSync().osName || uni.getSystemInfoSync().platform || '').toLowerCase()
    const request = plus?.android?.requestPermissions
    if (!os.includes('android') || typeof request !== 'function') {
      resolve()
      return
    }
    request(
      [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
      ],
      () => resolve(),
      () => resolve(),
    )
  })
}

function afterPlusClosed(run: () => void) {
  showPlusPanel.value = false
  setTimeout(run, 120)
}

/** 相册多选：一次最多 9 张，逐张发送保持顺序，单张失败不中断并汇总提示 */
function pickImage() {
  afterPlusClosed(() => {
    void requestAlbumAccess().then(() => {
      uni.chooseImage({
        count: MAX_PICK_COUNT,
        sourceType: ['album'],
        sizeType: ['compressed', 'original'],
        fail: (err) => chooseFailToast(err, '无法打开相册'),
        success: async (res) => {
          const paths = (res.tempFilePaths || []).slice(0, MAX_PICK_COUNT)
          let failed = 0
          for (const path of paths) {
            try {
              await chatStore.sendImage(conversationId.value, path, imUserId.value || myId.value)
              await nextTick()
              scrollToBottom()
            } catch {
              failed++
            }
          }
          if (failed) {
            uni.showToast({ title: `${failed} 张图片发送失败`, icon: 'none' })
          }
        },
      })
    })
  })
}

/** 相机拍照即发 */
function pickCamera() {
  afterPlusClosed(() => {
    uni.chooseImage({
      count: 1,
      sourceType: ['camera'],
      fail: (err) => chooseFailToast(err, '无法打开相机'),
      success: async (res) => {
        try {
          await chatStore.sendImage(conversationId.value, res.tempFilePaths[0], imUserId.value || myId.value)
          await nextTick()
          scrollToBottom()
        } catch (e) {
          uni.showToast({ title: (e as Error).message, icon: 'none' })
        }
      },
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
          try {
            await chatStore.sendVideo(
              conversationId.value,
              res.tempFilePath,
              imUserId.value || myId.value,
              Number(res.duration || 0),
              (res as { thumbTempFilePath?: string }).thumbTempFilePath || '',
            )
            await nextTick()
            scrollToBottom()
          } catch (e) {
            uni.showToast({ title: (e as Error).message || '视频发送失败', icon: 'none' })
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
    url: `/pages/chat/card-picker?conversationId=${encodeURIComponent(conversationId.value)}&title=${encodeURIComponent(title.value)}`,
  })
}

/** 选本地文件发送：一次最多 9 个（app 端原生选择器仅支持单选），逐个发送保持顺序，单个失败不中断并汇总提示 */
async function pickFile() {
  showPlusPanel.value = false
  try {
    const files = await chooseLocalFiles(MAX_PICK_COUNT)
    let failed = 0
    for (const file of files) {
      try {
        await chatStore.sendFile(conversationId.value, file.path, file.name, imUserId.value || myId.value)
        await nextTick()
        scrollToBottom()
      } catch {
        failed++
      }
    }
    if (failed) {
      uni.showToast({ title: `${failed} 个文件发送失败`, icon: 'none' })
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
    url: `/pages/chat/favorite-picker?conversationId=${encodeURIComponent(conversationId.value)}&title=${encodeURIComponent(title.value)}`,
  })
}
</script>

<template>
  <view class="room" :class="{ 'room-embedded': embedded }">
    <view
      class="chat-header"
      :style="{ paddingTop: embedded ? '0px' : statusBarHeight + 'px' }"
    >
      <view v-if="!embedded" class="back-btn" @click="goBack">‹</view>
      <text v-if="chatType === 'group' && memberCount > 0" class="member-count">{{ memberCount }}</text>
      <view class="header-title" @click="goToProfile">
        <text class="header-title-text">{{ title }}</text>
      </view>
      <view class="header-icon-wrap">
        <view class="header-icon" @click.stop="onHeaderMoreClick">⋯</view>
        <ImDesktopGroupMenu
          v-if="embedded && chatType === 'group' && businessId && conversationId"
          v-model="showGroupMenu"
          :group-id="businessId"
          :conversation-id="conversationId"
        />
      </view>
    </view>

    <view v-if="showAnnouncementBanner" class="announce-bar">
      <image class="announce-icon" src="/static/icons/icon-megaphone.svg" mode="aspectFit" />
      <text class="announce-text" @click="openAnnouncement">{{ announcementText }}</text>
      <text class="announce-dismiss" @click.stop="dismissAnnouncementBanner">不再提示</text>
    </view>

    <!-- 不开 scroll-with-animation：uni 的滚动动画是 transform 假动画 + 过渡结束才提交 scrollTop，
         发送后连续两次贴底会在动画中途重测位置，最终落点偏小导致最新消息下半截被视口切掉 -->
    <scroll-view
      scroll-y
      class="msg-list"
      :scroll-into-view="scrollInto"
      @scrolltoupper="onScrollToUpper"
    >
      <view
        v-for="m in messages"
        :id="`msg_${m.id}`"
        :key="m.id"
        class="msg-row"
        :class="{ selecting: actions.selecting.value }"
        @click="actions.selecting.value ? actions.toggleSelect(m) : undefined"
      >
        <view v-if="actions.selecting.value && m.type !== 'system'" class="msg-check" :class="{ on: actions.selectedIds.value.has(m.id) }">
          <text v-if="actions.selectedIds.value.has(m.id)">✓</text>
        </view>
        <view v-if="m.type === 'system'" class="sys-tip">
          <text class="sys-tip-text">{{ systemTextOf(m) }}</text>
        </view>
        <ChatBubble
          v-else
          :message="m"
          :mine="isMine(m)"
          :avatar="avatarOf(m)"
          :fallback-avatar="fallbackAvatarOf(m)"
          :nickname="nicknameOf(m)"
          :preview-urls="imagePreviewUrls"
          :read-state="readStateOf(m)"
          @avatar-click="onAvatarClick(m)"
          @avatar-longpress="onAvatarLongpress(m)"
          @card-view="onViewCard"
          @group-invite-apply="onGroupInviteApply"
          @longpress="actions.openMenu(m)"
          @retry="onRetry(m)"
          @play-video="onPlayVideo"
        />
      </view>
      <!-- 底部锚点：scroll-into-view 只保证元素「顶部」进入视口，最后一条比视口高时会露出上半截；
           滚到垫底的锚点等于滚到真正的底部，保证最新消息完整可见 -->
      <view id="bottom-anchor" class="bottom-anchor"></view>
    </scroll-view>

    <view v-if="actions.selecting.value" class="composer safe-bottom">
      <ImMessageSelectBar
        :count="actions.selectedCount.value"
        :mode="actions.selectMode.value"
        @cancel="actions.cancelSelect"
        @forward="actions.onSelectForward"
        @remove="actions.onSelectDelete"
      />
    </view>
    <view v-else class="composer safe-bottom">
      <ImQuoteBar
        v-if="actions.quote.value"
        :nickname="nicknameOf(actions.quote.value) || actions.quote.value.senderNickname || '我'"
        :thumb="quoteThumbOf(actions.quote.value.type, actions.quote.value.content, avatarOf(actions.quote.value))"
        :text="quoteSummaryOf(actions.quote.value.type, actions.quote.value.content)"
        @close="actions.clearQuote"
      />
      <view v-if="composerBlocked" class="composer-blocked">
        <text class="composer-blocked-tip">🔇 {{ blockTip }}</text>
        <view class="mute-check-btn" :class="{ checking: checkingMute }" @click="checkMuteStatus">
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
        @close="closeAtMention"
        @select-all="onAtMentionSelectAll"
        @select="onAtMentionSelect"
      />

      <view v-if="voiceMode" class="voice-bar">
        <view class="voice-trash" @click="cancelVoiceDraft">🗑</view>

        <view class="voice-middle" @click="recording ? stopVoiceRecord() : undefined">
          <view class="record-dot" :class="{ active: recording }"></view>
          <text class="record-time">{{ formatDuration(recordingSeconds) }}</text>
        </view>

        <view class="voice-actions">
          <view class="send-gray-btn" @click="recording ? stopVoiceRecord() : sendVoiceDraft()">
            <text>{{ recording ? '结束' : '发送' }}</text>
          </view>
          <view class="send-icon-btn" @click="sendVoiceDraft">↑</view>
        </view>
      </view>

      <view v-else class="composer-row">
        <view class="tool" @click="startVoiceRecord">
          <image class="tool-icon" src="/static/icon-mic.png" mode="aspectFit" />
        </view>
        <view class="input-wrap">
          <textarea
            ref="inputRef"
            class="input"
            v-model="input"
            :maxlength="-1"
            :auto-height="true"
            :confirm-type="composerConfirmType"
            :show-confirm-bar="false"
            :disable-default-padding="true"
            :hold-keyboard="true"
            :adjust-position="true"
            placeholder="输入消息"
            placeholder-style="color:#B0B0B0"
            :cursor-spacing="20"
            @input="syncAtMentionFromInput"
            @confirm="onConfirmSend"
            @keydown="onComposerKeydown"
          />
          <text class="emoji" @click="onEmoji">☺</text>
        </view>
        <view class="tool" @click="onPlus">＋</view>
        <view v-if="hasInput" class="send-btn" @click="onSend">传送</view>
      </view>
      </template>

      <view v-if="showPlusPanel && !composerBlocked" class="plus-panel">
        <view class="plus-item" @click="pickCamera">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-camera.png" mode="aspectFit" />
          </view>
          <text>相机</text>
        </view>
        <view class="plus-item" @click="pickImage">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-photo.png" mode="aspectFit" />
          </view>
          <text>照片</text>
        </view>
        <view class="plus-item" @click="pickVideo">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-video.svg" mode="aspectFit" />
          </view>
          <text>视频</text>
        </view>
        <view v-if="chatType !== 'group'" class="plus-item" @click="pickCard">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-card.png" mode="aspectFit" />
          </view>
          <text>名片</text>
        </view>
        <view class="plus-item" @click="pickFile">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-file.png" mode="aspectFit" />
          </view>
          <text>文件</text>
        </view>
        <view class="plus-item" @click="pickFavorite">
          <view class="plus-icon">
            <image class="plus-icon-img" src="/static/icon-favorite.png" mode="aspectFit" />
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
  background: #f5f5f5;
  overflow: hidden;
}

.room-embedded {
  height: 100%;
}

.chat-header {
  display: flex;
  align-items: center;
  height: 94rpx;
  padding: 0 26rpx;
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
  font-size: 38rpx;
  font-weight: 700;
  color: #111;
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

.msg-list {
  flex: 1;
  height: 0;
  padding-bottom: 16rpx;
}

.msg-row {
  width: 100%;
  box-sizing: border-box;
}

/** 底部滚动锚点：不可见的 2rpx 垫底元素，滚到它 = 滚到列表真正的底部 */
.bottom-anchor {
  height: 2rpx;
}

.msg-row.selecting {
  display: flex;
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

.sys-tip {
  display: flex;
  justify-content: center;
  padding: 12rpx 32rpx;
}

.sys-tip-text {
  font-size: 24rpx;
  color: #333333;
  text-align: center;
  line-height: 1.5;
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
