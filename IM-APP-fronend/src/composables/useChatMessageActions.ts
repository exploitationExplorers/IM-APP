import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { ChatMessage, GroupRole } from '@/types'
import type { MessageMenuItem } from '@/components/ImMessageActionMenu.vue'
import { createFavorite } from '@/api/favorites'
import { muteGroupMember, removeGroupMember, unmuteGroupMember } from '@/api/group'
import { MUTE_OPTIONS } from '@/constants/mute'
import { useChatStore } from '@/stores/chat'
import { useForwardStore } from '@/stores/forward'
import { rememberConversationTitle } from '@/utils/favoriteMeta'
import { saveVideoToDevice } from '@/utils/chatMedia'
import { businessUserIdFromIM } from '@/utils/openim'

/** 群成员的发言管控元信息（房间页从群成员接口构建，业务用户 ID 索引） */
export interface MemberMeta {
  role: GroupRole
  isMuted: boolean
}

export function useChatMessageActions(opts: {
  conversationId: Ref<string>
  chatType: Ref<'private' | 'group'>
  businessId: Ref<string>
  myId: Ref<string>
  myRole: Ref<'owner' | 'admin' | 'member'>
  input: Ref<string>
  nicknameOf: (message: ChatMessage) => string
  isMine: (message: ChatMessage) => boolean
  visibleMessages: ComputedRef<ChatMessage[]>
  conversationTitle?: Ref<string>
  /** 群成员角色/禁言元信息，用于撤回他人消息与禁言/解禁的权限判断 */
  memberMeta?: Ref<Record<string, MemberMeta>>
  /** 禁言/解禁成功后的回调（房间页用来刷新成员禁言状态） */
  onMuteChanged?: () => void
}) {
  const chatStore = useChatStore()
  const forwardStore = useForwardStore()

  const SENDER_LEFT_GROUP_TOAST = '该群友不在群聊'

  function isMemberListLoaded(): boolean {
    const map = opts.memberMeta?.value
    return !!map && Object.keys(map).length > 0
  }

  /** 消息发送者是否仍在当前群（已移除成员的历史消息返回 false） */
  function isSenderInGroup(message: ChatMessage): boolean {
    if (opts.chatType.value !== 'group' || opts.isMine(message)) return true
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId) return false
    if (!isMemberListLoaded()) return true
    return !!opts.memberMeta!.value[userId]
  }

  function notifySenderLeftGroup() {
    uni.showToast({ title: SENDER_LEFT_GROUP_TOAST, icon: 'none' })
  }

  /** 涉及发送者本人的菜单动作：已退群/被踢则仅提示，不继续交互 */
  function guardSenderInGroup(message: ChatMessage): boolean {
    if (isSenderInGroup(message)) return true
    notifySenderLeftGroup()
    return false
  }

  const menuMessage = ref<ChatMessage | null>(null)
  const selecting = ref(false)
  const selectMode = ref<'forward' | 'multi'>('multi')
  const selectedIds = ref<Set<string>>(new Set())
  const quote = ref<ChatMessage | null>(null)
  /** 头像长按 @TA 记下被 @ 的人（OpenIM userID + 群昵称），发送时走 AtText */
  const atList = ref<Array<{ atUserID: string; groupNickname: string }>>([])

  const selectedCount = computed(() => selectedIds.value.size)
  const menuVisible = computed(() => !!menuMessage.value && !selecting.value)

  /** 目标成员的角色/禁言状态（业务用户 ID 索引）；成员列表没加载到时返回 undefined */
  function memberMetaOf(message: ChatMessage): MemberMeta | undefined {
    const map = opts.memberMeta?.value
    if (!map) return undefined
    const userId = businessUserIdFromIM(message.senderId)
    return userId ? map[userId] : undefined
  }

  /** 群主/管理员能否管控该消息的发送者：与后端权限矩阵一致（不可动群主，管理员不可动管理员） */
  function canActOnTarget(message: ChatMessage) {
    if (opts.chatType.value !== 'group') return false
    const myRole = opts.myRole.value
    if (myRole === 'member' || opts.isMine(message)) return false
    const meta = memberMetaOf(message)
    if (meta?.role === 'owner') return false
    if (meta) {
      if (meta.role === 'admin' && myRole !== 'owner') return false
      return myRole === 'owner' || meta.role === 'member'
    }
    // 成员列表尚未加载时先展示管控项，最终由后端校验
    return myRole === 'owner' || myRole === 'admin'
  }

  /**
   * 撤回入口：自己的消息（非发送中）一律显示，超 2 分钟窗口由后端校验并 toast 提示；
   * 他人的消息仅群主/管理员显示，目标角色已加载时按权限矩阵收敛，
   * 没加载到也先显示，由后端最终判定（无权时返回明确报错）。
   */
  function canRevoke(message: ChatMessage) {
    if (message.status === 'sending') return false
    if (opts.isMine(message)) return true
    if (opts.chatType.value !== 'group') return false
    const myRole = opts.myRole.value
    if (myRole === 'member') return false
    const meta = memberMetaOf(message)
    if (!meta) return true
    if (meta.role === 'owner') return false
    return myRole === 'owner' || meta.role === 'member'
  }

  const menuItems = computed<MessageMenuItem[]>(() => {
    const message = menuMessage.value
    if (!message) return []
    const mine = opts.isMine(message)
    const isGroup = opts.chatType.value === 'group'
    const canManage = canActOnTarget(message)
    const items: MessageMenuItem[] = []

    // 参考站顺序：转发|引用 → 复制|收藏 → 检举|@TA → 禁言|删除 → 多选|空
    if (mine && canRevoke(message)) {
      items.push({ key: 'revoke', label: '撤回' })
    }
    items.push({ key: 'forward', label: '转发' }, { key: 'quote', label: '引用' })
    if (message.type === 'text') items.push({ key: 'copy', label: '复制' })
    if (message.type === 'video') items.push({ key: 'save', label: '保存视频' })
    items.push({ key: 'favorite', label: '收藏' })
    if (!mine && isGroup) {
      items.push({ key: 'report', label: '检举' }, { key: 'at', label: '@TA' })
    }
    if (!mine && canManage) {
      const muted = !!memberMetaOf(message)?.isMuted
      items.push(muted ? { key: 'unmute', label: '解除禁言' } : { key: 'mute', label: '禁言' })
    }
    items.push({ key: 'delete', label: '删除' }, { key: 'multi', label: '多选' })

    const gridCount = items.length
    if (gridCount % 2 === 1) {
      items.push({ key: '_spacer', label: '', spacer: true })
    }

    if (!mine && canManage) {
      items.push({ key: 'kick', label: '移除该成员', wide: true })
      items.push({ key: 'kickAndDelete', label: '移除该成员并删除消息', wide: true })
    }
    return items
  })

  function closeMenu() {
    menuMessage.value = null
  }

  function openMenu(message: ChatMessage, event?: { touches?: Array<{ clientX: number; clientY: number }> }) {
    if (selecting.value || message.type === 'system') return
    void event
    menuMessage.value = message
  }

  function enterSelect(message: ChatMessage, mode: 'forward' | 'multi') {
    selectMode.value = mode
    selecting.value = true
    selectedIds.value = new Set([message.id])
    closeMenu()
  }

  function toggleSelect(message: ChatMessage) {
    if (!selecting.value) return
    const next = new Set(selectedIds.value)
    if (next.has(message.id)) {
      next.delete(message.id)
    } else {
      // iOS 一次最多转发 99 条：转发模式选满即止；多选模式不限制（批量删除不受影响）
      next.add(message.id)
    }
    selectedIds.value = next
  }

  function cancelSelect() {
    selecting.value = false
    selectedIds.value = new Set()
  }

  function selectedMessages() {
    const ids = selectedIds.value
    return opts.visibleMessages.value.filter((m) => ids.has(m.id))
  }

  function goForward(messages: ChatMessage[]) {
    if (!messages.length) return
    // 入口兜底：多选模式勾选不设限，点「转发」时统一校验（iOS 99 条，安卓不限）
    forwardStore.start(
      opts.conversationId.value,
      messages.map((m) => m.id),
    )
    uni.navigateTo({ url: '/pages/chat/forward' })
  }

  function copyText(message: ChatMessage) {
    uni.setClipboardData({
      data: message.content,
      success: () => uni.showToast({ title: '已复制', icon: 'none' }),
    })
  }

  function confirm(content: string, confirmText = '确定', cancelText = '取消') {
    return new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '提示',
        content,
        confirmText,
        cancelText,
        success: (res) => resolve(!!res.confirm),
      })
    })
  }

  async function favoriteMessage(message: ChatMessage) {
    const ok = await confirm('确定加入收藏吗？', '加入收藏')
    if (!ok) return
    // 名片 content 是 JSON，收藏转成可读文本；其余按原内容存
    const isCard = message.type === 'card'
    const type = isCard
      ? 'text'
      : message.type === 'file'
        ? 'file'
        : message.type === 'image'
          ? 'image'
          : message.type === 'video'
            ? 'video'
            : message.type === 'voice'
              ? 'voice'
              : 'text'
    let content = message.content
    if (isCard) {
      try {
        const card = JSON.parse(message.content) as { nickname?: string }
        content = `[名片] ${card.nickname || ''}`.trim()
      } catch {
        content = '[名片]'
      }
    }
    try {
      await createFavorite({
        messageId: message.id,
        type,
        content,
        senderId: businessUserIdFromIM(message.senderId) || message.senderId,
        conversationId: message.conversationId,
      })
      const convTitle =
        opts.conversationTitle?.value ||
        chatStore.conversations.find((c) => c.id === message.conversationId)?.title ||
        ''
      rememberConversationTitle(message.conversationId, convTitle)
      uni.showToast({ title: '已收藏', icon: 'none' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '收藏失败', icon: 'none' })
    }
  }

  async function deleteMessages(messages: ChatMessage[]) {
    if (!messages.length) return
    const ok = await confirm(messages.length > 1 ? `确定删除这 ${messages.length} 条消息吗？` : '确定删除该消息吗？')
    if (!ok) return
    try {
      await chatStore.removeLocalMany(
        opts.conversationId.value,
        messages.map((m) => m.id),
      )
      cancelSelect()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' })
    }
  }

  /** 撤他人消息（群主/管理员）后端要求必填原因：弹窗输入，取消返回 null，留空用默认文案 */
  function promptRevokeReason(): Promise<string | null> {
    return new Promise((resolve) => {
      uni.showModal({
        title: '撤回消息',
        editable: true,
        placeholderText: '请输入撤回原因',
        success: (res) => resolve(res.confirm ? res.content?.trim() || '管理员撤回' : null),
        fail: () => resolve(null),
      })
    })
  }

  async function revoke(message: ChatMessage) {
    let reason: string | undefined
    if (!opts.isMine(message)) {
      const input = await promptRevokeReason()
      if (input === null) return
      reason = input
    }
    try {
      await chatStore.recall(opts.conversationId.value, message.id, {
        peerId: opts.businessId.value || undefined,
        reason,
      })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '撤回失败', icon: 'none' })
    }
  }

  function startQuote(message: ChatMessage) {
    quote.value = message
  }

  function clearQuote() {
    quote.value = null
  }

  /**
   * 写入输入框的是「@昵称」，按钮文案 @TA 只是动作名。
   * displayName 优先用气泡已展示的昵称，避免 maps 未就绪时落到字面量 TA。
   */
  function atUser(message: ChatMessage, displayName?: string) {
    if (!guardSenderInGroup(message)) return
    const name =
      (displayName || opts.nicknameOf(message) || message.senderNickname || '').trim() || '用户'
    const token = `@${name} `
    if (!opts.input.value.includes(token)) {
      opts.input.value = `${token}${opts.input.value}`
    }
    // atUserID 必须用 OpenIM userID（message.senderId），不要转业务 ID
    if (message.senderId && !atList.value.some((a) => a.atUserID === message.senderId)) {
      atList.value.push({ atUserID: message.senderId, groupNickname: name })
    }
  }

  /** 仅群主/管理员：@所有人（OpenIM AtAllTag）；普通成员由 webhook 拒绝 */
  function atAll() {
    const role = opts.myRole.value
    if (role !== 'owner' && role !== 'admin') {
      uni.showToast({ title: '仅群主或管理员可以@所有人', icon: 'none' })
      return
    }
    const token = '@所有人 '
    if (!opts.input.value.includes(token)) {
      opts.input.value = `${token}${opts.input.value}`
    }
    if (!atList.value.some((a) => a.atUserID === 'AtAllTag')) {
      atList.value.push({ atUserID: 'AtAllTag', groupNickname: '所有人' })
    }
  }

  function reportUser(message: ChatMessage) {
    if (!guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId) {
      uni.showToast({ title: '无法检举该用户', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: `/pages/contacts/report-user?id=${encodeURIComponent(userId)}`,
    })
  }

  function muteUser(message: ChatMessage) {
    if (!guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !opts.businessId.value) return
    uni.showActionSheet({
      itemList: MUTE_OPTIONS.map((o) => o.label),
      success: async (res) => {
        const option = MUTE_OPTIONS[res.tapIndex]
        if (!option) return
        try {
          await muteGroupMember(opts.businessId.value, userId, option.seconds)
          uni.showToast({ title: `已禁言${option.label}`, icon: 'none' })
          opts.onMuteChanged?.()
        } catch (e) {
          uni.showToast({ title: (e as Error).message || '禁言失败', icon: 'none' })
        }
      },
    })
  }

  async function unmuteUser(message: ChatMessage) {
    if (!guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !opts.businessId.value) return
    const ok = await confirm('确定解除该成员的禁言吗？')
    if (!ok) return
    try {
      await unmuteGroupMember(opts.businessId.value, userId)
      uni.showToast({ title: '已解除禁言', icon: 'none' })
      opts.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '解除禁言失败', icon: 'none' })
    }
  }

  async function kickUser(message: ChatMessage, deleteMsgs: boolean) {
    if (!guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !opts.businessId.value) return
    const ok = await confirm(
      deleteMsgs ? '确定移除该成员并删除消息吗？' : '确定要移除该成员吗？',
      deleteMsgs ? '移除并删除' : '移除该成员',
    )
    if (!ok) return
    try {
      await removeGroupMember(opts.businessId.value, userId)
      if (deleteMsgs) {
        const theirs = opts.visibleMessages.value.filter((m) => m.senderId === message.senderId)
        await chatStore.removeLocalMany(
          opts.conversationId.value,
          theirs.map((m) => m.id),
        )
      }
      uni.showToast({ title: '已移除', icon: 'none' })
      opts.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '移除失败', icon: 'none' })
    }
  }

  async function onMenuSelect(key: string) {
    const message = menuMessage.value
    closeMenu()
    if (!message) return
    if (key === 'forward') {
      enterSelect(message, 'forward')
      return
    }
    if (key === 'quote') {
      startQuote(message)
      return
    }
    if (key === 'copy') {
      copyText(message)
      return
    }
    if (key === 'save' && message.type === 'video') {
      uni.showLoading({ title: '正在保存' })
      try {
        await saveVideoToDevice(message.content)
        uni.hideLoading()
        uni.showToast({ title: '已保存到相册', icon: 'success' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: (e as Error).message || '保存视频失败', icon: 'none' })
      }
      return
    }
    if (key === 'favorite') {
      await favoriteMessage(message)
      return
    }
    if (key === 'delete') {
      await deleteMessages([message])
      return
    }
    if (key === 'multi') {
      enterSelect(message, 'multi')
      return
    }
    if (key === 'revoke') {
      await revoke(message)
      return
    }
    if (key === 'report') {
      reportUser(message)
      return
    }
    if (key === 'at') {
      atUser(message, opts.nicknameOf(message) || message.senderNickname || undefined)
      return
    }
    if (key === 'mute') {
      muteUser(message)
      return
    }
    if (key === 'unmute') {
      await unmuteUser(message)
      return
    }
    if (key === 'kick') {
      await kickUser(message, false)
      return
    }
    if (key === 'kickAndDelete') {
      await kickUser(message, true)
    }
  }

  function onSelectForward() {
    goForward(selectedMessages())
  }

  function onSelectDelete() {
    void deleteMessages(selectedMessages())
  }

  async function forwardMessages(messages: ChatMessage[]) {
    goForward(messages)
  }

  async function saveVideoMessage(message: ChatMessage) {
    uni.showLoading({ title: '正在保存' })
    try {
      await saveVideoToDevice(message.content)
      uni.hideLoading()
      uni.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: (e as Error).message || '保存视频失败', icon: 'none' })
    }
  }

  return {
    menuVisible,
    menuItems,
    selecting,
    selectMode,
    selectedIds,
    selectedCount,
    quote,
    atList,
    atUser,
    atAll,
    openMenu,
    closeMenu,
    onMenuSelect,
    toggleSelect,
    cancelSelect,
    onSelectForward,
    onSelectDelete,
    forwardMessages,
    saveVideoMessage,
    clearQuote,
    isSenderInGroup,
    notifySenderLeftGroup,
  }
}
