-- 用户收藏（收藏消息：文字/图片/视频/文件/语音）
CREATE TABLE IF NOT EXISTS favorites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    msg_type        VARCHAR(16) NOT NULL DEFAULT 'text',  -- text|emoji|image|video|file|voice
    content         TEXT        NOT NULL DEFAULT '',       -- 收藏快照（文本或文件地址/JSON）
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, message_id)  -- 同一用户不能重复收藏同一消息
);
CREATE INDEX IF NOT EXISTS idx_favorites_user_type ON favorites(user_id, msg_type, created_at DESC);
