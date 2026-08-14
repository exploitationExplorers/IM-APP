# 共享表扩展方案（按 GOAL-管理后台分模块开发清单）

> 状态：**待执行**。当前 admin 代码为「未扩展兼容版」，通过新增独立表承载功能，不依赖下列扩展列。
> 本文档记录后续给 server 共享表补列后，SQL 与对应代码改造方式。扩展后旧代码依然兼容，本改造为**可选优化**。

---

## 一、背景

清单要求扩展的共享表集中在 **`groups`、`forward_tasks`、`messages`**（及可选 `users`）。当前实现用以下新表承载同等功能，未动原表结构：

| 扩展需求 | 当前承载方案（新表） | 表来源 |
|---|---|---|
| 群解散字段 | `group_status_logs` 记录解散原因/操作者 | admin `004` |
| 转发成功/失败/跳过统计 | `forward_task_targets` 聚合 | admin `006` |
| 消息撤回标记 | `message_recall_logs` | admin `004` |
| 用户登录/发信限制 | `user_restrictions` / `user_status_logs`（清单推荐表方案，**无需改**） | admin `004` |

---

## 二、扩展列 SQL（ALTER TABLE）

> 表归 server 管理，建议放入 server 迁移（如 `IM-APP-server/migrations/010_admin_extensions.sql`）；
> 全部使用 `IF NOT EXISTS` 幂等，可在已建列后重复执行。

### 2.1 groups —— 解散字段（清单 04.2）

```sql
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_at TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_by_admin_id UUID;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolve_reason TEXT NOT NULL DEFAULT '';
```

> 说明：`status`、`all_muted`、`join_mode`、`allow_member_add_friend` 服务端已有，无需再加。

### 2.2 forward_tasks —— 统计与风控字段（清单 06.2）

```sql
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS success_count    INT         NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS failed_count     INT         NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS skipped_count    INT         NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS finished_at      TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS idempotency_key  VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_type     VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_summary  TEXT        NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS risk_level       VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS canceled_at      TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS cancel_reason    TEXT        NOT NULL DEFAULT '';
```

> 说明：服务端现有 `target_count`、`done_count`、`status`、`created_at`、`updated_at` 保持不动。

### 2.3 messages —— 撤回标记（可选）

> 若继续采用 `message_recall_logs` 记录管理撤回，则**可跳过本段**；如需在消息表直接打撤回标记，再执行：

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_by UUID;
```

---

## 三、对应代码改造点

### 3.1 转发统计 —— `internal/repository/forward.go`（forwardSelect）

**当前（聚合 forward_task_targets）：**

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

**扩展后（直接读新列，省去子查询）：**

```sql
SELECT ft.id::text, ft.user_id::text, ft.status, ft.target_count, ft.created_at,
       COALESCE(ft.finished_at, ft.updated_at),
       ft.success_count, ft.failed_count, ft.skipped_count
FROM forward_tasks ft
```

### 3.2 群解散 —— `internal/repository/group.go`（DissolveGroup）

**当前：**

```sql
UPDATE groups SET status='dissolved' WHERE id=$1::uuid;
-- 另写 group_status_logs 记录原因/操作者（保留）
```

**扩展后（同时落扩展列，group_status_logs 保留作历史审计）：**

```sql
UPDATE groups SET status='dissolved',
       dissolved_at = NOW(),
       dissolved_by_admin_id = $2::uuid,
       dissolve_reason = $3
WHERE id = $1::uuid;
```

> 对应 `GetGroupDetail` 可额外返回 `dissolvedAt`、`dissolvedByAdminId`、`dissolveReason`。

### 3.3 消息撤回 —— `internal/repository/group.go`（RecallMessage，可选）

**当前：**

```sql
INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
VALUES($1::uuid, $2::uuid, 'admin', $3::uuid, $4);
```

**扩展后（消息表打撤回标记 + 保留审计）：**

```sql
UPDATE messages SET recalled_at = NOW(), recalled_by = $3::uuid
WHERE id = $1::uuid;

INSERT INTO message_recall_logs(message_id, group_id, operator_type, operator_id, reason)
VALUES($1::uuid, $2::uuid, 'admin', $3::uuid, $4);
```

---

## 四、无需改动的部分

以下本来就是清单推荐的**独立表方案**，不属于「扩展列」，保持现状：

- `user_restrictions` / `user_status_logs` —— 用户登录/发信限制（清单 03.2 明确建议用表，而非 users 加列）
- `reports` / `report_reasons` / `report_files` / `report_assignments` 等 —— 举报工单（清单 05）
- `forward_task_targets` / `forward_user_limits` / `forward_risk_events` / `forward_task_actions` —— 转发明细/限额/风控（清单 06）
- `message_recall_logs` —— 撤回审计（与 messages 扩展列可并存）

---

## 五、兼容性

| 阶段 | 代码 | 结果 |
|---|---|---|
| 扩展前（现状） | 聚合/新表方案 | ✅ 正常，不报缺列 |
| 扩展后，不改造代码 | 聚合/新表方案 | ✅ 依然兼容（列存在不影响聚合查询） |
| 扩展后，按本方案改造 | 直接读新列 | ✅ 更高效，行为一致 |

---

## 六、执行步骤（建议顺序）

1. 在 server 侧执行第 二 节 SQL（放入 server 迁移或手动执行，幂等安全）
2. 按第 三 节改造 `forward.go` / `group.go` 对应函数
3. 后端 `go build ./...` + `go vet ./...` 验证
4. 回归：转发任务列表、群解散、管理撤回接口各验证一次
