# IM API 契约

Go 业务服务（IM-APP-server）正式 REST 契约。前后端 Mock 与 Go 后端共用。

架构说明见 [architecture.md](./architecture.md)。

## 群历史清理状态（只读）

`GET /api/v1/im/group-retention/states?conversationIds=sg_<32位群ID>[,sg_<32位群ID>]`，Bearer 鉴权。
仅接受这一个 query 参数、1～50 个不重复的小写群会话 ID，不接受 GET body。
成功返回 `data.items=[{conversationId,minVisibleSeq,revision,updatedAt}]`，`Cache-Control: private, no-store`。
仅查询当前有效成员及有效账号有权访问的群；无权访问或尚无已执行状态的群省略，空数组不撤销已知边界。
`minVisibleSeq` 以下的正数 seq 不应再进入聊天历史、搜索、媒体列表或会话预览；seq=0 的本地发送中消息不因此丢弃。
客户端按账号持久化并只接受递增版本和不后退的边界，超时、空结果、后端回滚不应复活旧消息。
400 为参数错误，401 为未登录，503 为状态服务不可用；上游错误、群消息正文和凭据不出现在响应中。
本接口没有执行清理或发布边界的写能力；预览计划永远不能作为已清理结果返回。
详见 `openapi.yaml` 与 `group-retention.postman_collection.json`。

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

客户端检查是否有 wgt 热更新或整包更新。无需 JWT；按 IP 限流。`channel` 不传时默认 `test`。`canary` 只给内部壳，客户测试壳仍是 `test`，两条记录互不影响。

Query：`platform=android|ios`、`channel=canary|test|prod`、`nativeVersion`（当前安装包 versionCode）、`wgtVersion`（当前资源包 versionCode）。

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

`updateType`：`none` | `wgt` | `native`。无发布记录或已是最新时 `hasUpdate=false` 且 `updateType=none`。`downloadUrl` 为服务端返回的可下载地址：兼容 MinIO、媒体/CDN URL，或 OSS 私有桶的稳定解析地址（302 到限时签名 GET）。客户端不得替换其中的 host、key 编码或签名参数。

发布接口走内部密钥，不面向 App。线上 Nginx 只反代 `/api/`，因此本机 `pack:wgt --publish` 使用下面这组：

- `POST /api/v1/admin/app-releases/uploads` Body：`{ "platform", "packageType", "fileName" }`，返回 `uploadUrl`（PUT）、`objectKey`、`fileUrl`、`expiresIn`，可选扩展 `headers`（存储签名要求的请求头）、`storageProvider`（`minio|oss`）。PUT 字节上传必须携带这些 headers；OSS 失败不得回退 MinIO，也不得继续发布记录。
- `POST /api/v1/admin/app-releases` Body：`{ "platform", "channel", "versionName", "versionCode", "packageType", "objectKey", "changelog", "forceUpdate", "minNativeVersion?" }`
- `GET /api/v1/admin/app-releases?platform=&channel=&limit=`

内网仍保留 `POST/GET /internal/admin/app-releases*`。Header 均需 `X-Internal-API-Key`。日常用前端 `npm run pack:wgt -- --build --publish --min-native=100` 发布。详见仓库根目录 [plan.md](../../plan.md)。

OSS 接入阶段不运行上述发布命令；测试与生产发布数据库/API 必须隔离。发布时按 `objectKey` 命名空间查对应存储，HEAD 校验非空且不超过 200 MiB；保留旧包 download URL，不自动改成当前桶。

### GET `/api/v1/public/oss-media`

私有业务 OSS 桶的稳定读取入口。Query：`key`、`token`，均为服务端生成的媒体 URL 中的原值，无需 JWT。可选 `variant=list|preview|preview-mobile|avatar` 仅用于图片：`list` 固定输出 `360px`、`q=60` 的 WebP，`preview` 固定输出 `1280px`、`q=75` 的 WebP，`preview-mobile` 固定输出 `960px`、`q=72` 的 WebP，`avatar` 固定输出 `128px`、`q=70` 的 WebP；不传 `variant` 时读取原对象，视频、语音和文件忽略该参数。服务端只接受这四个固定值，禁止客户端透传任意 `x-oss-process`。该 token 是指定 bucket/key 的 HMAC capability，持有链接即可读，不代表会话成员权限校验。

