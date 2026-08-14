# OpenIM 后端注册登录对接与验收记录

## 1. 对接结论

业务用户只注册一次，注册入口保持不变：

```text
POST /api/v1/auth/register
```

Go 后端在创建 PostgreSQL 用户的同一事务中写入 `user.registered` Outbox。后台 Worker 自动将该用户同步到 OpenIM，不需要调用方再注册 OpenIM 账号。

业务登录入口保持不变：

```text
POST /api/v1/auth/login
```

需要取得聊天连接凭证时，继续使用原接口：

```text
POST /api/v1/im/token
```

本次没有新增注册或登录必调接口，也没有保留 `/im/session`、`/im/status` 等重复对外路由。

## 2. 注册链路

```text
/auth/register
  → 校验手机号、验证码和密码
  → PostgreSQL 事务创建 users
  → 同一事务写入 user.registered Outbox
  → 提交事务并返回原业务 AuthResult
  → 后台 Worker 幂等查询 OpenIM 用户
  → 不存在则调用 /user/user_register
  → 已存在则同步昵称和头像
  → Outbox 标记 completed
```

OpenIM 暂时不可用时，PostgreSQL 注册仍然成功；Outbox 会自动重试。调用 `/im/token` 时还会执行一次幂等 `EnsureUser`，避免同步延迟阻塞聊天。

## 3. 用户 ID 映射

PostgreSQL 用户主键保持 UUID，OpenIM 不接受包含连字符的该类 userID，因此采用固定映射：

```text
业务 UUID：78037b3a-ec80-46fd-b141-3154f0feabb3
OpenIM ID：78037b3aec8046fdb1413154f0feabb3
```

规则是删除 UUID 中的四个 `-`，得到 32 位小写 OpenIM ID。映射是确定性的，不需要另建账号映射表。

## 4. 同步字段

只同步以下内容：

- OpenIM 用户 ID
- 昵称
- 头像 URL（业务侧为空时写入默认头像，避免 OpenIM 客户端生成文字头像）

不得同步：

- 手机号
- 密码或密码哈希
- 短信验证码
- 业务 JWT 或 Refresh Token
- OpenIM Secret

## 5. 原 `/im/token` 契约

请求：

```http
POST /api/v1/im/token
Authorization: Bearer <业务 accessToken>
Content-Type: application/json

{"platformId":5}
```

响应 `data`：

```json
{
  "token": "<OpenIM用户Token>",
  "expireSec": 7776000,
  "platform": 5,
  "userId": "78037b3aec8046fdb1413154f0feabb3",
  "apiAddr": "http://8.210.72.157:10002",
  "wsAddr": "ws://8.210.72.157:10001"
}
```

兼容规则：

- 保留原路径 `/api/v1/im/token`。
- 保留原字段 `token`、`expireSec`、`platform`、`userId`。
- 请求体为空、`platformId` 省略或为 `0` 时沿用原默认值 `5`。
- `apiAddr` 和 `wsAddr` 只是扩展字段，不影响旧调用方解析。
- OpenIM 未配置时返回明确错误，不再生成无法使用的假 Token。

## 6. 数据库对象

迁移文件：

```text
migrations/007_openim_sync_outbox.sql
```

核心表：

```text
users
auth_sessions
im_sync_outbox
```

注册同步事件：

```text
event_type = user.registered
pending → processing → completed
```

Worker 使用 `FOR UPDATE SKIP LOCKED` 领取任务，支持多实例、失败重试、指数退避和处理超时回收。

## 7. 2026-08-13 实机验收

环境：

```text
PostgreSQL 18：127.0.0.1:5432 / im_app
Go 临时验收端口：127.0.0.1:18080
OpenIM API：8.210.72.157:10002
OpenIM WS：8.210.72.157:10001
```

严格顺序验收结果：

1. 使用新手机号调用原 `/auth/register`，返回 `code=0`。
2. 在没有调用登录和 `/im/token` 前查询 Outbox，`user.registered` 已为 `completed`。
3. 调用原 `/auth/login`，返回 `code=0`。
4. 调用原 `/im/token`，返回 `code=0` 和非空 OpenIM 用户 Token。
5. 响应包含全部原字段：`token`、`expireSec`、`platform`、`userId`。
6. OpenIM ID 等于业务 UUID 删除连字符后的值。
7. 公开 API/WS 地址分别正确返回 `10002` 和 `10001`。
8. `go test ./...` 全部通过。
9. 临时 Go 验收服务已停止。

结论：原注册、原登录和原 `/im/token` 链路已经打通，OpenIM 用户注册由 Go 后端自动完成。

## 8. 2026-08-13 精简后复检

删除本阶段之外的 Webhook、关系同步、群同步、强制下线和历史同步命令后，重新完成以下检查：

1. `go test ./...` 通过。
2. `go vet ./...` 通过。
3. `git diff --check` 通过。
4. 本机 `im_sync_outbox` 表存在。
5. 两条 `user.registered` 均为 `completed`，`attempt_count=1`、`last_error` 为空。
6. 使用已同步测试用户调用原 `/auth/login`，返回 `code=0` 和业务 Access Token。
7. 随后调用原 `/im/token`，返回 `code=0`、真实非空 OpenIM Token、`platform=5`、`expireSec=7776000`、API `10002` 和 WS `10001`。
8. 本次复检没有创建新账号，临时 Go 服务已停止。

项目当前迁移器直接按文件顺序执行幂等 SQL，没有 `schema_migrations` 版本记录表；迁移验收应直接检查目标表、索引和数据状态，不能以查询 `schema_migrations` 为准。

本机库里还有一条早期测试产生的 `user.profile_updated/completed` 历史事件。当前精简代码只定义并产生 `user.registered`，该历史行不代表当前仍包含资料同步功能。
