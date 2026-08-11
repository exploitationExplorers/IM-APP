# GOAL：APP Go 后端分模块接口开发清单

> 范围：只包含 APP 后端，不包含运营管理后台。  
> API 前缀：`/api/v1`。  
> 本文只说明“有哪些模块、每个模块开发哪些接口、请求和响应是什么、需要哪些表”，不展开具体开发方式。

## 一、模块总览

| 编号 | 模块 | 主要内容 | 接口数 | 主要数据表 |
|---:|---|---|---:|---|
| 01 | 公共配置 | APP 初始化、国家区号、上传、举报原因 | 7 | `countries`、`app_configs`、`files`、`report_reasons` |
| 02 | 认证账号 | 短信、注册、登录、刷新 Token、退出、重置密码 | 8 | `users`、`sms_codes`、`sms_send_logs`、`auth_sessions` |
| 03 | 用户资料 | 本人资料、公开资料、公开 ID、个人二维码、注销 | 7 | `users`、`user_qrcodes` |
| 04 | 好友通讯录 | 搜索、申请、好友、备注、黑名单、标签 | 19 | `friend_requests`、`friendships`、`user_blocks`、`contact_tags`、`contact_tag_members` |
| 05 | 群聊管理 | 建群、入群、邀请、申请、成员、管理员、禁言、二维码 | 22 | `groups`、`group_members`、`group_invitations`、`group_join_requests`、`group_qrcodes` |
| 06 | 会话 | 会话列表、置顶、免打扰、未读、删除会话 | 6 | `conversations`、`conversation_members` |
| 07 | 消息 | 历史消息、发送、已读、撤回、离线同步、WebSocket | 6 | `messages`、`message_recall_logs`、`sync_events` |
| 08 | 万人转发 | 可选好友、预估、创建任务、进度、明细、失败重试 | 7 | `forward_tasks`、`forward_task_targets` |
| 09 | 设备与推送 | 设备 Token、通知设置、隐私设置 | 6 | `user_devices`、`notification_settings`、`privacy_settings` |
| 10 | 用户举报 | 举报用户或群 | 1 | `reports`、`report_files` |

按模块共列出 `89` 个接口项；扣除万人转发模块复用的“转发可选好友”接口后，实际为 `87` 个唯一 HTTP 接口和 `1` 个 WebSocket 连接入口。

明确不做：管理后台接口、转账、钱包、红包、朋友圈、VIP、商城、音视频通话。

---

## 二、统一响应结构

所有 HTTP 接口使用相同外层结构：

```go
type ApiResponse[T any] struct {
    Code      int    `json:"code"`
    Message   string `json:"message"`
    Data      T      `json:"data"`
    RequestID string `json:"requestId"`
}

type EmptyResult struct {
    OK bool `json:"ok"`
}

type PageResult[T any] struct {
    Items      []T    `json:"items"`
    NextCursor string `json:"nextCursor,omitempty"`
    HasMore    bool   `json:"hasMore"`
}

type CountResult struct {
    Count int64 `json:"count"`
}
```

下文“响应结构”填写的是 `ApiResponse[T]` 中的 `T`。

---

# 01. 公共配置模块

## 01.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 健康检查 | `GET /health` | 无 | `HealthResult` |
| APP 初始化配置 | `GET /public/bootstrap` | `BootstrapQuery` | `BootstrapResult` |
| 国家区号列表 | `GET /public/countries` | `CountryListQuery` | `PageResult[CountryItem]` |
| 创建上传任务 | `POST /files/uploads` | `CreateUploadRequest` | `UploadInitResult` |
| 确认上传完成 | `POST /files/uploads/:fileId/complete` | `CompleteUploadRequest` | `FileInfo` |
| 查询文件信息 | `GET /files/:fileId` | path: `fileId` | `FileInfo` |
| 举报原因列表 | `GET /report-reasons` | query: `targetType` | `[]ReportReasonItem` |

## 01.2 请求与响应结构体