成功返回 HTTP **302**，`Location` 为 10 分钟有效的 OSS 签名 GET（图片处理参数参与签名）；`Cache-Control: private, no-store`，`Referrer-Policy: no-referrer`。无效/缺失 token 或越界 key 返回 404，非法 variant 返回 400，解析服务未配置返回 503。这是裸 HTTP 响应，不使用统一 JSON envelope。媒体签名 key 必须稳定持久化，不能随部署随机变化；日志不得泄露完整 token。

增量机器契约及独立测试请求见 `openapi-oss.yaml`、`oss-storage.postman_collection.json`。

### POST `/api/v1/auth/sms/send`

发送短信验证码。`scene`: `register` | `login` | `reset`。

限流：同一手机号 1 分钟 1 条、号码每日 10 条；同 IP 默认每小时 60 条。  
「同 IP 多设备农场」默认**关闭**（`SMS_IP_MAX_FPS=0`），因运营商 CGNAT 下会误杀真实新用户；超限返回 `code=1`。

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

手机号 + 验证码 + 密码注册。密码必填，至少 6 位。登录支持密码或验证码；找回密码用验证码重置。

**Body**
```json
{
  "countryCode": "+86",
  "phone": "13900000001",
  "code": "123456",
  "password": "yourpassword",
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
    "publicId": "chat_ez1b8e1bc1dv12",
    "nickname": "用户0001",
    "avatar": "",
    "bio": "",
    "status": "active",
    "hasPassword": true
  }
}
```

`publicId` 由注册时分配：`chat_` 加 14 位随机小写字母和数字。已有的 `chat10001` 这类递增号保持不变。用户后来自己改的聊天号保留大小写（6–20 位、首位字母、其余字母或数字）；搜索和占用判断忽略大小写，`Abc` 与 `abc` 视为同一个号。

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

用 `refreshToken` 换取新的 `accessToken` + `refreshToken`（旧 refreshToken 立即失效）。账号被封禁或处于「禁止登录」时返回 401，不再签发新令牌。禁止登录同时作废该用户全部 refresh token，并拒绝其尚未过期的 access token 访问业务接口（401），客户端因此退出到登录页。

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
  "requireFriendApproval": true,
  "requireGroupApproval": true
}
```

- `requireFriendApproval`：加我为好友需验证。**默认 `true`**，关闭后对方加好友立即通过。
- `requireGroupApproval`：邀请我入群需验证。**默认 `true`**，关闭后被邀请直接入群。
- 新用户默认值读取管理后台已发布的 `system.limits.defaultRequireFriendApproval`、`defaultRequireGroupApproval`；缺字段时均为 `true`。草稿不生效，已有个人设置不会随普通发布改变。
- 升级迁移 `069_privacy_defaults.sql` 仅首次将存量用户两项设置开启并补齐缺行；之后重复迁移保留用户选择。后台发布可显式传 `applyPrivacyDefaultsToExisting: true`，在同一事务中批量同步现有用户。

### POST `/api/v1/me/privacy-settings`

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
    "publicId": "chat_yq9tb0wjevwb22",
    "nickname": "用户0003",
    "avatar": ""
  }
}
```

### GET `/api/v1/users/search?publicId=chat10002`

按公开 ID 搜索用户。**不支持手机号搜索。** 响应不含 `phone` 字段。

精确搜索成功后，服务端为当前账号与目标用户记录有效期 30 分钟的 `public_id` 添加授权；该授权不能用于其他账号或目标。

未找到返回 `data: null`。

### POST `/api/v1/users/qrcode/resolve`

解析个人二维码 token（扫码加好友）。

解析有效二维码后，服务端记录有效期 30 分钟的 `user_qrcode` 添加授权。无效、过期或撤销的二维码不会产生授权。

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

**Query**：`groupId`（可选，群号）。仅本人、好友、有有效搜索/扫码授权的调用者，或与目标同在有效群的群主/管理员可见完整 `publicId`；其余调用者返回脱敏值（如 `ch****01`）。省略 `groupId` 不会公开聊天号，无效群号与数据库校验失败不会放行。查询 UUID 资料本身不产生添加授权。

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

**说明**：带 `cursor` 翻页时服务端跳过 `COUNT(*)`，`total` 为 0；首页仍返回 `total`。

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

