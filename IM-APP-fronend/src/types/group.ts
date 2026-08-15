/** 群组相关类型 */

export type GroupRole = 'owner' | 'admin' | 'member'
export type GroupJoinMode = 'open' | 'approval'

export interface GroupPermissions {
  canEditProfile: boolean
  canEditAnnouncement: boolean
  canViewQRCode: boolean
  canManageMembers: boolean
  canEditMyNickname: boolean
  canReport: boolean
}

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
  joinMode?: GroupJoinMode
  myNickname?: string
  remark?: string
  myRole?: GroupRole
  allMuted?: boolean
  permissions?: GroupPermissions
}

export interface GroupSettingsInput {
  name?: string
  avatarFileId?: string
  announcement?: string
  allowMemberAddFriend?: boolean
  joinMode?: GroupJoinMode
  allMuted?: boolean
}

export interface GroupJoinRequestItem {
  id: string
  status: string
  remark: string
  createdAt: string
  handledAt?: string
  applicant: {
    id: string
    publicId: string
    nickname: string
    avatar: string
  }
}

export interface GroupQRCodeResolveResult {
  group: GroupInfo
  joined: boolean
  memberId?: string
  joinMode: GroupJoinMode
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
  groupNickname?: string
  avatar: string
  role: GroupRole
  memberRemark?: string
}
