# Server 主业务表扩展与 Admin 适配改造方案

> 状态：**已执行**（2026-08-17）
> 执行内容：
> - server 新增 `IM-APP-server/migrations/024_admin_extensions.sql`（幂等补齐 `messages`/`groups`/`forward_tasks`/`group_members` 全部字段 + 注释）
> - admin `RecallMessage` 改为事务并写 `messages.recalled_at/recalled_by` 标记
> - admin `forwardSelect` 直读 `success_count/failed_count/skipped_count`（去掉 3 个聚合子查询）
> - admin `DissolveGroup` 落 `groups.dissolved_at/dissolved_by_admin_id/dissolve_reason`
> - admin `GetGroupDetail`/`AppGroupDetail` 返回 `maxMembers/dissolvedAt/dissolvedByAdminId/dissolveReason`
> - 统一 `groups.join_mode` 默认值为 `'open'`（admin 002 与 server 007 一致）
> - 重新生成 `docs/admin-api.json`（103 接口）
> 背景：按《GOAL-APP-Go后端接口与建表开发清单》核对，server 主业务表存在清单要求但尚未扩展的字段；admin 当前用独立表 + 聚合子查询承载同等能力。
> 原则：**表归 server 管**，扩展字段放 server migrations（幂等）；admin 不再 ALTER server 表；补字段后 admin 逐步改为直读字段、独立审计表保留。

---

## 一、现状问题

1. **原始清单要求的部分字段 server 表没有**（见第三节），导致：
   - 群成员上限 `max_members` 无字段可存
   - 管理撤回消息后，`messages` 表无 `recalled_at/recalled_by` 标记
   - 群成员无 `status/left_at`（无法区分在群/已退）
2. **admin 直接 ALTER server 表造成不一致**：`groups.join_mode` 在 admin `002` 默认 `'direct'`、server `007` 默认 `'open'`，同一库最终默认值取决于 migration 执行顺序。
3. **admin 写 server 表绕过 server 业务逻辑**：群禁言/解散、转发取消/重试等直接改库，跳过 server 的 OpenIM 同步与 Kafka 队列状态机（建议后续走 server 管理 API，本文档聚焦**字段补齐**，不展开服务化改造）。

---

## 二、Server 主业务表扩展字段

> 全部使用 `ADD COLUMN IF NOT EXISTS` 幂等（本项目 migration 无版本记录，每次启动重跑）。
> 建议放入 `IM-APP-server/migrations/024_admin_extensions.sql`（或按 server 现有编号续）。

### 2.1 `groups` —— 补 4 个字段

```sql
-- 群成员上限（清单必备，当前缺）
ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_members INT NOT NULL DEFAULT 200;

-- 群解散信息（admin 运营解散群时落库，供详情展示/审计）
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_at TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_by_admin_id UUID;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolve_reason TEXT NOT NULL DEFAULT '';
```

> `status / all_muted / join_mode / allow_member_add_friend / announcement / conversation_id` server 已有，无需再加。

### 2.2 `forward_tasks` —— 补 9 个字段

```sql
-- 转发统计（直存计数，避免每次聚合子查询）
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS success_count INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS failed_count  INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS skipped_count INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS finished_at   TIMESTAMPTZ;

-- 幂等与内容描述
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_type    VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_summary TEXT        NOT NULL DEFAULT '';

-- 风控与取消信息
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS risk_level    VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS canceled_at   TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS cancel_reason TEXT        NOT NULL DEFAULT '';
```

> `target_count / done_count / status / created_at / updated_at` 保持不动。

### 2.3 `messages` —— 补 5 个字段（清单必备，当前全缺）

```sql
-- 消息撤回标记（管理撤回 / 用户撤回后置标）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_by UUID;

-- 消息序号 / 客户端幂等 / 状态（清单要求，当前 server 用简化版）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'normal';
```

### 2.4 `group_members` —— 补 3 个字段（清单要求，当前缺）

```sql
-- 成员状态（active 在群 / left 已退）与退群时间
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- 群内昵称（可选）
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS group_nickname VARCHAR(64) NOT NULL DEFAULT '';
```

### 2.5 `users` —— 可选 1 个字段

```sql
-- 用户级禁言（admin 001 已加过，但 server 未定义/未实现；二选一：server 补定义并实现，或删除 admin 里的无用列）
ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
```

> ⚠️ `users.muted_until` 目前 admin 加了但代码未用、server 不认，属于"半预留"。建议明确：要么 server 扩展并实现用户级禁言，要么清理。

---

## 三、Admin 表调整方案

