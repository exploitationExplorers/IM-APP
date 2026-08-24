-- 用户自定义表情（我的表情）
CREATE TABLE IF NOT EXISTS user_stickers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id    UUID REFERENCES files(id) ON DELETE SET NULL,
    url        TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_stickers_user_created
    ON user_stickers(user_id, created_at DESC);

-- 同一用户同一文件不重复添加
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_stickers_user_file
    ON user_stickers(user_id, file_id)
    WHERE file_id IS NOT NULL;
