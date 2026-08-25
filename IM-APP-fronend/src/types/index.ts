/** 通用类型定义 — 统一 re-export */

export type { ApiResponse } from './api'

export type { AppUpdateType, AppReleaseCheckResult, AppReleaseLocalVersion } from './app-release'

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
  MessageQuote,
  ChatMessage,
  CardPayload,
  Conversation,
} from './chat'

export type {
  Contact,
  ContactPage,
  ContactListQuery,
  ContactListSort,
  ContactTagItem,
  GroupPreview,
  GroupPage,
  GroupMemberPage,
  FriendRequest,
  FriendRequestList,
  FriendRequestAction,
  PrivacySettings,
  SendFriendResult,
  GroupFriendRequestResult,
} from './contact'

export type {
  GroupInfo,
  GroupMember,
  GroupPermissions,
  GroupSettingsInput,
  GroupJoinRequestItem,
  GroupQRCodeResolveResult,
  JoinGroupByQRCodeResult,
  GroupMemberMuteResult,
  GroupAnnouncementHistoryItem,
  GroupRole,
  GroupJoinMode,
} from './group'

export type {
  UploadPurpose,
  CreateUploadInput,
  UploadInitResult,
  CompleteUploadInput,
  FileObject,
  FileInfo,
  PresignResult,
} from './file'

export type {
  ForwardTaskStatus,
  ForwardTargetStatus,
  ForwardSelectorMode,
  ForwardSelector,
  ForwardMessageSnapshot,
  ForwardTask,
  ForwardTaskTarget,
  ForwardTaskPage,
  ForwardTaskTargetPage,
  CreateForwardTaskInput,
  AffectedCountResult,
  OkResult,
  FriendForwardPlan,
} from './forward'
