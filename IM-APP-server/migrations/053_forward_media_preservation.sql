-- Independently owned copies for direct SDK forwarding and queued forwarding.
-- Source messages, tasks and objects are retained; legacy tasks start pending.
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS media_archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_forward_tasks_media_pending
    ON forward_tasks (id) WHERE NOT media_archived;

CREATE TABLE IF NOT EXISTS forward_media_snapshots (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_hash VARCHAR(64) NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, source_hash)
);
