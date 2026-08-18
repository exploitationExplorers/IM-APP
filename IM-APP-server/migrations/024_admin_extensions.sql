-- ============================================================
-- 024 管理后台扩展列（按《IM-APP-admin/docs/server-table-extension-plan.md》）
-- 表归 server 管理，给共享主业务表补齐清单要求的字段
-- 幂等：全部 ADD COLUMN IF NOT EXISTS（本项目 migration 每次启动重跑）
-- ============================================================

-- ---------- messages：消息撤回标记 / 序号 / 幂等 / 状态 ----------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_by UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'normal';

COMMENT ON COLUMN messages.recalled_at IS '撤回时间（NULL=未撤回）';
COMMENT ON COLUMN messages.recalled_by IS '撤回操作者ID';
COMMENT ON COLUMN messages.seq IS '消息序号（会话内递增）';
COMMENT ON COLUMN messages.client_message_id IS '客户端消息幂等ID';
COMMENT ON COLUMN messages.status IS '消息状态：normal=正常 / recalled=已撤回';

-- ---------- groups：成员上限 / 解散信息 ----------
ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_members INT NOT NULL DEFAULT 200;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_at TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolved_by_admin_id UUID;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS dissolve_reason TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN groups.max_members IS '群成员上限（默认 200）';
COMMENT ON COLUMN groups.dissolved_at IS '解散时间（NULL=未解散）';
COMMENT ON COLUMN groups.dissolved_by_admin_id IS '解散操作管理员ID';
COMMENT ON COLUMN groups.dissolve_reason IS '解散原因';

-- ---------- forward_tasks：统计 / 幂等 / 风控 / 取消 ----------
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS success_count INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS failed_count  INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS skipped_count INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS finished_at   TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_type    VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS content_summary TEXT        NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS risk_level     VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS canceled_at    TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS cancel_reason  TEXT        NOT NULL DEFAULT '';

COMMENT ON COLUMN forward_tasks.success_count IS '成功数（直存，替代聚合子查询）';
COMMENT ON COLUMN forward_tasks.failed_count IS '失败数';
COMMENT ON COLUMN forward_tasks.skipped_count IS '跳过数';
COMMENT ON COLUMN forward_tasks.finished_at IS '完成时间（NULL=未完成）';
COMMENT ON COLUMN forward_tasks.idempotency_key IS '幂等键（防止重复提交）';
COMMENT ON COLUMN forward_tasks.content_type IS '内容类型（text/image 等）';
COMMENT ON COLUMN forward_tasks.content_summary IS '内容摘要';
COMMENT ON COLUMN forward_tasks.risk_level IS '风控级别：normal|medium|high';
COMMENT ON COLUMN forward_tasks.canceled_at IS '取消时间（NULL=未取消）';
COMMENT ON COLUMN forward_tasks.cancel_reason IS '取消原因';

-- ---------- group_members：成员状态 / 退群时间 / 群内昵称 ----------
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS group_nickname VARCHAR(64) NOT NULL DEFAULT '';

COMMENT ON COLUMN group_members.status IS '成员状态：active=在群 / left=已退群';
COMMENT ON COLUMN group_members.left_at IS '退群时间（NULL=在群）';
COMMENT ON COLUMN group_members.group_nickname IS '群内昵称';
