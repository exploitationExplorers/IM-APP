# 设计文档：管理后台「消息发送记录 + 失败排查」

> 日期：2026-08-22
> 范围：`IM-APP-system`（管理后台 UI）、`IM-APP-admin`（BFF）、`IM-APP-server`（核心）、`IM-APP-fronend`（用户端上报）
> 状态：待评审
> 关联：视频发送故障排查（`发视频还是有问题`）；管理后台功能清单「模块四：转发和群发管理」；`GOAL-消息转发前后端问题检查记录-20260821.md`

## 1. 背景

管理后台已有「转发风控」页（`ForwardRiskView`），能查看**转发/群发**消息的发起人、类型、接收方、成功/失败数与失败原因。但**普通聊天消息（一对一 / 群聊，非转发）**没有任何后台可见性：

- 成功消息由 OpenIM `afterSendMsg` 回调写入核心库 `im_message_audit`（发送方 / 接收方 / 群 / 内容类型 / 时间），但**无 UI 展示**。
- 发送失败**完全不落库**：
  - 客户端失败（尤其**视频上传超时 / 上传失败**）发生在设备端，消息从未到达 OpenIM，服务端无感知。
  - `beforeSend` 回调可拒绝发送（拉黑 / 非好友 / 禁言），但拒绝原因只回给 OpenIM，未持久化。

因此管理员无法回答「谁发了什么、发给谁、成没成、为什么失败」，也无法用后台辅助排查视频发送问题。

## 2. 目标 / 非目标

**目标**
- 管理后台可查看消息发送记录：谁发给谁、消息类型（文本/语音/图片/视频/文件等）、时间、成功/失败。
- 失败可查看原因（客户端超时/上传失败/创建失败、服务端拦截等）。
- 页面采用双 Tab：`发送记录`（成功）｜`发送失败`。
- 打通「客户端发送失败 → 服务端」上报链路，为视频故障排查提供数据。
- 在失败可见性基础上定位并修复视频发送 bug。

**非目标（YAGNI，本期不做）**
- 不抓取 / 展示消息正文与媒体原件（仅展示类型）。
- 不做成功/失败统一时间线（选定方案 B 双 Tab）。
- 不做发送量趋势统计图表（后续按需）。
- 不改动转发风控既有页面与链路。

## 3. 架构（三层，均已存在）

```
IM-APP-system (Vue3 + Element Plus + Pinia)
   │  HTTP  /api/admin/v1/*   (JWT + RBAC 权限点)
IM-APP-admin (Go BFF, gin, :8090)
   │  读：直连核心 PostgreSQL（pgxpool，SELECT + JOIN users/groups）
   │  写：/internal/admin/* HTTP（内部密钥）调核心 server
IM-APP-server (Go 核心) + OpenIM
   │  im_message_audit  ← OpenIM afterSendMsg 回调（仅成功）
   │  beforeSend 回调可拒绝（本期改为拒绝时落库）
   │  新增 POST /im/message-send-failures（客户端失败上报）
IM-APP-fronend (uni-app 用户端)
   │  发送失败时调用上报接口
```

关键既有事实：
- BFF **读**核心库是直接 SQL（见 `IM-APP-admin/internal/repository/forward.go` 的 `forwardSelect`），因此读 `im_message_audit` / 失败表无需 HTTP 跳转。
- OpenIM userID = 业务用户 UUID 去横线并小写；groupID = 群业务 UUID 去横线小写。SQL 解析昵称用 `LOWER(REPLACE(u.id::text,'-','')) = sender_im_id`。
- RBAC 权限点 `messages.audit.read` 已存在（`IM-APP-admin/migrations/003_admin_rbac.sql:136`），本期复用。

## 4. 数据模型（核心库 IM-APP-server）

### 4.1 成功记录：复用 `im_message_audit`（不改表）
现有字段（`migrations/011_openim_chat_backend.sql`）：`callback_command, server_msg_id, client_msg_id, conversation_id, sender_im_id, receiver_im_id, group_im_id, content_type, seq, send_time, created_at`。

> 注意：afterSend 回调 `seq` 恒为 0，按 `client_msg_id` 定位；`content_type` 为 OpenIM 数字类型（101 文本 / 102 图片 / 103 语音 / 104 视频 / 105 文件 / 106 @ / 107 合并 / 108 名片 / 114 引用）。

