# OpenIM 对话后端接口与 WebSocket 开发规划

## 1. 文档目标

本规划只覆盖 Go 后端接口、OpenIM 服务端对接、WebSocket 边界、PostgreSQL 与 MongoDB 的数据职责以及后端验收，不包含任何前端页面、Vue、uni-app 或客户端 SDK 代码开发。

当前第一阶段已经完成：业务用户沿用原注册、登录接口，由 Go 后端自动同步到 OpenIM；登录后沿用原 `/api/v1/im/token` 获取 OpenIM 连接凭证。

接下来的目标是把单聊、群聊、消息历史、未读数、已读回执、离线消息和实时推送统一交给 OpenIM，避免继续维护一套 PostgreSQL 消息系统和一套 Go WebSocket 消息系统。

## 2. 已完成基线

| 能力 | 状态 | 说明 |
|---|---|---|
| 原业务注册 | 已完成 | `POST /api/v1/auth/register`，没有新增第二个注册接口 |
| 注册自动同步 OpenIM | 已完成 | 注册事务写入 `user.registered` Outbox，Worker 自动重试并幂等同步 |
| 原业务登录 | 已完成 | `POST /api/v1/auth/login`，返回原业务 JWT |
| OpenIM 用户凭证 | 已完成 | `POST /api/v1/im/token`，返回 `userId/token/platform/expireSec/apiAddr/wsAddr` |
| 本机 PostgreSQL 验收 | 已完成 | 两条 `user.registered` 事件均为 `completed`，各执行一次、无错误 |
| Go 自动化检查 | 已完成 | `go test ./...`、`go vet ./...` 通过 |

详细证据见 [OpenIM 后端注册登录对接与验收记录](./OpenIM后端注册登录对接与验收记录.md)。

## 3. 最终架构结论

```text
业务注册/登录
    │
    ▼
Go 业务后端 ── PostgreSQL
    │             ├─ users / contacts / groups
    │             └─ im_sync_outbox / 业务审计
    │
    ├─ POST /api/v1/im/token
    │      返回 OpenIM userId、token、apiAddr、wsAddr
    │
    └─ OpenIM 管理 REST / Webhook
                  │
                  ▼
             OpenIM Server
                  ├─ :10002 管理 API
                  ├─ :10001 消息 WebSocket
                  └─ MongoDB 保存 OpenIM 消息数据
```

唯一实时消息链路是 OpenIM 的消息网关。Go 后端不代理 OpenIM WebSocket，也不再通过自己的 `/ws` 广播聊天正文。

### 3.1 WebSocket 边界

- `ws://8.210.72.157:10001` 是当前 OpenIM 消息网关地址。
- `POST /api/v1/im/token` 返回这个地址及与 `platformId` 对应的用户 Token。
- OpenIM SDK 使用 `userId + token + platformId + apiAddr + wsAddr` 建立连接。
- 心跳、断线重连、离线补偿、消息顺序、已读回执和新消息事件由 OpenIM SDK/Server 负责。
- Go 当前的 `GET /ws?token=<业务JWT>` 只能视为旧的临时聊天通道，OpenIM 切换完成后应停止承载 `chat.message`。
- 生产环境必须把 HTTP/WS 升级为 HTTPS/WSS，并通过域名反向代理，不应长期暴露明文 `ws://IP:10001`。

### 3.2 数据库边界

| 数据 | 权威存储 | Go 是否直接读写 |
|---|---|---|
| 账号、手机号、业务身份 | PostgreSQL | 是 |
| 好友申请、黑名单、业务联系人关系 | PostgreSQL | 是 |
| 群业务资料、成员角色、审批规则 | PostgreSQL | 是 |
| OpenIM 同步任务、失败重试 | PostgreSQL `im_sync_outbox` | 是 |
| 消息正文、消息序号、撤回状态 | OpenIM/MongoDB | 否，必须通过 OpenIM API/SDK |
| OpenIM 会话、未读、已读和离线同步状态 | OpenIM | 不直接操作 MongoDB |
| 客户端本地消息缓存 | OpenIM SDK 本地数据库 | 否 |

