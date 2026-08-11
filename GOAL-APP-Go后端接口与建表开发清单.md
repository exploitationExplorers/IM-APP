# GOAL：APP Go 后端接口、数据结构与建表开发清单

> 文档状态：开发基线（仅 APP，不含运营管理后台）  
> API 前缀：`/api/v1`  
> 依据：最终需求范围、`site-api-capture.md`、当前前端 `src/api` / `src/types` / `src/mock`、现有 Go 服务与 migrations。

## 1. 最终目标与边界

目标是完成 Android/iOS APP 可独立验收的 Go 业务后端，覆盖：多国手机号认证、用户资料、公开 ID/二维码、好友关系、群聊管理、会话和消息、文件、消息同步/已读/撤回、至少 10000 名好友的异步转发、离线推送、APP 设置和用户举报。

本目标明确不包含：

- 运营管理后台页面、管理员账号/RBAC、后台审核页面。
- 转账、钱包、充值、提现、红包、朋友圈、VIP、商城、音视频通话。
- H5、小程序和 PC 正式端。
- 合并转发多条记录、定时/周期群发、对整批转发统一撤回。

后台页面暂不做，但 APP 运行所需的状态、风控校验和审计数据必须先落库，例如群管理撤回记录、短信结果、举报、转发失败原因。

## 2. 当前代码结论

### 2.1 已有骨架可复用

- Gin 分层、JWT 中间件、PostgreSQL、Redis/MinIO/Kafka/OpenIM 客户端占位。
- 认证：密码登录、短信登录/注册、重置密码。
- 用户：本人资料、修改资料、公开 ID 搜索、二维码、公开资料。
- 好友：列表、申请、同意/拒绝、删除、拉黑/解除。
- 群：创建、详情、成员列表、加入、基础设置、退出。
- 聊天：会话列表、消息列表、发消息、全部已读、过渡 WebSocket。
- 文件预签名、OpenIM Token、简化转发任务。

### 2.2 必须补齐或重构

| 领域 | 当前问题 | 目标 |
|---|---|---|
| 手机号唯一性 | `users.phone` 单列唯一，跨国家可能冲突 | 唯一键改为标准 E.164 `phone_e164` |
| 短信 | 验证码可重复使用，无错误次数/设备/IP/国家限流 | 一次消费、错误次数、发送记录、Redis 限流 |
| Token | 只有长 JWT，不能可靠退出/续签 | access + refresh session，可撤销 |
| 公开资料 | `UserInfo` 会向他人返回手机号 | 本人 DTO 与公开 DTO 彻底分离 |
| 好友 | 无发出申请、备注、标签和大列表游标 | 双向关系事务、标签、游标分页 |
| 群 | 缺二维码、邀请、申请审核、管理员、移除、解散、禁言 | 完整群状态和权限闭环 |
| 消息 | `content string`、最多 200 条、读列表即清零 | 类型化内容、游标分页、幂等、同步、已读、撤回 |
| 转发 | 只存总数，最大值还是 9999，无目标明细和失败重试 | 至少 10000、任务明细、幂等、批处理、重试 |
| 上传 | 只有 presign，无完成确认/用途/大小校验 | 初始化上传 + 完成确认 + 文件元数据 |
| 推送 | 仅占位 | 设备注册、偏好、离线推送、角标 |
| APP 设置 | 通知/隐私/黑名单/收藏等页面多为本地假状态 | 服务端设置接口；非首期功能明确降级 |

`site-api-capture.md` 只用于参考业务字段和交互，不沿用其 `UID + Token` 放请求体、全 POST、HTTP 200 表示全部结果等设计。认证统一使用 `Authorization: Bearer <accessToken>`，业务错误使用正确 HTTP 状态码。

## 3. 统一协议与公共 Go 结构体

### 3.1 基础规则

- ID 对外均为字符串；数据库建议 UUIDv7/UUID，消息可使用雪花 ID，但同一 API 中不得混用数字和字符串。
- 时间统一 RFC3339 UTC，例如 `2026-08-12T02:30:00Z`。
- 列表统一游标分页，禁止为 10000+ 好友使用 offset 深分页。
- 写接口接受 `Idempotency-Key`；消息另有 `clientMessageId`。
- 空列表必须返回 `[]`，不能省略 `data` 或返回 `null`。
- `code=0` 表示成功；错误码使用稳定字符串，便于 APP 判断。

