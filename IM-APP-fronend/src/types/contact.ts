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
}

export interface FriendRequest {
  id: string
  fromUser: Contact
  message: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export type FriendRequestAction = 'accept' | 'reject'
