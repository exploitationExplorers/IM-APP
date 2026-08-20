<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import ChatBubble from '@/components/ChatBubble.vue'
import EmojiStickerPanel from '@/components/EmojiStickerPanel.vue'
import ImMessageActionMenu from '@/components/ImMessageActionMenu.vue'
import ImMessageSelectBar from '@/components/ImMessageSelectBar.vue'
import ImQuoteBar from '@/components/ImQuoteBar.vue'
import ImSuccessToast from '@/components/ImSuccessToast.vue'
import { useChatMessageActions, type MemberMeta } from '@/composables/useChatMessageActions'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { useChatSettingsStore } from '@/stores/chatSettings'
import { useForwardStore } from '@/stores/forward'
import { businessUserIdFromIM, chooseLocalFiles, ensureIMLogin, imUserId } from '@/utils/openim'
import { APP_CONFIG } from '@/config'
import { useContactStore } from '@/stores/contact'
import { resolveIMGroupByIM } from '@/api/im'
import { fetchGroupDetail, fetchGroupMembers } from '@/api/group'
import { safeBack } from '@/utils/nav'
import type { CardPayload, ChatMessage, Conversation } from '@/types'
import { collapseRepeatedGroupNameNotices, replaceOpenIMAdminLabel } from '@/utils/im-notification'
import { getStatusBarHeight } from '@/utils/status-bar'
import {
  isAnnouncementDismissed,
  rememberDismissedAnnouncement,
} from '@/utils/group-announcement'

const chatStore = useChatStore()
const userStore = useUserStore()
const contactStore = useContactStore()
const forwardStore = useForwardStore()
const successVisible = ref(false)

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
const input = ref('')
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
  if (m.type === 'image' || m.type === 'voice' || m.type === 'file') return true
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
 * 私聊已读回执展示条件：仅私聊 + 自己发的 + 已成功发出的消息。
 * 发送中 / 失败的消息没有已读语义；群聊 OpenIM 单聊回执能力不覆盖，不展示。
 */
function readStateOf(message: ChatMessage): 'read' | 'unread' | undefined {
  if (chatType.value !== 'private' || !isMine(message)) return undefined
  if (message.status !== 'sent') return undefined
  return message.hasRead ? 'read' : 'unread'
}

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
const confirmType = computed(() => (enterToSend.value ? 'send' : 'done'))
const hasInput = computed(() => input.value.trim().length > 0)

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

onShow(() => {
  if (chatType.value === 'group') void refreshGroupMeta()
  if (chatType.value === 'private') refreshPrivateTitle()
  if (!forwardStore.consumeSucceeded()) return
  actions.cancelSelect()
  successVisible.value = true
})

onUnload(() => {
  if (muteExpireTimer) {
    clearTimeout(muteExpireTimer)
    muteExpireTimer = null
  }
  chatStore.setOnIncomingForDissolve(null)
})

/**
 * 用户在房间时收到群解散通知时，自动 toast + 返回上一页。
 * 通过 chatStore.setOnIncomingForDissolve 注册回调，避开 messagesMap 的 reactive watch。
 */
let dissolvedInRoom = false
function handleIncomingForDissolve(message: { conversationId?: string; notificationKind?: string }) {
  if (dissolvedInRoom) return
  if (chatType.value !== 'group') return
  if (message.conversationId !== conversationId.value) return
  if (message.notificationKind !== 'dissolved') return
  dissolvedInRoom = true
  uni.showToast({ title: '群已解散', icon: 'none', duration: 2000 })
  setTimeout(() => uni.navigateBack(), 0)
}
chatStore.setOnIncomingForDissolve(handleIncomingForDissolve)

