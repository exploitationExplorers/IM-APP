# IM API 契约

Go 业务服务（IM-APP-server）正式 REST 契约。前后端 Mock 与 Go 后端共用。

架构说明见 [architecture.md](./architecture.md)。

## 统一响应

统一响应格式：

```json
{ "code": 0, "message": "ok", "data": {} }
```

失败时 `code: 1`，HTTP 状态码：400 / 401 / 403 / 404 / 500。

---

## 认证（无需 JWT，除标注外）

### POST `/api/v1/auth/sms/send`

发送短信验证码。`scene`: `register` | `login` | `reset`。

限流：同一手机号 1 分钟 1 条、IP 每小时 5 条、号码每日 10 条，超限返回 `code=1`。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13800138000",
  "scene": "register",
  "deviceId": "test-device"
}
```

**Response**
```json
{
  "retryAfterSec": 60,
  "expiresIn": 600,
  "devCode": "123456"
}
```

`devCode` 仅开发环境返回。

### POST `/api/v1/auth/register`

手机号 + 验证码 + 密码注册（密码至少 6 位）。成功返回 `accessToken` / `refreshToken` / `user`。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13900000001",
  "code": "123456",
  "password": "test123456",
  "deviceId": "test-device"
}
```

**Response**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "rt...",
  "expiresIn": 604800,
  "user": {
    "id": "uuid",
    "phoneMasked": "139****0001",
    "countryCode": "+86",
    "publicId": "chat10005",
    "nickname": "用户0001",
    "avatar": "",
    "bio": "",
    "status": "active"
  }
}
```

### POST `/api/v1/auth/login`

手机号 + 密码登录。演示账号 `13800138000` / `123456`。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13800138000",
  "password": "123456",
  "deviceId": "test-device"
}
```

**Response**：同注册，`AuthResult`。

### POST `/api/v1/auth/login/sms`

手机号 + 验证码登录。验证码需先通过 `/auth/sms/send`（`scene=login`）获取。

未注册手机号返回失败（禁止静默注册）。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13800138000",
  "code": "123456",
  "deviceId": "test-device"
}
```

### POST `/api/v1/auth/token/refresh`

用 `refreshToken` 换取新的 `accessToken` + `refreshToken`（旧 refreshToken 立即失效）。

**Body**
```json
{
  "refreshToken": "rt...",
  "deviceId": "test-device"
}
```

**Response**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "rt-new...",
  "expiresIn": 604800
}
```

### POST `/api/v1/auth/password/reset`