```go
package dto

type Response[T any] struct {
    Code      int            `json:"code"`
    Message   string         `json:"message"`
    Data      T              `json:"data"`
    RequestID string         `json:"requestId"`
}

type ErrorData struct {
    ErrorCode string            `json:"errorCode"`
    Details   map[string]string `json:"details,omitempty"`
}

type Empty struct { OK bool `json:"ok"` }

type Page[T any] struct {
    Items      []T    `json:"items"`
    NextCursor string `json:"nextCursor,omitempty"`
    HasMore    bool   `json:"hasMore"`
}

type CountResult struct { Count int64 `json:"count"` }
```

### 3.2 公共实体 DTO

```go
type UserSummary struct {
    ID       string `json:"id"`
    PublicID string `json:"publicId"`
    Nickname string `json:"nickname"`
    Avatar   string `json:"avatar"`
}

type FileObject struct {
    ID          string `json:"id"`
    Purpose     string `json:"purpose"`     // avatar|image|voice|file|sticker
    FileName    string `json:"fileName"`
    ContentType string `json:"contentType"`
    Size        int64  `json:"size"`
    URL         string `json:"url"`
    ThumbnailURL string `json:"thumbnailUrl,omitempty"`
    DurationMs  int64  `json:"durationMs,omitempty"`
    Status      string `json:"status"`      // pending|ready|rejected
}

type UploadInitResult struct {
    File      FileObject `json:"file"`
    UploadURL string     `json:"uploadUrl"`
    Headers   map[string]string `json:"headers,omitempty"`
    ExpiresIn int        `json:"expiresIn"`
}

type SystemLimits struct {
    AvatarMaxBytes int64 `json:"avatarMaxBytes"`
    ImageMaxBytes  int64 `json:"imageMaxBytes"`
    VoiceMaxBytes  int64 `json:"voiceMaxBytes"`
    FileMaxBytes   int64 `json:"fileMaxBytes"`
    ForwardMaxTargets int `json:"forwardMaxTargets"`
    GroupMaxMembers   int `json:"groupMaxMembers"`
}
```

## 4. 公共能力模块

公共接口不能散落在用户、聊天或群 Handler 中。

| 接口 | 请求结构 | 成功响应 `data` | 说明 |
|---|---|---|---|
| `GET /health` | 无 | `HealthResult` | 存活检查 |
| `GET /api/v1/public/bootstrap` | query: `platform,appVersion,locale` | `BootstrapResult` | 国家区号、协议版本、文件限制、最低版本 |
| `GET /api/v1/public/countries` | query: `keyword,cursor,limit` | `Page[CountryItem]` | 登录前可用 |
| `POST /api/v1/files/uploads` | `CreateUploadRequest` | `UploadInitResult` | 获取预签名地址 |
| `POST /api/v1/files/uploads/:id/complete` | `CompleteUploadRequest` | `FileObject` | 校验对象、大小、MIME 后转 ready |
| `GET /api/v1/report-reasons` | query: `targetType` | `[]ReportReason` | 用户/群举报原因 |
| `POST /api/v1/reports` | `CreateReportRequest` | `ReportResult` | APP 提交举报 |

```go
type HealthResult struct { Status string `json:"status"` }
type CountryItem struct { Code, CNName, ENName, DialCode string; Enabled bool `json:"enabled"` }
type BootstrapResult struct {
    Countries []CountryItem `json:"countries"`
    Limits SystemLimits `json:"limits"`
    UserAgreementURL string `json:"userAgreementUrl"`
    PrivacyPolicyURL string `json:"privacyPolicyUrl"`
    MinAppVersion string `json:"minAppVersion"`
    LatestAppVersion string `json:"latestAppVersion"`
    UpgradeURL string `json:"upgradeUrl,omitempty"`
}
type CreateUploadRequest struct { Purpose, FileName, ContentType, SHA256 string; Size int64 `json:"size"` }
type CompleteUploadRequest struct { ETag string `json:"etag,omitempty"` }
type ReportReason struct { ID, TargetType, Reason string }
type CreateReportRequest struct { TargetType, TargetID, ReasonID, Description string; EvidenceFileIDs []string `json:"evidenceFileIds,omitempty"` }
type ReportResult struct { ID, Status, CreatedAt string }
```

关键逻辑：上传初始化必须按 purpose 校验扩展名、MIME、大小和用户配额；客户端只能把 `ready` 文件用于头像或消息。下载 URL 应为 CDN/对象存储 URL，不把本机临时路径存入消息。