### 4.2 失败记录：新增迁移 `031_im_message_send_failures.sql`
```sql
CREATE TABLE IF NOT EXISTS im_message_send_failures (
    id              BIGSERIAL PRIMARY KEY,
    client_msg_id   VARCHAR(128) NOT NULL DEFAULT '',
    source          VARCHAR(16)  NOT NULL,            -- 'client' | 'before_hook'
    sender_id       UUID,                             -- 业务用户 id（可空）
    sender_im_id    VARCHAR(64)  NOT NULL DEFAULT '',
    peer_type       VARCHAR(16)  NOT NULL,            -- 'c2c' | 'group'
    target_id       UUID,                             -- 业务用户/群 id（可空）
    target_im_id    VARCHAR(64)  NOT NULL DEFAULT '',
    content_type    INTEGER      NOT NULL DEFAULT 0,  -- OpenIM 数字类型
    stage           VARCHAR(24)  NOT NULL DEFAULT '', -- create|upload|send|timeout|blocked
    fail_code       VARCHAR(48)  NOT NULL DEFAULT '',
    fail_message    TEXT         NOT NULL DEFAULT '',
    client_platform VARCHAR(24)  NOT NULL DEFAULT '', -- app|h5|ios|android
    app_version     VARCHAR(32)  NOT NULL DEFAULT '',
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_fail_created  ON im_message_send_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_fail_sender   ON im_message_send_failures(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_fail_type     ON im_message_send_failures(content_type);
CREATE INDEX IF NOT EXISTS idx_msg_fail_code     ON im_message_send_failures(fail_code);
-- 幂等：同一 client_msg_id + stage 只记一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_fail_client_stage
    ON im_message_send_failures(client_msg_id, stage) WHERE client_msg_id <> '';
```
迁移需可重复执行（`IF NOT EXISTS`），与仓库现有迁移风格一致。

## 5. 失败采集（两条链路）

### 5.1 客户端上报（核心 server）
- 新增鉴权路由：`POST /im/message-send-failures`（放在现有用户鉴权分组 `auth` 下，与其余 `/im/*` 或聊天接口同级；具体分组在实现时对齐 `cmd/server/main.go`）。
- 请求体：
  ```json
  {
    "clientMsgId": "…",
    "peerType": "c2c|group",
    "targetId": "业务UUID 或 OpenIM id",
    "contentType": 104,
    "stage": "upload|timeout|create|send",
    "failCode": "upload_timeout",
    "failMessage": "发送超时",
    "platform": "android",
    "appVersion": "1.2.3",
    "occurredAt": "RFC3339（可空，缺省服务端 NOW()）"
  }
  ```
- 服务端：`sender` 从 JWT 解析（忽略请求体伪造）；解析 `sender_im_id` 与 `target_im_id`；按 `client_msg_id+stage` 幂等落库。
- 决策：接口放**核心 server**（非 BFF）。理由：sender 身份来自用户 JWT，且与消息链路同源；BFF 只服务管理员。

### 5.2 beforeSend 拒绝落库（核心 server）
- 在 `internal/handler/openim_webhook.go` 的 `BeforeSingle` / `BeforeGroup` **拒绝分支**（`denyWebhook(reason)` 前）插入一条失败记录：`source='before_hook', stage='blocked', fail_code=reason`（如 `blocked/not_friend/group_dissolved/member_muted/group_muted/message restricted by admin`）。
- 仅在拒绝时写入，量受限于被拦截尝试，不影响正常吞吐。
- 写库失败不得阻断回调响应（best-effort，异步或忽略错误并记日志）。

### 5.3 前端上报（IM-APP-fronend）
- 新增 `reportSendFailure()` 工具，调用 `POST /im/message-send-failures`。
- 接入点：`utils/openim.ts` 发送封装（`sendCreatedMessage` / `sendOnAppNative` 的失败与超时出口、`sendVideoMessage` 三级降级链各级 catch）+ `room.vue` / `useChatMessageActions.ts` 发送 catch。带上 `stage`（区分创建/上传/发送/超时）、`failCode`、原始 `errMsg`、平台、版本。
- 上报失败自身不得影响用户体验（best-effort，静默失败）。

## 6. BFF 接口（IM-APP-admin）

新增 `messages` 相关方法（可复用 `OpsRepo` 或新建 `MessageRepo`；handler 归入 `OpsHandler` 或新建 `MessageHandler`，实现时对齐现有组织方式）：

- `GET /api/admin/v1/messages` — 读 `im_message_audit`。
  - 查询参数：`page, size, contentType, senderKeyword, peerType(c2c|group), from, to`。
  - 返回：`AdminPage<MessageRecord>`；字段含 `时间, 发送方(im_id + 昵称), 接收方/群(im_id + 昵称), 会话类型, 消息类型`。
  - 昵称解析：`LEFT JOIN users` on `LOWER(REPLACE(users.id::text,'-','')) = sender_im_id / receiver_im_id`；群 `LEFT JOIN groups` on `group_im_id`。
- `GET /api/admin/v1/messages/failures` — 读 `im_message_send_failures`。
  - 查询参数：`page, size, contentType, failCode, senderKeyword, source, from, to`。
  - 返回：`AdminPage<MessageFailure>`；字段含 `时间, 发送方, 接收方, 会话类型, 消息类型, 来源, 阶段, 失败码, 失败信息`。
- 权限：两接口均 `middleware.RequirePermission(rbacRepo, "messages.audit.read")`。
- 排序默认按时间倒序；分页与既有 `AdminPage` 一致。

## 7. 前端页面（IM-APP-system）