好友详情（含备注、标签、共同群组）。`friendSince` 是成为好友的时间，`lastSeenAt` 是对方最近上线时间（可能为空）。

**Response**
```json
{
  "id": "uuid",
  "publicId": "j8afsqh",
  "nickname": "bug001",
  "avatar": "https://...",
  "remark": "",
  "friendSince": "2026-10-14T03:29:00Z",
  "lastSeenAt": "2026-10-14T03:29:00Z",
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

`source=group` 时服务端校验双方均为有效群成员；群主/管理员始终可加，普通成员受该群 `allowMemberAddFriend` 约束。

`source=public_id|user_qrcode` 必须匹配当前账号、目标与来源的有效服务端授权。先调用精确聊天号搜索或个人二维码解析；授权有效期 30 分钟。旧客户端不传 `source` 时，服务端使用最近有效授权并记录真实来源，不再默认认定为搜索添加。仅有目标 UUID、伪造来源或授权过期返回 `403`，需重新搜索/扫码。

本接口与 `/api/v1/group-friend-requests` 共用账号级滑动窗口：每分钟 20 次、每 24 小时 100 次，超限返回 `429`。额度在创建申请前原子消费，后续写入失败仍计数；更换 IP 或来源不能重置配额。

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

创建群聊。新建群默认 `allowMemberAddFriend=false`（禁止群成员互加好友开关默认开启）。初始成员必须是群主的有效好友，包含群主至少选择 3 人。被邀请人开启「邀请我加入群聊需验证」时，先保存待确认邀请，不能直接加入业务群或 OpenIM 群；邀请卡通过可靠任务异步投递，失败自动重试。`memberCount` 只统计已实际加入的人，确认前可能只有群主。

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
  "allowMemberAddFriend": false,
  "conversationId": "uuid"
}
```

群同步到 OpenIM 后，系统向该群发送一条欢迎消息：`新群创建成功，一起来聊天吧`。

### GET `/api/v1/groups`

群列表（分页）。支持 `role=owner|member|admin` 筛选。

**Query**：`cursor`（上一页最后一条群 public_id）、`limit`（默认 100，最大 200）

**Response `data`**
```json
{
  "items": [{ "id": "100001", "name": "群名", "avatar": "", "role": "owner", "conversationId": "sg_xxx", "status": "active" }],
  "nextCursor": "100001",
  "hasMore": false
}
```

### GET `/api/v1/groups/:id`

群详情（需为群成员）。

群相关对外接口中的 `:id` / `groupId` 为业务群号：新建群为 `qun_` + 14 位随机小写字母数字（例如 `qun_ez1b8e1bc1dv12`）；历史纯数字群号已在迁移中批量换成同形态。服务端映射为内部 UUID；OpenIM 仍用 UUID 去连字符。

群详情响应额外含 `publicIdChangeUsed`（群主是否已用掉「改群号一次」）。

响应包含 `myRole`、`myNickname`、`joinMode`、`allMuted` 以及 `permissions`，前端据此展示群资料编辑、二维码、成员管理和举报入口。

### POST `/api/v1/groups/public-id/update`

群主修改群号，每个群只能改一次（系统分配的随机号不算已改过）。需 JWT。

**Body** `{ "groupId": "qun_旧号", "publicId": "qun_新号" }`

`publicId` 规则：必须以 `qun_` 开头，后接 6–20 位字母或数字；占用与查找忽略大小写。

**Response `data`**：更新后的群详情（`id` 为新群号，`publicIdChangeUsed=true`）。

### GET `/api/v1/group-members`

群成员列表（分页）。Query：`groupId`（必填）、`cursor`、`limit`（默认 100，最大 200）。

列表按角色排序：群主 → 管理员 → 普通成员，同角色再按用户 ID。每条带 `joinedAt`（入群时间）。  
`nextCursor` 格式为 `{roleRank}:{userId}`（`0=owner` / `1=admin` / `2=member`），与排序键一致；旧客户端只传 `userId` 时服务端按 member 档兜底。

**Response `data`**
```json
{
  "items": [{ "id": "uuid", "nickname": "成员", "role": "member", "joinedAt": "2026-10-14T03:29:00Z" }],
  "nextCursor": "2:uuid",
  "hasMore": false
}
```

### GET `/api/v1/groups/:id/members`

