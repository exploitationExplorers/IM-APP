-- ============================================================
-- 管理后台转发任务 seed（写 server 的 forward_tasks 主表 + admin 转发明细）
--
-- 注意：本文件会往 server 服务的 forward_tasks 表插入数据（user_id 关联真实 users），
--       这是管理后台「转发和群发管理」列表的数据源。
--       依赖 users 表已有真实用户。
-- 固定 UUID 可重复执行（ON CONFLICT DO NOTHING）。
-- 执行方式：Navicat/DBeaver/psql 对整个文件执行。
-- ============================================================

-- ---------- 1. 转发任务主表（server 表 forward_tasks） ----------
-- task_id：30000000-...-0001 ~ 0003；user_id 关联真实 users
INSERT INTO forward_tasks (id, user_id, source_message_id, target_count, done_count, status, created_at, updated_at) VALUES
('30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 0),
 '20000000-0000-0000-0000-0000000000B1', 3, 2, 'success',    NOW() - interval '3 days',  NOW() - interval '3 days'),
('30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 1),
 '20000000-0000-0000-0000-0000000000B2', 2, 1, 'processing', NOW() - interval '2 hours', NOW() - interval '1 hour'),
('30000000-0000-0000-0000-000000000003',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 2),
 NULL, 2, 0, 'cancelled', NOW() - interval '1 day', NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ---------- 2. 转发明细（admin 006 表 forward_task_targets；user_id 关联真实 users） ----------
-- task1 的明细（2 success + 1 failed）
INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, message_id, fail_code, finished_at, created_at) VALUES
('50000000-0000-0000-0000-0000000000B1', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 3), 'success', 1, '20000000-0000-0000-0000-0000000000C1', '', NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000B2', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 4), 'success', 1, '20000000-0000-0000-0000-0000000000C2', '', NOW() - interval '3 days', NOW() - interval '3 days'),
('50000000-0000-0000-0000-0000000000B3', '30000000-0000-0000-0000-000000000001',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 5), 'failed',  2, NULL, 'friend_blocked', NOW() - interval '3 days', NOW() - interval '3 days'),
-- task2 的明细（1 success + 1 pending）
('50000000-0000-0000-0000-0000000000B4', '30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 6), 'success', 1, '20000000-0000-0000-0000-0000000000C3', '', NOW() - interval '1 hour', NOW() - interval '2 hours'),
('50000000-0000-0000-0000-0000000000B5', '30000000-0000-0000-0000-000000000002',
 (SELECT id FROM users ORDER BY created_at LIMIT 1 OFFSET 7), 'pending', 0, NULL, '', NULL, NOW() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

-- ---------- 3. 转发操作记录（admin 006 表 forward_task_actions；admin_id 关联真实 admin） ----------
INSERT INTO forward_task_actions (task_id, admin_id, action, detail, created_at) VALUES
('30000000-0000-0000-0000-000000000003', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'cancel',       '终止任务',   NOW() - interval '1 day'),
('30000000-0000-0000-0000-000000000002', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'retry',        '重试失败目标', NOW() - interval '1 hour'),
('30000000-0000-0000-0000-000000000001', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), 'limit_change', '修改限额',   NOW() - interval '2 hours');

-- ============================================================
-- 完成。执行后：
--   * 「转发和群发管理」列表有 3 条任务（success/processing/cancelled）
--   * 点进任务详情能看到目标明细（成功/失败统计）与操作记录
-- 建议执行顺序：seed-data.sql → seed-data-extra.sql → seed-forward-tasks.sql
-- ============================================================
