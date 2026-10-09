-- 聊天号按用户输入保留大小写，但大小写不同不能同时存在。
CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_lower_key ON users (lower(public_id));