（旧路径，仍可用）群成员全量列表；新客户端请用 `/group-members` 分页接口。

### GET `/api/v1/groups/:id/qrcode`

所有有效群成员获取群二维码字符串。前端使用响应 `payload` 生成二维码图片。

### POST `/api/v1/groups/qrcode/resolve`

只读解析群二维码，返回 `joined`、`joinMode` 和 `nextAction=enter|join|apply`。

- 已在群中：`nextAction=enter`
- 公开群（`joinMode=open`）且未入群：`nextAction=join`，确认后直接入群
- 私密群（`joinMode=approval`）且未入群：`nextAction=apply`，确认后只提交入群申请，不能直接进群

**Body** `{ "token": "..." }`

### POST `/api/v1/groups/qrcode/join`

用户确认后按二维码加入群：

- 已是成员：返回 `enter`，并补齐 OpenIM 成员同步（自愈业务库有人、IM 未入群的历史脏数据）
- 公开群未入群：直接写入成员并返回 `joined`（以群主邀请方式同步 OpenIM）
- 私密群未入群：写入入群申请并返回 `pending_approval`，管理员同意前不是群成员。`remark` 为空时记为「扫码申请入群」

**Body** `{ "token": "...", "remark": "可选，仅私密群申请时使用" }`，也支持传完整 `payload`。

### POST `/api/v1/groups/:id/join`

直接加入公开群。审核群返回 HTTP 409，必须提交入群申请。

### POST `/api/v1/groups/:id/invitations`

群主/管理员邀请好友入群。

- 被邀请人**未**开启「邀请我加入群聊需验证」：直接写入群成员并同步 OpenIM。
- 被邀请人**已**开启验证：不拉进群，同一事务写入 `group_invitations` 和邀请卡发送任务，提交后异步下发入群邀请卡片（CustomMessage，`businessKey=group_invite`），发送失败自动重试。`pendingCount` 表示待确认邀请数。已在群中或非好友会被跳过。未保存个人设置时采用后台已发布默认值，缺配置时默认需要确认。

**Body** `{ "userIds": ["uuid"] }`

**Response `data`**
```json
{ "ok": true, "invitedCount": 1, "pendingCount": 2 }
```

- `invitedCount`：本次直接拉进群的人数
- `pendingCount`：因对方开启验证而发送邀请卡片的人数

### POST `/api/v1/group-invitations/:token/accept`

被邀请人点击卡片「申请入群」：

- 公开群（`joinMode=open`）：直接入群，`nextAction=joined`
- 审核群（`joinMode=approval`）：提交入群申请，`nextAction=pending_approval`
- 已在群中：`nextAction=already_member`
- 同一张邀请卡只能成功使用一次。再次点击，包括被移出群之后，返回 400，`message` 为「邀请已失效」。邀请没有过期时间。群主或管理员重新邀请会生成新卡。

**Response `data`**
```json
{ "nextAction": "joined", "group": { "...": "GroupInfo" } }
```

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

### POST `/api/v1/group-members/purge-messages`

为所有人删除某成员在群内的全部历史消息，**目标已退群也可操作**（炸群后退出的场景）。
权限：群主/管理员；不能操作自己和群主，管理员不能操作其他管理员；已退群的目标按普通成员处理。

**Body** `{ "groupId": "qun_xxx", "memberUserId": "<业务用户 UUID>" }`

**Response** `data: { "userId": "...", "purgedAt": "2026-10-18T08:00:00Z" }`

- 写入 `group_message_purges` 水位（与「移除并删除其消息」同一张表），重复调用把水位推到当前时间；客户端经 `GET /groups/:id/message-purges` 拉取后隐藏该成员在 `purgedAt` 之前的消息。
- 成功后 imAdmin 向群内发一条文本 `群主|管理员清除了「昵称」的全部消息`，客户端识别为系统提示并重新拉取水位；发送失败只记日志，不影响结果。
- 错误：`403 无权限`；`404 用户不存在`；`400 参数错误 / 操作失败`。

### PUT `/api/v1/groups/:id/settings`

群主/管理员修改群设置。

**Body**
```json
{
  "name": "新群名称",
  "avatarFileId": "已完成上传的本人图片 fileId",
  "announcement": "公告",
  "announcementImageFileIds": ["新上传的 purpose=image 文件 UUID"],
  "keepAnnouncementImages": ["继续保留的已有公告图片 URL"],
  "allowMemberAddFriend": false,
  "joinMode": "open|approval",
  "allMuted": false
}
```

