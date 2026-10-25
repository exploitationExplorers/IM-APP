import type { ChatMessage } from '@/types'
import { businessUserIdFromIM } from '@/utils/openim'
import type { ChatMessageActionsOpts, MemberMeta } from './types'

const SENDER_LEFT_GROUP_TOAST = '该群友不在群聊'

export function createSenderGuards(opts: ChatMessageActionsOpts) {
  function isMemberListLoaded(): boolean {
    const map = opts.memberMeta?.value
    return !!map && Object.keys(map).length > 0
  }

  function memberMetaOf(message: ChatMessage): MemberMeta | undefined {
    const map = opts.memberMeta?.value
    if (!map) return undefined
    const userId = businessUserIdFromIM(message.senderId)
    return userId ? map[userId] : undefined
  }

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

  function guardSenderInGroup(message: ChatMessage): boolean {
    if (isSenderInGroup(message)) return true
    notifySenderLeftGroup()
    return false
  }

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
    return myRole === 'owner' || myRole === 'admin'
  }

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

  return {
    memberMetaOf,
    isSenderInGroup,
    notifySenderLeftGroup,
    guardSenderInGroup,
    canActOnTarget,
    canRevoke,
  }
}
