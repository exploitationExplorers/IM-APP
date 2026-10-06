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
  /**
   * 「清理该成员全部消息」成功后的回调。房间页用它把清理水位乐观写进 purgedMap ——
   * 不写的话操作者自己还看得到消息，会以为没生效。
   */
  onMessagesPurged?: (businessUserId: string, purgedAt: number) => void
  /** 私聊对方展示名，用于「为我和 xxx 置顶」文案 */
  peerDisplayName?: Ref<string>
}) {
  const chatStore = useChatStore()
  const forwardStore = useForwardStore()

  const SENDER_LEFT_GROUP_TOAST = '该群友不在群聊'
  /** 「清理该成员全部消息」时顺带即时撤回的条数上限，其余交给服务端清理水位 */
  const PURGE_RECALL_LIMIT = 50

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
   *
   * 注意：**撤回他人消息不受 2 分钟窗口限制** —— 时间窗只对「自己的消息」生效
   * （见后端 validateRecallPermission），所以清理炸群人员的历史广告不需要赶时间。
   * 发送者已退群时 memberMetaOf 查不到（成员列表只含现役成员），这里按「先显示、
   * 后端兜底」处理，正好覆盖「炸群人员发完就跑」的场景。
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

    // 参考站顺序：转发|引用 → 复制|收藏 → 置顶|检举 → @TA|禁言 → 删除|多选
    // 撤回不再只给自己的消息：群主/管理员撤他人消息也走这里。以前只判 mine，
    // 结果管理员对别人的广告只剩「删除」，而删除是纯本地操作（DeleteMessageFromLocalStorage），
    // 别的群员照旧看得到 —— 这就是「删除了其他人还能看到」的根因。
    if (canRevoke(message)) {
      items.push({ key: 'revoke', label: '撤回' })
    }
    items.push({ key: 'forward', label: '转发' }, { key: 'quote', label: '引用' })
    if (message.type === 'text') items.push({ key: 'copy', label: '复制' })
    if (message.type === 'video') items.push({ key: 'save', label: '保存视频' })
    items.push({ key: 'favorite', label: '收藏' })
    const pinnedId = chatStore.conversations.find((c) => c.id === opts.conversationId.value)?.pinnedMessage
      ?.clientMsgID
    items.push({
      key: 'pin',
      label: pinnedId && pinnedId === message.id ? '取消置顶' : '置顶',
    })
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
      // 目标已经退群时上面两项都点不动（guardSenderInGroup 会拦），一键清理才是可用出口：
      // 只写清理水位，不改成员关系，覆盖 TA 在本群的全部历史消息。
      items.push({ key: 'purgeAll', label: '清理该成员全部消息', wide: true })
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
    // 系统提示（进群/退群/改名等）不可转发也不能撤回，房间页的 @click 对所有行都会触发，
    // 必须在这里挡掉 —— 勾选框不渲染并不等于选不中。
    if (message.type === 'system') return
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
    // 系统提示也过滤掉：批量转发/删除/撤回都不该把它带上
    return opts.visibleMessages.value.filter((m) => ids.has(m.id) && m.type !== 'system')
  }

  /** 选中项里当前身份能撤回的条数（群主/管理员撤他人 + 自己的消息）；多选栏据此决定是否显示「撤回」 */
  const revocableCount = computed(() => selectedMessages().filter((m) => canRevoke(m)).length)

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

  function choosePinScope(): Promise<'self' | 'shared' | null> {
    const isGroup = opts.chatType.value === 'group'
    const canShare = isGroup
      ? opts.myRole.value === 'owner' || opts.myRole.value === 'admin'
      : true
    if (!canShare) return Promise.resolve('self')

    const peerName = (
      opts.peerDisplayName?.value ||
      opts.conversationTitle?.value ||
      '对方'
    ).trim() || '对方'
    const sharedLabel = isGroup ? '为全员置顶' : `为我和 ${peerName} 置顶`
    return new Promise((resolve) => {
      uni.showActionSheet({
        itemList: [sharedLabel, '仅为我置顶'],
        success: (res) => {
          if (res.tapIndex === 0) resolve('shared')
          else if (res.tapIndex === 1) resolve('self')
          else resolve(null)
        },
        fail: () => resolve(null),
      })
    })
  }

  async function pinOrUnpinMessage(message: ChatMessage) {
    const convId = opts.conversationId.value
    const current = chatStore.conversations.find((c) => c.id === convId)?.pinnedMessage
    if (current?.clientMsgID === message.id) {
      try {
        await chatStore.unpinChatMessage(convId, current.scope === 'shared')
        uni.showToast({ title: '已取消置顶', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: (e as Error).message || '取消置顶失败', icon: 'none' })
      }
      return
    }
    const scope = await choosePinScope()
    if (!scope) return
    try {
      await chatStore.pinChatMessage(
        convId,
        message,
        scope,
        opts.nicknameOf(message) || message.senderNickname || '',
      )
      uni.showToast({ title: '已置顶', icon: 'none' })
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '置顶失败', icon: 'none' })
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

  /**
   * 一键清理某成员在本群的全部消息（群主/管理员）。走服务端清理水位，覆盖 TA 在本群的
   * **全部**历史（含未加载部分），与「移除该成员并删除消息」共用同一套水位；再对已加载的
   * 最近若干条补一次批量撤回 —— 写水位本身不产生群通知，其他端要等下次拉水位才变化，
   * 而撤回事件是即时推送的，不补这一步其他群员会以为「清理没生效」。
   * 批量撤回失败不阻断，水位那份才是覆盖完整性的保证。
   * 刻意不判 guardSenderInGroup：目标已退群正是这个入口要解决的情况。
   */
  async function purgeAllMessages(message: ChatMessage) {
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId) {
      uni.showToast({ title: '无法清理该用户的消息', icon: 'none' })
      return
    }
    const ok = await confirm(
      '将隐藏 TA 在本群的全部历史消息（含未加载部分），并同步给所有群成员。此操作不可恢复。',
      '确定清理',
    )
    if (!ok) return
    uni.showLoading({ title: '正在清理' })
    try {
      const purgedAt = await chatStore.purgeMemberMessages(opts.conversationId.value, userId)
      // 本地立刻生效：不写水位的话操作者自己还看得到消息，会以为没生效
      opts.onMessagesPurged?.(userId, purgedAt)
      // 只补最近 PURGE_RECALL_LIMIT 条：撤回会在全群每个客户端插入一条「已撤回」提示，
      // 成百条一起撤回既慢又会把聊天记录刷满墓碑。更早的交给水位，下次拉水位时消失。
      const theirs = opts.visibleMessages.value
        .filter((m) => m.senderId === message.senderId && m.type !== 'system')
        .slice(-PURGE_RECALL_LIMIT)
      if (theirs.length) {
        try {
          await chatStore.recallMany(
            opts.conversationId.value,
            theirs.map((m) => ({ id: m.id, seq: m.seq })),
            { peerId: opts.businessId.value || undefined, reason: '管理员清理' },
          )
        } catch {
          // 忽略：水位已生效，批量撤回只是让其他端立刻同步
        }
      }
      uni.hideLoading()
      uni.showToast({ title: '已清理该成员的消息', icon: 'none' })
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: (e as Error).message || '清理失败', icon: 'none' })
    }
  }

  /**
   * 多选批量撤回（群主/管理员）。原因整批只弹一次（后端撤他人消息要求必填）；
   * 结果如实汇总 —— 失败条目的原因必须说出来，不能报成「全部成功」。
   */
  async function onSelectRevoke() {
    const selected = selectedMessages().filter((m) => canRevoke(m))
    if (!selected.length) return
    let reason: string | undefined
    if (selected.some((m) => !opts.isMine(m))) {
      const input = await promptRevokeReason()
      if (input === null) return
      reason = input
    }
    uni.showLoading({ title: '正在撤回' })
    let result: { succeeded: string[]; failed: Array<{ id: string; message: string }> }
    try {
      result = await chatStore.recallMany(
        opts.conversationId.value,
        selected.map((m) => ({ id: m.id, seq: m.seq })),
        { peerId: opts.businessId.value || undefined, reason },
      )
    } catch (e) {
      uni.hideLoading()
      uni.showToast({ title: (e as Error).message || '撤回失败', icon: 'none' })
      return
    }
    uni.hideLoading()
    // 成功的从选中集里摘掉，失败项留着方便重试
    const done = new Set(result.succeeded)
    selectedIds.value = new Set([...selectedIds.value].filter((id) => !done.has(id)))
    if (!result.failed.length) {
      cancelSelect()
      uni.showToast({ title: `已撤回 ${result.succeeded.length} 条消息`, icon: 'none' })
      return
    }
    const reasons = [...new Set(result.failed.map((f) => f.message))].slice(0, 2).join('；')
    uni.showToast({
      title: `已撤回 ${result.succeeded.length} 条，${result.failed.length} 条失败：${reasons}`,
      icon: 'none',
      duration: 3000,
    })
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
      // deleteMsgs 必须传给后端：服务端会记一条清理水位，群内所有客户端都隐藏该成员的历史消息。
      // 只在本地删（以前的做法）只有操作者自己看不到，别人照旧能看见。
      await removeGroupMember(opts.businessId.value, userId, deleteMsgs)
      if (deleteMsgs) {
        // 本地立即删掉做即时反馈；服务端那份负责其他成员，收到成员变更通知后生效
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
    if (key === 'pin') {
      await pinOrUnpinMessage(message)
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
      return
    }
    if (key === 'purgeAll') {
      await purgeAllMessages(message)
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
    revocableCount,
    onSelectRevoke,
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
