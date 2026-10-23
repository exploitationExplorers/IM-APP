-- 群消息保留：平台默认 1500 条 / 168 小时；groups 可按群覆盖（NULL = 用平台默认）。
-- 提高上限不会回滚已发布的 min_visible_seq。

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS retention_max_messages INTEGER
    CHECK (retention_max_messages IS NULL OR retention_max_messages BETWEEN 1 AND 20000),
  ADD COLUMN IF NOT EXISTS retention_keep_hours INTEGER
    CHECK (retention_keep_hours IS NULL OR retention_keep_hours BETWEEN 1 AND 2160);

COMMENT ON COLUMN groups.retention_max_messages IS '群消息保留条数覆盖；NULL 用 system.limits.groupRetentionMaxMessages';
COMMENT ON COLUMN groups.retention_keep_hours IS '群消息保留小时覆盖；NULL 用 system.limits.groupRetentionHours';

UPDATE app_configs
SET value = jsonb_set(
      jsonb_set(
        CASE WHEN value IS NULL OR btrim(value) = '' THEN '{}'::jsonb ELSE value::jsonb END,
        '{groupRetentionMaxMessages}',
        to_jsonb(COALESCE(NULLIF((value::jsonb ->> 'groupRetentionMaxMessages')::int, 0), 1500))
      ),
      '{groupRetentionHours}',
      to_jsonb(COALESCE(NULLIF((value::jsonb ->> 'groupRetentionHours')::int, 0), 168))
    )::text
WHERE key = 'system.limits';

UPDATE app_config_versions AS v
SET data_json = jsonb_set(
      jsonb_set(
        CASE WHEN v.data_json IS NULL OR btrim(v.data_json) = '' THEN '{}'::jsonb ELSE v.data_json::jsonb END,
        '{groupRetentionMaxMessages}',
        to_jsonb(COALESCE(NULLIF((v.data_json::jsonb ->> 'groupRetentionMaxMessages')::int, 0), 1500))
      ),
      '{groupRetentionHours}',
      to_jsonb(COALESCE(NULLIF((v.data_json::jsonb ->> 'groupRetentionHours')::int, 0), 168))
    )::text
WHERE v.id = (
  SELECT id FROM app_config_versions
  WHERE status = 'published'
  ORDER BY version DESC, id DESC
  LIMIT 1
);
