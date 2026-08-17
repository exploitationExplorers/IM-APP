-- APP 用户举报。此迁移同时兼容：
-- 1. 未部署管理后台的新库；
-- 2. 已由 IM-APP-admin/005_admin_reports.sql 建表的共享库；
-- 3. 历史上只创建了部分字段的旧库。
--
-- 不修改 group_reports；现有群举报接口继续使用原表，避免本次发布影响旧功能。

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS report_reasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16)  NOT NULL,
    reason      VARCHAR(128) NOT NULL,
    language    VARCHAR(8)   NOT NULL DEFAULT 'zh',
    sort_order  INT          NOT NULL DEFAULT 0,
    status      VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS 不会补已有表字段，因此每个接口依赖字段都显式补齐。
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS target_type VARCHAR(16) NOT NULL DEFAULT 'user';
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS reason VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS language VARCHAR(8) NOT NULL DEFAULT 'zh';
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE report_reasons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE report_reasons SET id=gen_random_uuid() WHERE id IS NULL;
ALTER TABLE report_reasons ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE report_reasons ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_reasons_id ON report_reasons(id);

CREATE INDEX IF NOT EXISTS idx_report_reasons_target
    ON report_reasons(target_type, status);

CREATE TABLE IF NOT EXISTS reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_no    VARCHAR(32) NOT NULL UNIQUE,
    reporter_id  UUID,
    target_type  VARCHAR(16) NOT NULL,
    target_id    VARCHAR(64) NOT NULL,
    reason_id    UUID,
    reason_text  VARCHAR(128) NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',
    status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    assignee_id  UUID,
    resolved_by  UUID,
    conclusion   TEXT        NOT NULL DEFAULT '',
    action_taken TEXT        NOT NULL DEFAULT '',
    version      INT         NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_no VARCHAR(32);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_id UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_type VARCHAR(16) NOT NULL DEFAULT 'user';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reason_id UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reason_text VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS assignee_id UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS conclusion TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_taken TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 旧的部分表若没有 report_no，先为历史行生成稳定且唯一的编号，再收紧约束。
UPDATE reports SET id=gen_random_uuid() WHERE id IS NULL;
UPDATE reports
   SET report_no = 'REP-LEGACY-' || LEFT(REPLACE(id::TEXT, '-', ''), 20)
 WHERE report_no IS NULL OR report_no = '';

ALTER TABLE reports ALTER COLUMN report_no SET NOT NULL;
ALTER TABLE reports ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE reports ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_id ON reports(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_report_no ON reports(report_no);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS report_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id        UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    file_id          UUID,
    file_url         TEXT        NOT NULL DEFAULT '',
    content_type     VARCHAR(64) NOT NULL DEFAULT '',
    message_id       VARCHAR(64) NOT NULL DEFAULT '',
    message_snapshot TEXT        NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE report_files ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS report_id UUID;
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS file_id UUID;
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS file_url TEXT NOT NULL DEFAULT '';
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS content_type VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS message_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS message_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE report_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE report_files SET id=gen_random_uuid() WHERE id IS NULL;
ALTER TABLE report_files ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE report_files ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_files_id ON report_files(id);
CREATE INDEX IF NOT EXISTS idx_report_files_report ON report_files(report_id);

-- 默认用户举报原因。事务级 advisory lock 防止 APP 与管理后台并发启动时重复插入。
SELECT pg_advisory_xact_lock(hashtext('im_app_report_reason_seed_v1'));

INSERT INTO report_reasons(target_type, reason, language, sort_order, status)
SELECT seed.target_type, seed.reason, seed.language, seed.sort_order, 'active'
FROM (VALUES
    ('user', '垃圾广告', 'zh', 10),
    ('user', '诈骗',     'zh', 20),
    ('user', '色情',     'zh', 30),
    ('user', '暴力',     'zh', 40),
    ('user', '骚扰',     'zh', 50),
    ('user', '其他',     'zh', 60)
) AS seed(target_type, reason, language, sort_order)
WHERE NOT EXISTS (
    SELECT 1
      FROM report_reasons existing
     WHERE existing.target_type = seed.target_type
       AND existing.language = seed.language
       AND existing.reason = seed.reason
);

COMMIT;
