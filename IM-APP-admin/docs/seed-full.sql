-- ============================================================
-- 管理后台全接口联调数据 seed（完整版）
--
-- 针对 admin 全部 88 个接口，按模块补齐所需数据。
-- 本次允许新增 server 服务的表数据（forward_tasks 等），
-- 以真实 users/groups/admin_users 关联（动态子查询）。
-- 全部幂等：ON CONFLICT DO NOTHING / 可重复执行。
-- 执行方式：Navicat/DBeaver/psql 对整个文件执行。
-- ============================================================

-- ============================================================
-- 模块 0：系统（/health /meta 无数据依赖）
-- ============================================================

-- ============================================================
-- 模块 3：用户管理
--   GET /users /users/{id} /users/{id}/groups /users/{id}/reports
--   /users/{id}/forward-tasks → 依赖 forward_tasks（下方补）
-- ============================================================

-- 补 3 个用户（若已执行旧 seed 则跳过），便于列表翻页
DELETE FROM users WHERE id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
INSERT INTO users (id, phone, country_code, password_hash, nickname, avatar, bio, status, public_id, phone_e164, created_at, updated_at) VALUES
('00000000-0000-0000-0000-000000000001', '13800000001', '+86', 'seed', '测试用户A', '', '联调数据', 'active',  'u100001', '+8613800000001', NOW() - interval '30 days', NOW() - interval '1 hour'),
('00000000-0000-0000-0000-000000000002', '13800000002', '+86', 'seed', '测试用户B', '', '联调数据', 'active',  'u100002', '+8613800000002', NOW() - interval '25 days', NOW() - interval '3 hours'),
('00000000-0000-0000-0000-000000000003', '13800000003', '+86', 'seed', '测试用户C', '', '联调数据', 'banned',  'u100003', '+8613800000003', NOW() - interval '20 days', NOW() - interval '1 day');

-- 好友关系（补几条，用户详情好友数有值）
DELETE FROM friendships WHERE user_id=(SELECT id FROM users ORDER BY created_at LIMIT 1) AND friend_id=(SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1);
INSERT INTO friendships (user_id, friend_id, remark, created_at)
SELECT a.id, b.id, '联调好友', NOW() - interval '5 days'
FROM users a, users b
WHERE a.id <> b.id AND a.id IN (SELECT id FROM users ORDER BY created_at LIMIT 1)
  AND b.id IN (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1);

-- 用户限制 / 状态历史（admin 004）
INSERT INTO user_restrictions (user_id, type, banned, until, reason, operator_id, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'login',   true,  NOW() + interval '30 days', '发送广告',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days')
ON CONFLICT (user_id, type) DO NOTHING;

INSERT INTO user_status_logs (user_id, from_status, to_status, reason, operator_id, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'active', 'banned', '违规内容',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day');

-- 登录会话（强制下线功能有数据可测）
DELETE FROM auth_sessions WHERE refresh_token_hash IN ('seed-full-hash-0001','seed-full-hash-0002');
INSERT INTO auth_sessions (user_id, device_id, refresh_token_hash, ip, user_agent, expires_at, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1), 'dev-test-1', 'seed-full-hash-0001', '10.0.0.1', 'Mozilla/5.0 (iPhone)', NOW() + interval '30 days', NOW() - interval '2 hours'),
((SELECT id FROM users ORDER BY created_at LIMIT 1), 'dev-test-2', 'seed-full-hash-0002', '10.0.0.2', 'Mozilla/5.0 (Android)', NOW() + interval '30 days', NOW() - interval '1 hour');

-- ============================================================
-- 模块 4：群组管理
--   GET /groups /groups/{id} /groups/{id}/members /groups/{id}/reports
--   /groups/{id}/recall-logs /groups/{id}/messages/{messageId}/recall
-- ============================================================

-- 补 2 个群（若已执行旧 seed 则跳过）
DELETE FROM groups WHERE id IN ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
INSERT INTO groups (id, name, avatar, owner_id, announcement, allow_member_add_friend, status, all_muted, created_at, updated_at) VALUES
('10000000-0000-0000-0000-000000000001', '联调产品群', '', (SELECT id FROM users ORDER BY created_at LIMIT 1), '群公告', true,  'active', false, NOW() - interval '15 days', NOW() - interval '1 day'),
('10000000-0000-0000-0000-000000000002', '联调运营群', '', (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), '',       false, 'banned', true,  NOW() - interval '10 days', NOW() - interval '2 days');

-- 群成员（真实 users 关联）
DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups ORDER BY created_at LIMIT 2) AND user_id IN (SELECT id FROM users ORDER BY created_at LIMIT 4);
INSERT INTO group_members (group_id, user_id, role, muted_until, joined_at)
SELECT g.id, u.id, 'member', NULL, NOW() - interval '10 days'
FROM groups g CROSS JOIN users u
WHERE g.id IN (SELECT id FROM groups ORDER BY created_at LIMIT 2)
  AND u.id IN (SELECT id FROM users ORDER BY created_at LIMIT 4);

