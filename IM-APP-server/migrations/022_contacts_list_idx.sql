-- 通讯录分页按加入时间倒序拉取，避免 1 万好友全表扫。
CREATE INDEX IF NOT EXISTS idx_friendships_user_created
    ON friendships(user_id, created_at DESC, friend_id DESC);
