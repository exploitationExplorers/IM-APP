ALTER TABLE groups ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS all_muted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS im_message_audit (
    id BIGSERIAL PRIMARY KEY,
    callback_command VARCHAR(96) NOT NULL,
    server_msg_id VARCHAR(128) NOT NULL DEFAULT '',
    client_msg_id VARCHAR(128) NOT NULL DEFAULT '',
    conversation_id VARCHAR(192) NOT NULL DEFAULT '',
    sender_im_id VARCHAR(64) NOT NULL DEFAULT '',
    receiver_im_id VARCHAR(64) NOT NULL DEFAULT '',
    group_im_id VARCHAR(64) NOT NULL DEFAULT '',
    content_type INTEGER NOT NULL DEFAULT 0,
    seq BIGINT NOT NULL DEFAULT 0,
    send_time BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_im_message_audit_callback_message
    ON im_message_audit(callback_command, conversation_id, server_msg_id, client_msg_id, seq);
CREATE INDEX IF NOT EXISTS idx_im_message_audit_created_at
    ON im_message_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS im_system_message_requests (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    receiver_type VARCHAR(16) NOT NULL CHECK (receiver_type IN ('user', 'group')),
    receiver_business_id UUID NOT NULL,
    message_type VARCHAR(16) NOT NULL CHECK (message_type IN ('text', 'custom')),
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    server_msg_id VARCHAR(128) NOT NULL DEFAULT '',
    client_msg_id VARCHAR(128) NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE im_system_message_requests
    ADD COLUMN IF NOT EXISTS request_hash CHAR(64) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_im_system_message_status
    ON im_system_message_requests(status, updated_at);
