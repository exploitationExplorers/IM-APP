-- 群号从递增数字改为 qun_ + 随机串（对齐聊天号 chat_），并支持群主改一次。
-- 已有数字群号一次性迁成 qun_，避免被按序列号猜群加群。

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_public_id_numeric_check;

ALTER TABLE groups ALTER COLUMN public_id TYPE VARCHAR(32);

-- 新建群由应用层写入随机号，不再用序列默认值
ALTER TABLE groups ALTER COLUMN public_id DROP DEFAULT;

ALTER TABLE groups ADD COLUMN IF NOT EXISTS public_id_changed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS groups_public_id_lower_key ON groups (lower(public_id));

-- 存量数字群号 → qun_ + md5(uuid) 前 14 位（小写十六进制，足够分散）
UPDATE groups
SET public_id = 'qun_' || substr(md5(id::text), 1, 14)
WHERE public_id ~ '^[0-9]+$';
