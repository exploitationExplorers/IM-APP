-- ============================================================
-- 027 群状态变更历史表（server 侧建表；与 admin 004 同结构，幂等可重复执行）
-- 用户端（App 群主）解散/管理端（admin）解散、禁言等群状态变更统一落此表审计
-- ============================================================

CREATE TABLE IF NOT EXISTS group_status_logs (
    id          BIGSERIAL PRIMARY KEY,
    group_id    UUID NOT NULL,
    from_status VARCHAR(16) NOT NULL DEFAULT '',
    to_status   VARCHAR(16) NOT NULL DEFAULT '',
    reason      TEXT        NOT NULL DEFAULT '',
    operator_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_status_logs_group ON group_status_logs(group_id, created_at DESC);

COMMENT ON TABLE group_status_logs IS '群状态变更历史（封禁/禁言/解散审计）';
COMMENT ON COLUMN group_status_logs.id IS '日志ID';
COMMENT ON COLUMN group_status_logs.group_id IS '群ID';
COMMENT ON COLUMN group_status_logs.from_status IS '变更前状态';
COMMENT ON COLUMN group_status_logs.to_status IS '变更后状态';
COMMENT ON COLUMN group_status_logs.reason IS '变更原因';
COMMENT ON COLUMN group_status_logs.operator_id IS '操作者ID（管理端为管理员ID，用户端为群主/用户ID）';
COMMENT ON COLUMN group_status_logs.created_at IS '变更时间';
