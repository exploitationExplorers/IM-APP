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

好友列表。

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

### GET `/api/v1/contacts/:id/conversation`

获取或创建与该好友的私聊会话 ID。

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

## 聊天（需 JWT）

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

**Body** `{ "role": "admin|member" }`

### PUT `/api/v1/groups/:id/members/:userId/mute`

**Body** `{ "mutedUntil": "2026-08-12T12:00:00Z" }`（空字符串解除禁言）

### DELETE `/api/v1/groups/:id/members/:userId`

移除群成员。

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

退出群聊。

### DELETE `/api/v1/groups/:id`

解散群聊（仅群主）。

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

为当前用户签发 OpenIM Token（未部署 OpenIM 时返回 dev 占位 token）。

**Body**
```json
{ "platformId": 5 }
```

**Response**
```json
{ "token": "...", "expireSec": 604800, "platform": 5, "userId": "..." }
```

---

## 消息转发（Phase 5）

### POST `/api/v1/forward-tasks`

创建异步转发任务（最多 9999 个目标会话）。

**Body**
```json
{ "sourceMessageId": "uuid", "targetConvIds": ["uuid1", "uuid2"] }
```

### GET `/api/v1/forward-tasks/:id`

查询转发任务进度。

---

## WebSocket

连接：`GET /ws?token=<jwt>`

| 事件 | 方向 | 说明 |
|---|---|---|
| `ping` | C→S | 心跳 |
| `pong` | S→C | 心跳响应 |
| `chat.message` | S→C | 新消息推送（按会话成员定向） |

---

## 后续 TODO

- 消息撤回 / 已读回执（OpenIM 能力）
- 真实短信网关 / 离线推送（Phase 5 生产接入）