| admin 表 | 当前作用 | 扩展后处置 | 说明 |
|---|---|---|---|
| `group_status_logs` | 记录群状态变更（from/to/reason/operator） | **可退役**（可选） | groups 直存 `dissolved_at` 等后，它只剩历史审计价值；新数据可停止写入，历史保留 |
| `forward_task_targets` | 转发明细 + 失败统计 + 列表分页 | **不能删** | 明细列表仍用；只把 `forwardSelect` 的**聚合子查询**改为直读 `success_count/failed_count/skipped_count` |
| `message_recall_logs` | 撤回审计（记录撤回人/原因） | **保留** | 与 `messages.recalled_at` 并存：消息表打标记，审计表记日志 |
| `user_restrictions` | 用户登录/发信限制（清单推荐表方案） | **保留** | 本来就是表方案，不涉及 |
| `user_status_logs` | 用户状态变更审计 | **保留** | 同上 |

**结论**：真正可退役的仅 `group_status_logs`（可选），其余为"保留表 + 优化查询"，无强制删除项。

---

## 四、Admin 代码改造点

### 4.1 转发统计 —— `internal/repository/forward.go`（forwardSelect）

**当前**（聚合子查询，性能差）：

```sql
SELECT ft.id::text, ft.user_id::text, ft.status, ft.target_count, ft.created_at, ft.updated_at,
       GREATEST(ft.done_count,
         COALESCE((SELECT COUNT(*) FROM forward_task_targets t
                   WHERE t.task_id=ft.id AND t.status='success'),0)),
       (SELECT COUNT(*) FROM forward_task_targets t
        WHERE t.task_id=ft.id AND t.status='failed'),
       (SELECT COUNT(*) FROM forward_task_targets t
        WHERE t.task_id=ft.id AND t.status='skipped')
FROM forward_tasks ft
```

**扩展后**（直读字段，去掉 3 个子查询）：

```sql
SELECT ft.id::text, ft.user_id::text, ft.status, ft.target_count, ft.created_at,
       COALESCE(ft.finished_at, ft.updated_at),
       ft.success_count, ft.failed_count, ft.skipped_count
FROM forward_tasks ft
```

> 注意：`forward_task_targets` 明细列表/失败分析仍保留，只优化主列表查询。

### 4.2 群解散 —— `internal/repository/group.go`（DissolveGroup）

**当前**：

```sql
UPDATE groups SET status='dissolved' WHERE id=$1::uuid;
INSERT INTO group_status_logs(group_id, from_status, to_status, reason, operator_id) ...;
```

**扩展后**（同时落 groups 解散字段；`group_status_logs` 可停写或保留）：

```sql
UPDATE groups
SET status='dissolved',
    dissolved_at = NOW(),
    dissolved_by_admin_id = $2::uuid,
    dissolve_reason = $3
WHERE id = $1::uuid;
```

`GetGroupDetail` 额外返回 `maxMembers / dissolvedAt / dissolvedByAdminId / dissolveReason`。

### 4.3 管理撤回消息 —— `internal/repository/group.go`（RecallMessage）

**当前**（只写审计表，消息无标记）：

```sql
INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
VALUES($1::uuid, $2::uuid, 'admin', $3::uuid, $4);
```

**扩展后**（消息表打撤回标记 + 审计）：

```sql
UPDATE messages SET recalled_at = NOW(), recalled_by = $3::uuid
WHERE id = $1::uuid;

INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
VALUES($1::uuid, $2::uuid, 'admin', $3::uuid, $4);
```

> 这是解决"管理撤回后消息无标记"最实际的一处，优先级最高。

### 4.4 模型 —— `internal/models/*.go`

- `AppGroup` / `AppGroupDetail`：加 `MaxMembers`、`DissolvedAt`、`DissolvedByAdminId`、`DissolveReason`
- `ForwardTask`：加 `SuccessCount`、`FailedCount`、`SkippedCount`、`FinishedAt`（若改直读）
- `group_members` 相关：加 `Status`、`LeftAt`（如列表需要展示）

---

## 五、实施步骤（建议分批）

**阶段 1（最小，推荐先做）—— 解决"撤回无标记"**
1. server 加 `messages.recalled_at / recalled_by`（024 migration）
2. admin `RecallMessage` 加 UPDATE messages 标记
3. 回归：管理撤回一个消息，查 messages 表确认 `recalled_at` 落库

**阶段 2 —— 补齐主表字段**
1. server 024 migration 补齐 `groups / forward_tasks / group_members` 全部字段（幂等 SQL）
2. `go build ./... && go vet ./...` 验证 server 无回归（server 代码不依赖新列，兼容）

**阶段 3 —— admin 代码直读优化**
1. `forwardSelect` 改为直读 count 列
2. `DissolveGroup` 落 groups 解散字段（`group_status_logs` 停写，历史保留）
3. `GetGroupDetail` / models 返回新字段
4. 回归：转发列表、群解散、群详情各验证一次

