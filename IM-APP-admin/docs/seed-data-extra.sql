-- ============================================================
-- 管理后台联调假数据 seed-extra（补充表，按 server 真实数据关联）
--
-- 覆盖 seed-data.sql 之外的其余 admin 控制表（18 张）。
-- 引用用户/群/管理员/转发任务的地方用【动态子查询】关联 server 真实数据。
--
-- 依赖：先执行 seed-data.sql（report_assignments 引用其中的 reports）。
-- 说明：admin_permissions 已由 003 migration 初始化权限码，本文件不重复插入；
--       新增测试管理员 operator1 / viewer1（密码 123456，仅测试）。
-- 执行方式：Navicat/DBeaver/psql 对整个文件执行（可重复执行）。
-- ============================================================

-- ---------- 1. 旧版遗留表（001 早期表，代码未使用，仅数据完整性） ----------
INSERT INTO roles (id, name, description, created_at) VALUES
('C0000000-0000-0000-0000-000000000001', '超级管理员', '旧表角色-超级管理员', NOW()),
('C0000000-0000-0000-0000-000000000002', '运营',       '旧表角色-运营',       NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission) VALUES
('C0000000-0000-0000-0000-000000000001', 'user.list'),
('C0000000-0000-0000-0000-000000000001', 'user.block'),
('C0000000-0000-0000-0000-000000000001', 'group.dissolve'),
('C0000000-0000-0000-0000-000000000002', 'sms.view')
ON CONFLICT (role_id, permission) DO NOTHING;

INSERT INTO admins (id, username, password_hash, nickname, role_id, status, last_login_at, created_at, updated_at) VALUES
('D0000000-0000-0000-0000-000000000001', 'legacy_admin', 'seed', '旧管理员1', 'C0000000-0000-0000-0000-000000000001', 'active', NOW() - interval '3 days', NOW() - interval '10 days', NOW() - interval '3 days'),
('D0000000-0000-0000-0000-000000000002', 'legacy_op',    'seed', '旧运营',    'C0000000-0000-0000-0000-000000000002', 'active', NULL, NOW() - interval '8 days', NOW() - interval '8 days')
ON CONFLICT (username) DO NOTHING;

INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail_json, ip, created_at) VALUES
('D0000000-0000-0000-0000-000000000001', 'user.block', 'user', (SELECT id::text FROM users ORDER BY created_at LIMIT 1), '{"reason":"旧表测试"}', '127.0.0.1', NOW() - interval '3 days'),
('D0000000-0000-0000-0000-000000000002', 'sms.config', 'sms_config', 'CN', '{}', '127.0.0.1', NOW() - interval '2 days');

INSERT INTO error_logs (module, message, stack, created_at) VALUES
('user',   '旧表错误示例-用户服务', '', NOW() - interval '2 days'),
('group',  '旧表错误示例-群服务',   '', NOW() - interval '1 day');

-- ---------- 2. RBAC 管理表（003；admin_permissions 已由 migration 初始化） ----------
-- 测试管理员（密码 123456，bcrypt）
INSERT INTO admin_users (id, username, password_hash, nickname, status, mfa_secret, last_login_at, created_at, updated_at) VALUES
('A0000000-0000-0000-0000-000000000001', 'operator1', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', '运营小王', 'active', '', NOW() - interval '5 hours', NOW() - interval '10 days', NOW() - interval '5 hours'),
('A0000000-0000-0000-0000-000000000002', 'viewer1',   '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi', '客服小李', 'active', '', NULL, NOW() - interval '5 days', NOW() - interval '5 days')
ON CONFLICT (username) DO NOTHING;

INSERT INTO admin_roles (id, name, code, description, status, created_at) VALUES
('B0000000-0000-0000-0000-000000000001', '运营专员', 'operator', '日常运营与举报处理', 'active', NOW() - interval '10 days'),
('B0000000-0000-0000-0000-000000000002', '只读查看', 'viewer',   '只读查看各模块',     'active', NOW() - interval '10 days')
ON CONFLICT (code) DO NOTHING;

-- operator：测试环境授予全部权限（方便联调各模块）
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT 'B0000000-0000-0000-0000-000000000001', id FROM admin_permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;
-- viewer：常用只读权限
INSERT INTO admin_role_permissions (role_id, permission_id) VALUES
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='users.read')),
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='reports.read')),
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='sms.logs.read')),
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='sms.statistics.read')),
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='app-versions.read')),
('B0000000-0000-0000-0000-000000000002', (SELECT id FROM admin_permissions WHERE code='moderation.words.read'))
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_user_roles (admin_id, role_id) VALUES
('A0000000-0000-0000-0000-000000000001', 'B0000000-0000-0000-0000-000000000001'),
('A0000000-0000-0000-0000-000000000002', 'B0000000-0000-0000-0000-000000000002')
ON CONFLICT (admin_id, role_id) DO NOTHING;

