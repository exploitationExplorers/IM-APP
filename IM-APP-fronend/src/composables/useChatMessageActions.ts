import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { ChatMessage } from '@/types'
import type { MessageMenuItem } from '@/components/ImMessageActionMenu.vue'
import { createFavorite } from '@/api/favorites'
import { muteGroupMember, removeGroupMember } from '@/api/group'
import { useChatStore } from '@/stores/chat'
import { useForwardStore } from '@/stores/forward'
import { rememberConversationTitle } from '@/utils/favoriteMeta'
import { businessUserIdFromIM } from '@/utils/openim'

const REVOKE_MS = 2 * 60 * 1000
const MUTE_OPTIONS = [
  { label: '10分钟', seconds: 10 * 60 },
  { label: '1小时', seconds: 60 * 60 },
  { label: '12小时', seconds: 12 * 60 * 60 },
  { label: '1天', seconds: 24 * 60 * 60 },
  { label: '7天', seconds: 7 * 24 * 60 * 60 },
  { label: '30天', seconds: 30 * 24 * 60 * 60 },
]

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
}) {
  const chatStore = useChatStore()
  const forwardStore = useForwardStore()

  const menuMessage = ref<ChatMessage | null>(null)
  const menuTop = ref(120)
  const menuLeft = ref(24)
  const selecting = ref(false)
  const selectMode = ref<'forward' | 'multi'>('multi')
  const selectedIds = ref<Set<string>>(new Set())
  const quote = ref<ChatMessage | null>(null)
  /** 长按 @TA 记下被 @ 的人（OpenIM userID + 群昵称），发送时走 AtText */
  const atList = ref<Array<{ atUserID: string; groupNickname: string }>>([])

  const selectedCount = computed(() => selectedIds.value.size)
  const menuVisible = computed(() => !!menuMessage.value && !selecting.value)

  function canRevoke(message: ChatMessage) {
    if (!opts.isMine(message) || message.status === 'sending') return false
    return Date.now() - new Date(message.createdAt).getTime() < REVOKE_MS
  }

  const menuItems = computed<MessageMenuItem[]>(() => {
    const message = menuMessage.value
    if (!message) return []
    const mine = opts.isMine(message)
    const items: MessageMenuItem[] = []
    if (canRevoke(message)) items.push({ key: 'revoke', label: '撤回' })
    items.push({ key: 'forward', label: '转发' }, { key: 'quote', label: '引用' })
    if (message.type === 'text') items.push({ key: 'copy', label: '复制' })
    items.push({ key: 'favorite', label: '收藏' })
    if (!mine) {
      items.push({ key: 'report', label: '检举' })
      if (opts.chatType.value === 'group') items.push({ key: 'at', label: '@TA' })
      if (opts.chatType.value === 'group' && opts.myRole.value !== 'member') {
        items.push({ key: 'mute', label: '禁言' })
      }
    }
    items.push({ key: 'delete', label: '删除' }, { key: 'multi', label: '多选' })
    if (!mine && opts.chatType.value === 'group' && opts.myRole.value !== 'member') {
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
    const touch = event?.touches?.[0]
    const sys = uni.getSystemInfoSync()
    const menuWidth = 180
    const x = touch?.clientX ?? sys.windowWidth / 2
    const y = touch?.clientY ?? sys.windowHeight / 2
    menuLeft.value = Math.min(Math.max(12, x - menuWidth / 2), sys.windowWidth - menuWidth - 12)
    menuTop.value = Math.min(Math.max(80, y - 20), sys.windowHeight - 280)
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
    if (next.has(message.id)) next.delete(message.id)
    else next.add(message.id)
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

  function confirm(content: string, confirmText = '确定') {
    return new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '提示',
        content,
        confirmText,
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm),
      })
    })
  }

  async function favoriteMessage(message: ChatMessage) {
    const ok = await confirm('确定加入收藏吗？', '加入收藏')
    if (!ok) return
    const type = message.type === 'file' ? 'file' : message.type === 'image' ? 'image' : message.type === 'voice' ? 'voice' : 'text'
    try {
      await createFavorite({
        messageId: message.id,
        type,
        content: message.content,
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

  async function revoke(message: ChatMessage) {
    try {
      await chatStore.recall(opts.conversationId.value, message.id)
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

  function atUser(message: ChatMessage) {
    const name = opts.nicknameOf(message) || message.senderNickname || 'TA'
    const token = `@${name} `
    if (!opts.input.value.includes(token)) {
      opts.input.value = `${token}${opts.input.value}`
      // 记下被 @ 的人。atUserID 必须用 OpenIM userID（message.senderId 就是），不要转业务 ID
      if (message.senderId && !atList.value.some((a) => a.atUserID === message.senderId)) {
        atList.value.push({ atUserID: message.senderId, groupNickname: name })
      }
    }
  }

  function reportUser(message: ChatMessage) {
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
        } catch (e) {
          uni.showToast({ title: (e as Error).message || '禁言失败', icon: 'none' })
        }
      },
    })
  }

  async function kickUser(message: ChatMessage, deleteMsgs: boolean) {
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !opts.businessId.value) return
    const ok = await confirm(deleteMsgs ? '确定移除该成员并删除消息吗？' : '确定移除该成员吗？')
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
      atUser(message)
      return
    }
    if (key === 'mute') {
      muteUser(message)
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

  return {
    menuVisible,
    menuItems,
    menuTop,
    menuLeft,
    selecting,
    selectMode,
    selectedIds,
    selectedCount,
    quote,
    atList,
    openMenu,
    closeMenu,
    onMenuSelect,
    toggleSelect,
    cancelSelect,
    onSelectForward,
    onSelectDelete,
    clearQuote,
  }
}
