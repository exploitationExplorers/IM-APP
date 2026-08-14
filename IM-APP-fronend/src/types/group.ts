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
  joinMode?: 'open' | 'approval'
  myNickname?: string
  remark?: string
}

export interface GroupQRCodeResolveResult {
  group: GroupInfo
  joined: boolean
  memberId?: string
  joinMode: 'open' | 'approval'
  nextAction: 'enter' | 'join' | 'apply'
}

export interface JoinGroupByQRCodeResult {
  action: 'enter' | 'joined' | 'pending_approval'
  group: GroupInfo
  requestId?: string
}

export interface GroupMember {
  id: string
  nickname: string
  avatar: string
  role: 'owner' | 'admin' | 'member'
  memberRemark?: string
}