onLoad(async (query) => {
  title.value = decodeURIComponent(String(query?.title || '聊天'))
  peerAvatar.value = decodeURIComponent(String(query?.avatar || APP_CONFIG.defaultAvatarUrl))
  chatType.value = String(query?.type || 'group') === 'private' ? 'private' : 'group'
  businessId.value = String(query?.targetId || '')
  uni.setNavigationBarTitle({ title: '' })
  uni.hideNavigationBarLoading?.()

  try {
    const conv = await chatStore.enterConversation({
      conversationId: String(query?.conversationId || ''),
      type: chatType.value,
      businessId: businessId.value,
    })
    convRef.value = conv
    conversationId.value = conv.id
    if (!query?.title) title.value = conv.title

    // 确保当前 OpenIM 用户 ID 已就绪（某些 H5/热更新场景下 imUserId 可能未同步到本页）
    if (!imUserId.value) {
      await ensureIMLogin()
    }
    myId.value = imUserId.value
    if (!myId.value) {
      throw new Error('当前 IM 用户 ID 未初始化，请重新登录')
    }

    if (chatType.value === 'group' && !businessId.value) {
      try {
        businessId.value = await resolveBusinessTarget()
      } catch {
        businessId.value = ''
      }
    }

    // 群聊先查群详情：群已解散时弹 toast 后直接返回上一页，不再调 OpenIM 拉历史
    // （避免触发 getAdvancedHistoryMessageList errCode=10006）
    if (chatType.value === 'group' && businessId.value) {
      await refreshGroupMeta()
      if (groupDissolved.value) {
        uni.showToast({ title: '群已解散', icon: 'none', duration: 2000 })
        setTimeout(() => uni.navigateBack(), 0)
        return
      }
    }

    await Promise.all([
      chatStore.loadMessages(conv.id).catch((e: any) => {
        // 兜底：预检测失败时 OpenIM SDK 直接抛 getAdvancedHistoryMessageList errCode=10006，
        // 同样弹 toast 后返回上一页
        if (chatType.value === 'group' && e?.message?.includes('10006')) {
          uni.showToast({ title: '群已解散', icon: 'none', duration: 2000 })
          setTimeout(() => uni.navigateBack(), 0)
          return
        }
        throw e
      }),
      chatType.value === 'group' ? refreshGroupMeta() : Promise.resolve(),
    ])
    await nextTick()
    scrollToBottom()
  } catch (e) {
    console.error('[chat] 打开会话失败', e)
    uni.showToast({ title: (e as Error)?.message || '会话打开失败', icon: 'none', duration: 4000 })
  }
})

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
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onConfirmSend() {
  if (!enterToSend.value) return
  onSend()
}

function goBack() {
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
    const [ms, detail] = await Promise.all([
      fetchGroupMembers(gid),
      fetchGroupDetail(gid).catch((e: any) => {
        // APP 端 GetByID 过滤了已解散群，返回 404「群不存在或无权访问」，
        // 与已解散语义对齐，避免被静默吞掉后还继续去 OpenIM 拉历史（errCode 10006）
        if (e?.message?.includes('群不存在')) {
          groupDissolved.value = true
          return null
        }
        return null
      }),
    ])
    // 拿到 detail 说明群有效，重置解散标记
    if (detail) {
      groupDissolved.value = false
    }
    const map: Record<string, string> = {}
    const avatarMap: Record<string, string> = {}
    const metaMap: Record<string, MemberMeta> = {}
    for (const m of ms) {
      const r = m.memberRemark?.trim()
      if (r) map[m.id] = r
      const av = m.avatar?.trim()
      if (av) avatarMap[m.id] = av
      metaMap[m.id] = { role: m.role, isMuted: !!m.isMuted }
    }
    memberRemarkMap.value = map
    memberAvatarMap.value = avatarMap
    memberMetaMap.value = metaMap
    memberCount.value = ms.length
    const owner = ms.find((m) => m.role === 'owner')
    groupOwnerName.value =
      owner?.memberRemark?.trim() ||
      owner?.displayName?.trim() ||
      owner?.groupNickname?.trim() ||
      owner?.nickname?.trim() ||
      ''
    const me = userStore.profile?.id
    const self = me ? ms.find((m) => m.id === me) : undefined
    if (self) myRole.value = self.role
    if (detail) {
      applyGroupChatPermission(detail, self)
      announcementText.value = (detail.announcement || '').trim()
      detailApplied = true
    }
  } catch {
    // 人数刷新失败时保留当前值
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

/** 名片消息点「查看」：直接进对应好友详情页 */
function onViewCard(card: CardPayload) {
  if (!card.userId) {
    uni.showToast({ title: '名片信息缺失', icon: 'none' })
    return
  }
  void openProfileById(card.userId)
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
      const path = res.tempFilePath || ''
      // App 端 onStop 的 duration 单位是毫秒，统一换算成秒；缺失时退回计时器秒数
      const rawDuration = Number(res.duration || 0)
      const duration =
        rawDuration > 0 ? Math.max(1, Math.round(rawDuration / 1000)) : Math.max(1, recordingSeconds.value)
      if (!path) {
        voiceMode.value = false
        uni.showToast({ title: '录音文件无效', icon: 'none' })
        return
      }
      voiceDraft.value = { path, duration }
    })

    recorder.onError(() => {
      recording.value = false
      clearRecordingTimer()
      voiceMode.value = false
      voiceDraft.value = null
      cleanupBrowserRecorder()
      uni.showToast({ title: '录音失败', icon: 'none' })
    })

    recorder.start({
      format: uni.getSystemInfoSync().platform === 'ios' ? 'aac' : 'mp3',
    })
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
  }
}

