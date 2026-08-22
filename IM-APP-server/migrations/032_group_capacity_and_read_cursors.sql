-- 群容量配置审计与群聊已读游标。
-- 技术硬上限不写入数据库，统一由 GROUP_MEMBER_HARD_LIMIT 环境变量控制。

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_max_members_check;
ALTER TABLE groups ADD CONSTRAINT groups_max_members_check CHECK (max_members >= 3);

-- server 可独立启动；管理端完整迁移会在相同表上幂等补齐配置数据。
CREATE TABLE IF NOT EXISTS app_config_versions (
    id BIGSERIAL PRIMARY KEY,
    version INT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_member_limit_logs (
    id                    BIGSERIAL PRIMARY KEY,
    group_id              UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    old_limit             INT NOT NULL,
    new_limit             INT NOT NULL,
    member_count_snapshot INT NOT NULL,
    platform_limit_snapshot INT NOT NULL,
    operator_type         VARCHAR(16) NOT NULL DEFAULT 'admin',
    operator_id           UUID,
    reason                TEXT NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_member_limit_logs_group_created
    ON group_member_limit_logs(group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS im_group_read_cursors (
    conversation_id VARCHAR(128) NOT NULL,
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    has_read_seq    BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_im_group_read_cursors_top
    ON im_group_read_cursors(conversation_id, has_read_seq DESC);

COMMENT ON TABLE im_group_read_cursors IS '群成员主动上报的 OpenIM 已读游标；查询任一成员已读只取其他成员最大游标';
COMMENT ON TABLE group_member_limit_logs IS '单群人数上限变更审计；降低上限不会踢出现有成员';
