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
  ownerName?: string
  memberCount: number
  maxMembers?: number
  announcement?: string
  /** 群公告配图 URL 列表（最多 9 张） */
  announcementImages?: string[]
  allowMemberAddFriend?: boolean
  /** 关联的群聊会话 ID */
  conversationId?: string
  joinMode?: GroupJoinMode
  myNickname?: string
  remark?: string
  myRole?: GroupRole
  allMuted?: boolean
  /** 当前用户能否在该群发言，进群时据此禁用输入区 */
  canChat?: boolean
  /** canChat=false 时的原因（单人禁言 / 全员禁言等） */
  denyReason?: string
  /** 当前用户在本群是否被禁言 */
  isMuted?: boolean
  mutedUntil?: string | null
  permissions?: GroupPermissions
}

export interface GroupSettingsInput {
  name?: string
  avatarFileId?: string
  announcement?: string
  /** 新上传的图片 fileId（purpose=image） */
  announcementImageFileIds?: string[]
  /** 继续保留的已有公告图片 URL */
  keepAnnouncementImages?: string[]
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
  displayName?: string
  avatar: string
  role: GroupRole
  memberRemark?: string
  /** 是否被禁言（后端成员列表已带禁言状态） */
  isMuted?: boolean
  mutedUntil?: string | null
}

/** POST /group-members/mute、/group-members/unmute 的返回 */
export interface GroupMemberMuteResult {
  groupId: string
  memberUserId: string
  isMuted: boolean
  mutedUntil: string | null
  changedAt: string
}

/** 群公告历史条目 */
export interface GroupAnnouncementHistoryItem {
  id: string
  content: string
  images?: string[]
  publisherId?: string
  publisherName?: string
  createdAt: string
}