function onEmojiSelect(value: string) {
  input.value += value
  showEmojiPanel.value = false
}

function onPlus() {
  showPlusPanel.value = !showPlusPanel.value
  if (showPlusPanel.value) {
    showEmojiPanel.value = false
  }
}

/** 相册 / 文件一次最多可选数量 */
const MAX_PICK_COUNT = 9

/** 相册多选：一次最多 9 张，逐张发送保持顺序，单张失败不中断并汇总提示 */
function pickImage() {
  uni.chooseImage({
    count: MAX_PICK_COUNT,
    sourceType: ['album'],
    success: async (res) => {
      showPlusPanel.value = false
      // 各端选择器一般已按 count 限制，这里再截一次兜底
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
}

/** 相机拍照即发 */
function pickCamera() {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: async (res) => {
      showPlusPanel.value = false
      try {
        await chatStore.sendImage(conversationId.value, res.tempFilePaths[0], imUserId.value || myId.value)
        await nextTick()
        scrollToBottom()
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}

/** 选好友发名片：跳好友选择页，发送在 card-picker 内完成后返回本页 */
function pickCard() {
  showPlusPanel.value = false
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
  <view class="room">
    <view class="chat-header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="back-btn" @click="goBack">‹</view>
      <text v-if="chatType === 'group' && memberCount > 0" class="member-count">{{ memberCount }}</text>
      <view class="header-title" @click="goToProfile">
        <text class="header-title-text">{{ title }}</text>
      </view>
      <view class="header-icon" @click="goToProfile">⋯</view>
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
          @card-view="onViewCard"
          @longpress="actions.openMenu(m)"
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
        :nickname="actions.quote.value.senderNickname || nicknameOf(actions.quote.value) || '我'"
        :text="actions.quote.value.content"
        @close="actions.clearQuote"
      />
      <view v-if="composerBlocked" class="composer-blocked">
        <text class="composer-blocked-tip">🔇 {{ blockTip }}</text>
        <view class="mute-check-btn" :class="{ checking: checkingMute }" @click="checkMuteStatus">
          {{ checkingMute ? '检查中…' : '检查禁言状态' }}
        </view>
      </view>

      <template v-else>
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
          <input
            class="input"
            v-model="input"
            :confirm-type="confirmType"
            placeholder="输入消息"
            placeholder-style="color:#B0B0B0"
            @confirm="onConfirmSend"
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
        <view class="plus-item" @click="pickCard">
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
        @close="showEmojiPanel = false"
      />
    </view>

    <ImMessageActionMenu
      v-if="actions.menuVisible.value"
      :items="actions.menuItems.value"
      :top="actions.menuTop.value"
      :left="actions.menuLeft.value"
      @select="actions.onMenuSelect"
      @close="actions.closeMenu"
    />
    <ImSuccessToast
      :visible="successVisible"
      text="转发成功"
      placement="top"
      @close="successVisible = false"
    />
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

.chat-header {
  display: flex;
  align-items: center;
  height: 94rpx;
  padding: 0 26rpx;
  box-sizing: content-box;
  background: #ffffff;
  border-bottom: 1rpx solid #ececec;
  flex-shrink: 0;
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

.header-icon {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
  color: #444;
  flex-shrink: 0;
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
  align-items: center;
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
  background: #fff;
  border-radius: 36rpx;
  min-height: 72rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.input {
  flex: 1;
  font-size: 28rpx;
  height: 72rpx;
}

.emoji {
  font-size: 36rpx;
  color: #666;
  margin-left: 8rpx;
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
