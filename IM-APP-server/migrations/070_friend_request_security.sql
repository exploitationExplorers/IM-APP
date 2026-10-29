-- 来源授权仅由精确搜索或二维码解析产生，不能以客户端声明替代。
CREATE TABLE IF NOT EXISTS friend_source_grants (
    from_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('public_id', 'user_qrcode')),
    expires_at TIMESTAMPTZ NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (from_user, to_user, source)
);

-- 账号级滑动窗口：不同 IP、不同申请来源共用配额。
CREATE TABLE IF NOT EXISTS friend_request_attempts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_friend_request_attempts_user_time
    ON friend_request_attempts(user_id, created_at);