Go 项目不增加 MongoDB 驱动，不手工创建或修改 OpenIM MongoDB collection。MongoDB 已随服务器 OpenIM Docker 部署，由 OpenIM 自己初始化、升级和维护。业务代码直接访问 OpenIM MongoDB 会绕过权限、序号和同步规则，禁止这样实现。

## 4. 对外接口规划

### 4.1 P0：聊天连接凭证（已完成）

#### `POST /api/v1/im/token`

鉴权：业务 JWT。

请求：

```json
{
  "platformId": 5
}
```

响应 `data`：

```json
{
  "userId": "78037b3aec8046fdb1413154f0feabb3",
  "token": "<OpenIM user token>",
  "platform": 5,
  "expireSec": 7776000,
  "apiAddr": "http://8.210.72.157:10002",
  "wsAddr": "ws://8.210.72.157:10001"
}
```

后端要求：

- 只允许当前 JWT 用户获取自己的 OpenIM Token。
- `platformId` 必须是 OpenIM 支持的平台编号；省略或为 `0` 时兼容旧逻辑，默认 Web `5`。
- 签发前幂等确认 OpenIM 用户存在，解决 Outbox 尚未执行完成的短暂窗口。
- OpenIM Secret 和管理员 Token 永远不能返回给调用方。

### 4.2 P0：单聊对象解析与权限预检

#### `GET /api/v1/im/peers/:businessUserId`

用途：把 PostgreSQL 业务用户 ID 解析为 OpenIM 用户 ID，并在进入单聊前统一校验账号状态、黑名单和联系人策略。

响应 `data`：

```json
{
  "businessUserId": "78037b3a-ec80-46fd-b141-3154f0feabb3",
  "imUserId": "78037b3aec8046fdb1413154f0feabb3",
  "nickname": "用户0014",
  "avatar": "https://example.com/avatar.png",
  "canChat": true,
  "denyReason": ""
}
```

规则：

- 不返回手机号、密码、JWT、OpenIM Secret 等敏感信息。
- 本人、禁用账号、互相拉黑或产品规则禁止陌生人消息时返回 `canChat=false`。
- 这个接口不创建 PostgreSQL `conversations` 记录，不写消息表。

### 4.3 P0：群聊对象解析与权限预检

#### `GET /api/v1/im/groups/:businessGroupId`

响应 `data`：

```json
{
  "businessGroupId": "c9bd5c82-b523-49c7-9aab-e25674cf8434",
  "imGroupId": "c9bd5c82b52349c79aabe25674cf8434",
  "name": "产品讨论群",
  "avatar": "https://example.com/group.png",
  "role": "member",
  "canChat": true,
  "mutedUntil": null
}
```

规则：

- 只有 PostgreSQL 中的有效群成员可以解析并进入群聊。
- 群已解散、成员已退出、成员被禁言或全员禁言时必须给出明确状态。
- 群创建、成员加入/退出、角色和资料变化通过 Outbox 同步 OpenIM，接口本身不直接写 OpenIM MongoDB。

### 4.4 P1：服务端系统消息

#### `POST /internal/im/messages`

用途：业务系统发送欢迎消息、审核结果、系统通知等，不作为普通用户聊天发送接口。

鉴权：仅服务间密钥或内网 mTLS，不能使用普通用户 JWT。

请求：

```json
{
  "idempotencyKey": "group-approved:request-id",
  "receiverType": "user",
  "receiverBusinessId": "78037b3a-ec80-46fd-b141-3154f0feabb3",
  "messageType": "custom",
  "key": "group_join_approved",
  "data": {"requestId": "业务请求UUID"},
  "guaranteed": true
}
```

后端通过 OpenIM 管理 REST `/msg/send_msg` 或业务通知 API 发送，并保存幂等键及审计记录；不得允许调用方指定任意 `sendID` 冒充其他用户。

### 4.5 P1：后端运维状态

#### `GET /internal/im/health`

用途：供部署探针和运维检查，不对普通客户端开放。

响应只给状态，不返回 Secret/Token：

