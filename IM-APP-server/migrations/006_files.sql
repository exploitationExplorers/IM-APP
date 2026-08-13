-- 文件表（供头像/图片/语音/文件消息使用）
CREATE TABLE IF NOT EXISTS files (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    purpose      VARCHAR(32)  NOT NULL DEFAULT 'file',   -- avatar|image|voice|file|sticker
    object_key   VARCHAR(255) NOT NULL UNIQUE,
    content_type VARCHAR(128) NOT NULL DEFAULT '',
    size         BIGINT       NOT NULL DEFAULT 0,
    sha256       VARCHAR(64)  NOT NULL DEFAULT '',
    status       VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending|ready|rejected
    url          TEXT         NOT NULL DEFAULT '',          -- 最终可访问地址
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