```go
type HealthResult struct {
    Status string `json:"status"`
}

type BootstrapQuery struct {
    Platform   string `form:"platform"`
    AppVersion string `form:"appVersion"`
    Locale     string `form:"locale"`
}

type BootstrapResult struct {
    Limits             SystemLimits `json:"limits"`
    UserAgreementURL   string       `json:"userAgreementUrl"`
    PrivacyPolicyURL   string       `json:"privacyPolicyUrl"`
    MinAppVersion      string       `json:"minAppVersion"`
    LatestAppVersion   string       `json:"latestAppVersion"`
    UpgradeURL         string       `json:"upgradeUrl,omitempty"`
    ForceUpgrade       bool         `json:"forceUpgrade"`
}

type SystemLimits struct {
    AvatarMaxBytes    int64 `json:"avatarMaxBytes"`
    ImageMaxBytes     int64 `json:"imageMaxBytes"`
    VoiceMaxBytes     int64 `json:"voiceMaxBytes"`
    FileMaxBytes      int64 `json:"fileMaxBytes"`
    GroupMaxMembers   int   `json:"groupMaxMembers"`
    ForwardMaxTargets int   `json:"forwardMaxTargets"`
}

type CountryListQuery struct {
    Keyword string `form:"keyword"`
    Cursor  string `form:"cursor"`
    Limit   int    `form:"limit"`
}

type CountryItem struct {
    Code     string `json:"code"`
    CNName   string `json:"cnName"`
    ENName   string `json:"enName"`
    DialCode string `json:"dialCode"`
    Enabled  bool   `json:"enabled"`
}

type CreateUploadRequest struct {
    Purpose     string `json:"purpose"` // avatar|image|voice|file|sticker
    FileName    string `json:"fileName"`
    ContentType string `json:"contentType"`
    Size        int64  `json:"size"`
    SHA256      string `json:"sha256,omitempty"`
}

type UploadInitResult struct {
    FileID     string            `json:"fileId"`
    UploadURL  string            `json:"uploadUrl"`
    Headers    map[string]string `json:"headers,omitempty"`
    ExpiresIn  int               `json:"expiresIn"`
}

type CompleteUploadRequest struct {
    ETag string `json:"etag,omitempty"`
}

type FileInfo struct {
    ID           string `json:"id"`
    Purpose      string `json:"purpose"`
    FileName     string `json:"fileName"`
    ContentType  string `json:"contentType"`
    Size         int64  `json:"size"`
    URL          string `json:"url"`
    ThumbnailURL string `json:"thumbnailUrl,omitempty"`
    DurationMs   int64  `json:"durationMs,omitempty"`
    Status       string `json:"status"`
}

type ReportReasonItem struct {
    ID         string `json:"id"`
    TargetType string `json:"targetType"` // user|group
    Reason     string `json:"reason"`
}
```

## 01.3 需要的数据表

- `countries`
- `app_configs`
- `files`
- `report_reasons`

---

# 02. 认证账号模块

## 02.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 发送短信验证码 | `POST /auth/sms/send` | `SendSMSRequest` | `SendSMSResult` |
| 手机号注册 | `POST /auth/register` | `RegisterRequest` | `AuthResult` |
| 手机号密码登录 | `POST /auth/login/password` | `PasswordLoginRequest` | `AuthResult` |
| 手机号验证码登录 | `POST /auth/login/sms` | `SMSLoginRequest` | `AuthResult` |
| 刷新 Token | `POST /auth/token/refresh` | `RefreshTokenRequest` | `TokenResult` |
| 重置密码 | `POST /auth/password/reset` | `ResetPasswordRequest` | `EmptyResult` |
| 退出当前设备 | `POST /auth/logout` | `LogoutRequest` | `EmptyResult` |
| 退出全部设备 | `POST /auth/logout-all` | 无 | `EmptyResult` |

## 02.2 请求与响应结构体

```go
type SendSMSRequest struct {
    CountryCode string `json:"countryCode"`
    Phone       string `json:"phone"`
    Scene       string `json:"scene"` // register|login|reset
    DeviceID    string `json:"deviceId"`
}

type SendSMSResult struct {
    RetryAfterSec int `json:"retryAfterSec"`
    ExpiresIn     int `json:"expiresIn"`
}

type RegisterRequest struct {
    CountryCode string `json:"countryCode"`
    Phone       string `json:"phone"`
    Code        string `json:"code"`
    Password    string `json:"password"`
    DeviceID    string `json:"deviceId"`
}

type PasswordLoginRequest struct {
    CountryCode string `json:"countryCode"`
    Phone       string `json:"phone"`
    Password    string `json:"password"`
    DeviceID    string `json:"deviceId"`
}

type SMSLoginRequest struct {
    CountryCode string `json:"countryCode"`
    Phone       string `json:"phone"`
    Code        string `json:"code"`
    DeviceID    string `json:"deviceId"`
}

type RefreshTokenRequest struct {
    RefreshToken string `json:"refreshToken"`
    DeviceID     string `json:"deviceId"`
}

type ResetPasswordRequest struct {
    CountryCode string `json:"countryCode"`
    Phone       string `json:"phone"`
    Code        string `json:"code"`
    Password    string `json:"password"`
}

type LogoutRequest struct {
    RefreshToken string `json:"refreshToken"`
}

type TokenResult struct {
    AccessToken  string `json:"accessToken"`
    RefreshToken string `json:"refreshToken"`
    ExpiresIn    int    `json:"expiresIn"`
}

type AuthResult struct {
    AccessToken  string    `json:"accessToken"`
    RefreshToken string    `json:"refreshToken"`
    ExpiresIn    int       `json:"expiresIn"`
    User         MeProfile `json:"user"`
}
```

## 02.3 需要的数据表

- `users`
- `sms_codes`
- `sms_send_logs`
- `auth_sessions`

---

# 03. 用户资料模块

