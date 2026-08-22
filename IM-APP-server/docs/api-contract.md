# IM API 契约

Go 业务服务（IM-APP-server）正式 REST 契约。前后端 Mock 与 Go 后端共用。

架构说明见 [architecture.md](./architecture.md)。

## 统一响应

统一响应格式：

```json
{ "code": 0, "message": "ok", "data": {} }
```

失败时 `code: 1`，HTTP 状态码：400 / 401 / 403 / 404 / 500。

例外：`GET /health` 为无需登录的基础存活检查，直接返回 `{ "status": "ok" }`，并按来源 IP 限制为每分钟最多 20 次。

---

## 认证（无需 JWT，除标注外）

### GET `/api/v1/public/countries`

登录、注册前查询已启用的国家/地区和国际电话区号。响应项包含 `code`、`dialCode`、`cnName`、`enName`、`enabled`。注册、密码登录、验证码登录、发送验证码和重置密码均传 `countryCode + phone`；`countryCode` 不传时兼容默认 `+86`，传入时按 libphonenumber 的各国规则校验并统一存为 E.164。

### GET `/api/v1/public/app-release`

客户端检查是否有 wgt 热更新或整包更新。无需 JWT；按 IP 限流。`channel` 不传时默认 `test`。

Query：`platform=android|ios`、`channel=test|prod`、`nativeVersion`（当前安装包 versionCode）、`wgtVersion`（当前资源包 versionCode）。

**Response**
```json
{
  "hasUpdate": true,
  "updateType": "wgt",
  "versionName": "1.0.12",
  "versionCode": 112,
  "minNativeVersion": 100,
  "downloadUrl": "https://www.ke58.com/minio/im-uploads/app-releases/android/uuid.wgt?X-Amz-...",
  "changelog": "修复聊天气泡错位",
  "forceUpdate": false
}
```

`updateType`：`none` | `wgt` | `native`。无发布记录或已是最新时 `hasUpdate=false` 且 `updateType=none`。`downloadUrl` 为限时预签名地址。

发布接口走内部密钥，不面向 App。线上 Nginx 只反代 `/api/`，因此本机 `pack:wgt --publish` 使用下面这组：

- `POST /api/v1/admin/app-releases/uploads` Body：`{ "platform", "packageType", "fileName" }`，返回 `uploadUrl`（PUT）、`objectKey`、`fileUrl`
- `POST /api/v1/admin/app-releases` Body：`{ "platform", "channel", "versionName", "versionCode", "packageType", "objectKey", "changelog", "forceUpdate", "minNativeVersion?" }`
- `GET /api/v1/admin/app-releases?platform=&channel=&limit=`

内网仍保留 `POST/GET /internal/admin/app-releases*`。Header 均需 `X-Internal-API-Key`。日常用前端 `npm run pack:wgt -- --build --publish --min-native=100` 发布。详见仓库根目录 [plan.md](../../plan.md)。

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

手机号 + 验证码注册。密码可选；不传则只支持验证码登录，之后在安全设置里设初始密码。若传密码则至少 6 位。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13900000001",
  "code": "123456",
  "password": "",
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
    "status": "active",
    "hasPassword": false
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

当前用户资料。含 `hasPassword`：是否已设置过登录密码。未设置时安全页走「设初始密码」，不要求旧密码。

只返回脱敏号 `phoneMasked`，**不返回明文手机号**。安全页完整号由客户端用登录时输入的本地号展示。他人资料接口同样不返回明文手机号。

### PUT `/api/v1/me`

**Body**（字段可选，旧版）
```json
{ "nickname": "新昵称", "avatar": "url", "bio": "签名" }
```

### PATCH `/api/v1/me`

修改本人资料。**nickname、avatarFileId、bio 均需传入**（bio 无内容传空字符串）。头像 `avatarFileId` 须先走文件上传流程（接口 12 → multipart POST → 接口 13）。

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

### POST `/api/v1/me/password/verify`

