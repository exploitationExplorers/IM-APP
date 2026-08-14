-- 群详情页：群内昵称与举报。
ALTER TABLE group_members
    ADD COLUMN IF NOT EXISTS nickname VARCHAR(64) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS group_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason       VARCHAR(32) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT group_reports_reason_check
        CHECK (reason IN ('spam','fraud','pornography','violence','harassment','other')),
    CONSTRAINT group_reports_status_check
        CHECK (status IN ('pending','processing','resolved','rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_reports_one_pending
    ON group_reports(group_id, reporter_id)
    WHERE status='pending';

CREATE INDEX IF NOT EXISTS idx_group_reports_status_created
    ON group_reports(status, created_at DESC);

WITH duplicate_pending AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY group_id, user_id ORDER BY created_at DESC, id DESC) AS row_num
    FROM group_join_requests
    WHERE status='pending'
)
UPDATE group_join_requests r
SET status='rejected', handled_at=NOW()
FROM duplicate_pending d
WHERE r.id=d.id AND d.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_join_requests_one_pending
    ON group_join_requests(group_id, user_id)
    WHERE status='pending';
