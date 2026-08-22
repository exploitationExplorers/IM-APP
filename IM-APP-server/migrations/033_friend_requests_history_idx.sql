-- 近期已处理好友申请列表（accepted/rejected）
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_history
    ON friend_requests (to_user, created_at DESC)
    WHERE status IN ('accepted', 'rejected');
