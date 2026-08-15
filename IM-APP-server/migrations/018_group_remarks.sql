-- 018: 个人群备注名（仅自己可见的群显示名，类似好友备注）
CREATE TABLE IF NOT EXISTS group_remarks (
    user_id    uuid        NOT NULL,
    group_id   uuid        NOT NULL,
    remark     VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_id)
);