## 5. 认证与账号模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `POST /auth/sms/send` | `SendSMSRequest` | `SendSMSResult` |
| `POST /auth/register` | `RegisterRequest` | `AuthResult` |
| `POST /auth/login` | `PasswordLoginRequest` | `AuthResult` |
| `POST /auth/login/sms` | `SMSLoginRequest` | `AuthResult` |
| `POST /auth/token/refresh` | `RefreshTokenRequest` | `TokenPair` |
| `POST /auth/password/reset` | `ResetPasswordRequest` | `Empty` |
| `POST /auth/logout` | `LogoutRequest` | `Empty` |
| `POST /auth/logout-all` | 无 | `Empty` |

```go
type SendSMSRequest struct { CountryCode, Phone, Scene, DeviceID string }
type SendSMSResult struct { RetryAfterSec int `json:"retryAfterSec"`; ExpiresIn int `json:"expiresIn"` }
type RegisterRequest struct { CountryCode, Phone, Code, Password, DeviceID string }
type PasswordLoginRequest struct { CountryCode, Phone, Password, DeviceID string }
type SMSLoginRequest struct { CountryCode, Phone, Code, DeviceID string }
type RefreshTokenRequest struct { RefreshToken, DeviceID string }
type ResetPasswordRequest struct { CountryCode, Phone, Code, Password string }
type LogoutRequest struct { RefreshToken string `json:"refreshToken"` }
type TokenPair struct { AccessToken, RefreshToken string; ExpiresIn int `json:"expiresIn"` }
type AuthResult struct { TokenPair; User MeProfile `json:"user"` }
```

核心逻辑：使用 libphonenumber 规则把区号和本地号归一为 `phone_e164`；国家停用时禁止新注册；短信验证码哈希存储、一次消费、有效期和错误次数限制；Redis 按国家/号码/设备/IP 限流；登录成功创建可撤销 session。禁止短信登录在用户不存在时静默注册，注册和登录必须是两个明确流程。

## 6. 用户资料与二维码模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `GET /me` | 无 | `MeProfile` |
| `PATCH /me` | `UpdateProfileRequest` | `MeProfile` |
| `GET /me/qrcode` | 无 | `QRCodeResult` |
| `GET /users/search?publicId=` | 无 | `UserPublicProfile`；未找到为 404 |
| `POST /users/qrcode/resolve` | `ResolveQRCodeRequest` | `QRCodeResolveResult` |
| `GET /users/:id` | 无 | `UserPublicProfile` |
| `POST /me/account/cancel` | `CancelAccountRequest` | `Empty` |

```go
type MeProfile struct {
    ID, PhoneMasked, CountryCode, PublicID, Nickname, Avatar, Bio, Status, CreatedAt string
}
type UserPublicProfile struct {
    UserSummary
    Bio string `json:"bio"`
    Relation string `json:"relation"` // self|none|pending|friend|blocked
}
type UpdateProfileRequest struct { Nickname, AvatarFileID, Bio *string }
type QRCodeResult struct { Type, Payload, ExpiresAt string; User UserSummary `json:"user"` }
type ResolveQRCodeRequest struct { Payload string `json:"payload"` }
type QRCodeResolveResult struct { Type string `json:"type"`; User *UserPublicProfile `json:"user,omitempty"`; Group *GroupInfo `json:"group,omitempty"` }
type CancelAccountRequest struct { Password, SMSCode string }
```

核心逻辑：内部 ID 永不可修改；公开 ID 唯一且默认不可修改；他人 DTO 不出现手机号；昵称 1–32 字符并走敏感词规则；头像必须引用已完成的 avatar 文件；资料变化通过事件使好友会话、群成员缓存失效，而不是复制多份永久快照。

## 7. 好友、黑名单与标签模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `GET /contacts` | query: `keyword,tagId,cursor,limit` | `Page[ContactItem]` |
| `GET /contacts/selectable` | query 同上 | `Page[SelectableContact]` |
| `GET /contacts/:id` | 无 | `ContactItem` |
| `PATCH /contacts/:id` | `UpdateContactRequest` | `ContactItem` |
| `DELETE /contacts/:id` | 无 | `Empty` |
| `GET /contacts/:id/conversation` | 无 | `ConversationRef` |
| `GET /friend-requests` | query: `direction,status,cursor,limit` | `Page[FriendRequestItem]` |
| `POST /friend-requests` | `CreateFriendRequest` | `FriendRequestItem` |
| `POST /friend-requests/:id/accept` | 无 | `FriendActionResult` |
| `POST /friend-requests/:id/reject` | 无 | `FriendActionResult` |
| `GET /blocks` | query: `cursor,limit` | `Page[BlockedUserItem]` |
| `POST /blocks` | `BlockUserRequest` | `BlockedUserItem` |
| `DELETE /blocks/:userId` | 无 | `Empty` |
| `GET /contact-tags` | 无 | `[]ContactTag` |
| `POST /contact-tags` | `SaveTagRequest` | `ContactTag` |
| `PATCH /contact-tags/:id` | `SaveTagRequest` | `ContactTag` |
| `DELETE /contact-tags/:id` | 无 | `Empty` |
| `PUT /contact-tags/:id/members` | `SetTagMembersRequest` | `ContactTag` |

