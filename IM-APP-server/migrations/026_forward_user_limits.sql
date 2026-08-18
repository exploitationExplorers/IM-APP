-- ============================================================
-- 026 用户转发限额表（server 侧建表；与 admin 006 同结构，幂等）
-- admin 管理限额，server 在提交转发任务时强制检查
-- ============================================================

CREATE TABLE IF NOT EXISTS forward_user_limits (
    user_id        UUID PRIMARY KEY,
    daily_limit    INT      NOT NULL DEFAULT 100,
    hourly_limit   INT      NOT NULL DEFAULT 20,
    single_targets INT      NOT NULL DEFAULT 10000,
    enabled        BOOLEAN  NOT NULL DEFAULT true,
    updated_by     UUID,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE forward_user_limits IS '用户转发限额（admin 管理，server 提交时强制检查）';
COMMENT ON COLUMN forward_user_limits.user_id IS '用户ID';
COMMENT ON COLUMN forward_user_limits.daily_limit IS '每日转发上限（默认 100）';
COMMENT ON COLUMN forward_user_limits.hourly_limit IS '每小时上限（默认 20）';
COMMENT ON COLUMN forward_user_limits.single_targets IS '单次最大目标数（默认 10000）';
COMMENT ON COLUMN forward_user_limits.enabled IS '是否允许转发';
COMMENT ON COLUMN forward_user_limits.updated_by IS '修改管理员ID';
COMMENT ON COLUMN forward_user_limits.updated_at IS '更新时间';
