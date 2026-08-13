-- 管理后台 schema
-- 复用 APP 库中已有表：users / groups / group_members / group_action_logs /
--   forward_tasks / forward_task_targets / sms_send_logs / countries / reports / report_reasons

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============ 模块一：管理员与权限 ============
CREATE TABLE IF NOT EXISTS roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(64) NOT NULL UNIQUE,
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission VARCHAR(64) NOT NULL,  -- 权限码: user.list / user.block / group.dissolve / sms.view ...
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL DEFAULT '',
    nickname      VARCHAR(64) NOT NULL DEFAULT '',
    role_id       UUID REFERENCES roles(id),
    status        VARCHAR(16) NOT NULL DEFAULT 'active', -- active|disabled
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_operation_logs (
    id          BIGSERIAL PRIMARY KEY,
    admin_id    UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    action      VARCHAR(64) NOT NULL,   -- user.block / user.status / group.dissolve / ...
    target_type VARCHAR(32) NOT NULL DEFAULT '',  -- user|group|forward_task|sms_config|...
    target_id   VARCHAR(64) NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '',
    ip          VARCHAR(64) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_oplogs_admin ON admin_operation_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_oplogs_target ON admin_operation_logs(target_type, target_id);

-- ============ 模块五：短信与运营配置 ============
CREATE TABLE IF NOT EXISTS app_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform      VARCHAR(16) NOT NULL DEFAULT '',  -- android|ios
    version       VARCHAR(32) NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    download_url  TEXT        NOT NULL DEFAULT '',
    force_upgrade BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_policies (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type       VARCHAR(32) NOT NULL,   -- user_agreement|privacy_policy
    title      VARCHAR(128) NOT NULL DEFAULT '',
    content    TEXT        NOT NULL DEFAULT '',
    version    VARCHAR(32) NOT NULL DEFAULT '1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensitive_words (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word       VARCHAR(128) NOT NULL UNIQUE,
    category   VARCHAR(32) NOT NULL DEFAULT 'general',
    status     VARCHAR(16) NOT NULL DEFAULT 'active', -- active|disabled
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS error_logs (
    id         BIGSERIAL PRIMARY KEY,
    module     VARCHAR(64) NOT NULL DEFAULT '',
    message    TEXT        NOT NULL DEFAULT '',
    stack      TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

-- ============ 扩展 APP 表，支撑管理后台功能 ============
ALTER TABLE users        ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE groups       ADD COLUMN IF NOT EXISTS status       VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE groups       ADD COLUMN IF NOT EXISTS all_muted    BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