## 03.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 获取本人资料 | `GET /me` | 无 | `MeProfile` |
| 修改本人资料 | `PATCH /me` | `UpdateProfileRequest` | `MeProfile` |
| 获取个人二维码 | `GET /me/qrcode` | 无 | `UserQRCodeResult` |
| 公开 ID 搜索用户 | `GET /users/search` | query: `publicId` | `UserPublicProfile` |
| 解析个人二维码 | `POST /users/qrcode/resolve` | `ResolveQRCodeRequest` | `UserPublicProfile` |
| 查看用户公开资料 | `GET /users/:userId` | path: `userId` | `UserPublicProfile` |
| 注销账号 | `POST /me/account/cancel` | `CancelAccountRequest` | `EmptyResult` |

## 03.2 请求与响应结构体

```go
type UserSummary struct {
    ID       string `json:"id"`
    PublicID string `json:"publicId"`
    Nickname string `json:"nickname"`
    Avatar   string `json:"avatar"`
}

type MeProfile struct {
    ID          string `json:"id"`
    PhoneMasked string `json:"phoneMasked"`
    CountryCode string `json:"countryCode"`
    PublicID    string `json:"publicId"`
    Nickname    string `json:"nickname"`
    Avatar      string `json:"avatar"`
    Bio         string `json:"bio"`
    Status      string `json:"status"`
    CreatedAt   string `json:"createdAt"`
}

type UpdateProfileRequest struct {
    Nickname     *string `json:"nickname,omitempty"`
    AvatarFileID *string `json:"avatarFileId,omitempty"`
    Bio          *string `json:"bio,omitempty"`
}

type UserPublicProfile struct {
    UserSummary
    Bio      string `json:"bio"`
    Relation string `json:"relation"` // self|none|pending|friend|blocked
}

type UserQRCodeResult struct {
    Payload   string      `json:"payload"`
    ExpiresAt string      `json:"expiresAt,omitempty"`
    User      UserSummary `json:"user"`
}

type ResolveQRCodeRequest struct {
    Payload string `json:"payload"`
}

type CancelAccountRequest struct {
    Password string `json:"password,omitempty"`
    SMSCode  string `json:"smsCode,omitempty"`
}
```

## 03.3 需要的数据表

- `users`
- `user_qrcodes`

---

# 04. 好友通讯录模块

## 04.1 需要开发的接口

### 用户与好友

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 好友列表 | `GET /contacts` | `ContactListQuery` | `PageResult[ContactItem]` |
| 转发可选好友列表 | `GET /contacts/selectable` | `ContactListQuery` | `PageResult[SelectableContact]` |
| 好友详情 | `GET /contacts/:userId` | path: `userId` | `ContactItem` |
| 修改好友备注/标签 | `PATCH /contacts/:userId` | `UpdateContactRequest` | `ContactItem` |
| 删除好友 | `DELETE /contacts/:userId` | path: `userId` | `EmptyResult` |
| 获取私聊会话 | `GET /contacts/:userId/conversation` | path: `userId` | `ConversationRef` |

### 好友申请

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 好友申请列表 | `GET /friend-requests` | `FriendRequestListQuery` | `PageResult[FriendRequestItem]` |
| 发起好友申请 | `POST /friend-requests` | `CreateFriendRequest` | `FriendRequestItem` |
| 同意好友申请 | `POST /friend-requests/:requestId/accept` | path: `requestId` | `FriendActionResult` |
| 拒绝好友申请 | `POST /friend-requests/:requestId/reject` | path: `requestId` | `FriendActionResult` |

### 黑名单

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 黑名单列表 | `GET /blocks` | `PageQuery` | `PageResult[BlockedUserItem]` |
| 加入黑名单 | `POST /blocks` | `BlockUserRequest` | `BlockedUserItem` |
| 解除黑名单 | `DELETE /blocks/:userId` | path: `userId` | `EmptyResult` |

### 好友标签

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 标签列表 | `GET /contact-tags` | 无 | `[]ContactTagItem` |
| 创建标签 | `POST /contact-tags` | `SaveContactTagRequest` | `ContactTagItem` |
| 修改标签 | `PATCH /contact-tags/:tagId` | `SaveContactTagRequest` | `ContactTagItem` |
| 删除标签 | `DELETE /contact-tags/:tagId` | path: `tagId` | `EmptyResult` |
| 标签成员列表 | `GET /contact-tags/:tagId/members` | `PageQuery` | `PageResult[ContactItem]` |
| 设置标签成员 | `PUT /contact-tags/:tagId/members` | `SetTagMembersRequest` | `ContactTagItem` |

## 04.2 请求与响应结构体

