import type { Ref } from 'vue'
import type { ChatMessage } from '@/types'
import { purgeGroupMemberMessages, removeGroupMember } from '@/api/group'
import { businessUserIdFromIM } from '@/utils/openim'
import type { ConfirmFn } from './memberDeps'

export function createKickActions(deps: {
  businessId: Ref<string>
  conversationId: Ref<string>
  visibleMessages: { value: ChatMessage[] }
  onMuteChanged?: () => void
  guardSenderInGroup: (message: ChatMessage) => boolean
  confirm: ConfirmFn
  removeLocalMany: (conversationId: string, ids: string[]) => Promise<void>
}) {
  function reportUser(message: ChatMessage) {
    if (!deps.guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId) {
      uni.showToast({ title: '无法检举该用户', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: `/pages/contacts/report-user?id=${encodeURIComponent(userId)}`,
    })
  }

  async function kickUser(message: ChatMessage, deleteMsgs: boolean) {
    if (!deps.guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !deps.businessId.value) return
    const ok = await deps.confirm(
      deleteMsgs ? '确定移除该成员并删除消息吗？' : '确定要移除该成员吗？',
      deleteMsgs ? '移除并删除' : '移除该成员',
    )
    if (!ok) return
    try {
      await removeGroupMember(deps.businessId.value, userId, deleteMsgs)
      if (deleteMsgs) {
        const theirs = deps.visibleMessages.value.filter((m) => m.senderId === message.senderId)
        await deps.removeLocalMany(
          deps.conversationId.value,
          theirs.map((m) => m.id),
        )
      }
      uni.showToast({ title: '已移除', icon: 'none' })
      deps.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '移除失败', icon: 'none' })
    }
  }

  async function purgeUserMessages(message: ChatMessage) {
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !deps.businessId.value) return
    const ok = await deps.confirm(
      '确定为所有人删除该成员在本群的全部消息吗？此操作不可恢复。',
      '全部删除',
    )
    if (!ok) return
    try {
      await purgeGroupMemberMessages(deps.businessId.value, userId)
      const theirs = deps.visibleMessages.value.filter((m) => m.senderId === message.senderId)
      await deps.removeLocalMany(
        deps.conversationId.value,
        theirs.map((m) => m.id),
      )
      uni.showToast({ title: '已删除', icon: 'none' })
      deps.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' })
    }
  }

  return { reportUser, kickUser, purgeUserMessages }
}
