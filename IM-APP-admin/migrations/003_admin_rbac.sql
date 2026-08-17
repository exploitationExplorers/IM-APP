-- ============================================================
-- 003 管理后台 RBAC 核心表（按 GOAL-管理后台分模块开发清单 12.1）
-- 表名严格遵循清单；与旧表(admins/roles/role_permissions)共存，代码使用新表
-- 全部幂等：CREATE TABLE IF NOT EXISTS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 管理员账号（不得复用 APP users 表）
CREATE TABLE IF NOT EXISTS admin_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64)  NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL DEFAULT '',
    nickname      VARCHAR(64)  NOT NULL DEFAULT '',
    status        VARCHAR(16)  NOT NULL DEFAULT 'active',   -- active|disabled
    mfa_secret    TEXT         NOT NULL DEFAULT '',         -- MFA 密钥（加密后），空=未启用
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 管理员会话（refresh token 仅存哈希，可撤销）
CREATE TABLE IF NOT EXISTS admin_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id           UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    device             VARCHAR(128)  NOT NULL DEFAULT '',
    ip                 VARCHAR(64)   NOT NULL DEFAULT '',
    user_agent         VARCHAR(256)  NOT NULL DEFAULT '',
    expires_at         TIMESTAMPTZ   NOT NULL,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_refresh ON admin_sessions(refresh_token_hash);

-- 角色
CREATE TABLE IF NOT EXISTS admin_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(64) NOT NULL,
    code        VARCHAR(64) NOT NULL UNIQUE,
    description TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'active',      -- active|disabled
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 权限码字典
CREATE TABLE IF NOT EXISTS admin_permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(64) NOT NULL UNIQUE,
    name        VARCHAR(64) NOT NULL DEFAULT '',
    module      VARCHAR(64) NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT ''
);