```go
type PageQuery struct {
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type ContactListQuery struct {
    Keyword string `form:"keyword"`
    TagID   string `form:"tagId"`
    Cursor  string `form:"cursor"`
    Limit   int    `form:"limit"`
}

type ContactTagItem struct {
    ID          string `json:"id"`
    Name        string `json:"name"`
    MemberCount int64  `json:"memberCount"`
}

type ContactItem struct {
    User      UserSummary     `json:"user"`
    Remark    string          `json:"remark"`
    Tags      []ContactTagItem `json:"tags"`
    CreatedAt string          `json:"createdAt"`
}

type SelectableContact struct {
    User           UserSummary `json:"user"`
    Remark         string      `json:"remark"`
    TagIDs         []string    `json:"tagIds"`
    Selectable     bool        `json:"selectable"`
    DisabledReason string      `json:"disabledReason,omitempty"`
}

type UpdateContactRequest struct {
    Remark *string  `json:"remark,omitempty"`
    TagIDs []string `json:"tagIds,omitempty"`
}

type ConversationRef struct {
    ConversationID string `json:"conversationId"`
}

type FriendRequestListQuery struct {
    Direction string `form:"direction"` // received|sent
    Status    string `form:"status"`
    Cursor    string `form:"cursor"`
    Limit     int    `form:"limit"`
}

type CreateFriendRequest struct {
    ToUserID     string `json:"toUserId"`
    Message      string `json:"message"`
    Source       string `json:"source"` // public_id|user_qrcode|group
    SourceGroupID string `json:"sourceGroupId,omitempty"`
}

type FriendRequestItem struct {
    ID        string      `json:"id"`
    Direction string      `json:"direction"`
    Status    string      `json:"status"`
    Message   string      `json:"message"`
    Source    string      `json:"source"`
    User      UserSummary `json:"user"`
    CreatedAt string      `json:"createdAt"`
    HandledAt string      `json:"handledAt,omitempty"`
}

type FriendActionResult struct {
    Request FriendRequestItem `json:"request"`
    Contact *ContactItem      `json:"contact,omitempty"`
}

type BlockUserRequest struct {
    UserID string `json:"userId"`
}

type BlockedUserItem struct {
    User      UserSummary `json:"user"`
    CreatedAt string      `json:"createdAt"`
}

type SaveContactTagRequest struct {
    Name string `json:"name"`
}

type SetTagMembersRequest struct {
    UserIDs []string `json:"userIds"`
}
```

## 04.3 需要的数据表

- `friend_requests`
- `friendships`
- `user_blocks`
- `contact_tags`
- `contact_tag_members`

---

# 05. 群聊管理模块

## 05.1 需要开发的接口

### 群基础资料

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 我的群列表 | `GET /groups` | `GroupListQuery` | `PageResult[GroupListItem]` |
| 创建群聊 | `POST /groups` | `CreateGroupRequest` | `GroupInfo` |
| 群详情 | `GET /groups/:groupId` | path: `groupId` | `GroupInfo` |
| 修改群资料 | `PATCH /groups/:groupId` | `UpdateGroupRequest` | `GroupInfo` |
| 解散群聊 | `DELETE /groups/:groupId` | path: `groupId` | `EmptyResult` |
| 退出群聊 | `POST /groups/:groupId/leave` | path: `groupId` | `EmptyResult` |

### 群二维码与加入群

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 获取群二维码 | `GET /groups/:groupId/qrcode` | path: `groupId` | `GroupQRCodeResult` |
| 解析群二维码 | `POST /groups/qrcode/resolve` | `ResolveQRCodeRequest` | `GroupInfo` |
| 提交入群申请 | `POST /groups/:groupId/join-requests` | `CreateGroupJoinRequest` | `GroupJoinRequestItem` |
| 入群申请列表 | `GET /groups/:groupId/join-requests` | `GroupJoinRequestListQuery` | `PageResult[GroupJoinRequestItem]` |
| 同意入群申请 | `POST /groups/:groupId/join-requests/:requestId/approve` | 无 | `JoinGroupResult` |
| 拒绝入群申请 | `POST /groups/:groupId/join-requests/:requestId/reject` | 无 | `GroupJoinRequestItem` |

### 群邀请

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 邀请好友入群 | `POST /groups/:groupId/invitations` | `InviteGroupMembersRequest` | `InviteGroupResult` |
| 接受群邀请 | `POST /group-invitations/:token/accept` | path: `token` | `JoinGroupResult` |
| 拒绝群邀请 | `POST /group-invitations/:token/reject` | path: `token` | `EmptyResult` |

### 群成员与权限

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 群成员列表 | `GET /groups/:groupId/members` | `GroupMemberListQuery` | `PageResult[GroupMemberItem]` |
| 设置/取消管理员 | `PUT /groups/:groupId/members/:userId/role` | `UpdateMemberRoleRequest` | `GroupMemberItem` |
| 设置成员禁言 | `PUT /groups/:groupId/members/:userId/mute` | `MuteMemberRequest` | `GroupMemberItem` |
| 移除群成员 | `DELETE /groups/:groupId/members/:userId` | path 参数 | `EmptyResult` |
| 修改群公共设置 | `PUT /groups/:groupId/settings` | `UpdateGroupSettingsRequest` | `GroupInfo` |
| 获取我的群设置 | `GET /groups/:groupId/my-settings` | path: `groupId` | `MyGroupSettings` |
| 修改我的群设置 | `PUT /groups/:groupId/my-settings` | `UpdateMyGroupSettingsRequest` | `MyGroupSettings` |

