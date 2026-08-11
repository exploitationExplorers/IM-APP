-- Phase 2: 群设置扩展
ALTER TABLE groups ADD COLUMN IF NOT EXISTS announcement TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allow_member_add_friend BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);

-- 群成员 role 已在 002 group_members 中
