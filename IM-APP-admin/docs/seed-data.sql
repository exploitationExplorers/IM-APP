-- ============================================================
-- 管理后台联调假数据 seed（仅 admin 侧表，按 server 真实数据关联）
--
-- 只填充 admin migrations 001-008 创建的表，不写 server 服务的表。
-- 但凡是引用用户/群/管理员的地方，都用【动态子查询】从 server 真实表取值
-- （users / groups / admin_users），这样 admin 页面 LEFT JOIN 能显示真实昵称/群名。
--
-- 依赖：server 库中 users / groups / admin_users 已有真实数据（无数据则关联为空）。
-- 固定 UUID 的表可重复执行（ON CONFLICT DO NOTHING）。
-- 执行方式：Navicat/DBeaver/psql 对整个文件执行。
-- ============================================================

-- ---------- 1. 国家 / 地区（admin 002） ----------
INSERT INTO countries (code, dial_code, cn_name, en_name, phone_rule, enabled, sort_order) VALUES
('CN', '+86',  '中国', 'China',      '1[3-9]\d{9}', true,  1),
('HK', '+852', '中国香港', 'Hong Kong', '\d{8}',     true,  2),
('US', '+1',   '美国', 'United States', '(\d{10})',  true,  3),
('SG', '+65',  '新加坡', 'Singapore', '\d{8}',       true,  4),
('MY', '+60',  '马来西亚', 'Malaysia', '\d{9}',      true,  5)
ON CONFLICT (code) DO NOTHING;

-- ---------- 2. 用户限制与状态历史（admin 004；关联真实 users） ----------
INSERT INTO user_restrictions (user_id, type, banned, until, reason, operator_id, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 'login',   true,  NOW() + interval '30 days', '多次发送广告',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'message', true,  NOW() + interval '7 days',  '骚扰他人',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day')
ON CONFLICT (user_id, type) DO NOTHING;

INSERT INTO user_status_logs (user_id, from_status, to_status, reason, operator_id, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 'active', 'banned', '违规内容',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'active', 'cancelled', '用户注销', NULL, NOW() - interval '1 day');

-- ---------- 3. 群状态变更 / 消息撤回记录（admin 004；关联真实 groups） ----------
INSERT INTO group_status_logs (group_id, from_status, to_status, reason, operator_id, created_at) VALUES
((SELECT id FROM groups ORDER BY created_at LIMIT 1 OFFSET 0), 'active', 'banned', '群内大量广告',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '3 days');

INSERT INTO message_recall_logs (message_id, group_id, operator_type, operator_id, reason, created_at) VALUES
('20000000-0000-0000-0000-0000000000F1', (SELECT id FROM groups ORDER BY created_at LIMIT 1 OFFSET 0), 'admin',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '违规消息', NOW() - interval '1 day'),
('20000000-0000-0000-0000-0000000000F2', (SELECT id FROM groups ORDER BY created_at LIMIT 1 OFFSET 0), 'user',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), '发错了',   NOW() - interval '6 hours');

-- ---------- 4. 举报与内容处置（admin 005；关联真实 users/groups/admin_users） ----------
INSERT INTO report_reasons (id, target_type, reason, language, sort_order, status, created_at) VALUES
('40000000-0000-0000-0000-000000000001', 'user',    '垃圾广告', 'zh', 1, 'active', NOW()),
('40000000-0000-0000-0000-000000000002', 'user',    '骚扰辱骂', 'zh', 2, 'active', NOW()),
('40000000-0000-0000-0000-000000000003', 'group',   '群内广告', 'zh', 1, 'active', NOW()),
('40000000-0000-0000-0000-000000000004', 'group',   '涉黄涉暴', 'zh', 2, 'active', NOW()),
('40000000-0000-0000-0000-000000000005', 'message', '诈骗信息', 'zh', 1, 'active', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO reports (id, report_no, reporter_id, target_type, target_id, reason_text, description, status, assignee_id, conclusion, action_taken, version, created_at, updated_at) VALUES
('20000000-0000-0000-0000-000000000001', 'REP20260814001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'user',
 (SELECT id::text FROM users ORDER BY created_at LIMIT 1 OFFSET 0), '垃圾广告', '持续私发广告',
 'pending', NULL, '', '', 1, NOW() - interval '3 days', NOW() - interval '3 days'),
('20000000-0000-0000-0000-000000000002', 'REP20260814002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'group',
 (SELECT id::text FROM groups ORDER BY created_at LIMIT 1 OFFSET 0), '群内广告', '群里全是广告',
 'processing', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '', '', 1, NOW() - interval '2 days', NOW() - interval '1 day'),
('20000000-0000-0000-0000-000000000003', 'REP20260814003',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 3), 'message', '20000000-0000-0000-0000-0000000000A1',
 '诈骗信息', '对方诱导转账',
 'resolved', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '证据确凿，封号处理', 'ban', 1, NOW() - interval '5 days', NOW() - interval '4 days'),
