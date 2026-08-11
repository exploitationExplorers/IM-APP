import type { GroupInfo } from '@/types'

export const SEED_GROUP_DETAILS: Record<string, GroupInfo> = {
  g_1: {
    id: 'g_1',
    name: '产品讨论群',
    avatar: '/static/group-1.png',
    ownerId: 'u_me',
    memberCount: 3,
    announcement: '欢迎加入产品讨论群',
    allowMemberAddFriend: true,
    conversationId: 'c_g1',
  },
  g_2: {
    id: 'g_2',
    name: '设计交流群',
    avatar: '/static/group-2.png',
    ownerId: 'u_2',
    memberCount: 2,
    announcement: '',
    allowMemberAddFriend: false,
    conversationId: '',
  },
}

export const SEED_GROUP_MEMBERS: Record<string, { id: string; nickname: string; avatar: string; role: 'owner' | 'admin' | 'member' }[]> = {
  g_1: [
    { id: 'u_me', nickname: '张三', avatar: '/static/avatar-me.png', role: 'owner' },
    { id: 'u_1', nickname: '李四', avatar: '/static/avatar-1.png', role: 'member' },
    { id: 'u_2', nickname: '王五', avatar: '/static/avatar-2.png', role: 'member' },
  ],
}
