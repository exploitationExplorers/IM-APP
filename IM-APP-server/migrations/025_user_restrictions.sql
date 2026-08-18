-- ============================================================
-- 025 用户登录/发信限制表（server 侧建表；与 admin 004 同结构，幂等可重复执行）
-- 管理端（admin）写入限制，server 在登录/发消息时强制检查
-- ============================================================

CREATE TABLE IF NOT EXISTS user_restrictions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,
    type        VARCHAR(16) NOT NULL,               -- login|message
    banned      BOOLEAN     NOT NULL DEFAULT false,
    until       TIMESTAMPTZ,
    reason      TEXT        NOT NULL DEFAULT '',
    operator_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_user_restrictions_user ON user_restrictions(user_id);

COMMENT ON TABLE user_restrictions IS '用户登录/发信限制（admin 写入，server 强制执行）';
COMMENT ON COLUMN user_restrictions.user_id IS '用户ID';
COMMENT ON COLUMN user_restrictions.type IS '限制类型：login=禁止登录 / message=禁止发消息';
COMMENT ON COLUMN user_restrictions.banned IS '是否限制：true=禁止';
COMMENT ON COLUMN user_restrictions.until IS '限制截止时间（NULL=永久）';
COMMENT ON COLUMN user_restrictions.reason IS '限制原因';
COMMENT ON COLUMN user_restrictions.operator_id IS '操作管理员ID';
COMMENT ON COLUMN user_restrictions.created_at IS '创建时间';