**阶段 4 —— 收尾**
1. 统一 `join_mode` 默认值（admin/server 改为一致）
2. 决策 `users.muted_until` 去留
3. 更新 `docs/shared-table-extensions.md` 或归档到本文档

---

## 六、风险与兼容性

| 项 | 说明 |
|---|---|
| **字段扩展安全性** | 全部 `IF NOT EXISTS` 幂等；server 代码不依赖新列，补列不破坏现有查询 |
| **admin 直读新列** | 在 server 字段已补、且该功能对应版本已部署后才改代码，避免"代码读了不存在的列" |
| **`group_status_logs` 退役** | 只停写新数据、保留历史表，不 DROP（保留审计追溯） |
| **`join_mode` 默认值** | 统一为 server 的 `'open'`（或按产品定），在 server 侧维护 |
| **写 server 表绕过业务逻辑** | ✅ 已按方案 A 实施（见第八章）：写操作改走 server 内部 API，由 server 执行业务 + OpenIM 同步 |

---

## 七、关联文档

- `docs/shared-table-extensions.md`：早期管理后台视角的扩展方案（覆盖转发统计/群解散/撤回，未覆盖 `max_members`、`messages.seq/status`、`group_members.status/left_at`）
- 根目录 `GOAL-APP-Go后端接口与建表开发清单.md`：原始字段要求（本文档以此为准补齐缺口）

---

## 八、方案 A：写操作服务化改造（admin 走 server 内部 API）

> 背景：admin 此前直接改 server 共享表，绕过 server 业务逻辑（OpenIM 同步、Kafka 转发队列、用户状态强制检查），导致管理后台操作在 OpenIM/APP 端不生效。
> 方案：server 提供 `/internal/admin` 内部接口（`X-Internal-API-Key` 鉴权），admin 写操作改走 HTTP 调用，由 server 执行业务 + 同步；admin 本地仅保留审计表写入。

### 8.1 server 内部管理接口（`/internal/admin`）

| 接口 | 功能 | 同步/副作用 |
|---|---|---|
| `POST /groups/:id/dismiss` | 解散群 | OpenIM 群解散 |
| `POST /groups/:id/mute` | 全员禁言 | OpenIM |
| `POST /groups/:id/add-friend` | 群内加好友开关 | OpenIM |
| `POST /forward-tasks/:id/cancel` | 终止转发任务 | Kafka 队列 |
| `POST /forward-tasks/:id/retry` | 重试失败目标 | Kafka 队列 |
| `POST /users/:id/restriction` | 登录/发信限制 | server 登录/发消息强制检查 |
| `POST /users/:id/status` | 封禁/解封/注销 | 撤销会话、状态强制检查 |
| `POST /users/:id/sessions/revoke` | 强制下线 | 撤销 auth_sessions |
| `POST /users/:id/reset-profile` | 重置头像/昵称 | 更新 users + OpenIM 资料同步 |
| `POST /messages/:id/recall` | 撤回消息 | OpenIM 撤回（按 clientMsgId 反查 im_message_audit） |

### 8.2 admin 改走 server 的操作（对外 URL 不变）

- **群**：解散 / 全员禁言 / 加好友开关 → server（本地写 `group_status_logs` 审计）
- **转发**：终止 / 重试 → server（提交时 server 强制限额检查）
- **用户**：限制 / 封禁 / 强制下线 / 注销 / 重置资料 → server（本地写 `user_status_logs` 审计）
- **消息**：撤回 → server（前端带 `clientMsgId` 定位 OpenIM 撤回）

### 8.3 新增表（server 侧补建，幂等）

| 表 | 文件 | 用途 |
|---|---|---|
| `user_restrictions` | `025_user_restrictions.sql` | 用户登录/发信限制（server 强制检查） |
| `forward_user_limits` | `026_forward_user_limits.sql` | 用户转发限额（server 提交时强制检查） |

### 8.4 新增 admin 对外接口 / 权限点

- 接口：`POST /users/:id/reset-profile`、`POST /users/:id/cancel`、`GET /users/phone-search`
- 权限点：`users.reset.profile`、`users.phone.search`、`users.cancel`

### 8.5 部署配置

```bash
# server/.env
IM_INTERNAL_API_KEY=<密钥>

# admin/.env
SERVER_BASE_URL=http://127.0.0.1:8080
SERVER_INTERNAL_KEY=<与 IM_INTERNAL_API_KEY 一致>
```

### 8.6 剩余待办

- **前端撤回**传 `clientMsgId`（后端已就绪，前端消息数据带 `clientMsgID` 即自动生效）
- 撤回的 OpenIM 定位依赖 `im_message_audit` 有 webhook 审计记录（需 OpenIM webhook 开启）
- 手机号查询权限：前端用户管理页"手机号搜索"需改用 `/users/phone-search`
