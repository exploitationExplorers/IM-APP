-- Phase 5: 消息转发异步任务
CREATE TABLE IF NOT EXISTS forward_tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_message_id UUID,
    target_count      INT NOT NULL DEFAULT 0,
    done_count        INT NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forward_tasks_user ON forward_tasks(user_id, created_at DESC);