登录态下校验旧密码（安全页点「下一步」）。需 JWT。未设置密码或旧密码不正确返回 400。

**Body**
```json
{ "oldPassword": "oldpass123" }
```

**Response**
```json
{ "ok": true }
```

### PUT `/api/v1/me/password`

登录态下设置/修改密码（安全设置 → 重置密码）。需 JWT。仅当 `hasPassword=true` 时必须传 `oldPassword`。

**Body**
```json
{ "password": "newpassword123", "oldPassword": "oldpass123" }
```

首次设置密码可省略 `oldPassword`。历史验证码注册写入的临时密码不算已设密码。

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

好友列表（分页）。每项含 `remark`（无备注时为空字符串）。通讯录展示优先用备注，没有则用昵称。

一次转发 9999+ 好友不要靠本接口拉全量，客户端全选后走 `POST /api/v1/forward-task-targets/generate` 的 `all_friends`。

**Query**

| 参数 | 说明 |
|---|---|
| `keyword` | 可选，匹配昵称 / 备注 / 公开 ID，最长 64 字 |
| `sort` | `recent`（默认，最近加入）或 `name`（备注/昵称） |
| `cursor` | 上一页最后一条好友 ID，首页省略 |
| `limit` | 默认 50，最大 100 |

**Response `data`**
```json
{
  "items": [
    {
      "id": "uuid",
      "publicId": "j8afsqh",
      "nickname": "压测好友00001",
      "avatar": "",
      "remark": ""
    }
  ],
  "nextCursor": "uuid",
  "hasMore": true,
  "total": 10002
}
```

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

好友申请列表（默认 `received`）。H5 / 调试可用；**App 端请用下方 POST sync**，避免 CDN / WebView 缓存 GET。

### POST `/api/v1/friend-requests/sync`

拉取好友申请列表（与 GET 等价，不会被中间层缓存）。App 端统一走此接口。

**Body**
```json
{ "direction": "received" }
```

**Response（`direction=received`）**
```json
{
  "pending": [
    {
      "id": "uuid",
      "fromUser": { "id": "uuid", "nickname": "...", "avatar": "..." },
      "message": "验证说明",
      "status": "pending",
      "createdAt": "2026-08-22T10:00:00Z"
    }
  ],
  "recent": [
    {
      "id": "uuid",
      "fromUser": { "id": "uuid", "nickname": "...", "avatar": "..." },
      "message": "你好，我是 xxx",
      "status": "accepted",
      "createdAt": "2026-08-12T10:00:00Z"
    }
  ]
}
```

- `pending`：待处理（同一申请人只保留最近一条），按时间倒序，最多 100 条。
- `recent`：近期已处理（`accepted` / `rejected`），不含当前仍有 `pending` 的申请人，按时间倒序，最多 100 条。

**Response（`direction=sent`）**：`{ "pending": [...], "recent": [] }`，`pending` 为我发出的待对方同意申请。

### POST `/api/v1/friend-requests`

**Body**
```json
{
  "toUserId": "uuid",
  "message": "验证说明",
  "source": "public_id|user_qrcode|group",
  "sourceGroupId": "100001"
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

标签列表，含 `memberCount` 与最多 5 个 `memberNames` 预览。

### POST `/api/v1/contact-tags`

**Body** `{ "name": "同事" }`

### PATCH `/api/v1/contact-tags/:tagId`

**Body** `{ "name": "同事" }`

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
  "id": "100001",
  "name": "群名称",
  "ownerId": "uuid",
  "memberCount": 3,
  "allowMemberAddFriend": true,
  "conversationId": "uuid"
}
```

群同步到 OpenIM 后，系统向该群发送一条欢迎消息：`新群创建成功，一起来聊天吧`。

### GET `/api/v1/groups`

见通讯录章节（支持 `role` 筛选）。

### GET `/api/v1/groups/:id`

群详情（需为群成员）。

