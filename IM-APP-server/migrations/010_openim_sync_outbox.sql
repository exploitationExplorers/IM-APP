CREATE TABLE IF NOT EXISTS im_sync_outbox (
    id BIGSERIAL PRIMARY KEY,
    aggregate_type VARCHAR(32) NOT NULL DEFAULT 'user',
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NOT NULL DEFAULT '',
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(128) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT im_sync_outbox_status_check
        CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'dead'))
);

CREATE INDEX IF NOT EXISTS idx_im_sync_outbox_ready
    ON im_sync_outbox(status, next_attempt_at, id)
    WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_im_sync_outbox_aggregate
    ON im_sync_outbox(aggregate_type, aggregate_id, created_at DESC);