群名称、头像和公告仅群主/管理员可修改。`avatarFileId` 必须属于操作者本人，且文件为 `ready + purpose=avatar + image/*`。

更新公告时（`announcement` 有传）：
- 配图最多 **9** 张；先走 `POST /files/uploads`（`purpose=image`）再 complete。
- `announcementImageFileIds`：本次新上传的 fileId。
- `keepAnnouncementImages`：继续保留的已有图片 URL（必须是当前群公告里已有的 URL，防盗链他人资源）。
- 两者都可省略或为空数组；省略 fileIds / keep 表示清空配图（仍以本次提交合并结果为准）。
- 群详情返回 `announcementImages: string[]`。

正式写接口为 `POST /api/v1/groups/settings/update`（`groupId` 在 Body）。群资料上的 `announcement` 是最新一条，供聊天顶栏使用。

公告列表本身最多 **10** 条，各自独立，可改、可删。相同正文和配图不会再插一条。

### GET `/api/v1/group-announcements?groupId=100001`

返回当前群公告（最多 10 条，新在前）。仅群成员可查。

**Response** `{ "items": [{ "id", "content", "images", "publisherId", "publisherName", "createdAt" }] }`

### POST `/api/v1/group-announcements/create`

群主/管理员新增一条。已有 10 条时拒绝。配图只接受本次新上传的 fileId。

**Body** `{ "groupId": "100001", "content": "公告", "announcementImageFileIds": [] }`

### POST `/api/v1/group-announcements/update`

按 id 改某一条，不新增记录。`keepAnnouncementImages` 必须是这一条里已有的图片 URL。

**Body** `{ "groupId": "100001", "announcementId": "uuid", "content": "公告", "announcementImageFileIds": [], "keepAnnouncementImages": [] }`

### POST `/api/v1/group-announcements/delete`

**Body** `{ "groupId": "100001", "announcementId": "uuid" }`

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

默认 OSS，也可显式设置 `STORAGE_PROVIDER=minio` 保留旧存储；路由与响应字段不变。客户端须原样发送所有 formData（可能是 `x-amz-*` 或 `x-oss-*`），**file 字段最后**，不要手工设置 multipart boundary，不向存储域名携带业务 JWT / 内部密钥。OSS 签名主机/编码/query 禁止改写。原生 App 使用 `uni.uploadFile`，不依赖 H5 fetch/File；均接受存储返回的 2xx。

OSS 模式要求 `size` 为 1～20 MiB（含边界，单位 byte）；签名有效期 900 秒，policy 精确绑定实际 key 和桶、禁止覆盖。文件任务保存 provider/bucket；旧记录和旧 MinIO 客户端协议不变。

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

按该任务创建时保存的 provider/bucket 查询对象，不随全局存储开关变化。OSS 须真实存在、非空、不超过 20 MiB 且大小与创建时声明一致；缺对象/大小不符返回 400，存储无权限/故障返回 503，不标记 ready。MinIO 保留旧客户端的 size 声明兼容性。

**Body**
```json
{ "fileId": "uuid", "etag": "optional" }
```

**Response**：`FileInfo`（含 `url`、`status` 等）。

### GET `/api/v1/files?fileId=uuid`

查询文件信息。

### POST `/api/v1/files/presign`（旧版 / 兼容）

获取当前存储（默认 OSS，可显式选择 MinIO）预签名 multipart POST 表单；显式选择 MinIO 且无存储的本地开发模式仍保留 dev 占位 URL，OSS 配置缺失时启动失败，不伪装成功。

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

把业务群号（`qun_xxx` 或遗留数字）、内部 UUID 或 OpenIM 群 ID 解析为稳定的 OpenIM groupID，响应里的 `businessGroupId` 始终是业务群号。校验群状态、成员资格、单人禁言及全员禁言。若 OpenIM 尚无该群（历史数据未同步），会按业务库补创建并把当前用户邀请进群后再返回；全量成员对账仍由 Outbox 负责。

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

### POST `/api/v1/forward-media/preserve`

