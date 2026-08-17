-- ============================================================
-- 006 转发/群发与风控（清单 06.2 / 12.1）
-- forward_tasks 主表在 server 侧（不做列扩展）；明细/限额等用独立新表
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 转发目标明细（任务内接收人唯一；用于分页/失败统计/幂等）
CREATE TABLE IF NOT EXISTS forward_task_targets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL,
    user_id     UUID NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|success|failed|skipped|cancelled
    attempts    INT         NOT NULL DEFAULT 0,
    message_id  UUID,
    fail_code   VARCHAR(64) NOT NULL DEFAULT '',
    finished_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_fwd_targets_task ON forward_task_targets(task_id, status);

-- 用户转发限额
CREATE TABLE IF NOT EXISTS forward_user_limits (
    user_id        UUID PRIMARY KEY,
    daily_limit    INT      NOT NULL DEFAULT 100,
    hourly_limit   INT      NOT NULL DEFAULT 20,
    single_targets INT      NOT NULL DEFAULT 10000,
    enabled        BOOLEAN  NOT NULL DEFAULT true,
    updated_by     UUID,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 转发风险事件（异常频率/投诉率/重复内容/失败率 → 待办）
CREATE TABLE IF NOT EXISTS forward_risk_events (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID,
    task_id    UUID,
    risk_type  VARCHAR(32) NOT NULL DEFAULT '',   -- frequency|complaint|duplicate|failure_rate
    level      VARCHAR(16) NOT NULL DEFAULT 'medium',
    detail     TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fwd_risk_created ON forward_risk_events(created_at DESC);

-- 转发任务操作记录（终止/重试/限额变更，清单 06.3 需审计）
CREATE TABLE IF NOT EXISTS forward_task_actions (
    id         BIGSERIAL PRIMARY KEY,
    task_id    UUID NOT NULL,
    admin_id   UUID,
    action     VARCHAR(32) NOT NULL DEFAULT '',    -- cancel|retry|limit_change
    detail     TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fwd_actions_task ON forward_task_actions(task_id, created_at DESC);

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE forward_task_targets IS '转发目标明细（任务内接收人唯一；分页/失败统计/幂等）';
COMMENT ON COLUMN forward_task_targets.id IS '目标记录ID';
COMMENT ON COLUMN forward_task_targets.task_id IS '转发任务ID';
COMMENT ON COLUMN forward_task_targets.user_id IS '接收用户ID';
COMMENT ON COLUMN forward_task_targets.status IS '状态：pending=待发送 / success=成功 / failed=失败 / skipped=跳过 / cancelled=已取消';
COMMENT ON COLUMN forward_task_targets.attempts IS '尝试次数（<3 可重试）';
COMMENT ON COLUMN forward_task_targets.message_id IS '发送成功后 OpenIM 消息ID';
COMMENT ON COLUMN forward_task_targets.fail_code IS '失败原因码';
COMMENT ON COLUMN forward_task_targets.finished_at IS '完成时间';
COMMENT ON COLUMN forward_task_targets.created_at IS '创建时间';

COMMENT ON TABLE forward_user_limits IS '用户转发限额（日/时/单次上限）';
COMMENT ON COLUMN forward_user_limits.user_id IS '用户ID（主键）';
COMMENT ON COLUMN forward_user_limits.daily_limit IS '每日转发上限（默认 100）';
COMMENT ON COLUMN forward_user_limits.hourly_limit IS '每小时上限（默认 20）';
COMMENT ON COLUMN forward_user_limits.single_targets IS '单次最大目标数（默认 10000）';
COMMENT ON COLUMN forward_user_limits.enabled IS '是否允许该用户转发';
COMMENT ON COLUMN forward_user_limits.updated_by IS '修改管理员ID';
COMMENT ON COLUMN forward_user_limits.updated_at IS '更新时间';

COMMENT ON TABLE forward_risk_events IS '转发风险事件（异常频率/投诉/重复/失败率 → 待办）';
COMMENT ON COLUMN forward_risk_events.id IS '事件ID';
COMMENT ON COLUMN forward_risk_events.user_id IS '风险用户ID';
COMMENT ON COLUMN forward_risk_events.task_id IS '关联任务ID';
COMMENT ON COLUMN forward_risk_events.risk_type IS '风险类型：frequency=频率 / complaint=投诉 / duplicate=重复 / failure_rate=失败率';
COMMENT ON COLUMN forward_risk_events.level IS '风险级别：low|medium|high';
COMMENT ON COLUMN forward_risk_events.detail IS '风险详情';
COMMENT ON COLUMN forward_risk_events.created_at IS '触发时间';

COMMENT ON TABLE forward_task_actions IS '转发任务操作记录（终止/重试/限额变更审计）';
COMMENT ON COLUMN forward_task_actions.id IS '记录ID';
COMMENT ON COLUMN forward_task_actions.task_id IS '任务ID（限额变更等非任务操作为空）';
COMMENT ON COLUMN forward_task_actions.admin_id IS '操作管理员ID';
COMMENT ON COLUMN forward_task_actions.action IS '动作：cancel=终止 / retry=重试 / limit_change=限额变更';
COMMENT ON COLUMN forward_task_actions.detail IS '操作详情';
COMMENT ON COLUMN forward_task_actions.created_at IS '操作时间';