群相关对外接口中的 `:id` 均为纯数字群号（例如 `100001`）。服务端会映射为内部 UUID；数据库关联和 OpenIM 对接仍使用原 UUID 映射，前端不再传群 UUID。

响应包含 `myRole`、`myNickname`、`joinMode`、`allMuted` 以及 `permissions`，前端据此展示群资料编辑、二维码、成员管理和举报入口。

### GET `/api/v1/groups/:id/members`

群成员列表。

### GET `/api/v1/groups/:id/qrcode`

所有有效群成员获取群二维码字符串。前端使用响应 `payload` 生成二维码图片。

### POST `/api/v1/groups/qrcode/resolve`

只读解析群二维码，返回 `joined`、`joinMode` 和 `nextAction=enter|join|apply`。

**Body** `{ "token": "..." }`

### POST `/api/v1/groups/qrcode/join`

用户确认后按二维码加入群：已是成员返回 `enter`；公开群直接加入并返回 `joined`；审核群创建/复用申请并返回 `pending_approval`。

**Body** `{ "token": "...", "remark": "申请说明" }`，也支持传完整 `payload`。

### POST `/api/v1/groups/:id/join`

直接加入公开群。审核群返回 HTTP 409，必须提交入群申请。

### POST `/api/v1/groups/:id/invitations`

群主/管理员邀请好友入群：直接写入群成员并同步 OpenIM（不走待接受邀请）。已在群中或非好友会被跳过。

