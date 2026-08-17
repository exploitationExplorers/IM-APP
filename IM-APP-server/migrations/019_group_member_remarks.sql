-- 019: 群成员备注（在群里给某个成员单独设置的备注名）
CREATE TABLE IF NOT EXISTS group_member_remarks (
    user_id        uuid        NOT NULL,
    group_id       uuid        NOT NULL,
    member_user_id uuid        NOT NULL,
    remark         VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_id, member_user_id)
);
