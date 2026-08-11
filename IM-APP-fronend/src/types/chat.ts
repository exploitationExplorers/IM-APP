/** 聊天相关类型 */

export type MessageType = 'text' | 'image' | 'voice' | 'file' | 'system'

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  type: MessageType
  content: string
  createdAt: string
  /** 本地发送中状态 */
  status?: 'sending' | 'sent' | 'failed'
}

export interface Conversation {
  id: string
  type: 'private' | 'group'
  title: string
  avatar: string
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  /** 如 [有新公告] */
  highlightTag?: string
  pinned?: boolean
  /** 私聊对方用户 ID */
  peerUserId?: string
}