```go
type ContactItem struct { User UserSummary `json:"user"`; Remark string `json:"remark"`; Tags []ContactTag `json:"tags"`; CreatedAt string `json:"createdAt"` }
type SelectableContact struct { User UserSummary `json:"user"`; Remark string `json:"remark"`; TagIDs []string `json:"tagIds"`; Selectable bool `json:"selectable"`; DisabledReason string `json:"disabledReason,omitempty"` }
type UpdateContactRequest struct { Remark *string `json:"remark"`; TagIDs []string `json:"tagIds,omitempty"` }
type ConversationRef struct { ConversationID string `json:"conversationId"` }
type CreateFriendRequest struct { ToUserID, Message, Source, SourceGroupID string }
type FriendRequestItem struct { ID, Direction, Status, Message, Source, CreatedAt, HandledAt string; User UserSummary `json:"user"` }
type FriendActionResult struct { Request FriendRequestItem `json:"request"`; Contact *ContactItem `json:"contact,omitempty"` }
type BlockUserRequest struct { UserID string `json:"userId"` }
type BlockedUserItem struct { User UserSummary `json:"user"`; CreatedAt string `json:"createdAt"` }
type ContactTag struct { ID, Name string; MemberCount int64 `json:"memberCount"` }
type SaveTagRequest struct { Name string `json:"name"` }
type SetTagMembersRequest struct { UserIDs []string `json:"userIds"` }
```

核心逻辑：同意申请必须在一个事务中锁定申请并幂等地建立双方 friendship；删除好友移除双方关系但不物理删除历史消息；拉黑同时使当前好友关系失效并阻止私聊/申请。`source=group` 时必须检查该群 `allowMemberAddFriend`，公开 ID/个人二维码来源不受群开关影响。

## 8. 群组、加群与群权限模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `GET /groups` | query: `role,cursor,limit` | `Page[GroupListItem]` |
| `POST /groups` | `CreateGroupRequest` | `GroupInfo` |
| `GET /groups/:id` | 无 | `GroupInfo` |
| `PATCH /groups/:id` | `UpdateGroupRequest` | `GroupInfo` |
| `DELETE /groups/:id` | 无 | `Empty` |
| `GET /groups/:id/members` | query: `keyword,cursor,limit` | `Page[GroupMemberItem]` |
| `POST /groups/:id/invitations` | `InviteGroupMembersRequest` | `InviteResult` |
| `POST /groups/invitations/:token/accept` | 无 | `JoinGroupResult` |
| `GET /groups/:id/join-requests` | query 分页 | `Page[GroupJoinRequestItem]` |
| `POST /groups/:id/join-requests` | `CreateGroupJoinRequest` | `GroupJoinRequestItem` |
| `POST /groups/:id/join-requests/:requestId/approve` | 无 | `JoinGroupResult` |
| `POST /groups/:id/join-requests/:requestId/reject` | 无 | `GroupJoinRequestItem` |
| `GET /groups/:id/qrcode` | 无 | `GroupQRCodeResult` |
| `POST /groups/qrcode/resolve` | `ResolveQRCodeRequest` | `GroupInfo` |
| `PUT /groups/:id/members/:userId/role` | `UpdateMemberRoleRequest` | `GroupMemberItem` |
| `PUT /groups/:id/members/:userId/mute` | `MuteMemberRequest` | `GroupMemberItem` |
| `DELETE /groups/:id/members/:userId` | 无 | `Empty` |
| `PUT /groups/:id/settings` | `UpdateGroupSettingsRequest` | `GroupInfo` |
| `PUT /groups/:id/my-settings` | `UpdateMyGroupSettingsRequest` | `MyGroupSettings` |
| `POST /groups/:id/leave` | 无 | `Empty` |