('20000000-0000-0000-0000-000000000004', 'REP20260814004',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 4), 'user',
 (SELECT id::text FROM users ORDER BY created_at LIMIT 1 OFFSET 2), '骚扰辱骂', '骂人',
 'rejected', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '证据不足', '', 1, NOW() - interval '4 days', NOW() - interval '4 days'),
('20000000-0000-0000-0000-000000000005', 'REP20260814005',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 'group',
 (SELECT id::text FROM groups ORDER BY created_at LIMIT 1 OFFSET 1), '群内广告', '有人发贷款广告',
 'reopened', NULL, '', '', 2, NOW() - interval '6 days', NOW() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_notes (report_id, admin_id, content, created_at) VALUES
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '已联系举报人核实', NOW() - interval '1 day'),
('20000000-0000-0000-0000-000000000003', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '保留聊天记录', NOW() - interval '4 days');

INSERT INTO report_actions (report_id, admin_id, action, before_status, after_status, detail, created_at) VALUES
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'assign', '',       '',        '指派处理', NOW() - interval '1 day'),
('20000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'start',  'pending', 'processing', '开始处理', NOW() - interval '20 hours'),
('20000000-0000-0000-0000-000000000003', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'resolve','pending', 'resolved', '结案', NOW() - interval '4 days'),
('20000000-0000-0000-0000-000000000005', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'reject', 'pending', 'rejected', '证据不足', NOW() - interval '4 days'),
('20000000-0000-0000-0000-000000000005', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'reopen', 'rejected', 'reopened', '重新打开', NOW() - interval '2 hours');

INSERT INTO report_files (id, report_id, file_id, file_url, content_type, message_id, created_at) VALUES
('20000000-0000-0000-0000-0000000000D1', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000E1', 'https://cdn.example.com/evidence/001.jpg', 'image/jpeg', '20000000-0000-0000-0000-0000000000A1', NOW() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

-- ---------- 5. 转发用户限额（admin 006；关联真实 users；forward_tasks 主表在 server 侧未写） ----------
INSERT INTO forward_user_limits (user_id, daily_limit, hourly_limit, single_targets, enabled, updated_by, updated_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 50, 10, 100, true,
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 200, 50, 500, true,
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 days')
ON CONFLICT (user_id) DO NOTHING;

-- ---------- 6. APP 版本 / 协议 / 敏感词审核（admin 001/007/008） ----------
INSERT INTO app_versions (id, platform, version, description, download_url, force_upgrade, status, created_at) VALUES
('60000000-0000-0000-0000-000000000001', 'android', '2.3.0', '新增群聊详情', 'https://cdn.example.com/app/android/2.3.0.apk', true,  'published', NOW() - interval '10 days'),
('60000000-0000-0000-0000-000000000002', 'ios',     '2.3.0', '修复若干 bug',  'https://apps.apple.com/xx/2.3.0',             false, 'published', NOW() - interval '9 days'),
('60000000-0000-0000-0000-000000000003', 'android', '2.4.0', '灰度测试中',    'https://cdn.example.com/app/android/2.4.0.apk', false, 'draft',     NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO legal_documents (id, type, version, language, title, content_url, status, published_at, created_at) VALUES
('70000000-0000-0000-0000-000000000001', 'user_agreement',   '1.2', 'zh', '用户服务协议', 'https://cdn.example.com/legal/agreement-1.2.html', 'published', NOW() - interval '20 days', NOW() - interval '20 days'),
('70000000-0000-0000-0000-000000000002', 'privacy_policy',   '1.1', 'zh', '隐私政策',     'https://cdn.example.com/legal/privacy-1.1.html',   'published', NOW() - interval '20 days', NOW() - interval '20 days'),
('70000000-0000-0000-0000-000000000003', 'user_agreement',   '1.3', 'zh', '用户服务协议', 'https://cdn.example.com/legal/agreement-1.3.html', 'draft',     NULL, NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensitive_words (word, category, status, created_at) VALUES
('赌博', '违法', 'active', NOW()), ('裸聊', '色情', 'active', NOW()),
('刷单', '广告', 'active', NOW()), ('代开发票', '广告', 'active', NOW()),
('兼职日结', '广告', 'disabled', NOW())
ON CONFLICT (word) DO NOTHING;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0), 'nickname', '专业刷单联系我', '刷单', '广告', 'intercept', NOW() - interval '2 days'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1), 'nickname', '现金贷秒批',     '贷款', '广告', 'pending_review', NOW() - interval '1 day');

INSERT INTO profile_moderation_records (user_id, field, old_value, new_value, status, handler_id, reason, handled_at, created_at) VALUES
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2), 'nickname', '包小姐',   '',        'rejected',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '违规昵称', NOW() - interval '1 day', NOW() - interval '1 day'),
((SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 3), 'avatar',   '头像-1',   '头像-2',  'pending', NULL, '', NULL, NOW() - interval '3 hours');