通过验证码重置密码（`scene=reset`）。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13800138000",
  "code": "123456",
  "password": "newpassword123"
}
```

### POST `/api/v1/auth/logout`

撤销当前设备会话（该 refreshToken 失效）。无需 JWT。

**Body**
```json
{ "refreshToken": "rt..." }
```

### POST `/api/v1/auth/logout-all`

撤销当前用户所有设备会话。**需 JWT**（`Authorization: Bearer accessToken`）。

**Body**
```json
{}
```

---

## 用户（需 JWT）

### GET `/api/v1/me`

当前用户资料。

### PUT `/api/v1/me`

**Body**（字段可选，旧版）
```json
{ "nickname": "新昵称", "avatar": "url", "bio": "签名" }
```

### PATCH `/api/v1/me`

修改本人资料。**nickname、avatarFileId、bio 均需传入**（bio 无内容传空字符串）。头像 `avatarFileId` 须先走文件上传流程（接口 12 → PUT → 接口 13）。

**Body**
```json
{ "nickname": "新昵称", "avatarFileId": "file-uuid", "bio": "" }
```

### GET `/api/v1/me/privacy-settings`

获取当前用户隐私设置。

**Response**
```json
{
  "requireFriendApproval": false,
  "requireGroupApproval": true
}
```

- `requireFriendApproval`：加我为好友需验证。**默认 `false`**（对齐参考站，关闭后对方加好友立即通过）。
- `requireGroupApproval`：邀请我入群需验证。默认 `true`。

### PUT `/api/v1/me/privacy-settings`

修改隐私设置。Body 同 Response 结构。

### PUT `/api/v1/me/password`

登录态下设置/修改密码（安全设置 → 重置密码）。需 JWT。已设置过密码时需传 `oldPassword`。

**Body**
```json
{ "password": "newpassword123", "oldPassword": "oldpass123" }
```

首次设置密码可省略 `oldPassword`。

### GET `/api/v1/me/qrcode`

需 JWT。注册成功后后端自动生成唯一二维码 token；前端用 `payload` 渲染二维码。

**Response**
```json
{
  "payload": "{\"token\":\"...\",\"type\":\"user\"}",
  "expiresAt": "2027-08-12T04:18:22Z",
  "user": {
    "id": "uuid",
    "publicId": "chat10006",
    "nickname": "用户0003",
    "avatar": ""
  }
}
```

### GET `/api/v1/users/search?publicId=chat10002`

按公开 ID 搜索用户。**不支持手机号搜索。** 响应不含 `phone` 字段。

未找到返回 `data: null`。

### POST `/api/v1/users/qrcode/resolve`

解析个人二维码 token（扫码加好友）。

**Body**
```json
{ "token": "uuid", "payload": "{\"token\":\"...\",\"type\":\"user\"}" }
```

**Response**
```json
{
  "user": { "id": "uuid", "publicId": "chat10002", "nickname": "用户", "avatar": "", "relation": "none" },
  "relation": "none"
}
```

`relation`: `self|none|pending|friend|blocked`

### GET `/api/v1/users/:id`

查看用户公开资料（不含完整手机号）。

---

## 通讯录（需 JWT）

### GET `/api/v1/contacts`

好友列表。每项含 `remark`（无备注时为空字符串）。通讯录展示优先用备注，没有则用昵称。

### GET `/api/v1/contacts/:id`

好友详情（含备注、标签、共同群组）。

**Response**
```json
{
  "id": "uuid",
  "publicId": "j8afsqh",
  "nickname": "bug001",
  "avatar": "https://...",
  "remark": "",
  "tags": [{ "id": "uuid", "name": "同事", "memberCount": 3 }],
  "commonGroups": [{ "id": "uuid", "name": "观察世界的窗口", "avatar": "", "conversationId": "uuid" }]
}
```

### PATCH `/api/v1/contacts/:id`

修改好友备注与/或标签集合。`tagIds` 省略则不改标签；传数组则覆盖该好友所属标签。

**Body**
```json
{ "remark": "备注名", "tagIds": ["uuid1", "uuid2"] }
```

### GET `/api/v1/groups?role=owner|member|admin`

当前用户群列表。`role=owner` 为「我建立的」，`role=member` 为「我加入的」。

**Response 项含** `role`、`conversationId`。

### GET `/api/v1/friend-requests?direction=received|sent`

好友申请列表（默认 `received`）。

### POST `/api/v1/friend-requests`

**Body**
```json
{
  "toUserId": "uuid",
  "message": "验证说明",
  "source": "public_id|user_qrcode|group",
  "sourceGroupId": "uuid"
}
```

`source=group` 时服务端校验该群 `allowMemberAddFriend`。

若对方 `requireFriendApproval=false`，服务端直接互加好友，不再进入待审核。

**Response**
```json
{
  "ok": true,
  "id": "uuid",
  "status": "pending"
}
```

`status`：`pending`（待对方同意）| `accepted`（已直接成为好友）。

### POST `/api/v1/friend-requests/:id/accept`

### POST `/api/v1/friend-requests/:id/reject`

### DELETE `/api/v1/contacts/:id`

删除好友。

### POST `/api/v1/contacts/:id/block`

拉黑。

### DELETE `/api/v1/contacts/:id/block`

解除拉黑。

### GET `/api/v1/contacts/:id/conversation`（旧链路）

仅 `LEGACY_CHAT_ENABLED=true` 时注册。默认关闭，OpenIM 模式使用 `/im/peers/:businessUserId` 获取聊天目标。

### GET `/api/v1/contact-tags`

标签列表。

### POST `/api/v1/contact-tags`

**Body** `{ "name": "同事" }`

### PATCH `/api/v1/contact-tags/:tagId`

### DELETE `/api/v1/contact-tags/:tagId`

### GET `/api/v1/contact-tags/:tagId/members`

### PUT `/api/v1/contact-tags/:tagId/members`

**Body** `{ "userIds": ["uuid1", "uuid2"] }`

---

## 旧聊天链路（默认关闭）

以下 PostgreSQL 消息接口仅 `LEGACY_CHAT_ENABLED=true` 时注册。生产 OpenIM 模式必须保持 `false`，普通消息、会话、历史、未读、已读和撤回均由 OpenIM SDK + OpenIM WebSocket 完成。

### GET `/api/v1/conversations`

会话列表。

### POST `/api/v1/conversations/read-all`

全部标记已读。

### GET `/api/v1/conversations/:id/messages`

消息历史（最多 200 条），读后清零该会话未读。

### POST `/api/v1/conversations/:id/messages`

**Body**
```json
{ "type": "text|image|voice|file", "content": "..." }
```

默认关闭时以上路由均返回 404，且不会向 PostgreSQL `messages` 写入新消息。

---

## 群组（需 JWT）

### POST `/api/v1/groups`

创建群聊。

**Body**
```json
{ "name": "群名称", "memberIds": ["uuid2", "uuid3"] }
```

**Response**
```json
{
  "id": "uuid",
  "name": "群名称",
  "ownerId": "uuid",
  "memberCount": 3,
  "allowMemberAddFriend": true,
  "conversationId": "uuid"
}
```

### GET `/api/v1/groups`

见通讯录章节（支持 `role` 筛选）。

### GET `/api/v1/groups/:id`

群详情（需为群成员）。

### GET `/api/v1/groups/:id/members`

群成员列表。

### GET `/api/v1/groups/:id/qrcode`

群主/管理员获取群二维码。

### POST `/api/v1/groups/qrcode/resolve`

解析群二维码。

**Body** `{ "token": "..." }`

### POST `/api/v1/groups/:id/join`

直接加入群聊（公开群）。

### POST `/api/v1/groups/:id/invitations`

邀请好友入群。**Body** `{ "userIds": ["uuid"] }`

### POST `/api/v1/group-invitations/:token/accept`

接受群邀请。

### POST `/api/v1/groups/:id/join-requests`

提交入群申请。**Body** `{ "remark": "申请说明" }`

### GET `/api/v1/groups/:id/join-requests`

入群申请列表（群主/管理员）。

### POST `/api/v1/groups/:id/join-requests/:requestId/approve`

### POST `/api/v1/groups/:id/join-requests/:requestId/reject`

### PUT `/api/v1/groups/:id/members/:userId/role`

仅群主可设置管理员或普通成员，不能改自己，也不能改群主。

**Body** `{ "role": "admin|member" }`

### PUT `/api/v1/groups/:id/members/:userId/mute`

群主/管理员禁言普通成员，群主可禁言管理员。`mutedSeconds=0` 表示解除；最大 30 天。

**Body** `{ "mutedSeconds": 3600 }`

### PUT `/api/v1/groups/:id/mute`

群主/管理员设置全员禁言。普通成员不能发言，群主/管理员仍可发送。
等价于 `PUT /groups/:id/settings` 里的 `allMuted`，两者都会同步到 OpenIM。

**Body** `{ "muted": true }`

### DELETE `/api/v1/groups/:id/members/:userId`

移除群成员。群主可移除管理员和普通成员，管理员只能移除普通成员。

### PUT `/api/v1/groups/:id/settings`

群主/管理员修改群设置。

**Body**
```json
{
  "announcement": "公告",
  "allowMemberAddFriend": false,
  "joinMode": "open|approval",
  "allMuted": false
}
```

### POST `/api/v1/groups/:id/leave`

退出群聊。群主不能退群，只能解散或先转让群主。

### POST `/api/v1/groups/:id/dismiss`

仅群主可解散。业务群状态变为 `dismissed`，后台 Outbox 同步解散 OpenIM 群。

群状态词表统一为 `active` / `dismissed` / `banned`，非 `active` 的群在所有业务接口中都不可见、不可进入。

---

## 文件上传（需 JWT）

### POST `/api/v1/files/uploads`

创建上传任务，获取预签名 PUT 地址。

**Body**
```json
{
  "purpose": "avatar",
  "fileName": "avatar.jpg",
  "contentType": "image/jpeg",
  "size": 102400
}
```

**Response**
```json
{
  "file": { "id": "uuid", "status": "pending" },
  "uploadUrl": "https://...",
  "headers": {},
  "expiresIn": 900
}
```

客户端 PUT 二进制到 `uploadUrl` 后，调用完成接口。

### POST `/api/v1/files/uploads/:fileId/complete`

确认上传完成。

**Body**
```json
{ "etag": "optional" }
```

**Response**：`FileInfo`（含 `url`、`status` 等）。

### GET `/api/v1/files/:fileId`

查询文件信息。

### POST `/api/v1/files/presign`（旧版 / 兼容）

获取 MinIO 预签名上传 URL（MinIO 未配置时返回 dev 占位 URL）。

**Body**
```json
{ "filename": "photo.jpg", "contentType": "image/jpeg" }
```

**Response**
```json
{
  "uploadUrl": "https://...",
  "fileUrl": "https://...",
  "objectKey": "users/{uid}/{uuid}.jpg",
  "expiresIn": 900
}
```

---

## OpenIM 桥接（Phase 4）

### POST `/api/v1/im/token`

沿用原接口，为当前业务用户签发 OpenIM Token。业务用户由注册接口在后端自动同步到 OpenIM，调用方不需要增加 OpenIM 注册接口。

**Body**
```json
{ "platformId": 5 }
```

**Response**
```json
{
  "userId": "...",
  "token": "...",
  "platform": 5,
  "expireSec": 7776000,
  "apiAddr": "http://8.210.72.157:10002",
  "wsAddr": "ws://8.210.72.157:10001"
}
```

兼容约束：`token`、`expireSec`、`platform`、`userId` 是原接口字段，保持名称和含义不变；`apiAddr`、`wsAddr` 是向后兼容的扩展字段。请求体为空、`platformId` 不传或传 `0` 时仍按原逻辑使用 Web 平台 `5`。

### GET `/api/v1/im/peers/:businessUserId`

把业务用户 UUID 解析为稳定的 OpenIM userID，并返回 `canChat/denyReason`。校验双方账号、好友关系和双向拉黑状态，不创建 PostgreSQL 会话。

### GET `/api/v1/im/groups/:businessGroupId`

把业务群 UUID 解析为稳定的 OpenIM groupID，并校验群状态、成员资格、单人禁言及全员禁言。

## OpenIM 内部接口

所有 `/internal/im/*` 必须携带 `X-Internal-API-Key`，密钥来自 `IM_INTERNAL_API_KEY`，不得下发给普通客户端。

| 方法与路径 | 用途 |
|---|---|
| `POST /internal/im/messages` | 幂等发送服务端文本或 custom 系统通知 |
| `GET /internal/im/health` | OpenIM API、管理 Token、Outbox 状态 |
| `POST /internal/im/reconcile` | 将当前用户、好友和群状态重新排入对账任务 |
| `GET /internal/im/outbox?status=dead&limit=100` | 查询同步任务/死信 |
| `POST /internal/im/outbox/:id/replay` | 仅重放指定 dead 任务 |

系统消息示例：

```json
{
  "idempotencyKey": "group-approved:request-id",
  "receiverType": "user",
  "receiverBusinessId": "业务用户UUID",
  "messageType": "custom",
  "key": "group_join_approved",
  "data": {"requestId":"uuid"},
  "guaranteed": true
}
```

同一幂等键和相同请求返回第一次的消息 ID，不重复发送；同一键换内容返回 409。

---

## 消息转发（Phase 5）

这是旧 PostgreSQL 消息链路能力，仅 `LEGACY_CHAT_ENABLED=true` 时注册；OpenIM 模式默认返回 404。普通用户消息转发应由 OpenIM SDK 完成。

### POST `/api/v1/forward-tasks`

创建异步转发任务（最多 9999 个目标会话）。

**Body**
```json
{ "sourceMessageId": "uuid", "targetConvIds": ["uuid1", "uuid2"] }
```

### GET `/api/v1/forward-tasks/:id`

查询转发任务进度。

---

## 收藏

收藏消息快照（文字 / 表情 / 图片 / 视频 / 文件 / 语音）。创建时按业务库 `messages` 校验消息存在且当前用户是会话成员；同一用户对同一消息幂等。

> 说明：当前实现依赖 PostgreSQL `messages` 表。OpenIM 主路径下的消息尚未落该表时，创建可能返回「消息不存在」；列表 / 删除不受影响。

### POST `/api/v1/favorites`

收藏一条消息。

**Body**
```json
{ "messageId": "uuid" }
```

**Response**
```json
{
  "id": "uuid",
  "messageId": "uuid",
  "type": "text",
  "content": "消息内容或文件地址/JSON",
  "senderId": "uuid",
  "conversationId": "uuid",
  "createdAt": "2026-08-13T12:00:00Z"
}
```

### GET `/api/v1/favorites?type=image&page=1&limit=20`

收藏列表。`type` 可选：`text` | `emoji` | `image` | `video` | `file` | `voice`；不传则全部。`page` 默认 1，`limit` 默认 20（最大 100）。

**Response**：收藏对象数组（字段同创建响应）。

### DELETE `/api/v1/favorites/:favoriteId`

取消收藏（仅本人）。成功返回 `{ "ok": true }`；不存在返回 404。

---

## WebSocket

唯一生产聊天连接是 `/api/v1/im/token` 返回的 OpenIM `wsAddr`。Go 后端不代理 OpenIM WebSocket。

`GET /ws?token=<jwt>` 仅旧链路开关启用时存在，默认返回 404。

| 事件 | 方向 | 说明 |
|---|---|---|
| `ping` | C→S | 心跳 |
| `pong` | S→C | 心跳响应 |
| `chat.message` | S→C | 新消息推送（按会话成员定向） |

---

消息撤回、已读回执、历史、会话与离线补偿使用 OpenIM SDK，不增加第二套 Go 消息接口。