```go
type GroupListItem struct { ID, Name, Avatar, Role, ConversationID string; MemberCount int `json:"memberCount"`; UnreadCount int64 `json:"unreadCount"` }
type GroupInfo struct { ID, Name, Avatar, OwnerID, Announcement, Status, JoinMode, ConversationID string; MemberCount, MaxMembers int; AllowMemberAddFriend, AllMuted bool }
type CreateGroupRequest struct { Name, AvatarFileID string; MemberIDs []string `json:"memberIds"` }
type UpdateGroupRequest struct { Name, AvatarFileID, Announcement *string }
type GroupMemberItem struct { User UserSummary `json:"user"`; Role, GroupNickname, JoinedAt, MutedUntil string }
type InviteGroupMembersRequest struct { UserIDs []string `json:"userIds"` }
type InviteResult struct { AcceptedCount, PendingCount, SkippedCount int; InvitationIDs []string `json:"invitationIds"` }
type CreateGroupJoinRequest struct { Remark, InviteToken string }
type GroupJoinRequestItem struct { ID, Status, Remark, CreatedAt, HandledAt string; Applicant UserSummary `json:"applicant"`; Handler *UserSummary `json:"handler,omitempty"` }
type JoinGroupResult struct { Group GroupInfo `json:"group"`; Membership GroupMemberItem `json:"membership"` }
type GroupQRCodeResult struct { GroupID, Payload, ExpiresAt string }
type UpdateMemberRoleRequest struct { Role string `json:"role"` } // admin|member
type MuteMemberRequest struct { MutedUntil string `json:"mutedUntil"` }
type UpdateGroupSettingsRequest struct { JoinMode *string; AllowMemberAddFriend, AllMuted *bool }
type UpdateMyGroupSettingsRequest struct { Muted, Pinned *bool }
type MyGroupSettings struct { Muted, Pinned bool }
```

权限逻辑：创建者为 owner；owner 可设置/取消 admin、移除成员、解散；owner/admin 可审核入群、邀请、禁言、管理撤回；普通成员只能退出。解散群写 `status=dissolved` 并发布系统事件，不直接删除审计记录。任何入群入口都检查群状态、容量、现有成员、申请状态和 join mode。

## 9. 会话模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `GET /conversations` | query: `cursor,limit,onlyUnread` | `Page[ConversationItem]` |
| `GET /conversations/unread-count` | 无 | `CountResult` |
| `GET /conversations/:id` | 无 | `ConversationItem` |
| `PUT /conversations/:id/settings` | `UpdateConversationSettingsRequest` | `ConversationSettings` |
| `DELETE /conversations/:id` | 无 | `Empty` |
| `POST /conversations/read-all` | 无 | `ReadAllResult` |

```go
type ConversationItem struct {
    ID, Type, Title, Avatar, PeerUserID, GroupID, LastMessageAt string
    LastMessage *MessagePreview `json:"lastMessage,omitempty"`
    UnreadCount int64 `json:"unreadCount"`
    Pinned, Muted bool
}
type MessagePreview struct { ID, Type, Text, SenderID string; Recalled bool `json:"recalled"` }
type UpdateConversationSettingsRequest struct { Pinned, Muted *bool }
type ConversationSettings struct { Pinned, Muted bool }
type ReadAllResult struct { ReadConversationCount int64 `json:"readConversationCount"`; UnreadCount int64 `json:"unreadCount"` }
```

删除会话只更新当前成员的 `hidden_before_seq`，不能删除对方或群成员历史。置顶、免打扰、未读数都属于会话成员个人状态。

## 10. 消息、已读、同步与 WebSocket 模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `GET /conversations/:id/messages` | query: `beforeSeq,limit` | `MessagePage` |
| `POST /conversations/:id/messages` | `SendMessageRequest` | `SendMessageResult` |
| `POST /conversations/:id/read` | `MarkReadRequest` | `ReadState` |
| `POST /messages/:id/recall` | `RecallMessageRequest` | `RecallResult` |
| `GET /messages/sync` | query: `cursor,limit` | `SyncResult` |
| `GET /ws` | query token 或 WS ticket | `WSHello` 后进入事件流 |

