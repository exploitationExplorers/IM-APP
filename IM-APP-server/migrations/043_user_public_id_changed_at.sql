-- 聊天号（users.public_id）支持「用户自己改一次」。
--
-- public_id_changed_at 为 NULL = 还没手动改过，还有一次机会；非 NULL = 用掉了。
-- ★ 注册时系统自动分配的随机号不算「改过」（见 repository.UserRepo.NextPublicID），
--   所以新用户这个字段是空的，仍然可以把系统发的号换成自己想要的。
--
-- 老用户的 chat10001… 这类递增号保持不动，他们要换也走同一个入口。
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.public_id_changed_at IS '聊天号手动修改时间；NULL 表示还可以改一次';
