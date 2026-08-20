/** 聊天相关类型 */

export type MessageType = 'text' | 'image' | 'voice' | 'file' | 'card' | 'system'

/** 名片消息内容（card 消息的 content，JSON 字符串） */
export interface CardPayload {
  /** 好友的业务用户 UUID，跳详情页用 */
  userId: string
  nickname: string
  avatar: string
}

export interface MessageQuote {
  senderNickname: string
  content: string
}

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
  /** 用于折叠 OpenIM 重试产生的连续重复系统通知；普通消息不设置。 */
  systemEventKey?: string
  /**
   * OpenIM 系统通知细分类型（如 'dissolved' / 'group-muted'），便于 chat-room 监听特定事件触发副作用。
   * 群普通文本/图片/语音消息不设置此字段。
   */
  notificationKind?: 'dissolved' | 'group-muted' | 'group-cancel-muted' | string
  /** 引用回复时展示的原消息摘要 */
  quote?: MessageQuote
  /**
   * 私聊已读回执：对方是否已读「我发的」这条消息。
   * 来自 OpenIM MessageItem.isRead，实时更新靠 OnRecvC2CReadReceipt 事件翻转；
   * 群聊与对方发来的消息不展示该状态。
   */
  hasRead?: boolean
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
  /** 会话预览红色提醒，如 [有人@你]、[有新公告] */
  highlightTags?: string[]
  /** OpenIM ConversationItem.groupAtType：0 无 / 1 @我 / 2 @所有人 / 3 两者 / 4 有新公告 */
  groupAtType?: number
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
