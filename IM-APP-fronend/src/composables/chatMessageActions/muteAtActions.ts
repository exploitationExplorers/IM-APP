import type { Ref } from 'vue'
import type { ChatMessage } from '@/types'
import { muteGroupMember, unmuteGroupMember } from '@/api/group'
import { MUTE_OPTIONS } from '@/constants/mute'
import { businessUserIdFromIM } from '@/utils/openim'
import type { ConfirmFn } from './memberDeps'

export function createMuteAtActions(deps: {
  businessId: Ref<string>
  myRole: Ref<'owner' | 'admin' | 'member'>
  input: Ref<string>
  atList: Ref<Array<{ atUserID: string; groupNickname: string }>>
  publicAtNameOf?: (message: ChatMessage) => string
  onMuteChanged?: () => void
  guardSenderInGroup: (message: ChatMessage) => boolean
  confirm: ConfirmFn
}) {
  function muteUser(message: ChatMessage) {
    if (!deps.guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !deps.businessId.value) return
    uni.showActionSheet({
      itemList: MUTE_OPTIONS.map((o) => o.label),
      success: async (res) => {
        const option = MUTE_OPTIONS[res.tapIndex]
        if (!option) return
        try {
          await muteGroupMember(deps.businessId.value, userId, option.seconds)
          uni.showToast({ title: `已禁言${option.label}`, icon: 'none' })
          deps.onMuteChanged?.()
        } catch (e) {
          uni.showToast({ title: (e as Error).message || '禁言失败', icon: 'none' })
        }
      },
    })
  }

  async function unmuteUser(message: ChatMessage) {
    if (!deps.guardSenderInGroup(message)) return
    const userId = businessUserIdFromIM(message.senderId)
    if (!userId || !deps.businessId.value) return
    if (!(await deps.confirm('确定解除该成员的禁言吗？'))) return
    try {
      await unmuteGroupMember(deps.businessId.value, userId)
      uni.showToast({ title: '已解除禁言', icon: 'none' })
      deps.onMuteChanged?.()
    } catch (e) {
      uni.showToast({ title: (e as Error).message || '解除禁言失败', icon: 'none' })
    }
  }

  function atUser(message: ChatMessage, displayName?: string) {
    if (!deps.guardSenderInGroup(message)) return
    const name =
      (displayName || deps.publicAtNameOf?.(message) || message.senderNickname || '').trim() ||
      '用户'
    const token = `@${name} `
    if (!deps.input.value.includes(token)) {
      deps.input.value = `${token}${deps.input.value}`
    }
    if (message.senderId && !deps.atList.value.some((a) => a.atUserID === message.senderId)) {
      deps.atList.value.push({ atUserID: message.senderId, groupNickname: name })
    }
  }

  function atAll() {
    const role = deps.myRole.value
    if (role !== 'owner' && role !== 'admin') {
      uni.showToast({ title: '仅群主或管理员可以@所有人', icon: 'none' })
      return
    }
    const token = '@所有人 '
    if (!deps.input.value.includes(token)) {
      deps.input.value = `${token}${deps.input.value}`
    }
    if (!deps.atList.value.some((a) => a.atUserID === 'AtAllTag')) {
      deps.atList.value.push({ atUserID: 'AtAllTag', groupNickname: '所有人' })
    }
  }

  return { muteUser, unmuteUser, atUser, atAll }
}
