CREATE TABLE IF NOT EXISTS feedbacks (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact        VARCHAR(64) NOT NULL DEFAULT '',
    content        VARCHAR(200) NOT NULL,
    image_file_id  UUID REFERENCES files(id) ON DELETE SET NULL,
    status         VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_user_created
    ON feedbacks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedbacks_status_created
    ON feedbacks(status, created_at DESC);