-- 群状态变更（admin 004）
INSERT INTO group_status_logs (group_id, from_status, to_status, reason, operator_id, created_at) VALUES
((SELECT id FROM groups ORDER BY created_at DESC LIMIT 1), 'active', 'banned', '群内广告',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days');

-- 消息撤回记录（admin 004）
INSERT INTO message_recall_logs (message_id, group_id, operator_type, operator_id, reason, created_at) VALUES
('20000000-0000-0000-0000-0000000000F1', (SELECT id FROM groups ORDER BY created_at LIMIT 1), 'admin',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '违规消息', NOW() - interval '1 day'),
('20000000-0000-0000-0000-0000000000F2', (SELECT id FROM groups ORDER BY created_at LIMIT 1), 'user',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), '发错了', NOW() - interval '6 hours');

-- ============================================================
-- 模块 5：举报与内容处置
--   GET /reports /reports/{id} /reports/{id}/actions 等全部举报接口
-- ============================================================

INSERT INTO report_reasons (id, target_type, reason, language, sort_order, status, created_at) VALUES
('40000000-0000-0000-0000-000000000001', 'user',    '垃圾广告', 'zh', 1, 'active', NOW()),
('40000000-0000-0000-0000-000000000002', 'group',   '群内广告', 'zh', 1, 'active', NOW()),
('40000000-0000-0000-0000-000000000003', 'message', '诈骗信息', 'zh', 1, 'active', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO reports (id, report_no, reporter_id, target_type, target_id, reason_text, description, status, assignee_id, conclusion, action_taken, version, created_at, updated_at) VALUES
('20000000-0000-0000-0000-000000000001', 'REP20260815001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'user',
 (SELECT id::text FROM users ORDER BY created_at LIMIT 1 OFFSET 2), '垃圾广告', '私发广告',
 'pending', NULL, '', '', 1, NOW() - interval '3 days', NOW() - interval '3 days'),
('20000000-0000-0000-0000-000000000002', 'REP20260815002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1), 'group',
 (SELECT id::text FROM groups ORDER BY created_at LIMIT 1), '群内广告', '群里全是广告',
 'processing', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '', '', 1, NOW() - interval '2 days', NOW() - interval '1 day'),
('20000000-0000-0000-0000-000000000003', 'REP20260815003',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'message', '20000000-0000-0000-0000-0000000000A1',
 '诈骗信息', '诱导转账',
 'resolved', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '封号处理', 'ban', 1, NOW() - interval '5 days', NOW() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_notes (report_id, admin_id, content, created_at) VALUES
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '已联系举报人', NOW() - interval '1 day');

INSERT INTO report_actions (report_id, admin_id, action, before_status, after_status, detail, created_at) VALUES
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'assign',  '',       '',        '指派', NOW() - interval '1 day'),
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'start',   'pending', 'processing', '开始处理', NOW() - interval '20 hours'),
('20000000-0000-0000-0000-000000000003', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'resolve', 'pending', 'resolved', '结案', NOW() - interval '4 days');

-- ============================================================
-- 模块 6：转发/群发与风控（核心：补齐 forward_tasks 主表）
--   GET /forward-tasks /forward-tasks/{id} /forward-tasks/{id}/targets
--   /forward-tasks/{id}/failures /forward-limits/users/{userId} /forward-settings
-- ============================================================

