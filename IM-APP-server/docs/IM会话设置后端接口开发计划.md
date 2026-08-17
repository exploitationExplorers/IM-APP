# IM 会话设置后端接口开发计划

> 落盘日期：2026-08-14
> 关联文档：[OpenIM对话后端接口与WebSocket开发规划.md](./OpenIM对话后端接口与WebSocket开发规划.md)
> 背景：原规划第 6 节把「置顶 / 免打扰 / 隐藏会话」归为 OpenIM SDK 客户端能力。
> 本计划扩展为：**由 Go 后端以 REST 配置接口代理 OpenIM 会话设置能力（im 有的都要出）**，
> 保持现有 BFF 模式（前端调后端，后端用 admin token 调 OpenIM，携带 opUserID）。

## 1. 目标与范围

暴露 OpenIM 提供的「单会话配置」与「用户级全局配置」能力，前端通过后端 REST 设置，
不再要求前端直接拿 OpenIM 用户 token 调 SDK 设置接口（避免 token 复用导致的连接失效问题，
与本仓库 2026-08-14 修复的 errCode=10004 同源）。

### 1.1 本次出接口的会话配置项（全量对齐 OpenIM）

| 配置项 | OpenIM 字段 | 取值 | 说明 |
|---|---|---|---|
| 消息免打扰 | `recvMsgOpt` | 0 正常 / 1 免打扰 / 2 仅在线接收 | 单会话免打扰 |
| 置顶聊天 | `isPinned` | bool | 会话置顶 |
| 阅后即焚 | `isPrivateChat` + `burnDuration` | bool + 秒 | 开启后 `burnDuration` 生效 |
| 消息定时销毁 | `isMsgDestruct` + `msgDestructTime` | bool + 秒 | 超过时长服务端销毁 |
| 会话备注/扩展 | `ex` | string | 存备注名等扩展信息 |
| @强提醒类型 | `groupAtType` | int | 群 @ 强提醒档位 |
| 会话草稿 | `draftText` | string | 客户端草稿 |
| 全局免打扰 | `set_global_msg_recv_opt` | 0/1/2 | 用户级，对所有会话生效 |
| 标记已读 | `mark_conversation_as_read` | — | 清空该会话未读 |

### 1.2 明确不出（避免与 SDK/规划重复）

- 会话列表 / 全部会话拉取（`get_all_conversations`）→ 规划定为 SDK 职责，本计划不重复。
- 消息收发、历史、撤回、实时收消息 → SDK + WS 职责。
- 旧 PostgreSQL `conversations/messages` 表（`LEGACY_CHAT_ENABLED` 关闭时本就不注册）。

## 2. 端点设计（均在 `auth` 业务 JWT 组下）

### 2.1 获取单会话设置

`GET /api/v1/im/conversations/:conversationId`

- `conversationId` 为 OpenIM 会话 ID（如 `si_xxx` 单聊、`sg_xxx` 群聊），前端进会话后已由 SDK 持有。
- 后端用 `opUserID = UserIDFromBusinessID(当前JWT用户)` 调 OpenIM `get_conversations`。
- 响应 `data`：
  ```json
  {
    "conversationID": "si_xxx",
    "conversationType": 1,
    "recvMsgOpt": 0,
    "isPinned": false,
    "isPrivateChat": false,
    "burnDuration": 0,
    "isMsgDestruct": false,
    "msgDestructTime": 0,
    "groupAtType": 0,
    "ex": "",
    "draftText": "",
    "showName": "",
    "faceURL": "",
    "unreadCount": 0
  }
  ```

### 2.2 更新单会话设置（部分更新）

`PATCH /api/v1/im/conversations/:conversationId`

请求体为上述字段的任意子集（用指针区分「未传」与「传了零值」）：
```json
{ "recvMsgOpt": 1, "isPinned": true, "ex": "老王" }
```

后端处理（防字段清零的关键）：
1. 先 `get_conversations` 取该会话**全量**对象；
2. 把请求里非 nil 的字段叠加到全量对象上；
3. 用合并后的全量对象调 `set_conversation` 回写。
   - 原因：OpenIM `Conversation` 为 protobuf 消息，部分 JSON 写入会按默认值清零未传字段；
     先 GET 全量再回写可保证只改目标字段、不动其它设置。

响应：回写后再次 GET 该会话，返回全量设置（与 2.1 同结构）。

### 2.3 标记会话已读

`POST /api/v1/im/conversations/:conversationId/read`

后端调 OpenIM `mark_conversation_as_read`，清空该会话未读数。响应 `data: {"ok": true}`。

### 2.4 用户级全局免打扰

`PUT /api/v1/im/me/global-msg-recv-opt`

请求体：`{ "recvMsgOpt": 1 }`（0/1/2，同单会话语义）。
后端调 OpenIM `set_global_msg_recv_opt`（用户级）。响应 `data: {"recvMsgOpt": 1}`。

## 3. 权限模型

- 所有接口走业务 JWT，`middleware.UserID(c)` 取出当前用户；`opUserID` 由其业务 UUID
  经 `im.UserIDFromBusinessID` 映射为 OpenIM ID。OpenIM 服务端按 `opUserID` 强制只能改
  自己的会话，越权会被 OpenIM 拒绝（返回非 0 errCode，后端转 502/4xx）。
- 不需要额外查 PostgreSQL 关系表；会话归属由 OpenIM 保证。

## 4. 与 OpenIM 管理 API 的对接要点（实现注意）

1. **admin 接口字段命名不一致**：不同 OpenIM 版本 `set_conversation` 用 `opUserID`、
   `get_conversations` 用 `userID`。为兼容，请求体**同时带 `opUserID` 与 `userID`**（同值），
   多余字段被服务端忽略，缺失字段为零，确保任一版本都能命中正确字段。
2. **部分更新清零风险**：见 2.2 的 GET→叠加→SET 策略。
3. **复用现有 `postWithAdmin`**：自动带 admin token、401 自动刷新重试，无需新写鉴权。
4. **OpenIM 不可用**：沿用 `ErrUnavailable` → 503；errCode 非 0 → 502。

## 5. 改动落点

| 文件 | 改动 |
|---|---|
| `internal/im/client.go` | 新增 `ConversationSettings` 结构体 + `GetConversations` / `SetConversation` / `MarkConversationAsRead` / `SetGlobalMsgRecvOpt` |
| `internal/service/im.go` | 新增 `GetConversationSettings` / `UpdateConversationSettings` / `MarkConversationRead` / `SetGlobalMsgRecvOpt` |
| `internal/handler/im.go` | 新增对应 4 个 handler |
| `cmd/server/main.go` | `auth` 组注册 4 个路由 |
| `docs/api-contract.md` | 追加端点契约 |

## 6. 验证方式

1. `go build ./... && go vet ./...` 通过。
2. 起 OpenIM 与后端，用业务 JWT 调 `PATCH /api/v1/im/conversations/si_xxx` 设 `recvMsgOpt=1`、
   `isPinned=true`，再 `GET` 确认返回已生效。
3. 进会话确认前端不再弹 10004（会话设置走后端，不依赖前端 SDK 直连）。
4. 边界：传非法 `recvMsgOpt`（如 5）→ 400；OpenIM 不可达 → 503。
