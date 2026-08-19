-- ============================================================
-- 004 用户/群处置与消息撤回（清单 12.1：user_restrictions 等）
-- 均为独立新表，不扩展共享表 users/groups/messages 的列
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 用户登录/发信限制（清单 03.2：不继续用单一 status 表达所有限制）
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

-- 用户状态变更历史（不可覆盖删除，清单 03.2）
CREATE TABLE IF NOT EXISTS user_status_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,
    from_status VARCHAR(16) NOT NULL DEFAULT '',
    to_status   VARCHAR(16) NOT NULL DEFAULT '',
    reason      TEXT        NOT NULL DEFAULT '',
    operator_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_status_logs_user ON user_status_logs(user_id, created_at DESC);

-- 群状态变更历史（清单 04.2）
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

-- 消息撤回记录（清单 04.2/12.1；替代依赖 messages.recalled_*，不依赖缺列）
CREATE TABLE IF NOT EXISTS message_recall_logs (
    id            BIGSERIAL PRIMARY KEY,
    message_id    UUID NOT NULL,
    group_id      UUID,
    operator_type VARCHAR(16) NOT NULL DEFAULT 'admin',  -- admin|user
    operator_id   UUID,
    reason        TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_recall_group ON message_recall_logs(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_recall_message ON message_recall_logs(message_id);

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE user_restrictions IS '用户登录/发信限制（用独立表而非单一 status 表达所有限制）';
COMMENT ON COLUMN user_restrictions.id IS '限制ID';
COMMENT ON COLUMN user_restrictions.user_id IS '用户ID';
COMMENT ON COLUMN user_restrictions.type IS '限制类型：login=禁止登录 / message=禁止发消息';
COMMENT ON COLUMN user_restrictions.banned IS '是否限制：true=禁止';
COMMENT ON COLUMN user_restrictions.until IS '限制截止时间（NULL=永久）';
COMMENT ON COLUMN user_restrictions.reason IS '限制原因';
COMMENT ON COLUMN user_restrictions.operator_id IS '操作管理员ID';
COMMENT ON COLUMN user_restrictions.created_at IS '创建时间';

COMMENT ON TABLE user_status_logs IS '用户状态变更历史（不可覆盖删除，审计用）';
COMMENT ON COLUMN user_status_logs.id IS '日志ID';
COMMENT ON COLUMN user_status_logs.user_id IS '用户ID';
COMMENT ON COLUMN user_status_logs.from_status IS '变更前状态';
COMMENT ON COLUMN user_status_logs.to_status IS '变更后状态';
COMMENT ON COLUMN user_status_logs.reason IS '变更原因';
COMMENT ON COLUMN user_status_logs.operator_id IS '操作管理员ID';
COMMENT ON COLUMN user_status_logs.created_at IS '变更时间';

COMMENT ON TABLE group_status_logs IS '群状态变更历史（封禁/禁言/解散审计）';
COMMENT ON COLUMN group_status_logs.id IS '日志ID';
COMMENT ON COLUMN group_status_logs.group_id IS '群ID';
COMMENT ON COLUMN group_status_logs.from_status IS '变更前状态';
COMMENT ON COLUMN group_status_logs.to_status IS '变更后状态';
COMMENT ON COLUMN group_status_logs.reason IS '变更原因';
COMMENT ON COLUMN group_status_logs.operator_id IS '操作管理员ID';
COMMENT ON COLUMN group_status_logs.created_at IS '变更时间';

COMMENT ON TABLE message_recall_logs IS '消息撤回记录（管理员/用户撤回审计；消息表不依赖 recalled_* 缺列）';
COMMENT ON COLUMN message_recall_logs.id IS '记录ID';
COMMENT ON COLUMN message_recall_logs.message_id IS '被撤回消息ID';
COMMENT ON COLUMN message_recall_logs.group_id IS '所属群ID';
COMMENT ON COLUMN message_recall_logs.operator_type IS '撤回方类型：admin=管理员 / user=用户';
COMMENT ON COLUMN message_recall_logs.operator_id IS '撤回操作者ID';
COMMENT ON COLUMN message_recall_logs.reason IS '撤回原因';
COMMENT ON COLUMN message_recall_logs.created_at IS '撤回时间';
