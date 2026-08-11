import type { ChatMessage, Conversation } from '@/types'

const now = Date.now()

export const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: 'c_1',
    type: 'private',
    title: '李四',
    avatar: '/static/avatar-1.png',
    lastMessage: '明天下午三点开会，记得准时参加',
    lastMessageAt: new Date(now - 17 * 60 * 1000).toISOString(),
    unreadCount: 0,
    peerUserId: 'u_1',
  },
  {
    id: 'c_g1',
    type: 'group',
    title: '产品讨论群',
    avatar: '/static/group-1.png',
    lastMessage: '新版本需求文档已上传',
    lastMessageAt: new Date(now - 30 * 1000).toISOString(),
    unreadCount: 3,
    highlightTag: '[有新公告]',
  },
  {
    id: 'c_2',
    type: 'private',
    title: '王五',
    avatar: '/static/avatar-2.png',
    lastMessage: '好的，收到',
    lastMessageAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
    unreadCount: 0,
    peerUserId: 'u_2',
  },
]

export const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  c_1: [
    {
      id: 'm1',
      conversationId: 'c_1',
      senderId: 'u_1',
      type: 'text',
      content: '你好，项目进度怎么样了？',
      createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'm2',
      conversationId: 'c_1',
      senderId: 'u_me',
      type: 'text',
      content: '前端页面基本完成，正在对接接口',
      createdAt: new Date(now - 90 * 60 * 1000).toISOString(),
    },
    {
      id: 'm3',
      conversationId: 'c_1',
      senderId: 'u_1',
      type: 'text',
      content: '明天下午三点开会，记得准时参加',
      createdAt: new Date(now - 17 * 60 * 1000).toISOString(),
    },
  ],
  c_g1: [
    {
      id: 'mg1',
      conversationId: 'c_g1',
      senderId: 'u_2',
      type: 'text',
      content: '新版本需求文档已上传',
      createdAt: new Date(now - 30 * 1000).toISOString(),
    },
  ],
  c_2: [
    {
      id: 'm4',
      conversationId: 'c_2',
      senderId: 'u_2',
      type: 'text',
      content: '好的，收到',
      createdAt: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
}

/** 会话成员映射 */
export const SEED_CONV_MEMBERS: Record<string, string[]> = {
  c_1: ['u_me', 'u_1'],
  c_2: ['u_me', 'u_2'],
  c_g1: ['u_me', 'u_1', 'u_2'],
}
