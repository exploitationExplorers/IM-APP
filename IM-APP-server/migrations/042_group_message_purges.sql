-- 「移除该成员并删除消息」的服务端留痕。
--
-- 背景：group_members 的行被删掉后不留任何痕迹，服务端无法区分「单纯移除该成员」
-- 和「移除该成员并删除消息」这两种操作，导致后者只能由前端本地删消息 —— 只有执行
-- 操作的管理员看不到，其他成员的界面照旧。
--
-- 这张表只记录后者：群内该用户 purged_at 之前发的消息，所有客户端一律隐藏。
--
-- ★ 记录不随该用户重新入群而删除：重新入群后新发的消息（晚于 purged_at）要正常显示，
--   只有被清理的那批历史消息保持隐藏。所以客户端过滤时必须带时间判断，
--   只按 user_id 过滤会把重新入群后的新消息也误隐藏。
CREATE TABLE IF NOT EXISTS group_message_purges (
    group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_message_purges_group_id ON group_message_purges (group_id);