```json
{
  "configured": true,
  "apiReachable": true,
  "adminTokenAvailable": true,
  "outboxPending": 0,
  "outboxDead": 0
}
```

## 5. OpenIM Webhook 规划

Webhook 是 OpenIM Server 主动调用 Go 后端，不是客户端接口。第一版只接入确实需要业务权限判断的回调。

| 回调 | 用途 | Go 处理 |
|---|---|---|
| 单聊发送前 | 黑名单、账号状态、陌生人策略、内容风控 | 查询 PostgreSQL，允许或拒绝 |
| 群聊发送前 | 群状态、成员资格、禁言状态 | 查询 PostgreSQL，允许或拒绝 |
| 单聊/群聊发送后 | 审计、举报索引、指标 | 异步记录元数据，不能复制消息正文作为第二消息库 |
| 消息撤回后 | 审计和业务通知 | 记录 `conversationID/seq/operator` 元数据 |

安全要求：

- Webhook 只允许 OpenIM 服务器内网来源访问。
- URL 使用不可猜测路径或网关签名，配合安全组白名单；不能只依赖一个明文路径参数。
- 严格限制请求体大小、超时和并发。
- “发送前”回调必须在 OpenIM 超时之前快速返回，慢任务放入队列。
- 回调幂等键使用 `callbackCommand + serverMsgID/clientMsgID + seq`。

## 6. 不再由 Go 重复提供的聊天接口

以下普通用户能力应由 OpenIM SDK 完成，不应继续把消息写入 PostgreSQL：

| 现有/拟议能力 | 最终执行方 |
|---|---|
| 会话列表、分页 | OpenIM SDK `getConversationListSplit` / `getAllConversationList` |
| 单个会话详情 | OpenIM SDK `getOneConversation` |
| 总未读数 | OpenIM SDK `getTotalUnreadMsgCount` |
| 历史消息 | OpenIM SDK `getAdvancedHistoryMessageList` |
| 发送文本、图片、语音、视频、文件 | OpenIM SDK 创建消息后 `sendMessage` |
| 实时收消息 | OpenIM WS 事件 `OnRecvNewMessages` |
| 标记已读和单聊已读回执 | OpenIM SDK `markConversationMessageAsRead` |
| 消息撤回 | OpenIM SDK `revokeMessage`；管理操作才走 Go 后端 |
| 置顶、免打扰、隐藏会话 | OpenIM SDK 会话接口 |
| 断线重连和离线补偿 | OpenIM SDK |

因此下面这些当前 Go 路由是旧临时实现，切换时不得继续作为消息主链：

```text
GET  /ws?token=<business-jwt>
GET  /api/v1/conversations
POST /api/v1/conversations/read-all
GET  /api/v1/conversations/:id/messages
POST /api/v1/conversations/:id/messages
```

后端切换策略：先停止新功能扩展，再增加运行开关，验收 OpenIM 后关闭旧写入；旧 PostgreSQL `messages/conversations` 数据保留只读，确认不需迁移后再单独制定归档任务。本规划不直接删除旧表和历史数据。

## 7. OpenIM 同步事件规划

注册同步已完成。后续事件仍使用 PostgreSQL Outbox，保证业务事务与同步任务一起提交。

| 优先级 | 事件 | OpenIM 动作 |
|---|---|---|
| 已完成 | `user.registered` | 注册/确认 OpenIM 用户 |
| P0 | `user.profile_updated` | 同步昵称和头像 |
| P0 | `friend.accepted` | 导入双向好友关系 |
| P0 | `friend.deleted` | 删除双向好友关系 |
| P0 | `block.added` / `block.removed` | 同步黑名单 |
| P0 | `group.created` | 创建 OpenIM 群并映射业务群 ID |
| P0 | `group.updated` | 同步群名、头像、公告和设置 |
| P0 | `group.member.joined/left` | 邀请/移除群成员 |
| P1 | `group.member.role_changed` | 同步群主和管理员角色 |
| P1 | `user.disabled` | 禁止新 Token、强制下线 |

所有事件必须幂等、可重试，并进入 `dead` 状态后可被运维查询和人工重放。