DELETE FROM forward_tasks WHERE id IN ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003');
INSERT INTO forward_tasks (id, user_id, source_message_id, target_count, done_count, status, created_at, updated_at) VALUES
('30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1), '20000000-0000-0000-0000-0000000000B1', 3, 3, 'success',    NOW() - interval '3 days',  NOW() - interval '3 days'),
('30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), '20000000-0000-0000-0000-0000000000B2', 2, 1, 'processing', NOW() - interval '2 hours', NOW() - interval '1 hour'),
('30000000-0000-0000-0000-000000000003',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), NULL, 2, 0, 'cancelled', NOW() - interval '1 day', NOW() - interval '1 day');

-- 转发明细（挂到上面 3 个任务；含 success/failed/skipped 供统计）
INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, message_id, fail_code, finished_at, created_at) VALUES
('50000000-0000-0000-0000-0000000000C1', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 3), 'success', 1, '20000000-0000-0000-0000-0000000000D1', '', NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000C2', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 4), 'success', 1, '20000000-0000-0000-0000-0000000000D2', '', NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000C3', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 5), 'failed',  2, NULL, 'friend_blocked', NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000C4', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 6), 'skipped', 1, NULL, 'rate_limited',   NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000C5', '30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 7), 'success', 1, '20000000-0000-0000-0000-0000000000D3', '', NOW() - interval '1 hour', NOW() - interval '2 hours'),
('50000000-0000-0000-0000-0000000000C6', '30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 8), 'pending', 0, NULL, '', NULL, NOW() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

-- 转发操作记录
INSERT INTO forward_task_actions (task_id, admin_id, action, detail, created_at) VALUES
('30000000-0000-0000-0000-000000000003', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'cancel', '终止任务', NOW() - interval '1 day'),
('30000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'retry',  '重试失败目标', NOW() - interval '1 hour');

-- 转发风险事件（工作台待办）
INSERT INTO forward_risk_events (user_id, task_id, risk_type, level, detail, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1), '30000000-0000-0000-0000-000000000001', 'failure_rate', 'high',   '失败率超阈值', NOW() - interval '3 days'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), '30000000-0000-0000-0000-000000000003', 'frequency',    'medium', '频繁转发', NOW() - interval '1 day');

-- 用户转发限额
INSERT INTO forward_user_limits (user_id, daily_limit, hourly_limit, single_targets, enabled, updated_by, updated_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1), 50, 10, 100, true, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 200, 50, 500, true, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- 模块 7：国家与短信
--   GET /countries /sms/logs /sms/logs/{id} /sms/statistics /sms/providers/health
-- ============================================================

INSERT INTO countries (code, dial_code, cn_name, en_name, phone_rule, enabled, sort_order) VALUES
('CN', '+86',  '中国', 'China', '1[3-9]\d{9}', true, 1),
('HK', '+852', '中国香港', 'Hong Kong', '\d{8}', true, 2)
ON CONFLICT (code) DO NOTHING;

-- 短信日志（不同状态/时间，供统计与健康度）
DELETE FROM sms_send_logs WHERE id BETWEEN 9000000001 AND 9000000006;
INSERT INTO sms_send_logs (id, phone_e164, country_code, scene, provider, status, error_code, created_at) VALUES
(9000000001, '+8613800000001', '+86', 'login',     'aliyun',  'sent',   '', NOW() - interval '3 days'),
(9000000002, '+8613800000002', '+86', 'register',  'aliyun',  'sent',   '', NOW() - interval '2 days'),
(9000000003, '+8613800000003', '+86', 'reset_pwd', 'aliyun',  'failed', 'B0001', NOW() - interval '2 days'),
(9000000004, '+8613800000004', '+86', 'login',     'aliyun',  'sent',   '', NOW() - interval '1 day'),
(9000000005, '+85298765432',   '+852', 'register', 'tencent', 'sent',   '', NOW() - interval '1 day'),
(9000000006, '+8613800000005', '+86', 'login',     'aliyun',  'failed', 'A0021', NOW() - interval '3 hours');

-- 短信供应商事件
INSERT INTO sms_provider_events (provider, event_type, detail, created_at) VALUES
('aliyun',  'alarm',  '错误率升高', NOW() - interval '2 days'),
('tencent', 'switch', '切换通道',   NOW() - interval '1 day');

-- ============================================================
-- 模块 8：APP 与公共配置
--   GET /app-versions /legal-documents /report-reasons /system-limits
-- ============================================================

