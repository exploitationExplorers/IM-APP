/** 通讯录相关类型 */

export interface Contact {
  id: string
  publicId?: string
  nickname: string
  avatar: string
  remark?: string
  tags?: string[]
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
