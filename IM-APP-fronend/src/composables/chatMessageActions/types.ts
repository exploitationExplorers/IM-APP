import type { ComputedRef, Ref } from 'vue'
import type { ChatMessage, GroupRole, GroupMessagePurge } from '@/types'

/** 气泡长按菜单项（勿从 .vue 具名导入：env.d.ts 的 *.vue 只暴露 default） */
export interface MessageMenuItem {
  key: string
  label: string
  wide?: boolean
  /** 参考站「多选」右侧占位格，保持 5 行双列网格 */
  spacer?: boolean
}

/** 群成员的发言管控元信息（房间页从群成员接口构建，业务用户 ID 索引） */
export interface MemberMeta {
  role: GroupRole
  isMuted: boolean
}

export type ChatMessageActionsOpts = {
  conversationId: Ref<string>
  chatType: Ref<'private' | 'group'>
  businessId: Ref<string>
  myId: Ref<string>
  myRole: Ref<'owner' | 'admin' | 'member'>
  input: Ref<string>
  nicknameOf: (message: ChatMessage) => string
  /** @ 写入消息体的公开名（不含好友备注）；缺省回退 senderNickname */
  publicAtNameOf?: (message: ChatMessage) => string
  isMine: (message: ChatMessage) => boolean
  visibleMessages: ComputedRef<ChatMessage[]>
  conversationTitle?: Ref<string>
  /** 群成员角色/禁言元信息，用于撤回他人消息与禁言/解禁的权限判断 */
  memberMeta?: Ref<Record<string, MemberMeta>>
  /** 禁言/解禁成功后的回调（房间页用来刷新成员禁言状态） */
  onMuteChanged?: () => void
  onMessagesPurged?: (groupId: string, purge?: GroupMessagePurge) => Promise<void>
  /** 私聊对方展示名，用于「为我和 xxx 置顶」文案 */
  peerDisplayName?: Ref<string>
  /** 发送失败气泡菜单「重新发送」 */
  onRetry?: (message: ChatMessage) => void
}