```go
type MessageContent struct {
    Text string `json:"text,omitempty"`
    File *FileObject `json:"file,omitempty"`
    DurationMs int64 `json:"durationMs,omitempty"`
    AtUserIDs []string `json:"atUserIds,omitempty"`
    QuoteMessageID string `json:"quoteMessageId,omitempty"`
}
type MessageItem struct {
    ID, ClientMessageID, ConversationID, SenderID, Type, Status, CreatedAt string
    Seq int64 `json:"seq"`
    Content MessageContent `json:"content"`
    RecalledAt, RecalledBy string
}
type SendMessageRequest struct { ClientMessageID, Type string; Content MessageContent `json:"content"` }
type SendMessageResult struct { Message MessageItem `json:"message"`; Duplicate bool `json:"duplicate"` }
type MessagePage struct { Items []MessageItem `json:"items"`; NextBeforeSeq int64 `json:"nextBeforeSeq"`; HasMore bool `json:"hasMore"` }
type MarkReadRequest struct { MaxSeq int64 `json:"maxSeq"` }
type ReadState struct { ConversationID string `json:"conversationId"`; MaxReadSeq, UnreadCount int64 }
type RecallMessageRequest struct { Reason string `json:"reason,omitempty"` }
type RecallResult struct { MessageID, ConversationID, RecalledBy, RecalledAt string; Seq int64 `json:"seq"` }
type SyncResult struct { Events []SyncEvent `json:"events"`; NextCursor string `json:"nextCursor"`; HasMore bool `json:"hasMore"` }
type SyncEvent struct { Cursor, Type, ConversationID, CreatedAt string; Payload any `json:"payload"` }
type WSHello struct { ConnectionID, SyncCursor, ServerTime string }
type WSEvent struct { EventID, Type, Cursor, CreatedAt string; Data any `json:"data"` }
```

消息类型：`text|emoji|image|voice|file|system`。`clientMessageId` 在发送人范围唯一，重试返回原消息且 `duplicate=true`。每个会话使用严格递增 `seq` 排序；客户端重连先调用 sync，再恢复 WS。普通成员只能在配置时间窗内撤回自己消息；群 owner/admin 可管理撤回指定群消息；撤回保留占位与审计，不能物理删除正文记录。

## 11. 万人转发任务模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `POST /forward-tasks/estimate` | `EstimateForwardRequest` | `ForwardEstimate` |
| `POST /forward-tasks` | `CreateForwardTaskRequest` | `ForwardTask` |
| `GET /forward-tasks` | query: `cursor,limit,status` | `Page[ForwardTask]` |
| `GET /forward-tasks/:id` | 无 | `ForwardTask` |
| `GET /forward-tasks/:id/targets` | query: `status,cursor,limit` | `Page[ForwardTarget]` |
| `POST /forward-tasks/:id/retry` | `RetryForwardRequest` | `ForwardTask` |

```go
type ForwardSelector struct { UserIDs []string `json:"userIds,omitempty"`; TagIDs []string `json:"tagIds,omitempty"`; AllMatched bool `json:"allMatched"`; Keyword string `json:"keyword,omitempty"` }
type EstimateForwardRequest struct { Selector ForwardSelector `json:"selector"` }
type ForwardEstimate struct { MatchedCount, EligibleCount, ExcludedCount int64; ExclusionSummary map[string]int64 `json:"exclusionSummary"` }
type CreateForwardTaskRequest struct { SourceMessageID, IdempotencyKey string; Selector ForwardSelector `json:"selector"` }
type ForwardTask struct { ID, SourceMessageID, Status, CreatedAt, StartedAt, FinishedAt string; TargetCount, SuccessCount, FailedCount, SkippedCount int64 }
type ForwardTarget struct { User UserSummary `json:"user"`; Status, FailureCode, FailureMessage, MessageID, UpdatedAt string }
type RetryForwardRequest struct { OnlyFailed bool `json:"onlyFailed"`; TargetUserIDs []string `json:"targetUserIds,omitempty"` }
```

任务提交时生成不可变目标快照并去重，硬上限不得低于 10000。worker 分批投递，每个目标复用单聊会话并写一条独立消息；目标级唯一键 `(task_id,target_user_id)` 防重复。执行时再次排除已删除好友、双方拉黑、封禁/注销用户。任务进度只能由目标明细聚合，不能靠内存计数。离线推送应限速合并，避免单任务形成推送风暴。

## 12. 设备、推送与 APP 设置模块

| 接口 | 请求结构 | 成功响应 `data` |
|---|---|---|
| `PUT /me/devices/:deviceId` | `UpsertDeviceRequest` | `DeviceItem` |
| `DELETE /me/devices/:deviceId` | 无 | `Empty` |
| `GET /me/notification-settings` | 无 | `NotificationSettings` |
| `PUT /me/notification-settings` | `NotificationSettings` | `NotificationSettings` |
| `GET /me/privacy-settings` | 无 | `PrivacySettings` |
| `PUT /me/privacy-settings` | `PrivacySettings` | `PrivacySettings` |

```go
type UpsertDeviceRequest struct { Platform, PushProvider, PushToken, AppVersion, Locale string }
type DeviceItem struct { DeviceID, Platform, AppVersion, LastActiveAt string; PushEnabled bool `json:"pushEnabled"` }
type NotificationSettings struct { MuteAll, NotifyNewMessage, SoundInApp, Vibration bool }
type PrivacySettings struct { RequireFriendApproval, RequireGroupApproval bool }
```