-- 管理端会话（引用真实 admin_users）
INSERT INTO admin_sessions (id, admin_id, refresh_token_hash, device, ip, user_agent, expires_at, created_at) VALUES
('A1000000-0000-0000-0000-000000000001', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'seed-refresh-hash-0001', 'Chrome-Win', '127.0.0.1', 'Mozilla/5.0 (Windows)', NOW() + interval '30 days', NOW() - interval '5 hours'),
('A1000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1 OFFSET 1), 'seed-refresh-hash-0002', 'Chrome-Mac', '127.0.0.1', 'Mozilla/5.0 (Macintosh)', NOW() + interval '30 days', NOW() - interval '1 day')
ON CONFLICT (refresh_token_hash) DO NOTHING;

-- ---------- 3. 转发明细（006；关联真实 users / forward_tasks） ----------
-- forward_tasks 主表在 server 侧。若库中有真实转发任务则关联插入；无则跳过。
INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, message_id, fail_code, finished_at, created_at)
SELECT '50000000-0000-0000-0000-0000000000A1', ft.id, (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 'success', 1, '20000000-0000-0000-0000-0000000000C1', '', NOW() - interval '1 day', NOW() - interval '1 day'
FROM forward_tasks ft ORDER BY ft.created_at LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, message_id, fail_code, finished_at, created_at)
SELECT '50000000-0000-0000-0000-0000000000A2', ft.id, (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'failed',  2, NULL, 'friend_blocked', NOW() - interval '1 day', NOW() - interval '1 day'
FROM forward_tasks ft ORDER BY ft.created_at LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, message_id, fail_code, finished_at, created_at)
SELECT '50000000-0000-0000-0000-0000000000A3', ft.id, (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'pending', 0, NULL, '', NULL, NOW() - interval '2 hours'
FROM forward_tasks ft ORDER BY ft.created_at DESC LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO forward_risk_events (user_id, task_id, risk_type, level, detail, created_at)
SELECT (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), ft.id, 'failure_rate', 'high', '失败率超过阈值', NOW() - interval '1 day'
FROM forward_tasks ft ORDER BY ft.created_at LIMIT 1;

INSERT INTO forward_risk_events (user_id, task_id, risk_type, level, detail, created_at)
SELECT (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), ft.id, 'frequency', 'medium', '短时间内频繁转发', NOW() - interval '5 hours'
FROM forward_tasks ft ORDER BY ft.created_at DESC LIMIT 1;

INSERT INTO forward_task_actions (task_id, admin_id, action, detail, created_at)
SELECT ft.id, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'cancel', '终止任务', NOW() - interval '20 hours'
FROM forward_tasks ft ORDER BY ft.created_at LIMIT 1;

INSERT INTO forward_task_actions (task_id, admin_id, action, detail, created_at)
SELECT ft.id, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'retry', '重试失败目标', NOW() - interval '1 hour'
FROM forward_tasks ft ORDER BY ft.created_at DESC LIMIT 1;

-- ---------- 4. 举报指派记录（005；引用 seed-data.sql 中已插入的 reports） ----------
INSERT INTO report_assignments (report_id, assigner_id, assignee_id, created_at) VALUES
('20000000-0000-0000-0000-000000000002',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1),
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1),
 NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ---------- 5. 版本快照表（007；created_by 引用真实 admin） ----------
INSERT INTO app_config_versions (version, data_json, status, published_at, created_by, created_at) VALUES
(1, '{"maxFileSizeMb":20,"maxGroupMembers":200,"recallWindowSec":120,"maxForwardTargets":10000,"maxNicknameLen":32}', 'published', NOW() - interval '2 days', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days'),
(2, '{"maxFileSizeMb":30,"maxGroupMembers":300,"recallWindowSec":180,"maxForwardTargets":20000,"maxNicknameLen":16}', 'draft',     NULL, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day');

INSERT INTO sensitive_word_versions (version, total, status, published_at, created_by, created_at) VALUES
(1, 35, 'published', NOW() - interval '3 days', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '3 days'),
(2, 40, 'draft',     NULL,                      (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day');

-- ---------- 6. 协议文档（旧表 app_policies，接口未使用，仅完整性） ----------
INSERT INTO app_policies (id, type, title, content, version, created_at) VALUES
('E0000000-0000-0000-0000-000000000001', 'user_agreement', '用户协议', '这是用户协议内容占位。', '1.0', NOW() - interval '30 days'),
('E0000000-0000-0000-0000-000000000002', 'privacy_policy', '隐私政策', '这是隐私政策内容占位。', '1.0', NOW() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- ---------- 7. 短信供应商事件（007） ----------
INSERT INTO sms_provider_events (provider, event_type, detail, created_at) VALUES
('aliyun',  'alarm',  '接口错误率超过 5%', NOW() - interval '2 days'),
('aliyun',  'switch', '切换备用通道',       NOW() - interval '1 day'),
('tencent', 'alarm',  '延迟升高',           NOW() - interval '6 hours');

-- ============================================================
-- 完成。说明：
--   * 只写 admin 控制的表，未新增任何 server 服务的表数据。
--   * 用户/群/管理员关联均取 server 真实数据；转发任务相关表在
--     server 有 forward_tasks 数据时才插入（无则自动跳过）。
--   * 建议执行顺序：先 seed-data.sql，再 seed-data-extra.sql。
--   * operator1 / viewer1 密码均为 123456（仅测试环境使用）。
--   * 若要让【转发任务列表】也有数据，需往 server 的 forward_tasks 写数据
--     （user_id 已有真实 users 可外键关联），需要可另生成一份。
-- ============================================================
