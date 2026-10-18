-- Durable published visibility only. A preview/planned job never creates a row.
CREATE TABLE IF NOT EXISTS group_retention_visibility (
    group_id UUID PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    min_visible_seq BIGINT NOT NULL CHECK (min_visible_seq BETWEEN 1 AND 9007199254740991),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Separate apply leases from the read-only planning queue. Backend code must
-- receive an authoritative OpenIM acknowledgement before publishing visibility.
CREATE TABLE IF NOT EXISTS group_retention_applications (
    job_id BIGINT PRIMARY KEY REFERENCES group_retention_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','applying','retry','blocked','applied')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
    lease_token UUID,
    locked_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failure_code TEXT NOT NULL DEFAULT '' CHECK (failure_code IN ('','adapter_unavailable','apply_failed','non_prefix','attempts_exhausted')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status='applying') = (lease_token IS NOT NULL AND locked_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_group_retention_apply_ready
    ON group_retention_applications(next_attempt_at,job_id) WHERE status IN ('queued','applying','retry');
