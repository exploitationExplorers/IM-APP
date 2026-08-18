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

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE report_reasons IS '举报原因（按目标类型/语言/排序/启停；被引用只能停用不能删除）';
COMMENT ON COLUMN report_reasons.id IS '原因ID';
COMMENT ON COLUMN report_reasons.target_type IS '适用目标类型：user=用户 / group=群 / message=消息';
COMMENT ON COLUMN report_reasons.reason IS '原因文案';
COMMENT ON COLUMN report_reasons.language IS '语言（默认 zh）';
COMMENT ON COLUMN report_reasons.sort_order IS '排序权重';
COMMENT ON COLUMN report_reasons.status IS '状态：active=启用 / disabled=停用';
COMMENT ON COLUMN report_reasons.created_at IS '创建时间';

COMMENT ON TABLE reports IS '举报工单（版本号+行锁防重复结案）';
COMMENT ON COLUMN reports.id IS '工单ID';
COMMENT ON COLUMN reports.report_no IS '工单编号（唯一）';
COMMENT ON COLUMN reports.reporter_id IS '举报人ID';
COMMENT ON COLUMN reports.target_type IS '被举报对象类型：user|group|message';
COMMENT ON COLUMN reports.target_id IS '被举报对象ID';
COMMENT ON COLUMN reports.reason_id IS '举报原因ID';
COMMENT ON COLUMN reports.reason_text IS '举报原因文案快照';
COMMENT ON COLUMN reports.description IS '举报补充描述';
COMMENT ON COLUMN reports.status IS '状态：pending=待处理 / processing=处理中 / resolved=已结案 / rejected=已驳回 / reopened=已重开';
COMMENT ON COLUMN reports.assignee_id IS '当前处理人ID';
COMMENT ON COLUMN reports.resolved_by IS '结案操作人ID';
COMMENT ON COLUMN reports.conclusion IS '处理结论';
COMMENT ON COLUMN reports.action_taken IS '采取的措施';
COMMENT ON COLUMN reports.version IS '乐观锁版本号（防并发重复结案）';
COMMENT ON COLUMN reports.created_at IS '创建时间';
COMMENT ON COLUMN reports.updated_at IS '更新时间';

COMMENT ON TABLE report_files IS '举报证据文件（访问单独审计，URL 用短期签名）';
COMMENT ON COLUMN report_files.id IS '文件ID';
COMMENT ON COLUMN report_files.report_id IS '所属举报工单ID';
COMMENT ON COLUMN report_files.file_id IS '文件服务ID';
COMMENT ON COLUMN report_files.file_url IS '文件URL';
COMMENT ON COLUMN report_files.content_type IS '文件类型';
COMMENT ON COLUMN report_files.message_id IS '关联消息ID（若有）';
COMMENT ON COLUMN report_files.message_snapshot IS '消息内容快照';
COMMENT ON COLUMN report_files.created_at IS '上传时间';

COMMENT ON TABLE report_assignments IS '举报领取/指派记录';
COMMENT ON COLUMN report_assignments.id IS '记录ID';
COMMENT ON COLUMN report_assignments.report_id IS '举报工单ID';
COMMENT ON COLUMN report_assignments.assigner_id IS '指派方ID';
COMMENT ON COLUMN report_assignments.assignee_id IS '被指派处理人ID';
COMMENT ON COLUMN report_assignments.created_at IS '指派时间';

COMMENT ON TABLE report_notes IS '举报内部备注';
COMMENT ON COLUMN report_notes.id IS '备注ID';
COMMENT ON COLUMN report_notes.report_id IS '举报工单ID';
COMMENT ON COLUMN report_notes.admin_id IS '备注管理员ID';
COMMENT ON COLUMN report_notes.content IS '备注内容';
COMMENT ON COLUMN report_notes.created_at IS '备注时间';

COMMENT ON TABLE report_actions IS '举报处置历史（每次状态迁移留痕）';
COMMENT ON COLUMN report_actions.id IS '记录ID';
COMMENT ON COLUMN report_actions.report_id IS '举报工单ID';
COMMENT ON COLUMN report_actions.admin_id IS '操作管理员ID';
COMMENT ON COLUMN report_actions.action IS '动作：assign=指派 / start=处理 / note=备注 / resolve=结案 / reject=驳回 / reopen=重开';
COMMENT ON COLUMN report_actions.before_status IS '变更前状态';
COMMENT ON COLUMN report_actions.after_status IS '变更后状态';
COMMENT ON COLUMN report_actions.detail IS '操作详情';
COMMENT ON COLUMN report_actions.created_at IS '操作时间';
