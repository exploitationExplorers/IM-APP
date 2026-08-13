-- ============================================================
-- 007 运营配置与观测（清单 12.2 P1 表）
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 协议文档（版本/语言/发布状态）
CREATE TABLE IF NOT EXISTS legal_documents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         VARCHAR(32) NOT NULL,             -- user_agreement|privacy_policy
    version      VARCHAR(32) NOT NULL DEFAULT '1.0',
    language     VARCHAR(8)  NOT NULL DEFAULT 'zh',
    title        VARCHAR(128) NOT NULL DEFAULT '',
    content_url  TEXT        NOT NULL DEFAULT '',
    status       VARCHAR(16) NOT NULL DEFAULT 'draft', -- draft|published
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (type, version, language)
);

-- APP bootstrap 配置（键值，草稿→发布）
CREATE TABLE IF NOT EXISTS app_configs (
    key         VARCHAR(64) PRIMARY KEY,
    value       TEXT        NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT '',
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 配置版本（发布后保留前后值，可回滚）
CREATE TABLE IF NOT EXISTS app_config_versions (
    id           BIGSERIAL PRIMARY KEY,
    version      INT NOT NULL,
    data_json    TEXT        NOT NULL DEFAULT '',
    status       VARCHAR(16) NOT NULL DEFAULT 'draft', -- draft|published|rolled_back
    published_at TIMESTAMPTZ,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 敏感词词库版本
CREATE TABLE IF NOT EXISTS sensitive_word_versions (
    id           BIGSERIAL PRIMARY KEY,
    version      INT NOT NULL,
    total        INT NOT NULL DEFAULT 0,
    status       VARCHAR(16) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 敏感词命中记录
CREATE TABLE IF NOT EXISTS moderation_hits (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID,
    field       VARCHAR(32) NOT NULL DEFAULT '',   -- nickname|group_name|announcement
    content     TEXT        NOT NULL DEFAULT '',
    matched_word VARCHAR(128) NOT NULL DEFAULT '',
    category    VARCHAR(32) NOT NULL DEFAULT '',
    disposition VARCHAR(32) NOT NULL DEFAULT 'intercept', -- intercept|pending_review
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_hits_created ON moderation_hits(created_at DESC);

-- 头像/昵称审核记录
CREATE TABLE IF NOT EXISTS profile_moderation_records (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,
    field       VARCHAR(32) NOT NULL DEFAULT '',   -- avatar|nickname
    old_value   TEXT        NOT NULL DEFAULT '',
    new_value   TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|rejected|restored
    handler_id  UUID,
    reason      TEXT        NOT NULL DEFAULT '',
    handled_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profile_mod_user ON profile_moderation_records(user_id, status);

-- 系统错误事件（不保存 Secret/Token/连接串，清单 10.2）
CREATE TABLE IF NOT EXISTS system_error_events (
    id          BIGSERIAL PRIMARY KEY,
    service     VARCHAR(64)  NOT NULL DEFAULT '',
    level       VARCHAR(16)  NOT NULL DEFAULT 'error',
    fingerprint VARCHAR(128) NOT NULL DEFAULT '',
    message     TEXT         NOT NULL DEFAULT '',
    trace_id    VARCHAR(64)  NOT NULL DEFAULT '',
    count       INT          NOT NULL DEFAULT 1,
    first_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    stack       TEXT         NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sys_error_created ON system_error_events(last_at DESC);

-- 导出任务（异步导出，短期签名链接）
CREATE TABLE IF NOT EXISTS export_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource    VARCHAR(32) NOT NULL DEFAULT '',
    filters     TEXT        NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|processing|ready|failed|expired
    file_id     UUID,
    file_url    TEXT        NOT NULL DEFAULT '',
    expires_at  TIMESTAMPTZ,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_created ON export_jobs(created_by, created_at DESC);

-- 短信供应商事件（告警/切换；密钥不入业务表）
CREATE TABLE IF NOT EXISTS sms_provider_events (
    id         BIGSERIAL PRIMARY KEY,
    provider   VARCHAR(32) NOT NULL DEFAULT '',
    event_type VARCHAR(32) NOT NULL DEFAULT '',    -- alarm|switch
    detail     TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