客户端直接用 SDK 转发或引用回复前，为涉及的媒体生成独立副本。本接口只复制并返回快照，不发送消息。登录用户是副本所有者；只接收 JSON 请求体，禁止 query 参数、未知请求字段、客户端指定所有者或归档标志。

```json
{
  "sourceSnapshot": {
    "contentType": 102,
    "content": {"sourcePicture": {"url": "https://chat.example.com/app/chat/image.jpg", "type": "image/jpeg"}}
  }
}
```

成功响应 `data` 为同样的 `{contentType,content}` 结构，媒体 URL 改为 `forwards/<ownerId>/...` 的独立副本稳定地址。按用户和规范化快照去重；不跨用户共享快照。图片/语音/视频/文件、@/引用/合并消息内嵌媒体均处理，兼容 App PascalCase 与 H5 camelCase、字符串内嵌 JSON。普通文字里的 URL/JSON 仍是文字，不下载。

每条内嵌媒体都须有远程原文件，不能用旁边的缩略图或另一条文件的地址替代；视频还须有远程封面。快照及重写结果最多 64 KiB、最多 64 个媒体 URL，累计文件 512 MiB。应用地址范围、重定向、公网下载限制与收藏相同；不验证 OpenIM 源消息存在或群成员身份，源下载不附加 JWT/Cookie。

无登录凭证返回 401；参数不合法、仅本地文件、快照超限返回 400；源不存在、范围/权限/超时/复制或持久化失败返回 503（不输出源链接和凭据）。失败时客户端必须停止本次转发或引用发送，允许重试；不得回退使用源地址。普通文字不依赖复制服务。

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

媒体及引用快照在创建、提交和旧任务投递前进行独立复制；成功后冻结为副本快照。创建返回 503 时可能已存在未提交的草稿，使用同一幂等键重试即可；不会投递未保存副本的媒体。既有任务中尚未发送的目标由 worker 补偿保护，已发送的历史消息不会因此改写。批量接口复用同样流程；复制失败时可能已创建前面的草稿或提交前面的任务，请保留相同批量幂等键重试。

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

媒体类型 `image / video / voice / file` 会先复制到当前业务存储的 `favorites/<userId>/...` 独立目录，成功后才提交收藏记录；返回的 `content` 使用独立副本的稳定地址。兼容 H5 camelCase、App PascalCase 以及字符串嵌套 JSON，保留原有内容结构。文字和表情不依赖媒体存储。

源文件必须属于配置的应用媒体地址范围；每次重定向也检查范围，源 URL 的有效签名会保留。源文件失效、权限不足、复制超时或文件过大时返回失败，不写入新的成功记录；已有收藏保持原快照。同一用户同一消息的重试使用数据库中已保存的快照，不覆盖为请求中的新内容。

输入及重写后的快照最多 64 KiB；一次收藏最多复制 64 个媒体地址，累计媒体字节上限 512 MiB，单次归档处理最长 45 秒。收藏保存失败可重试，不代表源聊天消息发送失败。旧收藏不会在列表查询时自动搬迁，使用专用补偿工具或再次收藏同一消息进行复制。

本接口接收客户端快照，当前没有通过 OpenIM 验证源消息存在或会话成员身份；媒体下载凭源 URL 本身的访问能力和配置范围，不附加用户登录凭据。`senderId / conversationId` 是快照元数据，不作为读取源文件的授权依据。

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

## 我的表情

用户自定义表情图。先走文件上传（`purpose=sticker` 或 `image`），完成后用 `fileId` 登记；同一用户同一 `fileId` 幂等。单用户上限 200 张。

### GET `/api/v1/stickers`

**Query**：`page`（默认 1）、`size`（默认 100，最大 100）

**Response**
```json
[
  {
    "id": "uuid",
    "fileId": "uuid",
    "url": "https://...",
    "createdAt": "2026-08-24T12:00:00Z"
  }
]
```

按 `createdAt` 倒序。

### POST `/api/v1/stickers`

**Body**
```json
{ "fileId": "uuid" }
```

`fileId` 须为当前用户已 `ready` 的图片（`purpose` 为 `sticker` 或 `image`）。成功返回表情对象。

### POST `/api/v1/stickers/delete`

批量删除本人表情（编辑多选）。

**Body**
```json
{ "stickerIds": ["uuid", "uuid"] }
```

成功返回 `{ "ok": true }`；均不存在返回 404。

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
