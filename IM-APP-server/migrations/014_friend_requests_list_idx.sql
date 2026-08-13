-- 好友申请列表按「待处理 + 收/发用户」过滤，历史 accepted/rejected 会越积越多
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_pending
    ON friend_requests (to_user, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friend_requests_from_pending
    ON friend_requests (from_user, created_at DESC)
    WHERE status = 'pending';
