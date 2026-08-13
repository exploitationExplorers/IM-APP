-- 隐私设置：默认加好友无需验证（对齐参考站 IsManualVerified=0）
CREATE TABLE IF NOT EXISTS privacy_settings (
    user_id                   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    require_friend_approval   BOOLEAN NOT NULL DEFAULT FALSE,
    require_group_approval    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 为已有用户补默认行
INSERT INTO privacy_settings (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