推送消费者读取消息事件，只向离线且未免打扰的有效设备推送；退出当前 session 删除或解绑该设备 token，封禁/注销撤销全部 session 和 token。通知 payload 只携带会话 ID、消息类型和安全摘要，不携带完整敏感正文。

## 13. 当前 APP 页面中的扩展项处理

以下来自现有页面或抓站记录，但不属于最终八项必须功能，不能混进 P0 主链路：

| 功能 | 处理 |
|---|---|
| 我的收藏 | 建议 P1；需要 `favorites` 表及列表/新增/删除接口 |
| 我的表情 | 建议 P1；需要 `user_stickers` 表及列表/新增/删除接口 |
| 清空聊天记录 | P0 只做“对自己隐藏到某 seq”，不删除他人数据 |
| 语言/主题/缓存清理 | 客户端本地设置，不需要 Go 接口 |
| 意见反馈/关于我们 | 反馈可复用 reports；关于我们走 bootstrap 配置 |
| 修改密码 | 可在账号安全阶段增加 `PUT /me/password`，需要旧密码或短信校验 |

若产品确认收藏和自定义表情首发必须上线，再把下列接口升为 P0：`GET/POST/DELETE /favorites`、`GET/POST/DELETE /stickers`。它们不能因为目标站存在就默认进入最终需求。

## 14. PostgreSQL 最终建表清单

### 14.1 账号与公共配置

| 表 | 核心字段/约束 |
|---|---|
| `users` | `id, phone_e164 UNIQUE, country_code, national_phone_encrypted, public_id UNIQUE, password_hash, nickname, avatar_file_id, bio, status, created_at, updated_at, canceled_at` |
| `auth_sessions` | `id, user_id, device_id, refresh_token_hash UNIQUE, expires_at, revoked_at, ip, user_agent` |
| `sms_codes` | `id, phone_e164, scene, code_hash, attempts, max_attempts, expires_at, consumed_at`；索引手机号+场景+时间 |
| `sms_send_logs` | `phone_e164, country_code, provider, provider_msg_id, scene, status, error_code, ip_hash, device_id, created_at` |
| `countries` | `code UNIQUE, dial_code, cn_name, en_name, phone_rule, enabled, sort_order` |
| `files` | `id, owner_id, purpose, object_key UNIQUE, content_type, size, sha256, status, created_at` |
| `report_reasons` | `id, target_type, reason, enabled, sort_order` |
| `reports` | `id, reporter_id, target_type, target_id, reason_id, description, status, created_at` |
| `report_files` | `(report_id,file_id)` 唯一 |

### 14.2 好友与标签

| 表 | 核心字段/约束 |
|---|---|
| `friendships` | 有向两行模型：`user_id, friend_id, remark, created_at`，联合主键 |
| `friend_requests` | `from_user_id,to_user_id,message,source,source_group_id,status,handled_at`；pending 防重复部分唯一索引 |
| `user_blocks` | `user_id,blocked_user_id,created_at`，联合主键 |
| `contact_tags` | `id,user_id,name,created_at`；同一用户标签名唯一 |
| `contact_tag_members` | `tag_id,user_id,friend_id`；只允许当前有效好友 |

### 14.3 群组

| 表 | 核心字段/约束 |
|---|---|
| `groups` | `id,name,avatar_file_id,owner_id,announcement,status,join_mode,max_members,allow_member_add_friend,all_muted,conversation_id,created_at` |
| `group_members` | `group_id,user_id,role,group_nickname,muted_until,status,joined_at,left_at`；有效成员唯一 |
| `group_invitations` | `id,group_id,inviter_id,invitee_id,token_hash,status,expires_at` |
| `group_join_requests` | `id,group_id,applicant_id,remark,status,handler_id,handled_at`；pending 防重复 |
| `group_qrcodes` | `id,group_id,token_hash UNIQUE,expires_at,revoked_at` |
| `group_action_logs` | `group_id,operator_id,action,target_user_id,target_message_id,detail_json,created_at` |

### 14.4 会话和消息

| 表 | 核心字段/约束 |
|---|---|
| `conversations` | `id,type,private_key UNIQUE NULLS NOT DISTINCT,group_id UNIQUE,last_seq,last_message_id,created_at` |
| `conversation_members` | `conversation_id,user_id,max_read_seq,unread_count,pinned,muted,hidden_before_seq,joined_at,left_at` |
| `messages` | `id,conversation_id,seq,sender_id,client_message_id,type,content_json,status,created_at,recalled_at,recalled_by`；`(conversation_id,seq)`、`(sender_id,client_message_id)` 唯一 |
| `message_recall_logs` | `message_id,conversation_id,operator_id,operator_role,reason,created_at` |
| `sync_events` | `cursor BIGSERIAL,user_id,event_type,conversation_id,payload_json,created_at`；按用户+cursor 索引并设置保留策略 |

