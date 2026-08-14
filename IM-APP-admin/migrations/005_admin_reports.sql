-- ============================================================
-- 005 举报与内容处置（清单 05.2 / 12.1）
-- 清单要求与 APP 共用：report_reasons / reports / report_files
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 举报原因（按目标类型/语言/排序/启停，已被引用只能停用不能删除）
CREATE TABLE IF NOT EXISTS report_reasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16)  NOT NULL,             -- user|group|message
    reason      VARCHAR(128) NOT NULL,
    language    VARCHAR(8)   NOT NULL DEFAULT 'zh',
    sort_order  INT          NOT NULL DEFAULT 0,
    status      VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active|disabled
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_reasons_target ON report_reasons(target_type, status);

-- 举报工单（版本号/行锁防重复结案）
CREATE TABLE IF NOT EXISTS reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_no    VARCHAR(32) NOT NULL UNIQUE,
    reporter_id  UUID,
    target_type  VARCHAR(16) NOT NULL,             -- user|group|message
    target_id    VARCHAR(64) NOT NULL,
    reason_id    UUID,
    reason_text  VARCHAR(128) NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',
    status       VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|processing|resolved|rejected|reopened
    assignee_id  UUID,
    resolved_by  UUID,
    conclusion   TEXT        NOT NULL DEFAULT '',
    action_taken TEXT        NOT NULL DEFAULT '',
    version      INT         NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

-- 举报证据文件（证据访问单独审计，URL 用短期签名）
CREATE TABLE IF NOT EXISTS report_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    file_id         UUID,
    file_url        TEXT        NOT NULL DEFAULT '',
    content_type    VARCHAR(64) NOT NULL DEFAULT '',
    message_id      VARCHAR(64) NOT NULL DEFAULT '',
    message_snapshot TEXT       NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_files_report ON report_files(report_id);

-- 领取/指派记录
CREATE TABLE IF NOT EXISTS report_assignments (
    id          BIGSERIAL PRIMARY KEY,
    report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    assigner_id UUID,
    assignee_id UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_assign_report ON report_assignments(report_id);

-- 内部备注
CREATE TABLE IF NOT EXISTS report_notes (
    id         BIGSERIAL PRIMARY KEY,
    report_id  UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    admin_id   UUID,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_notes_report ON report_notes(report_id);

-- 处置历史（每次状态迁移留痕）
CREATE TABLE IF NOT EXISTS report_actions (
    id            BIGSERIAL PRIMARY KEY,
    report_id     UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    admin_id      UUID,
    action        VARCHAR(32) NOT NULL,            -- assign|start|note|resolve|reject|reopen
    before_status VARCHAR(16) NOT NULL DEFAULT '',
    after_status  VARCHAR(16) NOT NULL DEFAULT '',
    detail        TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_actions_report ON report_actions(report_id, created_at);
