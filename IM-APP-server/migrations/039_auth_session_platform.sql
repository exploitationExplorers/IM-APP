-- auth_sessions 增加 platform 列，用于移动端单设备登录互踢
-- 默认值 'web' 保证旧数据兼容（旧 session 无 UA 平台信息，按 web 处理不互踢）
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS platform VARCHAR(16) NOT NULL DEFAULT 'web';
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_platform ON auth_sessions(user_id, platform);
