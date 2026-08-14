-- ============================================================
-- 敏感词相关模拟数据
-- 执行方式：在数据库工具（Navicat/DBeaver/psql）里对整个文件执行，
--           或复制需要的部分执行。可重复执行（不冲突）。
-- ============================================================

-- ---------- 1. 敏感词词库 sensitive_words ----------
-- 对应后台「内容审核」页的敏感词配置（Tab 敏感词）
INSERT INTO sensitive_words (word, category, status) VALUES
('赌博',       '赌博', 'active'),
('裸聊',       '色情', 'active'),
('刷单',       '广告', 'active'),
('贷款',       '广告', 'active'),
('代开发票',   '广告', 'active'),
('诈骗',       '违法', 'active'),
('暴恐',       '违法', 'active'),
('办证',       '广告', 'active'),
('兼职日结',   '广告', 'active'),
('私服',       '游戏违规', 'disabled')
ON CONFLICT (word) DO NOTHING;

-- ---------- 2. 敏感词命中记录 moderation_hits ----------
-- 对应后台「内容审核」页的「敏感词命中记录」Tab
-- 命中记录从 users 表取真实用户 id（若 users 无数据，user_id 显示为空，不影响展示）
INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'nickname', '专业刷单加V', '刷单', '广告', 'intercept',
       NOW() - INTERVAL '2 hours'
FROM users u ORDER BY u.created_at LIMIT 1;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'group_name', '赌博交流群', '赌博', '赌博', 'intercept',
       NOW() - INTERVAL '5 hours'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 1;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'announcement', '欢迎加入，扫码领贷款', '贷款', '广告', 'pending_review',
       NOW() - INTERVAL '1 day'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 2;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'nickname', '代开发票 联系VX', '代开发票', '广告', 'pending_review',
       NOW() - INTERVAL '2 days'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 3;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'group_name', '深夜裸聊直播间', '裸聊', '色情', 'intercept',
       NOW() - INTERVAL '3 days'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 4;

INSERT INTO moderation_hits (user_id, field, content, matched_word, category, disposition, created_at)
SELECT u.id, 'nickname', '兼职日结 一小时50', '兼职日结', '广告', 'intercept',
       NOW() - INTERVAL '4 days'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 5;

-- ---------- 3. （可选）资料审核待处理记录 profile_moderation_records ----------
-- 对应「待审核资料」Tab
INSERT INTO profile_moderation_records (user_id, field, old_value, new_value, status)
SELECT u.id, 'nickname', '', '专业刷单', 'pending'
FROM users u ORDER BY u.created_at LIMIT 1;

INSERT INTO profile_moderation_records (user_id, field, old_value, new_value, status)
SELECT u.id, 'avatar', '', '', 'pending'
FROM users u ORDER BY u.created_at LIMIT 1 OFFSET 1;
