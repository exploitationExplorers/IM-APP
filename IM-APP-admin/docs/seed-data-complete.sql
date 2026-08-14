-- ============================================================
-- 补齐所有实体的详情接口数据（群/用户/转发任务全覆盖）
--
-- 确保按 id 查询的详情接口，对【每个】实体都有数据：
--   GET /groups/{id}/reports            → 每个群都有群举报
--   GET /groups/{id}/recall-logs        → 每个群都有撤回记录
--   GET /users/{id}/reports             → 每个用户都有被举报记录
--   GET /users/{id}/forward-tasks       → 每个用户都有转发任务
--   GET /forward-limits/users/{userId}  → 每个用户都有转发限额
--   GET /forward-tasks/{id}/targets     → 每个转发任务都有目标明细
--
-- 幂等：ON CONFLICT / WHERE NOT EXISTS，可重复执行。
-- 执行方式：Navicat/DBeaver/psql 对整个文件执行。
-- ============================================================

-- ---------- 1. 每个群：群类型举报（/groups/{id}/reports） ----------
INSERT INTO reports (id, report_no, reporter_id, target_type, target_id, reason_text, description, status, version, created_at, updated_at)
SELECT gen_random_uuid(),
       'REP' || to_char(NOW(),'YYYYMMDDHH24') || upper(substr(md5(random()::text),1,8)),
       (SELECT id FROM users WHERE id <> g.owner_id ORDER BY created_at LIMIT 1),
       'group', g.id::text, '群内广告', '联调举报数据', 'pending', 1, NOW() - interval '1 day', NOW() - interval '1 day'
FROM groups g
WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_type='group' AND r.target_id = g.id::text)
ON CONFLICT (report_no) DO NOTHING;

-- ---------- 2. 每个群：消息撤回记录（/groups/{id}/recall-logs） ----------
INSERT INTO message_recall_logs (message_id, group_id, operator_type, operator_id, reason, created_at)
SELECT gen_random_uuid(), g.id, 'admin', (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), '违规消息', NOW() - interval '1 day'
FROM groups g
WHERE NOT EXISTS (SELECT 1 FROM message_recall_logs m WHERE m.group_id = g.id);

-- ---------- 3. 每个用户：被举报记录（/users/{id}/reports） ----------
INSERT INTO reports (id, report_no, reporter_id, target_type, target_id, reason_text, description, status, version, created_at, updated_at)
SELECT gen_random_uuid(),
       'REP' || to_char(NOW(),'YYYYMMDDHH24') || upper(substr(md5(random()::text),1,8)),
       (SELECT id FROM users WHERE id <> u.id ORDER BY created_at LIMIT 1),
       'user', u.id::text, '垃圾广告', '联调举报数据', 'pending', 1, NOW() - interval '1 day', NOW() - interval '1 day'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_type='user' AND r.target_id = u.id::text)
ON CONFLICT (report_no) DO NOTHING;

-- ---------- 4. 每个用户：转发限额（/forward-limits/users/{userId}） ----------
INSERT INTO forward_user_limits (user_id, daily_limit, hourly_limit, single_targets, enabled, updated_by, updated_at)
SELECT u.id, 100, 20, 1000, true, (SELECT id FROM admin_users ORDER BY created_at LIMIT 1), NOW()
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM forward_user_limits l WHERE l.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

-- ---------- 5. 每个用户：转发任务（/users/{id}/forward-tasks） ----------
INSERT INTO forward_tasks (id, user_id, source_message_id, target_count, done_count, status, created_at, updated_at)
SELECT gen_random_uuid(), u.id, gen_random_uuid(), 1, 1, 'success', NOW() - interval '1 day', NOW() - interval '1 day'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM forward_tasks ft WHERE ft.user_id = u.id);

-- ---------- 6. 每个转发任务：目标明细（/forward-tasks/{id}/targets） ----------
INSERT INTO forward_task_targets (id, task_id, user_id, status, attempts, finished_at, created_at)
SELECT gen_random_uuid(), ft.id,
       (SELECT u.id FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM forward_task_targets t WHERE t.task_id=ft.id AND t.user_id=u.id)
        ORDER BY u.created_at LIMIT 1),
       'failed', 1, NOW(), NOW()
FROM forward_tasks ft
WHERE NOT EXISTS (SELECT 1 FROM forward_task_targets t WHERE t.task_id = ft.id)
ON CONFLICT (task_id, user_id) DO NOTHING;

-- ============================================================
-- 完成。执行后每个群/用户/转发任务在对应详情接口都有数据。
-- ============================================================
