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
ALTER TABLE groups       ADD COLUMN IF NOT EXISTS status       VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE groups       ADD COLUMN IF NOT EXISTS all_muted    BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- ============================================================
-- 表 / 字段注释
-- ============================================================

-- 角色（旧版；清单 12.1 迁移到 admin_roles）
COMMENT ON TABLE roles IS '管理员角色（旧版，已被 admin_roles 取代）';
COMMENT ON COLUMN roles.id IS '角色ID';
COMMENT ON COLUMN roles.name IS '角色名称（唯一）';
COMMENT ON COLUMN roles.description IS '角色描述';
COMMENT ON COLUMN roles.created_at IS '创建时间';

COMMENT ON TABLE role_permissions IS '角色-权限关联（旧版；权限用权限码字符串）';
COMMENT ON COLUMN role_permissions.role_id IS '角色ID';
COMMENT ON COLUMN role_permissions.permission IS '权限码，如 user.list / group.dissolve / sms.view';

COMMENT ON TABLE admins IS '管理员账号（旧版；已被 admin_users 取代）';
COMMENT ON COLUMN admins.id IS '管理员ID';
COMMENT ON COLUMN admins.username IS '登录账号（唯一）';
COMMENT ON COLUMN admins.password_hash IS '密码哈希（bcrypt）';
COMMENT ON COLUMN admins.nickname IS '昵称';
COMMENT ON COLUMN admins.role_id IS '角色ID';
COMMENT ON COLUMN admins.status IS '状态：active=启用 / disabled=停用';
COMMENT ON COLUMN admins.last_login_at IS '最后登录时间';
COMMENT ON COLUMN admins.created_at IS '创建时间';
COMMENT ON COLUMN admins.updated_at IS '更新时间';

COMMENT ON TABLE admin_operation_logs IS '管理员操作日志（旧版；清单 10 迁移到 admin_audit_logs）';
COMMENT ON COLUMN admin_operation_logs.id IS '日志ID';
COMMENT ON COLUMN admin_operation_logs.admin_id IS '操作管理员ID';
COMMENT ON COLUMN admin_operation_logs.action IS '操作动作码，如 user.block / group.dissolve';
COMMENT ON COLUMN admin_operation_logs.target_type IS '操作对象类型：user|group|forward_task|sms_config';
COMMENT ON COLUMN admin_operation_logs.target_id IS '操作对象ID';
COMMENT ON COLUMN admin_operation_logs.detail_json IS '操作详情（JSON）';
COMMENT ON COLUMN admin_operation_logs.ip IS '操作者IP';
COMMENT ON COLUMN admin_operation_logs.created_at IS '操作时间';

COMMENT ON TABLE app_versions IS 'APP 版本发布管理';
COMMENT ON COLUMN app_versions.id IS '版本ID';
COMMENT ON COLUMN app_versions.platform IS '平台：android|ios';
COMMENT ON COLUMN app_versions.version IS '版本号';
COMMENT ON COLUMN app_versions.description IS '更新说明';
COMMENT ON COLUMN app_versions.download_url IS '下载地址';
COMMENT ON COLUMN app_versions.force_upgrade IS '是否强制升级：true=强制';
COMMENT ON COLUMN app_versions.created_at IS '创建时间';

COMMENT ON TABLE app_policies IS 'APP 协议/政策文档（用户协议、隐私政策）';
COMMENT ON COLUMN app_policies.id IS '文档ID';
COMMENT ON COLUMN app_policies.type IS '类型：user_agreement=用户协议 / privacy_policy=隐私政策';
COMMENT ON COLUMN app_policies.title IS '标题';
COMMENT ON COLUMN app_policies.content IS '正文内容';
COMMENT ON COLUMN app_policies.version IS '版本号';
COMMENT ON COLUMN app_policies.created_at IS '创建时间';

COMMENT ON TABLE sensitive_words IS '敏感词库（命中拦截/待审核）';
COMMENT ON COLUMN sensitive_words.id IS '敏感词ID';
COMMENT ON COLUMN sensitive_words.word IS '敏感词内容（唯一）';
COMMENT ON COLUMN sensitive_words.category IS '分类，如 general / politics / ad';
COMMENT ON COLUMN sensitive_words.status IS '状态：active=启用 / disabled=停用';
COMMENT ON COLUMN sensitive_words.created_at IS '创建时间';

COMMENT ON TABLE error_logs IS '系统错误日志';
COMMENT ON COLUMN error_logs.id IS '日志ID';
COMMENT ON COLUMN error_logs.module IS '所属模块';
COMMENT ON COLUMN error_logs.message IS '错误信息';
COMMENT ON COLUMN error_logs.stack IS '错误堆栈';
COMMENT ON COLUMN error_logs.created_at IS '发生时间';

-- 扩展 APP 表（管理后台支撑列）
COMMENT ON COLUMN users.muted_until IS '用户级禁言截止时间（管理后台扩展列；NULL=未禁言）';
COMMENT ON COLUMN groups.status IS '群状态：active=正常 / banned=封禁 / muted=禁言 / dismissed=已解散';
COMMENT ON COLUMN groups.all_muted IS '是否全员禁言';
COMMENT ON COLUMN group_members.muted_until IS '群成员禁言截止时间（NULL=未禁言）';
