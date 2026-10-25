import type { Ref } from 'vue'
import type { ChatMessage, GroupMessagePurge } from '@/types'
import { purgeGroupMemberMessages, removeGroupMember } from '@/api/group'
import { businessUserIdFromIM } from '@/utils/openim'
import type { ConfirmFn } from './memberDeps'

export function createKickActions(deps: {
  businessId: Ref<string>
  onMuteChanged?: () => void
  guardSenderInGroup: (message: ChatMessage) => boolean
  confirm: ConfirmFn
  onMessagesPurged?: (groupId: string, purge?: GroupMessagePurge) => Promise<void>
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
    const groupId = deps.businessId.value
    const ok = await deps.confirm(
      deleteMsgs ? '确定移除该成员并删除消息吗？' : '确定要移除该成员吗？',
      deleteMsgs ? '移除并删除' : '移除该成员',
    )
    if (!ok) return
    try {
      await removeGroupMember(groupId, userId, deleteMsgs)
      if (deleteMsgs) {
        await deps.onMessagesPurged?.(groupId)
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
    const groupId = deps.businessId.value
    const ok = await deps.confirm(
      '确定为所有人删除该成员在本群的全部消息吗？此操作不可恢复。',
      '全部删除',
    )
    if (!ok) return
    try {
      // 群清理以服务端按发送者记录的水位为准，不再逐条调用 SDK 删除。
      const purge = await purgeGroupMemberMessages(groupId, userId)
      await deps.onMessagesPurged?.(groupId, purge)
      uni.showToast({ title: '已删除', icon: 'none' })
      deps.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '删除失败', icon: 'none' })
    }
  }

  return { reportUser, kickUser, purgeUserMessages }
}
