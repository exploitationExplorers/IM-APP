/** 通讯录相关类型 */

export interface ContactTagItem {
  id: string
  name: string
  memberCount: number
}

export interface Contact {
  id: string
  publicId?: string
  nickname: string
  avatar: string
  remark?: string
  /** @deprecated 列表侧旧字段；详情用 tags */
  tagNames?: string[]
  tags?: ContactTagItem[]
  commonGroups?: GroupPreview[]
}

export interface GroupPreview {
  id: string
  name: string
  avatar: string
  role?: string
  conversationId?: string
}

export interface FriendRequest {
  id: string
  fromUser: Contact
  message: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export type FriendRequestAction = 'accept' | 'reject'

export interface PrivacySettings {
  /** 加我为好友需验证；默认 false（无需验证） */
  requireFriendApproval: boolean
  /** 邀请我入群需验证；默认 true */
  requireGroupApproval: boolean
}

export interface SendFriendResult {
  ok: boolean
  id?: string
  status: 'pending' | 'accepted'
}
