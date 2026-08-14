/** 聊天相关类型 */

export type MessageType = 'text' | 'image' | 'voice' | 'file' | 'system'

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  /** OpenIM 消息上的发送者头像，群聊按人展示 */
  senderAvatar?: string
  /** OpenIM 消息上的发送者昵称，群聊对方气泡上方展示 */
  senderNickname?: string
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
  /**
   * 会话级消息接收选项，来自 OpenIM ConversationItem.recvMsgOpt。
   * 0=正常提醒 1=不接收 2=接收但不提醒（免打扰）。前端用于决定是否播放提示音。
   */
  recvMsgOpt?: number
  /** 私聊对方的 OpenIM 用户 ID */
  peerUserId?: string
  /** 群聊的 OpenIM 群 ID */
  groupId?: string
}
