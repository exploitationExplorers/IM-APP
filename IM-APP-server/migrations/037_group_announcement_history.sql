-- 群公告历史：每个群保留最近 10 条，供成员回看
CREATE TABLE IF NOT EXISTS group_announcement_history (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
	content TEXT NOT NULL DEFAULT '',
	publisher_id UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_announcement_history_group_created
	ON group_announcement_history(group_id, created_at DESC);
