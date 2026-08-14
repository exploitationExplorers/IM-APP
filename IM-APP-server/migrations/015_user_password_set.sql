-- 是否用户主动设置过登录密码。验证码注册不设密码，安全页走「初始密码」而不是改密。
-- 已有账号默认 false：历史注册曾写入前端临时密码，用户并不知道，不能当已设密码。
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT false;
