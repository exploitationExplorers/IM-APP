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

**Body**（字段可选）
```json
{ "nickname": "新昵称", "avatar": "url", "bio": "签名" }
```

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

按公开 ID 搜索用户。**不支持手机号搜索。**

未找到返回 `data: null`。

### GET `/api/v1/users/:id`

查看用户公开资料（不含完整手机号）。

---

## 通讯录（需 JWT）

### GET `/api/v1/contacts`

好友列表。

### GET `/api/v1/groups`

当前用户所在群列表。

### GET `/api/v1/friend-requests`

收到的好友申请（pending）。

### POST `/api/v1/friend-requests`

**Body**
```json
{ "toUserId": "uuid", "message": "验证说明" }
```

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

## 群组（Phase 2）

### POST `/api/v1/groups`

创建群聊。

**Body**
```json
{ "name": "群名称", "memberIds": [2, 3] }
```

**Response**
```json
{ "id": 1, "name": "群名称", "ownerId": 1, "memberCount": 3, "allowAddFriend": true }
```

### GET `/api/v1/groups`

当前用户加入的群列表。

### GET `/api/v1/groups/:id`

群详情（需为群成员）。

### GET `/api/v1/groups/:id/members`

群成员列表。

### POST `/api/v1/groups/:id/join`

加入群聊（公开群或邀请）。

### PUT `/api/v1/groups/:id/settings`

群主/管理员修改群设置。

**Body**
```json
{ "name": "新名称", "allowAddFriend": false }
```

### POST `/api/v1/groups/:id/leave`

退出群聊。

---

## 文件上传（Phase 3）

### POST `/api/v1/files/presign`

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
