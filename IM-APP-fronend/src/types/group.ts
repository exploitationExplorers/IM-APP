/** 群组相关类型（Phase 2 预留） */

export interface GroupInfo {
  id: string
  name: string
  avatar: string
  ownerId: string
  memberCount: number
  announcement?: string
  allowMemberAddFriend?: boolean
  /** 关联的群聊会话 ID */
  conversationId?: string
}

export interface GroupMember {
  id: string
  nickname: string
  avatar: string
  role: 'owner' | 'admin' | 'member'
}