## 05.2 请求与响应结构体

```go
type GroupListQuery struct {
    Role   string `form:"role"` // owner|admin|member
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type GroupListItem struct {
    ID             string `json:"id"`
    Name           string `json:"name"`
    Avatar         string `json:"avatar"`
    Role           string `json:"role"`
    MemberCount    int    `json:"memberCount"`
    ConversationID string `json:"conversationId"`
    UnreadCount    int64  `json:"unreadCount"`
}

type GroupInfo struct {
    ID                   string `json:"id"`
    Name                 string `json:"name"`
    Avatar               string `json:"avatar"`
    OwnerID              string `json:"ownerId"`
    Announcement         string `json:"announcement"`
    Status               string `json:"status"`
    JoinMode             string `json:"joinMode"` // direct|approval
    ConversationID       string `json:"conversationId"`
    MemberCount          int    `json:"memberCount"`
    MaxMembers           int    `json:"maxMembers"`
    AllowMemberAddFriend bool   `json:"allowMemberAddFriend"`
    AllMuted             bool   `json:"allMuted"`
}

type CreateGroupRequest struct {
    Name         string   `json:"name"`
    AvatarFileID string   `json:"avatarFileId,omitempty"`
    MemberIDs    []string `json:"memberIds"`
}

type UpdateGroupRequest struct {
    Name         *string `json:"name,omitempty"`
    AvatarFileID *string `json:"avatarFileId,omitempty"`
    Announcement *string `json:"announcement,omitempty"`
}

type GroupQRCodeResult struct {
    GroupID   string `json:"groupId"`
    Payload   string `json:"payload"`
    ExpiresAt string `json:"expiresAt,omitempty"`
}

type CreateGroupJoinRequest struct {
    Remark string `json:"remark"`
}

type GroupJoinRequestListQuery struct {
    Status string `form:"status"`
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type GroupJoinRequestItem struct {
    ID        string       `json:"id"`
    Applicant UserSummary  `json:"applicant"`
    Status    string       `json:"status"`
    Remark    string       `json:"remark"`
    Handler   *UserSummary `json:"handler,omitempty"`
    CreatedAt string       `json:"createdAt"`
    HandledAt string       `json:"handledAt,omitempty"`
}

type InviteGroupMembersRequest struct {
    UserIDs []string `json:"userIds"`
}

type InviteGroupResult struct {
    AcceptedCount int      `json:"acceptedCount"`
    PendingCount  int      `json:"pendingCount"`
    SkippedCount  int      `json:"skippedCount"`
    InvitationIDs []string `json:"invitationIds"`
}

type JoinGroupResult struct {
    Group      GroupInfo       `json:"group"`
    Membership GroupMemberItem `json:"membership"`
}

type GroupMemberListQuery struct {
    Keyword string `form:"keyword"`
    Cursor  string `form:"cursor"`
    Limit   int    `form:"limit"`
}

type GroupMemberItem struct {
    User          UserSummary `json:"user"`
    Role          string      `json:"role"`
    GroupNickname string      `json:"groupNickname"`
    MutedUntil    string      `json:"mutedUntil,omitempty"`
    JoinedAt      string      `json:"joinedAt"`
}

type UpdateMemberRoleRequest struct {
    Role string `json:"role"` // admin|member
}

type MuteMemberRequest struct {
    MutedUntil string `json:"mutedUntil"`
}

type UpdateGroupSettingsRequest struct {
    JoinMode             *string `json:"joinMode,omitempty"`
    AllowMemberAddFriend *bool   `json:"allowMemberAddFriend,omitempty"`
    AllMuted             *bool   `json:"allMuted,omitempty"`
}

type MyGroupSettings struct {
    Muted  bool `json:"muted"`
    Pinned bool `json:"pinned"`
}

type UpdateMyGroupSettingsRequest struct {
    Muted  *bool `json:"muted,omitempty"`
    Pinned *bool `json:"pinned,omitempty"`
}
```

## 05.3 需要的数据表

- `groups`
- `group_members`
- `group_invitations`
- `group_join_requests`
- `group_qrcodes`
- `group_action_logs`

---

# 06. 会话模块

## 06.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 会话列表 | `GET /conversations` | `ConversationListQuery` | `PageResult[ConversationItem]` |
| 会话详情 | `GET /conversations/:conversationId` | path 参数 | `ConversationItem` |
| 全部未读数量 | `GET /conversations/unread-count` | 无 | `CountResult` |
| 修改置顶/免打扰 | `PUT /conversations/:conversationId/settings` | `UpdateConversationSettingsRequest` | `ConversationSettings` |
| 删除本地会话 | `DELETE /conversations/:conversationId` | path 参数 | `EmptyResult` |
| 全部标记已读 | `POST /conversations/read-all` | 无 | `ReadAllResult` |

## 06.2 请求与响应结构体