**Body** `{ "userIds": ["uuid"] }`

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
  "name": "新群名称",
  "avatarFileId": "已完成上传的本人图片 fileId",
  "announcement": "公告",
  "allowMemberAddFriend": false,
  "joinMode": "open|approval",
  "allMuted": false
}
```

群名称、头像和公告仅群主/管理员可修改。`avatarFileId` 必须属于操作者本人，且文件为 `ready + purpose=avatar + image/*`。

### PUT `/api/v1/groups/:id/me/nickname`

修改“我在本群的昵称”。空字符串恢复全局昵称，最长 32 个 Unicode 字符。

**Body** `{ "nickname": "群内昵称" }`

### PUT `/api/v1/groups/:id/remark`

设置当前用户对该群的备注，最多 64 个字。**Body** `{ "remark": "项目群" }`；传空字符串清除。群详情响应通过 `remark` 返回。

### PUT `/api/v1/groups/:id/members/:userId/remark`

设置当前用户对指定群成员的备注，最多 64 个字。**Body** `{ "remark": "产品负责人" }`；传空字符串清除。群成员列表通过 `memberRemark` 返回。

### POST `/api/v1/groups/reports`

举报当前群聊，仅群成员可提交；同一用户对同一群的待处理举报幂等。

图片先通过 `POST /api/v1/files/uploads`（`purpose=image`）上传，并调用 `POST /api/v1/files/uploads/complete` 完成上传。举报最多关联 9 张当前用户的已完成图片，每张不超过 10 MiB。

**Body** `{ "groupId": "100001", "reason": "spam|fraud|pornography|violence|harassment|other", "description": "补充说明", "imageFileIds": ["图片文件 UUID"] }`

响应的 `imagePaths` 仅包含可直接点击打开的 MinIO HTTP(S) URL，不返回 objectKey 等内部字符串。

### POST `/api/v1/groups/:id/leave`

退出群聊。群主不能退群，只能解散或先转让群主。

### POST `/api/v1/groups/:id/dismiss`

仅群主可解散。业务群状态变为 `dismissed`，后台 Outbox 同步解散 OpenIM 群。

群状态词表统一为 `active` / `dismissed` / `banned`，非 `active` 的群在所有业务接口中都不可见、不可进入。

---

## 用户举报（需 JWT）

### GET `/api/v1/report-reasons?targetType=user&language=zh`

返回当前启用的用户举报原因，按 `sortOrder` 排序。当前后端只接受 `targetType=user`，`language` 默认 `zh`。

**Response**
```json
[
  {
    "id": "uuid",
    "targetType": "user",
    "reason": "垃圾广告",
    "language": "zh",
    "sortOrder": 10
  }
]
```

### POST `/api/v1/reports`

提交用户举报。证据文件必须由当前用户上传且状态为 `ready`，最多 9 个；补充说明最多 1000 个字符。同一用户对同一目标已有 `pending`、`processing` 或 `reopened` 工单时，接口幂等返回原工单。

**Body**
```json
{
  "targetType": "user",
  "targetId": "被举报用户UUID",
  "reasonId": "举报原因UUID",
  "description": "补充说明",
  "evidenceFileIds": ["已完成上传的文件UUID"]
}
```

**Response**
```json
{
  "id": "举报工单UUID",
  "status": "pending",
  "createdAt": "2026-08-14T12:00:00Z"
}
```

该接口写入管理后台共用的 `report_reasons`、`reports`、`report_files`，不写入也不修改原有 `group_reports`。

### POST `/api/v1/feedbacks`

**Body**
```json
{
  "contact": "手机号码、邮箱、QQ、微信等",
  "content": "反馈内容",
  "imageFileIds": ["已完成上传的文件UUID"]
}
```

**Response**
```json
{
  "id": "uuid",
  "createdAt": "2026-08-21T15:00:00Z"
}
```

---

## 文件上传（需 JWT）

### POST `/api/v1/files/uploads`

创建上传任务，获取预签名 multipart POST 表单。H5 和 App 都使用 `formUrl` + `formData` 上传，文件字段名为 `file`；`uploadUrl` 仅为兼容字段，值与 `formUrl` 相同。

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
  "uploadUrl": "https://...预签名 POST 表单地址...",
  "formUrl": "https://www.ke58.com/minio/im-uploads",
  "formData": {
    "key": "uploads/.../uuid.jpg",
    "policy": "...",
    "x-amz-algorithm": "AWS4-HMAC-SHA256"
  },
  "headers": {},
  "expiresIn": 900
}
```

### POST `/api/v1/files/uploads/complete`

确认上传完成，`fileId` 放在 JSON 请求体中。

**Body**
```json
{ "fileId": "uuid", "etag": "optional" }
```

**Response**：`FileInfo`（含 `url`、`status` 等）。

### GET `/api/v1/files?fileId=uuid`

查询文件信息。

### POST `/api/v1/files/presign`（旧版 / 兼容）

获取 MinIO 预签名 multipart POST 表单（MinIO 未配置时返回 dev 占位 URL）。

**Body**
```json
{ "filename": "photo.jpg", "contentType": "image/jpeg" }
```

**Response**
```json
{
  "uploadUrl": "https://...",
  "formUrl": "https://...",
  "formData": { "key": "users/{uid}/{uuid}.jpg", "policy": "..." },
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

把纯数字业务群号、内部 UUID 或 OpenIM 群 ID 解析为稳定的 OpenIM groupID，响应里的 `businessGroupId` 始终是纯数字群号。校验群状态、成员资格、单人禁言及全员禁言。若 OpenIM 尚无该群（历史数据未同步），会按业务库补创建并把当前用户邀请进群后再返回；全量成员对账仍由 Outbox 负责。

### GET `/api/v1/im/conversations/:peerType/:peerId`

获取单个会话的当前设置（OpenIM 全量对象）。

- `peerType`：`c2c`（单聊）或 `group`（群聊）
- `peerId`：业务好友 ID 或业务群 ID（**无需传 OpenIM conversationId**，后端用 `ResolvePeer`/`ResolveGroup` 解析并拼 `si_`/`sg_` 会话 ID，且带好友/群关系校验）

**Response `data`**：见下方 PATCH 返回结构。

### PATCH `/api/v1/im/conversations/:peerType/:peerId`

部分更新会话设置，请求体为下列字段的任意子集（只传要改的）。后端先 GET 全量再叠加回写，避免清零其它设置。

- `peerType` / `peerId`：含义同上

| 字段 | 类型 | 说明 |
|---|---|---|
| `recvMsgOpt` | int | 0 正常 / 1 免打扰 / 2 仅在线接收 |
| `isPinned` | bool | 置顶聊天 |
| `isPrivateChat` | bool | 阅后即焚开关 |
| `burnDuration` | int | 阅后即焚时长（秒） |
| `isMsgDestruct` | bool | 消息定时销毁开关 |
| `msgDestructTime` | int | 消息定时销毁时长（秒） |
| `groupAtType` | int | 群 @ 强提醒档位 |
| `ex` | string | 会话扩展（建议存备注名） |
| `draftText` | string | 会话草稿 |

**Body 示例**
```json
{ "recvMsgOpt": 1, "isPinned": true, "ex": "老王" }
```

**Response `data`**：回写后该会话的最新全量设置。至少传一个字段，否则 400；`peerType` 非法 400；与好友/群不可聊天 403；会话不存在（仅 GET）404。

### POST `/api/v1/im/conversations/:peerType/:peerId/read`

标记会话已读，清空未读数。`peerType` / `peerId` 含义同上。

**Response `data`**：`{ "ok": true }`

### PUT `/api/v1/im/me/global-msg-recv-opt`

设置当前用户级全局免打扰（对所有会话生效）。

**Body**
```json
{ "recvMsgOpt": 1 }
```

**Response `data`**：`{ "recvMsgOpt": 1 }`

### POST `/api/v1/im/me/push-token`

注册/更新当前用户的设备推送凭证（App 后台/离线时的「来消息提示」）。按 `platform + deviceToken` 去重 upsert，存于 Redis，不过期。

**Body**
```json
{ "platform": "ios", "channel": "apns", "deviceToken": "a1b2c3d4e5f6...", "enabled": true }
```
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `platform` | string | 是 | ios / android / web / harmony |
| `channel` | string | 否 | apns / fcm / jpush / harmony（web 可空） |
| `deviceToken` | string | 是 | 设备推送令牌 |
| `enabled` | bool | 否 | 是否接收推送，缺省 true |

**Response `data`**：`{ "ok": true }`（Redis 不可用时 503）

### DELETE `/api/v1/im/me/push-token`

注销当前用户某个设备的推送凭证（退出登录/关闭推送时调用）。

**Body**
```json
{ "deviceToken": "a1b2c3d4e5f6..." }
```

**Response `data`**：`{ "ok": true }`

> 消息推送管线：OpenIM 在消息落库后回调 `AfterMessage` Webhook，后端记录审计并构造 `PushMessage` 调用 `PushService.Dispatch`。当前为 `LoggingPushService` 日志桩（仅打印意图），后续替换为接入 APNs/FCM/个推 的实现。未读总数建议前端直接调 OpenIM SDK `getTotalUnreadMsgCount` 获取，无需后端中转。

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

万人转发采用“PostgreSQL 任务状态 + 事务 Outbox + Kafka 异步队列 + OpenIM 发消息”的链路，接口始终注册，不依赖 `LEGACY_CHAT_ENABLED`。转发目标总人数不设业务上限；worker 从 Kafka 逐批消费并逐个发送，不会在一个 HTTP 请求内同步发完。客户端聊天「转发给」走本接口：创建草稿、按全部好友/标签生成或分批写入目标后提交，发送由 worker 异步完成。离线推送不在本阶段范围内。

接口约定：GET 使用 query 参数；新建的 POST 写接口全部使用静态路径和 JSON body，不把 `taskId` 拼入路径。`GET /api/v1/forward-tasks/:id` 只保留给旧客户端兼容，新客户端使用 `/forward-task-progress?taskId=...`。

### POST `/api/v1/forward-tasks`

创建异步转发草稿任务。`targetUserIds` 可以一次传入全部目标，服务端内部按每批 1000 条写 PostgreSQL；也可以先创建空任务，再通过 add/generate 逐批补充。

**Body**
```json
{
  "sourceConversationId": "si_xxx_xxx",
  "sourceClientMsgId": "OpenIM-clientMsgID",
  "sourceServerMsgId": "OpenIM-serverMsgID",
  "sourceSnapshot": {
    "contentType": 101,
    "content": {"content": "需要转发的文本"}
  },
  "selector": {"mode": "all_friends"},
  "idempotencyKey": "forward-request-uuid",
  "targetUserIds": ["业务用户UUID-1", "业务用户UUID-2"]
}
```

`sourceClientMsgId` 与兼容字段 `sourceMessageId` 至少传一个；`sourceSnapshot.contentType` 只能是 1～999，禁止借转发接口伪造 OpenIM 通知/控制消息。

### 目标管理

| 方法与路径 | 参数 | 说明 |
|---|---|---|
| `GET /api/v1/forward-task-targets?taskId=...&status=...&cursor=...&limit=50` | query | 游标分页查询目标明细 |
| `POST /api/v1/forward-task-targets/add` | `{taskId,targetUserIds}` | 向草稿任务添加目标，单次最多 1000 个 |
| `POST /api/v1/forward-task-targets/generate` | `{taskId,selector}` | 按全部好友、标签或关键字生成目标 |
| `POST /api/v1/forward-task-targets/remove` | `{taskId,targetUserIds}` | 从草稿任务移除目标，单次最多 1000 个 |
| `POST /api/v1/forward-task-targets/clear` | `{taskId}` | 清空草稿任务目标 |

`selector.mode` 可选 `all_friends`、`tags`、`search`；`tags` 需传 `tagIds`，`search` 可传 `keyword`。1000 是单次数据库写入/重试请求的技术批次，不是一个转发任务的总人数限制。

### 任务控制与进度

| 方法与路径 | 参数 | 说明 |
|---|---|---|
| `GET /api/v1/forward-tasks?status=...&cursor=...&limit=20` | query | 查询当前用户的任务列表 |
| `GET /api/v1/forward-task-progress?taskId=...` | query | 查询任务汇总进度 |
| `GET /api/v1/forward-tasks/:id` | path | 旧客户端兼容查询，已废弃 |
| `POST /api/v1/forward-tasks/submit` | `{taskId}` | 提交任务并写 Kafka Outbox |
| `POST /api/v1/forward-tasks/cancel` | `{taskId,reason}` | 取消任务 |
| `POST /api/v1/forward-tasks/retry` | `{taskId,onlyFailed,targetUserIds}` | 重试失败或指定目标，指定目标单次最多 1000 个 |
| `POST /api/v1/forward-tasks/pause` | `{taskId}` | 暂停任务 |
| `POST /api/v1/forward-tasks/resume` | `{taskId}` | 恢复任务并重新派发 Kafka 事件 |

提交、恢复或重试时 Kafka 未配置返回 503。任务状态包括 `draft`、`expanding`、`pending`、`processing`、`completed`、`partially_completed`、`failed`、`paused`、`cancelled`；进度响应包含目标总数及成功、失败、跳过、取消、等待中、处理中等计数。

---

## 收藏

收藏消息快照（文字 / 表情 / 图片 / 视频 / 文件 / 语音）。OpenIM 主路径下由客户端提交快照，服务端不再查业务库 `messages`。同一用户对同一 `messageId` 幂等。

### POST `/api/v1/favorites`

收藏一条消息。

**Body**
```json
{
  "messageId": "OpenIM clientMsgID",
  "type": "text",
  "content": "消息内容或文件地址/JSON",
  "senderId": "发送者业务或 OpenIM ID",
  "conversationId": "OpenIM conversationID"
}
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

### POST `/api/v1/favorites/list`

收藏列表使用 JSON body，不使用 query 参数。

**Body**
```json
{ "page": 1, "size": 20, "type": 0 }
```

`type`：`0` 全部、`1` 文字、`2` 图片/视频、`3` 文件、`4` 语音；`size` 默认 20，最大 100。

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