## 8. 后端实施顺序

### 阶段 A：连接基线（已完成）

- [x] 原注册事务写入 `user.registered` Outbox。
- [x] OpenIM 管理 Token 缓存与自动刷新。
- [x] 幂等注册/更新 OpenIM 用户。
- [x] 原 `/im/token` 返回真实用户 Token 和 WS/API 地址。
- [x] 单元测试、编译、静态检查和本机数据库验收。

### 阶段 B：聊天对象和权限接口

- [x] 实现 `GET /api/v1/im/peers/:businessUserId`。
- [x] 实现 `GET /api/v1/im/groups/:businessGroupId`。
- [x] 统一业务 UUID 到 OpenIM ID 的映射组件。
- [x] 给接口增加黑名单、账号状态、群成员和禁言校验。
- [x] 补充 client、Webhook 鉴权与内部接口鉴权测试。

### 阶段 C：关系和群同步

- [x] 扩展 Outbox 事件类型，并只在对应业务事务中写事件。
- [x] 同步资料、好友、黑名单、群、群成员、角色和禁言。
- [x] 增加指数退避、死信查询、人工重放和健康状态。
- [x] 用两个业务用户完成单聊权限，并将一个现有群同步到真实 OpenIM。

### 阶段 D：Webhook 与系统消息

- [x] 实现发送前权限回调；OpenIM 服务器开关按独立部署文档启用。
- [x] 实现发送后/撤回后审计回调。
- [x] 实现受保护且幂等的 `/internal/im/messages`。
- [x] 实现 `/internal/im/health`、对账、死信查询和重放。

### 阶段 E：旧消息链路退役

- [x] 增加 `LEGACY_CHAT_ENABLED` 开关，默认关闭。
- [x] 默认不注册旧 REST 消息和转发接口，停止写 PostgreSQL `messages`。
- [x] 默认不创建旧 WS Hub，不注册旧 `/ws`。
- [x] 旧消息表保留供回滚/归档，本任务不删历史数据。
- [x] 更新 API 契约，明确普通消息能力由 OpenIM SDK/WS 提供。

## 9. 后端验收标准

### 9.1 注册登录与连接

1. 新用户只调用原 `/auth/register`，Outbox 最终为 `completed`。
2. 原 `/auth/login` 成功后调用 `/im/token`，取得非空真实 Token。
3. 返回的 `platform` 与签发 Token 使用的平台完全一致。
4. 使用返回值连接 OpenIM WS，收到连接成功事件。
5. OpenIM 不可用时注册仍成功，Outbox 自动重试；`/im/token` 返回明确的 503/502，而不是假 Token。

### 9.2 单聊

1. 两个正常账号解析为不同、稳定的 OpenIM ID。
2. 允许聊天时消息只在 OpenIM/MongoDB 产生，不新增 PostgreSQL `messages` 行。
3. 对方在线实时收到；离线后重新连接可补齐。
4. 已读、撤回、未读数和历史翻页一致。
5. 拉黑或账号禁用后，发送前回调拒绝消息。

### 9.3 群聊

1. 业务群创建成功后 OpenIM 群存在且 ID 映射稳定。
2. 入群/退群、角色、禁言和解散状态最终一致。
3. 非成员、已退群成员或被禁言成员不能发送。
4. 群消息不写 PostgreSQL 正文，不出现 Go WS/OpenIM WS 双重推送。

### 9.4 安全与稳定性

1. OpenIM Secret、Admin Token 不出现在任何对外响应和日志。
2. 所有用户接口使用业务 JWT，所有内部接口使用独立服务鉴权。
3. Webhook 有来源限制、超时、大小限制和幂等处理。
4. `go test ./...`、`go vet ./...`、并发测试和越权测试通过。
5. OpenIM API/WS、MongoDB、Redis、Kafka 任一依赖异常时有可观察错误和恢复路径。

## 10. 代码落点规划