```go
type ConversationListQuery struct {
    OnlyUnread bool   `form:"onlyUnread"`
    Cursor     string `form:"cursor"`
    Limit      int    `form:"limit"`
}

type ConversationItem struct {
    ID            string          `json:"id"`
    Type          string          `json:"type"` // private|group
    Title         string          `json:"title"`
    Avatar        string          `json:"avatar"`
    PeerUserID    string          `json:"peerUserId,omitempty"`
    GroupID       string          `json:"groupId,omitempty"`
    LastMessage   *MessagePreview `json:"lastMessage,omitempty"`
    LastMessageAt string          `json:"lastMessageAt,omitempty"`
    UnreadCount   int64           `json:"unreadCount"`
    Pinned        bool            `json:"pinned"`
    Muted         bool            `json:"muted"`
}

type MessagePreview struct {
    ID       string `json:"id"`
    Type     string `json:"type"`
    Text     string `json:"text"`
    SenderID string `json:"senderId"`
    Recalled bool   `json:"recalled"`
}

type UpdateConversationSettingsRequest struct {
    Pinned *bool `json:"pinned,omitempty"`
    Muted  *bool `json:"muted,omitempty"`
}

type ConversationSettings struct {
    Pinned bool `json:"pinned"`
    Muted  bool `json:"muted"`
}

type ReadAllResult struct {
    ReadConversationCount int64 `json:"readConversationCount"`
    UnreadCount           int64 `json:"unreadCount"`
}
```

## 06.3 需要的数据表

- `conversations`
- `conversation_members`

---

# 07. 消息模块

## 07.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 历史消息分页 | `GET /conversations/:conversationId/messages` | `MessageListQuery` | `MessagePageResult` |
| 发送消息 | `POST /conversations/:conversationId/messages` | `SendMessageRequest` | `SendMessageResult` |
| 会话标记已读 | `POST /conversations/:conversationId/read` | `MarkReadRequest` | `ReadStateResult` |
| 撤回消息 | `POST /messages/:messageId/recall` | `RecallMessageRequest` | `RecallMessageResult` |
| 离线增量同步 | `GET /messages/sync` | `MessageSyncQuery` | `MessageSyncResult` |
| 实时消息连接 | `GET /ws` | token | `WSHelloResult` + WebSocket 事件 |

## 07.2 请求与响应结构体

```go
type MessageContent struct {
    Text           string    `json:"text,omitempty"`
    File           *FileInfo `json:"file,omitempty"`
    DurationMs     int64     `json:"durationMs,omitempty"`
    AtUserIDs      []string  `json:"atUserIds,omitempty"`
    QuoteMessageID string    `json:"quoteMessageId,omitempty"`
}

type MessageItem struct {
    ID              string         `json:"id"`
    ClientMessageID string         `json:"clientMessageId"`
    ConversationID  string         `json:"conversationId"`
    SenderID        string         `json:"senderId"`
    Type            string         `json:"type"` // text|emoji|image|voice|file|system
    Content         MessageContent `json:"content"`
    Seq             int64          `json:"seq"`
    Status          string         `json:"status"`
    CreatedAt       string         `json:"createdAt"`
    RecalledAt      string         `json:"recalledAt,omitempty"`
    RecalledBy      string         `json:"recalledBy,omitempty"`
}

type MessageListQuery struct {
    BeforeSeq int64 `form:"beforeSeq"`
    Limit     int   `form:"limit"`
}

type MessagePageResult struct {
    Items         []MessageItem `json:"items"`
    NextBeforeSeq int64         `json:"nextBeforeSeq,omitempty"`
    HasMore       bool          `json:"hasMore"`
}

type SendMessageRequest struct {
    ClientMessageID string         `json:"clientMessageId"`
    Type            string         `json:"type"`
    Content         MessageContent `json:"content"`
}

type SendMessageResult struct {
    Message   MessageItem `json:"message"`
    Duplicate bool        `json:"duplicate"`
}

type MarkReadRequest struct {
    MaxSeq int64 `json:"maxSeq"`
}

type ReadStateResult struct {
    ConversationID string `json:"conversationId"`
    MaxReadSeq     int64  `json:"maxReadSeq"`
    UnreadCount    int64  `json:"unreadCount"`
}

type RecallMessageRequest struct {
    Reason string `json:"reason,omitempty"`
}

type RecallMessageResult struct {
    MessageID      string `json:"messageId"`
    ConversationID string `json:"conversationId"`
    RecalledBy     string `json:"recalledBy"`
    RecalledAt     string `json:"recalledAt"`
    Seq            int64  `json:"seq"`
}

type MessageSyncQuery struct {
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type SyncEventItem struct {
    Cursor         string         `json:"cursor"`
    Type           string         `json:"type"`
    ConversationID string         `json:"conversationId,omitempty"`
    Payload        map[string]any `json:"payload"`
    CreatedAt      string         `json:"createdAt"`
}

type MessageSyncResult struct {
    Events     []SyncEventItem `json:"events"`
    NextCursor string          `json:"nextCursor"`
    HasMore    bool            `json:"hasMore"`
}

type WSHelloResult struct {
    ConnectionID string `json:"connectionId"`
    SyncCursor   string `json:"syncCursor"`
    ServerTime   string `json:"serverTime"`
}

type WSEvent struct {
    EventID  string         `json:"eventId"`
    Type     string         `json:"type"`
    Cursor   string         `json:"cursor"`
    Data     map[string]any `json:"data"`
    CreatedAt string        `json:"createdAt"`
}
```