- 新增视图 `src/views/messageAudit/MessageAuditView.vue`，仿 `views/forwardRisk/ForwardRiskView.vue`：
  - `el-tabs` 两个 Tab：`发送记录`｜`发送失败`。
  - 每个 Tab：搜索区（时间范围、发送人关键词、消息类型下拉、会话类型/失败码）+ `el-table` + `el-pagination`。
  - 列：
    - 发送记录：时间 / 发送方（昵称+id）/ 接收方（用户或群 昵称+id）/ 会话类型 / 消息类型。
    - 发送失败：时间 / 发送方 / 接收方 / 会话类型 / 消息类型 / 来源（客户端/拦截）/ 阶段 / 失败原因（码+信息）。
- 新增 API 模块 `src/api/modules/messageAudit.ts`（`namespace` + `http.get<AdminPage<T>>`，base `/admin/v1/messages`）。
- 路由：`src/router.ts` 新增 `messages/send-records`（标题「消息发送记录」）。
- 菜单：`src/layouts/AppShell.vue` 侧边栏新增「消息发送记录」，置于「转发风控」附近。
- 复用/扩展映射：
  - 类型映射复用 `SOURCE_CONTENT_TYPE_MAP`（101… → 中文）。
  - 失败码映射复用并扩展 `FAIL_CODE_LABEL_MAP`，新增客户端码：`upload_timeout`(上传超时)、`upload_failed`(上传失败)、`create_failed`(消息创建失败)、`send_timeout`(发送超时)、`send_failed`(发送失败)、`network_error`(网络错误) 等。

## 8. 视频 bug 排查（systematic-debugging）

失败上报接通后，「发送失败」Tab 将直接显示视频失败发生在哪一步（`stage`）。在此之上定位根因：

- 现状：`utils/openim.ts:sendVideoMessage`（app 端）本地全路径创建视频消息 → 三级降级（字符串入参→对象入参→上传换 URL）→ 交原生 SDK 上传 OSS + 发送，`timeoutMs=180000`，超时报「发送超时」，已带 `[video][send]` 日志（commit dc7e3bc）。
- 待验证假设（需一次真实失败日志对照）：
  1. 原生 OSS 上传在 180s 内无成功/失败回调（MinIO/OSS 端点、凭证、设备网络、大文件）。
  2. `isCompleteSentMessage` 误判导致成功回调被丢弃。
  3. 大文件超 nginx / server body 上限。
  4. `content://` / `file://` 路径未正确转换为 POSIX 全路径。
- 流程：复现取 `[video][send]` 日志 + 失败 Tab 的 stage/code → 对照假设定位单一根因 → 最小修复 → 回归验证。

## 9. RBAC / 权限

- 复用现有权限点 `messages.audit.read`（当前描述「查看撤回记录」，语义可扩展为「查看消息审计/发送记录」；如需更清晰可在 admin RBAC 迁移中补一个 `messages.send.read`，本期默认复用以减少改动）。

## 10. 测试

- **核心 server**：
  - `im_message_send_failures` repo 插入 + 幂等（`client_msg_id+stage` 冲突不重复）单测。
  - beforeSend 拒绝路径落库单测（拒绝时写、允许时不写）。
  - 上报接口鉴权：sender 取 JWT，非请求体。
- **BFF**：两个列表查询的 SQL/分页/昵称解析单测（仿 `IM-APP-admin` 现有 repo 测试）。
- **迁移**：可重复执行不报错。
- **前端**：`vue-tsc --noEmit` 通过；手动验证两 Tab 筛选/分页/空态。
- **端到端**：设备发一条注定失败的视频 → 失败 Tab 出现记录且含 stage + 原因。

## 11. 上线 / 迁移注意

- 核心库执行 `031` 迁移。
- OpenIM webhook 需已开启（`afterSendMsg`/`beforeSendMsg`）才有成功审计与拦截落库——现网已在用（撤回依赖它）。
- 失败上报接口无需 OpenIM，独立可用。
- 数据增长：失败表量小；`im_message_audit` 为全量消息，列表强制分页 + 时间范围默认近 7 天，避免全表扫描。

## 12. 决策记录（已拍板）

- 覆盖范围：完整记录 + 失败上报（两者都要）。
- 内容展示：仅类型，不抓正文/媒体。
- 页面：方案 B 双 Tab。
- 失败上报接口：放核心 server（`/im/message-send-failures`）。
- 权限：复用 `messages.audit.read`。
- 视频 bug：与后台功能并行排查修复。

## 13. 待确认 / 风险

- 菜单归属：暂定独立「消息发送记录」置于「转发风控」附近；若后续要归入「消息管理」分组再调整。
- `im_message_audit` 的 `receiver_im_id` 在群聊场景可能为空（以 `group_im_id` 为准），列表展示需按 `peer_type`/是否有 group 分别渲染。
- OpenIM 数字类型与前端 `MessageType` 的完整映射需在实现时核对补全。
