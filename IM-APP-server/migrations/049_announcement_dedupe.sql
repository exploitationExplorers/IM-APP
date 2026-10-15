-- 同一群里正文和配图完全相同的公告只留最新一条，清掉发布时复制出来的重复记录
DELETE FROM group_announcement_history older
USING group_announcement_history newer
WHERE older.group_id = newer.group_id
	AND older.content = newer.content
	AND older.images = newer.images
	AND (
		older.created_at < newer.created_at
		OR (older.created_at = newer.created_at AND older.id < newer.id)
	);

-- 群资料上还有公告、但列表里没有同样一条时，补进列表，避免成员只在顶栏看得到
INSERT INTO group_announcement_history (group_id, content, images, publisher_id)
SELECT g.id, COALESCE(g.announcement, ''), COALESCE(g.announcement_images, '{}'), g.owner_id
FROM groups g
WHERE g.status = 'active'
	AND (
		btrim(COALESCE(g.announcement, '')) <> ''
		OR cardinality(COALESCE(g.announcement_images, '{}')) > 0
	)
	AND NOT EXISTS (
		SELECT 1 FROM group_announcement_history h
		WHERE h.group_id = g.id
			AND h.content = COALESCE(g.announcement, '')
			AND h.images = COALESCE(g.announcement_images, '{}')
	)
	AND (
		SELECT COUNT(*) FROM group_announcement_history h2 WHERE h2.group_id = g.id
	) < 10;
