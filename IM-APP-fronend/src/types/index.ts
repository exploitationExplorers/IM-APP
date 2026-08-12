/** 通用类型定义 — 统一 re-export */

export type { ApiResponse } from './api'

export type {
  UserInfo,
  TokenPair,
  AuthResult,
  LoginResult,
  SmsScene,
  SendSMSResult,
  UserSummary,
  UserQrcodeResult,
  UserQrcodeResolveResult,
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

export type {
  UploadPurpose,
  CreateUploadInput,
  UploadInitResult,
  CompleteUploadInput,
  FileObject,
  FileInfo,
  PresignResult,
} from './file'
