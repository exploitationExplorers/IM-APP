-- 新建群默认最多 2000 人，并把还低于这个数的群和已发布系统限制一并抬上去。
--
-- 建群写入的 groups.max_members 取已发布配置里的 defaultGroupMaxMembers。
-- 只改代码兜底不够：线上如果还发布着更低的上限，新建群仍会被夹回那个数。
-- 幂等：已经 >= 2000 的不降。

ALTER TABLE groups ALTER COLUMN max_members SET DEFAULT 2000;
COMMENT ON COLUMN groups.max_members IS '群成员上限（新建群默认 2000）';

UPDATE groups
SET max_members = 2000
WHERE COALESCE(status, 'active') = 'active'
  AND COALESCE(max_members, 0) < 2000;

UPDATE app_configs
SET value = jsonb_set(
      jsonb_set(
        CASE WHEN value IS NULL OR btrim(value) = '' THEN '{}'::jsonb ELSE value::jsonb END,
        '{maxGroupMembers}',
        to_jsonb(GREATEST(COALESCE((value::jsonb ->> 'maxGroupMembers')::int, 0), 2000))
      ),
      '{defaultGroupMaxMembers}',
      to_jsonb(GREATEST(COALESCE((value::jsonb ->> 'defaultGroupMaxMembers')::int, 0), 2000))
    )::text
WHERE key = 'system.limits';

UPDATE app_config_versions AS v
SET data_json = jsonb_set(
      jsonb_set(
        CASE WHEN v.data_json IS NULL OR btrim(v.data_json) = '' THEN '{}'::jsonb ELSE v.data_json::jsonb END,
        '{maxGroupMembers}',
        to_jsonb(GREATEST(COALESCE((v.data_json::jsonb ->> 'maxGroupMembers')::int, 0), 2000))
      ),
      '{defaultGroupMaxMembers}',
      to_jsonb(GREATEST(COALESCE((v.data_json::jsonb ->> 'defaultGroupMaxMembers')::int, 0), 2000))
    )::text
WHERE v.id = (
  SELECT id FROM app_config_versions
  WHERE status = 'published'
  ORDER BY version DESC, id DESC
  LIMIT 1
);
