CREATE TABLE IF NOT EXISTS im_message_recalls (
    id BIGSERIAL PRIMARY KEY,
    conversation_id VARCHAR(192) NOT NULL,
    seq BIGINT NOT NULL CHECK (seq > 0),
    client_msg_id VARCHAR(128) NOT NULL,
    peer_type VARCHAR(16) NOT NULL CHECK (peer_type IN ('c2c', 'group')),
    peer_business_id VARCHAR(64) NOT NULL,
    sender_im_id VARCHAR(64) NOT NULL,
    operator_user_id UUID NOT NULL REFERENCES users(id),
    operator_im_id VARCHAR(64) NOT NULL,
    operator_role VARCHAR(16) NOT NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'recalled', 'failed')),
    last_error TEXT NOT NULL DEFAULT '',
    recalled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_im_message_recalls_operator
    ON im_message_recalls(operator_user_id, created_at DESC);
