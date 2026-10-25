-- 群消息保留默认改为：最近 3 天 ∪ 最近 3000 条（并集；仅两者都超限才清理）。
-- 提高/放宽策略不会回滚已发布的 min_visible_seq。

UPDATE app_configs
SET value = jsonb_set(
      jsonb_set(
        CASE WHEN value IS NULL OR btrim(value) = '' THEN '{}'::jsonb ELSE value::jsonb END,
        '{groupRetentionMaxMessages}',
        '3000'::jsonb
      ),
      '{groupRetentionHours}',
      '72'::jsonb
    )::text
WHERE key = 'system.limits';

UPDATE app_config_versions AS v
SET data_json = jsonb_set(
      jsonb_set(
        CASE WHEN v.data_json IS NULL OR btrim(v.data_json) = '' THEN '{}'::jsonb ELSE v.data_json::jsonb END,
        '{groupRetentionMaxMessages}',
        '3000'::jsonb
      ),
      '{groupRetentionHours}',
      '72'::jsonb
    )::text
WHERE v.id = (
  SELECT id FROM app_config_versions
  WHERE status = 'published'
  ORDER BY version DESC, id DESC
  LIMIT 1
);
