-- Planning only. A planned job is NOT permission to delete messages or objects.
CREATE TABLE IF NOT EXISTS group_retention_jobs (
    id BIGSERIAL PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    run_day DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','planning','retry','blocked','planned')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
    lease_token UUID,
    locked_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failure_code TEXT NOT NULL DEFAULT ''
        CHECK (failure_code IN ('','snapshot_unavailable','snapshot_invalid','plan_too_large','attempts_exhausted')),
    plan JSONB,
    committed_watermark BIGINT CHECK (committed_watermark >= 0),
    candidate_count INTEGER CHECK (candidate_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, run_day),
    CHECK ((status = 'planning') = (lease_token IS NOT NULL AND locked_until IS NOT NULL)),
    CHECK ((status = 'planned') = (plan IS NOT NULL AND committed_watermark IS NOT NULL AND candidate_count IS NOT NULL)),
    CHECK (plan IS NULL OR (plan->>'mode' = 'preview_only' AND octet_length(plan::text) <= 4194304))
);
CREATE INDEX IF NOT EXISTS idx_group_retention_ready
    ON group_retention_jobs(next_attempt_at, id) WHERE status IN ('queued','retry','planning');
