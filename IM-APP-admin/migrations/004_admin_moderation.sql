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
