-- 转发调度配置唯一事实来源；所有字段只控制处理速度和可靠性，不限制任务总量。
CREATE TABLE IF NOT EXISTS forward_delivery_settings (
    singleton                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    global_qps                 INT NOT NULL DEFAULT 20 CHECK (global_qps > 0),
    worker_concurrency         INT NOT NULL DEFAULT 4 CHECK (worker_concurrency > 0),
    claim_batch_size           INT NOT NULL DEFAULT 50 CHECK (claim_batch_size > 0),
    per_user_concurrency       INT NOT NULL DEFAULT 2 CHECK (per_user_concurrency > 0),
    retry_base_seconds         INT NOT NULL DEFAULT 2 CHECK (retry_base_seconds > 0),
    retry_max_seconds          INT NOT NULL DEFAULT 300 CHECK (retry_max_seconds > 0),
    processing_lock_seconds    INT NOT NULL DEFAULT 300 CHECK (processing_lock_seconds > 0),
    queue_paused               BOOLEAN NOT NULL DEFAULT FALSE,
    retention_days             INT NOT NULL DEFAULT 30 CHECK (retention_days > 0),
    queue_alert_depth          BIGINT NOT NULL DEFAULT 100000 CHECK (queue_alert_depth > 0),
    version                    BIGINT NOT NULL DEFAULT 1,
    updated_by                 UUID,
    update_reason              TEXT NOT NULL DEFAULT '',
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO forward_delivery_settings(singleton) VALUES(TRUE)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS forward_delivery_settings_audit (
    id             BIGSERIAL PRIMARY KEY,
    admin_id       UUID,
    reason         TEXT NOT NULL,
    before_value   JSONB NOT NULL,
    after_value    JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