INSERT INTO app_versions (id, platform, version, description, download_url, force_upgrade, status, created_at) VALUES
('60000000-0000-0000-0000-000000000001', 'android', '2.3.0', '群聊详情', 'https://cdn.example.com/apk/2.3.0.apk', true,  'published', NOW() - interval '10 days'),
('60000000-0000-0000-0000-000000000002', 'ios',     '2.4.0', '修复bug',  'https://apps.apple.com/xx/2.4.0',        false, 'draft',     NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO legal_documents (id, type, version, language, title, content_url, status, published_at, created_at) VALUES
('70000000-0000-0000-0000-000000000001', 'user_agreement', '1.2', 'zh', '用户服务协议', 'https://cdn.example.com/legal/agreement.html', 'published', NOW() - interval '20 days', NOW() - interval '20 days'),
('70000000-0000-0000-0000-000000000002', 'privacy_policy', '1.1', 'zh', '隐私政策',     'https://cdn.example.com/legal/privacy.html',   'published', NOW() - interval '20 days', NOW() - interval '20 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_configs (key, value, description, updated_by, updated_at) VALUES
('system.limits', '{"maxFileSizeMb":20,"maxGroupMembers":200,"recallWindowSec":120,"maxForwardTargets":10000,"maxNicknameLen":32}', '系统限制',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day'),
('forward.settings', '{"defaultDailyLimit":100,"defaultHourlyLimit":20,"defaultSingleTargets":10000,"maxSingleTargets":100000}', '转发规则',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 模块 9：敏感词与资料审核
--   GET /sensitive-words /moderation/hits /moderation/profiles
-- ============================================================

INSERT INTO sensitive_words (word, category, status, created_at) VALUES
('赌博', '违法', 'active', NOW()), ('裸聊', '色情', 'active', NOW()),
('刷单', '广告', 'active', NOW()), ('兼职日结', '广告', 'disabled', NOW())
ON CONFLICT (word) DO NOTHING;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1), 'nickname', '专业刷单', '刷单', '广告', 'intercept', NOW() - interval '2 days'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'nickname', '现金贷', '贷款', '广告', 'pending_review', NOW() - interval '1 day');

INSERT INTO profile_moderation_records (user_id, field, old_value, new_value, status, handler_id, reason, handled_at, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'nickname', '旧昵称', '', 'rejected', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '违规昵称', NOW() - interval '1 day', NOW() - interval '1 day'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'avatar',   '旧头像', '新头像', 'pending', NULL, '', NULL, NOW() - interval '3 hours');

-- ============================================================
-- 模块 10：运行错误 / 导出 / 审计
--   GET /system/errors /exports /audit-logs /admin-login-logs
-- ============================================================

INSERT INTO system_error_events (service, level, fingerprint, message, trace_id, count, first_at, last_at, stack) VALUES
('openim-sync', 'error',   'sync-timeout', '消息同步超时', 'trace-001', 12, NOW() - interval '2 days', NOW() - interval '2 hours', ''),
('sms-gateway', 'warning', 'sms-prod-1',   '短信通道异常', 'trace-002', 5,  NOW() - interval '1 day',  NOW() - interval '5 hours', '');

INSERT INTO export_jobs (id, resource, filters, status, file_url, expires_at, created_by, created_at, finished_at) VALUES
('80000000-0000-0000-0000-000000000001', 'users', '', 'ready', 'https://cdn.example.com/export/users.csv', NOW() + interval '1 day',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 hour', NOW() - interval '30 minutes'),
('80000000-0000-0000-0000-000000000002', 'reports', 'status=pending', 'failed', '', NULL,
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 hours', NOW() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_login_logs (admin_id, success, fail_reason, ip, user_agent, request_id, created_at) VALUES
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), true,  '',              '127.0.0.1', 'Mozilla/5.0', 'req-full-01', NOW() - interval '5 hours'),
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), false, 'password-error','127.0.0.1', 'Mozilla/5.0', 'req-full-02', NOW() - interval '4 hours');

INSERT INTO admin_audit_logs (admin_id, action, resource, resource_id, reason, before_value, after_value, ip, user_agent, request_id, result, created_at) VALUES
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'PUT /api/admin/v1/users/:id/ban', 'user', (SELECT id::text FROM users ORDER BY created_at LIMIT 1), '违规', 'active', 'banned', '127.0.0.1', 'Mozilla/5.0', 'req-full-03', 'success', NOW() - interval '2 days');

-- ============================================================
-- 完成。覆盖 admin 全部接口数据：
--   系统/认证（无数据） · 用户 · 群组 · 举报 · 转发 · 国家短信 ·
--   APP配置 · 敏感词审核 · 运行观测 · 审计登录日志
-- 全部幂等可重复执行。执行前建议先跑 admin migrations 001-008。
-- ============================================================
