-- 群二维码
CREATE TABLE IF NOT EXISTS group_qrcodes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    token      VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_qrcodes_group ON group_qrcodes(group_id);
CREATE INDEX IF NOT EXISTS idx_group_qrcodes_token ON group_qrcodes(token);

-- 好友申请来源（群内加好友校验）
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'public_id';
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS source_group_id UUID REFERENCES groups(id);

-- 群扩展字段
ALTER TABLE groups ADD COLUMN IF NOT EXISTS join_mode VARCHAR(16) NOT NULL DEFAULT 'open';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS all_muted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';

-- 群成员禁言
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- 入群申请
CREATE TABLE IF NOT EXISTS group_join_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remark      TEXT NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    handler_id  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_group ON group_join_requests(group_id, status);

-- 群邀请
CREATE TABLE IF NOT EXISTS group_invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    inviter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,
    status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_group_invitations_token ON group_invitations(token);
