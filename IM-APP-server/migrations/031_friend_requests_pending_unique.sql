-- 同一用户不能对同一接收方同时保留多条待处理申请。
-- 旧数据保留最近一条，前端展示和接受操作从此都只有一个稳定记录。
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY from_user, to_user
               ORDER BY created_at DESC, id DESC
           ) AS row_num
    FROM friend_requests
    WHERE status = 'pending'
)
DELETE FROM friend_requests fr
USING ranked r
WHERE fr.id = r.id AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_pair_unique
    ON friend_requests (from_user, to_user)
    WHERE status = 'pending';
