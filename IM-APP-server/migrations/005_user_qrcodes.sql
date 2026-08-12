-- 用户二维码：每个用户唯一 token，注册成功即生成
CREATE TABLE IF NOT EXISTS user_qrcodes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_qrcodes_user ON user_qrcodes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_qrcodes_token ON user_qrcodes(token);
