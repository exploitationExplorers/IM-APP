-- 群公告支持配图：当前公告与历史各存图片 URL 列表（最多 9 张，由业务层约束）
ALTER TABLE groups
	ADD COLUMN IF NOT EXISTS announcement_images TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE group_announcement_history
	ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';