-- 角色-权限关联
CREATE TABLE IF NOT EXISTS admin_role_permissions (
    role_id       UUID NOT NULL REFERENCES admin_roles(id)       ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 管理员-角色关联（支持一管理员多角色）
CREATE TABLE IF NOT EXISTS admin_user_roles (
    admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role_id  UUID NOT NULL REFERENCES admin_roles(id)  ON DELETE CASCADE,
    PRIMARY KEY (admin_id, role_id)
);

-- 登录日志（失败锁定依据）
CREATE TABLE IF NOT EXISTS admin_login_logs (
    id         BIGSERIAL PRIMARY KEY,
    admin_id   UUID,
    success    BOOLEAN      NOT NULL DEFAULT false,
    fail_reason VARCHAR(128) NOT NULL DEFAULT '',
    ip         VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent VARCHAR(256) NOT NULL DEFAULT '',
    request_id VARCHAR(64)  NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_login_logs_admin ON admin_login_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_login_logs_ip ON admin_login_logs(ip, created_at DESC);

-- 审计日志（不可删除；普通管理员无权删除）
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    admin_id     UUID,
    action       VARCHAR(64)  NOT NULL,
    resource     VARCHAR(32)  NOT NULL DEFAULT '',
    resource_id  VARCHAR(64)  NOT NULL DEFAULT '',
    reason       TEXT         NOT NULL DEFAULT '',
    before_value TEXT         NOT NULL DEFAULT '',
    after_value  TEXT         NOT NULL DEFAULT '',
    ip           VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent   VARCHAR(256) NOT NULL DEFAULT '',
    request_id   VARCHAR(64)  NOT NULL DEFAULT '',
    result       VARCHAR(16)  NOT NULL DEFAULT 'success', -- success|denied|failed
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_request ON admin_audit_logs(request_id);

-- ============================================================
-- 权限码字典初始化（清单各模块权限点；非敏感数据，可幂等写入）
-- ============================================================
INSERT INTO admin_permissions (code, name, module, description) VALUES
  ('admin.login',          '后台登录', 'system',   '后台登录'),
  ('admins.read',          '查看管理员', 'system', '查看管理员列表'),
  ('admins.write',         '创建/修改管理员', 'system', '创建和修改管理员'),
  ('admins.status',        '启停管理员', 'system', '启用/停用管理员'),
  ('admins.security',      '管理员安全', 'system', '重置管理员 MFA 等安全操作'),
  ('roles.read',           '查看角色', 'system',  '查看角色列表'),
  ('roles.write',          '角色管理', 'system',  '创建/修改/删除角色及权限'),
  ('dashboard.read',       '工作台', 'dashboard', '查看工作台指标/趋势/待办'),
  ('users.read',           '查看用户', 'user',    '查看用户列表与详情'),
  ('users.phone.reveal',   '查看完整手机号', 'user', '查看完整手机号（需原因+工单号并审计）'),
  ('users.groups.read',    '查看用户群', 'user',   '查看用户加入的群列表'),
  ('users.restrict.login', '登录限制', 'user',     '禁止/恢复用户登录'),
  ('users.restrict.message','发消息限制', 'user',  '禁止/恢复用户发消息'),
  ('users.ban',            '封禁用户', 'user',     '封禁/解封用户'),
  ('users.sessions.revoke', '强制下线', 'user',    '强制用户全部设备下线'),
  ('users.reset.profile',   '重置头像昵称', 'user', '强制重置用户头像/昵称'),
  ('users.phone.search',    '手机号查询', 'user',   '按手机号搜索用户（保护隐私）'),
  ('users.cancel',          '注销用户', 'user',     '注销用户账号'),
  ('reports.read',         '查看举报', 'report',   '查看举报列表/详情/历史'),
  ('reports.assign',       '指派举报', 'report',   '领取/指派举报工单'),
  ('reports.handle',       '处理举报', 'report',   '标记处理中/补充备注'),
  ('reports.resolve',      '结案举报', 'report',   '举报成立/驳回并结案'),
  ('reports.reopen',       '重开举报', 'report',   '重新打开已结案举报'),
  ('groups.read',          '查看群组', 'group',    '查看群列表与详情'),
  ('groups.members.read',  '查看群成员', 'group',  '查看群成员列表'),
  ('groups.mute',          '全员禁言', 'group',    '设置/解除群全员禁言'),
  ('groups.settings',      '群设置', 'group',      '修改群内互加好友等设置'),
  ('groups.dissolve',      '解散群', 'group',      '解散违规群（高风险）'),
  ('messages.audit.read',  '查看撤回记录', 'group', '查看群管理撤回记录'),
  ('messages.recall.admin','管理撤回', 'group',    '管理员撤回指定消息'),
  ('forward.read',         '查看转发任务', 'forward', '查看转发任务列表/详情/失败统计'),
  ('forward.targets.read', '查看转发目标', 'forward', '查看转发任务目标明细'),
  ('forward.cancel',       '终止转发任务', 'forward', '终止待处理转发任务'),
  ('forward.retry',        '重试转发', 'forward',   '重试失败转发目标'),
  ('forward.limits.read',  '查看转发限额', 'forward', '查看用户转发限额'),
  ('forward.limits.write', '修改转发限额', 'forward', '修改用户转发限额'),
  ('forward.settings.read','查看转发规则', 'forward', '查看全局转发规则'),
  ('forward.settings.write','修改转发规则', 'forward','修改全局转发规则'),
  ('countries.read',       '查看国家', 'sms',      '查看国家/地区列表'),
  ('countries.write',      '维护国家', 'sms',      '新增国家/修改号码规则'),
  ('countries.status',     '国家启停', 'sms',      '启用/停用国家注册'),
  ('sms.logs.read',        '查看短信日志', 'sms',  '查看短信发送日志'),
  ('sms.statistics.read',  '短信统计', 'sms',      '查看短信送达统计'),
  ('sms.providers.read',   '短信供应商', 'sms',    '查看短信供应商健康状态'),
  ('app-versions.read',    '查看APP版本', 'config', '查看APP版本列表'),
  ('app-versions.write',   '管理APP版本', 'config', '创建/修改/发布APP版本'),
  ('legal.read',           '查看协议', 'config',   '查看协议文档'),
  ('legal.write',          '维护协议', 'config',   '创建/发布协议版本'),
  ('report-reasons.read',  '查看举报原因', 'config','查看举报原因配置'),
  ('report-reasons.write', '维护举报原因', 'config','新建/修改/启停举报原因'),
  ('system-limits.read',   '查看系统限制', 'config','查看系统限制配置'),
  ('system-limits.write',  '修改系统限制', 'config','修改并发布系统限制'),
  ('moderation.words.read', '查看敏感词', 'moderation','查看敏感词列表'),
  ('moderation.words.write','维护敏感词', 'moderation','新建/修改/启停敏感词'),
  ('moderation.words.import','导入敏感词', 'moderation','批量导入敏感词'),
  ('moderation.hits.read', '查看命中记录', 'moderation','查看敏感词命中记录'),
  ('moderation.profiles.read','查看待审核资料', 'moderation','查看待审核头像/昵称'),
  ('moderation.profiles.handle','处理资料审核', 'moderation','驳回/恢复资料状态'),
  ('audit.read',           '查看审计日志', 'audit', '查看管理操作审计日志'),
  ('security.logs.read',   '查看登录日志', 'audit', '查看管理员登录日志'),
  ('system.errors.read',   '查看运行错误', 'audit', '查看系统运行错误记录'),
  ('exports.create',       '创建导出任务', 'audit', '创建异步导出任务'),
  ('exports.read.all',     '查看全部导出', 'audit', '查询/下载任意导出任务')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE admin_users IS '管理员账号（管理端独立账号，不复用 APP users 表）';
COMMENT ON COLUMN admin_users.id IS '管理员ID';
COMMENT ON COLUMN admin_users.username IS '登录账号（唯一）';
COMMENT ON COLUMN admin_users.password_hash IS '密码哈希（bcrypt）';
COMMENT ON COLUMN admin_users.nickname IS '昵称';
COMMENT ON COLUMN admin_users.status IS '状态：active=启用 / disabled=停用';
COMMENT ON COLUMN admin_users.mfa_secret IS 'MFA 密钥（启用时；空=未启用）';
COMMENT ON COLUMN admin_users.last_login_at IS '最后登录时间';
COMMENT ON COLUMN admin_users.created_at IS '创建时间';
COMMENT ON COLUMN admin_users.updated_at IS '更新时间';

COMMENT ON TABLE admin_sessions IS '管理员登录会话（refresh token 只存哈希，可撤销）';
COMMENT ON COLUMN admin_sessions.id IS '会话ID';
COMMENT ON COLUMN admin_sessions.admin_id IS '管理员ID';
COMMENT ON COLUMN admin_sessions.refresh_token_hash IS 'refresh token 哈希（唯一）';
COMMENT ON COLUMN admin_sessions.device IS '设备标识';
COMMENT ON COLUMN admin_sessions.ip IS '登录IP';
COMMENT ON COLUMN admin_sessions.user_agent IS '登录 UA';
COMMENT ON COLUMN admin_sessions.expires_at IS '过期时间';
COMMENT ON COLUMN admin_sessions.revoked_at IS '撤销时间（NULL=有效）';
COMMENT ON COLUMN admin_sessions.created_at IS '创建时间';

COMMENT ON TABLE admin_roles IS '管理角色（支持启停；super_admin 为内置超管角色）';
COMMENT ON COLUMN admin_roles.id IS '角色ID';
COMMENT ON COLUMN admin_roles.name IS '角色名称';
COMMENT ON COLUMN admin_roles.code IS '角色编码（唯一；super_admin=超级管理员）';
COMMENT ON COLUMN admin_roles.description IS '角色描述';
COMMENT ON COLUMN admin_roles.status IS '状态：active=启用 / disabled=停用（停用后权限不生效）';
COMMENT ON COLUMN admin_roles.created_at IS '创建时间';

COMMENT ON TABLE admin_permissions IS '权限码字典（模块/权限点）';
COMMENT ON COLUMN admin_permissions.id IS '权限ID';
COMMENT ON COLUMN admin_permissions.code IS '权限码（唯一）';
COMMENT ON COLUMN admin_permissions.name IS '权限名称';
COMMENT ON COLUMN admin_permissions.module IS '所属模块，如 system/user/group/report';
COMMENT ON COLUMN admin_permissions.description IS '权限说明';

COMMENT ON TABLE admin_role_permissions IS '角色-权限关联';
COMMENT ON COLUMN admin_role_permissions.role_id IS '角色ID';
COMMENT ON COLUMN admin_role_permissions.permission_id IS '权限ID';

COMMENT ON TABLE admin_user_roles IS '管理员-角色关联（一个管理员可多个角色）';
COMMENT ON COLUMN admin_user_roles.admin_id IS '管理员ID';
COMMENT ON COLUMN admin_user_roles.role_id IS '角色ID';

COMMENT ON TABLE admin_login_logs IS '管理员登录日志（失败锁定依据）';
COMMENT ON COLUMN admin_login_logs.id IS '日志ID';
COMMENT ON COLUMN admin_login_logs.admin_id IS '管理员ID（登录失败时可为空）';
COMMENT ON COLUMN admin_login_logs.success IS '是否成功';
COMMENT ON COLUMN admin_login_logs.fail_reason IS '失败原因（account_not_found/bad_password/locked 等）';
COMMENT ON COLUMN admin_login_logs.ip IS '登录IP';
COMMENT ON COLUMN admin_login_logs.user_agent IS '登录 UA';
COMMENT ON COLUMN admin_login_logs.request_id IS '请求ID（联查用）';
COMMENT ON COLUMN admin_login_logs.created_at IS '登录时间';

COMMENT ON TABLE admin_audit_logs IS '管理员操作审计日志（不可删除，普通管理员无权删除）';
COMMENT ON COLUMN admin_audit_logs.id IS '日志ID';
COMMENT ON COLUMN admin_audit_logs.admin_id IS '操作管理员ID';
COMMENT ON COLUMN admin_audit_logs.action IS '操作动作码';
COMMENT ON COLUMN admin_audit_logs.resource IS '资源类型';
COMMENT ON COLUMN admin_audit_logs.resource_id IS '资源ID';
COMMENT ON COLUMN admin_audit_logs.reason IS '操作原因（写操作必须填写）';
COMMENT ON COLUMN admin_audit_logs.before_value IS '变更前值';
COMMENT ON COLUMN admin_audit_logs.after_value IS '变更后值';
COMMENT ON COLUMN admin_audit_logs.ip IS '操作者IP';
COMMENT ON COLUMN admin_audit_logs.user_agent IS '操作者 UA';
COMMENT ON COLUMN admin_audit_logs.request_id IS '请求ID';
COMMENT ON COLUMN admin_audit_logs.result IS '结果：success=成功 / denied=被拒 / failed=失败';
COMMENT ON COLUMN admin_audit_logs.created_at IS '操作时间';
