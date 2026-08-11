/** 通用类型定义 — 统一 re-export */

export type { ApiResponse } from './api'

export type {
  UserInfo,
  LoginResult,
  QrcodePayload,
  UpdateProfileInput,
} from './user'

export type {
  MessageType,
  ChatMessage,
  Conversation,
} from './chat'

export type {
  Contact,
  GroupPreview,
  FriendRequest,
  FriendRequestAction,
} from './contact'

export type { GroupInfo, GroupMember } from './group'