## 07.3 需要的数据表

- `messages`
- `message_recall_logs`
- `sync_events`

---

# 08. 万人转发模块

## 08.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 转发可选好友 | `GET /contacts/selectable` | `ContactListQuery` | `PageResult[SelectableContact]` |
| 统计可转发人数 | `POST /forward-tasks/estimate` | `ForwardEstimateRequest` | `ForwardEstimateResult` |
| 创建转发任务 | `POST /forward-tasks` | `CreateForwardTaskRequest` | `ForwardTaskItem` |
| 转发历史 | `GET /forward-tasks` | `ForwardTaskListQuery` | `PageResult[ForwardTaskItem]` |
| 转发任务详情/进度 | `GET /forward-tasks/:taskId` | path: `taskId` | `ForwardTaskItem` |
| 转发目标明细 | `GET /forward-tasks/:taskId/targets` | `ForwardTargetListQuery` | `PageResult[ForwardTargetItem]` |
| 重试失败目标 | `POST /forward-tasks/:taskId/retry` | `RetryForwardTaskRequest` | `ForwardTaskItem` |

## 08.2 请求与响应结构体

```go
type ForwardSelector struct {
    UserIDs   []string `json:"userIds,omitempty"`
    TagIDs    []string `json:"tagIds,omitempty"`
    AllMatched bool    `json:"allMatched"`
    Keyword   string   `json:"keyword,omitempty"`
}

type ForwardEstimateRequest struct {
    Selector ForwardSelector `json:"selector"`
}

type ForwardEstimateResult struct {
    MatchedCount     int64            `json:"matchedCount"`
    EligibleCount    int64            `json:"eligibleCount"`
    ExcludedCount    int64            `json:"excludedCount"`
    ExclusionSummary map[string]int64 `json:"exclusionSummary"`
}

type CreateForwardTaskRequest struct {
    SourceMessageID string          `json:"sourceMessageId"`
    IdempotencyKey  string          `json:"idempotencyKey"`
    Selector        ForwardSelector `json:"selector"`
}

type ForwardTaskItem struct {
    ID              string `json:"id"`
    SourceMessageID string `json:"sourceMessageId"`
    Status          string `json:"status"` // pending|running|done|partial_failed|failed
    TargetCount     int64  `json:"targetCount"`
    SuccessCount    int64  `json:"successCount"`
    FailedCount     int64  `json:"failedCount"`
    SkippedCount    int64  `json:"skippedCount"`
    CreatedAt       string `json:"createdAt"`
    StartedAt       string `json:"startedAt,omitempty"`
    FinishedAt      string `json:"finishedAt,omitempty"`
}

type ForwardTaskListQuery struct {
    Status string `form:"status"`
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type ForwardTargetListQuery struct {
    Status string `form:"status"`
    Cursor string `form:"cursor"`
    Limit  int    `form:"limit"`
}

type ForwardTargetItem struct {
    User           UserSummary `json:"user"`
    Status         string      `json:"status"`
    FailureCode    string      `json:"failureCode,omitempty"`
    FailureMessage string      `json:"failureMessage,omitempty"`
    MessageID      string      `json:"messageId,omitempty"`
    UpdatedAt      string      `json:"updatedAt"`
}

type RetryForwardTaskRequest struct {
    OnlyFailed    bool     `json:"onlyFailed"`
    TargetUserIDs []string `json:"targetUserIds,omitempty"`
}
```

## 08.3 需要的数据表

- `forward_tasks`
- `forward_task_targets`

---

# 09. 设备、推送与 APP 设置模块

## 09.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 注册/更新设备 | `PUT /me/devices/:deviceId` | `UpsertDeviceRequest` | `DeviceItem` |
| 删除设备 | `DELETE /me/devices/:deviceId` | path: `deviceId` | `EmptyResult` |
| 获取通知设置 | `GET /me/notification-settings` | 无 | `NotificationSettings` |
| 修改通知设置 | `PUT /me/notification-settings` | `NotificationSettings` | `NotificationSettings` |
| 获取隐私设置 | `GET /me/privacy-settings` | 无 | `PrivacySettings` |
| 修改隐私设置 | `PUT /me/privacy-settings` | `PrivacySettings` | `PrivacySettings` |

## 09.2 请求与响应结构体

