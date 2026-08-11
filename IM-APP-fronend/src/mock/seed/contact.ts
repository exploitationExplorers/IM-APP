import type { Contact, FriendRequest, GroupPreview } from '@/types'

export interface MockFriendRequest extends FriendRequest {
  toUserId: string
}

export const SEED_CONTACTS: Contact[] = [
  {
    id: 'u_1',
    publicId: 'chat10002',
    nickname: '李四',
    avatar: '/static/avatar-1.png',
  },
  {
    id: 'u_2',
    publicId: 'chat10003',
    nickname: '王五',
    avatar: '/static/avatar-2.png',
  },
]

export const SEED_GROUPS: GroupPreview[] = [
  {
    id: 'g_1',
    name: '产品讨论群',
    avatar: '/static/group-1.png',
  },
  {
    id: 'g_2',
    name: '设计交流群',
    avatar: '/static/group-2.png',
  },
]

export const SEED_FRIEND_REQUESTS: MockFriendRequest[] = [
  {
    id: 'fr_1',
    toUserId: 'u_me',
    fromUser: {
      id: 'u_3',
      publicId: 'chat10004',
      nickname: '赵六',
      avatar: '/static/avatar-3.png',
    },
    message: '你好，我是赵六，加个好友吧',
    status: 'pending',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
]
