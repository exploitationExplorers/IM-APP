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
    status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- 资料审核状态机：pending|approved|rejected
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

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE legal_documents IS '协议文档（用户协议/隐私政策，按类型+版本+语言唯一）';
COMMENT ON COLUMN legal_documents.id IS '文档ID';
COMMENT ON COLUMN legal_documents.type IS '类型：user_agreement=用户协议 / privacy_policy=隐私政策';
COMMENT ON COLUMN legal_documents.version IS '版本号';
COMMENT ON COLUMN legal_documents.language IS '语言（默认 zh）';
COMMENT ON COLUMN legal_documents.title IS '标题';
COMMENT ON COLUMN legal_documents.content_url IS '正文 URL';
COMMENT ON COLUMN legal_documents.status IS '状态：draft=草稿 / published=已发布';
COMMENT ON COLUMN legal_documents.published_at IS '发布时间';
COMMENT ON COLUMN legal_documents.created_at IS '创建时间';

COMMENT ON TABLE app_configs IS 'APP 配置（键值，草稿→发布）';
COMMENT ON COLUMN app_configs.key IS '配置键（主键）';
COMMENT ON COLUMN app_configs.value IS '配置值';
COMMENT ON COLUMN app_configs.description IS '配置说明';
COMMENT ON COLUMN app_configs.updated_by IS '更新管理员ID';
COMMENT ON COLUMN app_configs.updated_at IS '更新时间';

COMMENT ON TABLE app_config_versions IS '配置发布版本（保留前后值，可回滚）';
COMMENT ON COLUMN app_config_versions.id IS '版本记录ID';
COMMENT ON COLUMN app_config_versions.version IS '版本号';
COMMENT ON COLUMN app_config_versions.data_json IS '配置数据快照（JSON）';
COMMENT ON COLUMN app_config_versions.status IS '状态：draft=草稿 / published=已发布 / rolled_back=已回滚';
COMMENT ON COLUMN app_config_versions.published_at IS '发布时间';
COMMENT ON COLUMN app_config_versions.created_by IS '操作管理员ID';
COMMENT ON COLUMN app_config_versions.created_at IS '创建时间';

COMMENT ON TABLE sensitive_word_versions IS '敏感词词库版本';
COMMENT ON COLUMN sensitive_word_versions.id IS '版本记录ID';
COMMENT ON COLUMN sensitive_word_versions.version IS '版本号';
COMMENT ON COLUMN sensitive_word_versions.total IS '词库总数';
COMMENT ON COLUMN sensitive_word_versions.status IS '状态';
COMMENT ON COLUMN sensitive_word_versions.published_at IS '发布时间';
COMMENT ON COLUMN sensitive_word_versions.created_by IS '操作管理员ID';
COMMENT ON COLUMN sensitive_word_versions.created_at IS '创建时间';

COMMENT ON TABLE moderation_hits IS '敏感词命中记录（拦截/待审核）';
COMMENT ON COLUMN moderation_hits.id IS '命中记录ID';
COMMENT ON COLUMN moderation_hits.user_id IS '触发用户ID';
COMMENT ON COLUMN moderation_hits.field IS '触发字段：nickname=昵称 / group_name=群名 / announcement=群公告';
COMMENT ON COLUMN moderation_hits.content IS '命中内容';
COMMENT ON COLUMN moderation_hits.matched_word IS '命中的敏感词';
COMMENT ON COLUMN moderation_hits.category IS '敏感词分类';
COMMENT ON COLUMN moderation_hits.disposition IS '处置：intercept=拦截 / pending_review=待审核';
COMMENT ON COLUMN moderation_hits.created_at IS '命中时间';

COMMENT ON TABLE profile_moderation_records IS '头像/昵称资料审核记录（状态机 pending|approved|rejected）';
COMMENT ON COLUMN profile_moderation_records.id IS '记录ID';
COMMENT ON COLUMN profile_moderation_records.user_id IS '用户ID';
COMMENT ON COLUMN profile_moderation_records.field IS '审核字段：avatar=头像 / nickname=昵称';
COMMENT ON COLUMN profile_moderation_records.old_value IS '原值';
COMMENT ON COLUMN profile_moderation_records.new_value IS '新值（待审核）';
COMMENT ON COLUMN profile_moderation_records.status IS '状态：pending=待审 / approved=通过 / rejected=驳回';
COMMENT ON COLUMN profile_moderation_records.handler_id IS '处理管理员ID';
COMMENT ON COLUMN profile_moderation_records.reason IS '处理原因';
COMMENT ON COLUMN profile_moderation_records.handled_at IS '处理时间';
COMMENT ON COLUMN profile_moderation_records.created_at IS '创建时间';

COMMENT ON TABLE system_error_events IS '系统错误事件（不保存 Secret/Token/连接串）';
COMMENT ON COLUMN system_error_events.id IS '事件ID';
COMMENT ON COLUMN system_error_events.service IS '来源服务';
COMMENT ON COLUMN system_error_events.level IS '级别：error|warn 等';
COMMENT ON COLUMN system_error_events.fingerprint IS '错误指纹（聚合去重用）';
COMMENT ON COLUMN system_error_events.message IS '错误信息';
COMMENT ON COLUMN system_error_events.trace_id IS '链路ID';
COMMENT ON COLUMN system_error_events.count IS '出现次数';
COMMENT ON COLUMN system_error_events.first_at IS '首次时间';
COMMENT ON COLUMN system_error_events.last_at IS '最近时间';
COMMENT ON COLUMN system_error_events.stack IS '错误堆栈';

COMMENT ON TABLE export_jobs IS '导出任务（异步导出，短期签名链接）';
COMMENT ON COLUMN export_jobs.id IS '任务ID';
COMMENT ON COLUMN export_jobs.resource IS '导出资源类型（users/groups 等）';
COMMENT ON COLUMN export_jobs.filters IS '导出筛选条件（JSON）';
COMMENT ON COLUMN export_jobs.status IS '状态：pending=等待 / processing=处理中 / ready=就绪 / failed=失败 / expired=已过期';
COMMENT ON COLUMN export_jobs.file_id IS '导出文件ID';
COMMENT ON COLUMN export_jobs.file_url IS '导出文件 URL';
COMMENT ON COLUMN export_jobs.expires_at IS '链接过期时间';
COMMENT ON COLUMN export_jobs.created_by IS '创建管理员ID';
COMMENT ON COLUMN export_jobs.created_at IS '创建时间';
COMMENT ON COLUMN export_jobs.finished_at IS '完成时间';

COMMENT ON TABLE sms_provider_events IS '短信供应商事件（告警/切换；密钥不入业务表）';
COMMENT ON COLUMN sms_provider_events.id IS '事件ID';
COMMENT ON COLUMN sms_provider_events.provider IS '供应商名称';
COMMENT ON COLUMN sms_provider_events.event_type IS '事件类型：alarm=告警 / switch=切换';
COMMENT ON COLUMN sms_provider_events.detail IS '事件详情';
COMMENT ON COLUMN sms_provider_events.created_at IS '发生时间';