```go
type UpsertDeviceRequest struct {
    Platform     string `json:"platform"` // android|ios
    PushProvider string `json:"pushProvider"`
    PushToken    string `json:"pushToken"`
    AppVersion   string `json:"appVersion"`
    Locale       string `json:"locale"`
}

type DeviceItem struct {
    DeviceID    string `json:"deviceId"`
    Platform    string `json:"platform"`
    AppVersion  string `json:"appVersion"`
    PushEnabled bool   `json:"pushEnabled"`
    LastActiveAt string `json:"lastActiveAt"`
}

type NotificationSettings struct {
    MuteAll          bool `json:"muteAll"`
    NotifyNewMessage bool `json:"notifyNewMessage"`
    SoundInApp       bool `json:"soundInApp"`
    Vibration        bool `json:"vibration"`
}

type PrivacySettings struct {
    RequireFriendApproval bool `json:"requireFriendApproval"`
    RequireGroupApproval  bool `json:"requireGroupApproval"`
}
```

## 09.3 需要的数据表

- `user_devices`
- `notification_settings`
- `privacy_settings`

---

# 10. 用户举报模块

## 10.1 需要开发的接口

| 接口 | 方法与路径 | 请求结构 | 响应结构 |
|---|---|---|---|
| 举报用户或群 | `POST /reports` | `CreateReportRequest` | `ReportResult` |

## 10.2 请求与响应结构体

```go
type CreateReportRequest struct {
    TargetType      string   `json:"targetType"` // user|group
    TargetID        string   `json:"targetId"`
    ReasonID        string   `json:"reasonId"`
    Description     string   `json:"description,omitempty"`
    EvidenceFileIDs []string `json:"evidenceFileIds,omitempty"`
}

type ReportResult struct {
    ID        string `json:"id"`
    Status    string `json:"status"`
    CreatedAt string `json:"createdAt"`
}
```

## 10.3 需要的数据表

- `reports`
- `report_files`

---

# 三、首期不开发的 APP 接口

以下页面虽然目前前端中存在入口或目标网站存在接口，但不在最终八项必须功能和基础 IM 范围内：

| 功能 | 首期处理 |
|---|---|
| 我的收藏 | 不开发，产品确认后进入 P1 |
| 我的表情 | 不开发，产品确认后进入 P1 |
| 语言切换 | APP 本地完成 |
| 主题/显示模式 | APP 本地完成 |
| 清理缓存 | APP 本地完成 |
| 调试信息/重新选线 | 不对普通用户开放 |
| 转账、钱包、红包、朋友圈 | 明确不开发 |

如果后续确认收藏和自定义表情必须上线，再增加：

- `GET /favorites`
- `POST /favorites`
- `DELETE /favorites/:favoriteId`
- `GET /stickers`
- `POST /stickers`
- `DELETE /stickers/:stickerId`
- 数据表：`favorites`、`user_stickers`

---

# 四、现有 Go 后端与本清单的差距

| 模块 | 现有代码已经有 | 还需要开发 |
|---|---|---|
| 公共配置 | 文件预签名 | bootstrap、国家列表、上传完成、文件详情、举报原因 |
| 认证账号 | 短信、注册、密码/短信登录、重置密码 | refresh token、session、退出当前/全部设备 |
| 用户资料 | 本人资料、修改资料、公开 ID 搜索、二维码、公开资料 | 二维码解析、账号注销、本人和公开 DTO 分离 |
| 好友通讯录 | 好友列表、申请、同意/拒绝、删除、拉黑/解除 | 发出申请、详情、备注、标签、黑名单列表、可选好友分页 |
| 群聊管理 | 创建、详情、成员列表、直接加入、基础设置、退出 | 二维码、邀请、入群申请、审核、角色、禁言、移除、解散、个人群设置 |
| 会话 | 列表、全部已读 | 详情、未读总数、置顶、免打扰、用户侧删除 |
| 消息 | 列表、发送、简单 WS | 类型化内容、分页、幂等、单会话已读、撤回、离线同步 |
| 万人转发 | 创建任务、查询任务 | 10000 上限、预估、历史、目标明细、失败原因、重试 |
| 设备推送 | 占位 | 设备注册、Token 维护、通知和隐私设置、离线推送 |
| 举报 | 无 | 举报原因和提交举报 |

---

# 五、最终需要新增或完善的数据表汇总

1. `users`
2. `auth_sessions`
3. `sms_codes`
4. `sms_send_logs`
5. `countries`
6. `app_configs`
7. `files`
8. `user_qrcodes`
9. `friend_requests`
10. `friendships`
11. `user_blocks`
12. `contact_tags`
13. `contact_tag_members`
14. `groups`
15. `group_members`
16. `group_invitations`
17. `group_join_requests`
18. `group_qrcodes`
19. `group_action_logs`
20. `conversations`
21. `conversation_members`
22. `messages`
23. `message_recall_logs`
24. `sync_events`
25. `forward_tasks`
26. `forward_task_targets`
27. `user_devices`
28. `notification_settings`
29. `privacy_settings`
30. `report_reasons`
31. `reports`
32. `report_files`

其中现有 migration 已有部分基础表，但字段和业务状态仍需要按本接口清单继续补齐。
