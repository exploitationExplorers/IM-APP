-- 无人数上限的 Kafka 转发任务状态、目标明细与事务 outbox。
-- Kafka 负责调度消费；PostgreSQL 负责进度、幂等、审计和可靠发布桥接。

ALTER TABLE forward_tasks
    ALTER COLUMN source_message_id TYPE VARCHAR(256) USING source_message_id::text,
    ALTER COLUMN target_count TYPE BIGINT,
    ALTER COLUMN done_count TYPE BIGINT,
	ALTER COLUMN status TYPE VARCHAR(32),
    ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS source_conversation_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS source_client_msg_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS source_server_msg_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS source_content_type INT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS selector JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS success_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS failed_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS skipped_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS cancelled_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE forward_tasks ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_tasks_user_idempotency
    ON forward_tasks(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_forward_tasks_user_created
    ON forward_tasks(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS forward_task_targets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES forward_tasks(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempts            INT NOT NULL DEFAULT 0,
    priority            INT NOT NULL DEFAULT 0,
    conversation_id     VARCHAR(256) NOT NULL DEFAULT '',
    sent_client_msg_id  VARCHAR(256) NOT NULL DEFAULT '',
    sent_server_msg_id  VARCHAR(256) NOT NULL DEFAULT '',
    fail_code           VARCHAR(64) NOT NULL DEFAULT '',
    failure_message     TEXT NOT NULL DEFAULT '',
    next_retry_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by           VARCHAR(128) NOT NULL DEFAULT '',
    locked_until        TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, user_id)
);

-- 沿用管理后台已发布的 user_id / fail_code 列名，避免破坏旧管理接口。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_targets' AND column_name='target_user_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_targets' AND column_name='user_id'
    ) THEN
        ALTER TABLE forward_task_targets RENAME COLUMN target_user_id TO user_id;
    END IF;
END $$;

ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS sent_client_msg_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS sent_server_msg_id VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS fail_code VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS failure_message TEXT NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_targets' AND column_name='message_id'
    ) THEN
        ALTER TABLE forward_task_targets ALTER COLUMN message_id TYPE VARCHAR(256) USING message_id::text;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forward_targets_claim
    ON forward_task_targets(status, next_retry_at, priority DESC, id)
    WHERE status IN ('pending','retrying','processing');
CREATE INDEX IF NOT EXISTS idx_forward_targets_task_status
    ON forward_task_targets(task_id, status, id);

CREATE TABLE IF NOT EXISTS forward_task_actions (
    id          BIGSERIAL PRIMARY KEY,
    task_id     UUID NOT NULL,
    admin_id    UUID,
    action      VARCHAR(32) NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 如果开发环境曾运行过新版草案，则恢复为管理后台兼容列。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_actions' AND column_name='operator_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_actions' AND column_name='admin_id'
    ) THEN
        ALTER TABLE forward_task_actions RENAME COLUMN operator_id TO admin_id;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='forward_task_actions' AND column_name='detail'
          AND data_type <> 'text'
    ) THEN
		ALTER TABLE forward_task_actions ALTER COLUMN detail DROP DEFAULT;
		ALTER TABLE forward_task_actions ALTER COLUMN detail TYPE TEXT USING detail::text;
		ALTER TABLE forward_task_actions ALTER COLUMN detail SET DEFAULT '';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forward_task_actions_task
    ON forward_task_actions(task_id, created_at DESC, id DESC);

-- 事务 outbox 只负责可靠地把“任务可消费”事件交给 Kafka；消息发送只由 Kafka consumer 驱动。
CREATE TABLE IF NOT EXISTS forward_kafka_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES forward_tasks(id) ON DELETE CASCADE,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by       VARCHAR(128) NOT NULL DEFAULT '',
    locked_until    TIMESTAMPTZ,
    last_error      TEXT NOT NULL DEFAULT '',
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_forward_kafka_outbox_claim
    ON forward_kafka_outbox(status, next_attempt_at, id)
    WHERE status IN ('pending','processing');
