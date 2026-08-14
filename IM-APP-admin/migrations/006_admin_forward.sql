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