```text
cmd/server/main.go                    # 注册必要路由和 Worker
internal/handler/im.go                # 对外 IM Token/对象解析接口
internal/handler/im_internal.go       # 内部消息、健康、对账和死信接口
internal/handler/openim_webhook.go    # OpenIM 权限与审计 Webhook
internal/im/client.go                 # OpenIM 管理 REST 客户端
internal/repository/im_access.go      # 权限解析、审计和系统消息幂等
internal/repository/im_sync.go        # Outbox 领取、完成、失败和重放
internal/service/im.go                # Token、用户/群解析和权限校验
internal/service/im_admin.go          # 内部系统消息和运维能力
internal/service/im_sync.go           # 用户、关系和群同步 Worker
migrations/007_openim_sync_outbox.sql # 当前 Outbox 表
migrations/008_openim_chat_backend.sql# 群状态、禁言和 IM 审计表
docs/api-contract.md                  # 最终对外 REST 契约
```

不在 Go 项目里新增 `mongo` repository，不在 `internal/ws` 扩展聊天协议。

## 11. 官方能力依据

- [OpenIM REST API 权限说明](https://docs.openim.io/restapi/apis/introduction)：管理 REST 需要管理员 Token，只应由服务端调用，客户端使用 SDK。
- [OpenIM 登录与 WS 参数](https://docs.openim.io/sdks/api/initialization/login)：用户 Token 由业务后端鉴权后取得，并使用 `apiAddr/wsAddr` 登录。
- [OpenIM uni-app 接入说明](https://docs.openim.io/sdks/quickstart/uniapp)：OpenIM Server/SDK 3.8.2 以上支持 uni-app 多端方案。
- [OpenIM 会话能力](https://docs.openim.io/sdks/api/conversation)：会话列表、未读、已读、置顶、免打扰等由 SDK 提供。
- [OpenIM 消息历史](https://docs.openim.io/sdks/api/message/getadvancedhistorymessagelist)：历史消息按会话分页拉取。
- [OpenIM 发送消息](https://docs.openim.io/sdks/api/message/sendmessage)：普通用户通过 SDK 创建和发送消息。
- [OpenIM 消息类型](https://docs.openim.io/restapi/contentdescription)：文本、图片、语音、视频、文件、@、位置和自定义消息类型。
- [OpenIM 单聊发送前回调](https://docs.openim.io/restapi/webhooks/msg/sendsinglemsgbefore)：业务后端可在投递前做权限和风控判断。

## 12. 最终决策

1. Go 后端是业务身份和权限源，不是第二套 IM 消息服务器。
2. OpenIM 是唯一消息、会话和实时连接主系统；MongoDB 由 OpenIM 独占管理。
3. PostgreSQL 继续保存业务关系、群业务状态、同步任务和审计，不再保存新聊天正文。
4. 后端优先开发对象解析、权限校验、关系/群同步、Webhook、系统消息和监控接口。
5. 当前旧 Go `/ws` 与 PostgreSQL 消息接口进入退役流程，不能与 OpenIM 同时长期运行。

## 13. 2026-08-13 实施与实机验收结果

- 本机 PostgreSQL 18 的 `im_app` 已执行 `007`、`008` 迁移；原 6 个用户未被改写。
- 历史对账已完成 6 个用户、2 对好友关系和 1 个群；当前实现还会把已有黑名单纳入后续全量对账；已执行任务均 `attempt_count=1`、无死信。
- 原登录接口和 `/im/token` 已取得真实 OpenIM 用户 Token、API 地址和 WS 地址。
- 两个业务用户的非好友单聊被对象接口和发送前 Webhook 正确拒绝。
- 发送后回调重复提交只产生一条审计记录，且 PostgreSQL 不保存消息正文。
- 内部 custom 系统通知已由真实 OpenIM 成功发送；相同幂等键/请求复用消息 ID，相同键换内容返回 409。
- `go test ./...`、`go vet ./...`、构建和 `git diff --check` 已通过；本机 Go 未启用 CGO，因此 `go test -race` 不能运行。
- OpenIM 服务器启用 Webhook 属于部署动作，按 `docs/OpenIM服务器Webhook部署步骤.md` 执行；代码端回调已完成。