若正式接入 OpenIM，消息正文、会话 seq、已读和同步以 OpenIM 为唯一事实源；PostgreSQL 不应再双写一套竞争状态，只保留业务映射、撤回审计和任务引用。

### 14.5 转发、推送和设置

| 表 | 核心字段/约束 |
|---|---|
| `forward_tasks` | `id,user_id,source_message_id,idempotency_key,status,target_count,success_count,failed_count,skipped_count,timestamps`；用户+幂等键唯一 |
| `forward_task_targets` | `task_id,target_user_id,conversation_id,status,attempts,failure_code,failure_message,message_id,updated_at`；任务+目标唯一 |
| `user_devices` | `user_id,device_id,platform,push_provider,push_token_hash,push_token_encrypted,app_version,last_active_at,revoked_at` |
| `notification_settings` | `user_id PK,mute_all,notify_new_message,sound_in_app,vibration,updated_at` |
| `privacy_settings` | `user_id PK,require_friend_approval,require_group_approval,updated_at` |

P1 可选表：`favorites`、`user_stickers`。

## 15. 必须补的关键索引与数据约束

- `users(phone_e164)`、`users(public_id)` 唯一；手机号必须加密/脱敏展示。
- `friend_requests(from_user_id,to_user_id) WHERE status='pending'` 唯一。
- `friendships(user_id,friend_id)` 主键，并用事务确保双向两行一致。
- `group_members(group_id,user_id) WHERE status='active'` 唯一。
- 私聊 `private_key=min(userA,userB)+':'+max(...)` 唯一，禁止重复私聊会话。
- `messages(conversation_id,seq)` 唯一并倒序索引；`messages(sender_id,client_message_id)` 唯一保证重试幂等。
- `conversation_members(user_id,pinned DESC,updated_at DESC)` 支撑会话列表。
- `forward_task_targets(task_id,status,id)` 支撑 worker 批量领取和失败分页。
- 所有状态字段使用 CHECK 或数据库 enum；所有计数非负；群人数在事务/锁内校验。

## 16. 开发顺序与验收门槛

1. 先冻结 DTO、错误码、数据库迁移和 OpenIM/自研消息边界。
2. 完成公共配置、上传、国际手机号认证和 session。
3. 完成本人/公开资料、公开 ID、个人二维码。
4. 完成好友申请、双向关系、黑名单、备注和标签。
5. 完成群创建、邀请/二维码/申请、权限、禁言、退出/解散。
6. 完成会话、类型化消息、游标分页、幂等发送、已读、撤回和同步。
7. 完成设备注册、离线推送和设置。
8. 完成万人转发任务、目标明细、重试、限流和压力测试。
9. APP 全量联调，移除页面中的临时本地路径消息和假设置。

最低验收门槛：

- 所有列表返回稳定结构和游标，空数据也是 `items: []`。
- 手机号不能搜索好友，也不能出现在其他用户公开 DTO。
- 断网重试不重复发消息；重连不漏消息且按 seq 有序。
- 群权限必须在服务端校验，不能只靠 APP 隐藏按钮。
- 单次 10000 个有效好友转发可持续查询进度，每个目标最多收到一条。
- 推送免打扰、退出登录、封禁/注销后的行为正确。
- 所有写接口有事务、幂等或明确的重复操作结果；核心模块有集成测试。

## 17. 现有文件的落地改造点

- `IM-APP-server/docs/api-contract.md`：实现时按本文收敛为正式 OpenAPI，不继续扩展旧的简化契约。
- `IM-APP-server/migrations/001_init.sql` 至 `004_forward_tasks.sql`：保留为历史迁移，新增迁移修正 E.164 唯一键、session、群申请、消息状态、目标明细等；不要直接修改已发布迁移。
- `IM-APP-server/internal/models`：拆分 db model 与 API DTO，禁止直接把数据库 User 序列化给客户端。
- `IM-APP-fronend/src/types`：同步本文字段；`ChatMessage.content` 从字符串升级为类型化对象。
- `IM-APP-fronend/src/api` 与 `src/mock/handlers`：所有真实 API 与 mock 使用同一个契约，补齐 cursor、错误码、幂等键和空列表结构。
- `site-api-capture.md` 含真实站点凭据，不应提交公共仓库；建议轮换其中 Token/密码并移出版本控制。
