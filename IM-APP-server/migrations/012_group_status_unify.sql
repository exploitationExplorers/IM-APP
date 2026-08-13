-- 群状态词表统一为 active / dismissed / banned
-- 历史上业务侧写过 dissolved、管理后台建列时默认 normal，两者都要归一，
-- 否则合并后业务查询（只认 active）会把这些群当成不可用。
UPDATE groups SET status='active'    WHERE status = 'normal';
UPDATE groups SET status='dismissed' WHERE status = 'dissolved';

ALTER TABLE groups ALTER COLUMN status SET DEFAULT 'active';
