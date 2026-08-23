-- 按 user_id 查群列表（ListGroups）加速
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