-- ---------- 7. 运行观测（admin 007） ----------
INSERT INTO system_error_events (service, level, fingerprint, message, trace_id, count, first_at, last_at, stack) VALUES
('openim-sync', 'error',   'sync-timeout',   'OpenIM 消息同步超时',    'trace-0001', 12, NOW() - interval '2 days', NOW() - interval '2 hours', ''),
('sms-gateway', 'warning', 'sms-provider-1', '短信通道异常率升高',     'trace-0002', 5,  NOW() - interval '1 day',  NOW() - interval '5 hours', '');

INSERT INTO export_jobs (id, resource, filters, status, file_url, expires_at, created_by, created_at, finished_at) VALUES
('80000000-0000-0000-0000-000000000001', 'users',   '',        'ready',  'https://cdn.example.com/export/users-20260814.csv', NOW() + interval '1 day',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 hour', NOW() - interval '30 minutes'),
('80000000-0000-0000-0000-000000000002', 'reports', 'status=pending', 'failed', '', NULL,
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '2 hours', NOW() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

-- ---------- 8. 系统限制 / 转发规则配置（admin 007，app_configs） ----------
INSERT INTO app_configs (key, value, description, updated_by, updated_at) VALUES
('system.limits', '{"maxFileSizeMb":20,"maxGroupMembers":200,"recallWindowSec":120,"maxForwardTargets":10000,"maxNicknameLen":32}', '系统限制配置',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day'),
('forward.settings', '{"defaultDailyLimit":100,"defaultHourlyLimit":20,"defaultSingleTargets":10000,"maxSingleTargets":100000}', '全局转发规则',
 (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW() - interval '1 day')
ON CONFLICT (key) DO NOTHING;

-- ---------- 9. 管理端审计 / 登录日志（admin 003；关联真实 admin_users） ----------
INSERT INTO admin_login_logs (admin_id, success, fail_reason, ip, user_agent, request_id, created_at) VALUES
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), true,  '',              '127.0.0.1', 'Mozilla/5.0 (Windows)', 'req-0001', NOW() - interval '5 hours'),
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), false, 'password-error','127.0.0.1', 'Mozilla/5.0 (Windows)', 'req-0002', NOW() - interval '4 hours'),
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), true,  '',              '127.0.0.1', 'Mozilla/5.0 (Windows)', 'req-0003', NOW() - interval '1 hour');

INSERT INTO admin_audit_logs (admin_id, action, resource, resource_id, reason, before_value, after_value, ip, user_agent, request_id, result, created_at) VALUES
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'PUT /api/admin/v1/users/:id/ban',  'user',  (SELECT id::text FROM users ORDER BY created_at LIMIT 1 OFFSET 0), '违规内容', 'active', 'banned', '127.0.0.1', 'Mozilla/5.0', 'req-0004', 'success', NOW() - interval '2 days'),
((SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'POST /api/admin/v1/reports/:id/resolve', 'report', '20000000-0000-0000-0000-000000000003', '证据确凿', 'pending', 'resolved', '127.0.0.1', 'Mozilla/5.0', 'req-0005', 'success', NOW() - interval '4 days');

-- ============================================================
-- 完成。说明：
--   * 只写 admin 控制的表，未新增任何 server 服务的表数据。
--   * 引用用户/群/管理员的字段通过动态子查询关联 server 真实数据，
--     admin 页面可显示真实昵称/群名。
--   * users / groups / admin_users 为空时，关联字段为空（部分 NOT NULL 插入会失败），
--     建议先确保 server 库有业务数据。
--   * 转发任务主表 forward_tasks 在 server 侧（本 seed 不写），
--     如需转发任务列表有数据，另见 seed-data-extra.sql 说明。
-- ============================================================
