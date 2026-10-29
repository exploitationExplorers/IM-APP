-- 默认要求好友和入群确认，并且仅首次升级时统一开启现有用户的设置。
-- app_configs 中的标记使 auto 模式重放迁移时保留用户后续修改。
BEGIN;

ALTER TABLE privacy_settings
  ALTER COLUMN require_friend_approval SET DEFAULT true,
  ALTER COLUMN require_group_approval SET DEFAULT true;

-- 服务端创建的配置表也需满足管理后台保存草稿的字段要求。
ALTER TABLE app_configs ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE app_configs ADD COLUMN IF NOT EXISTS updated_by UUID;

WITH first_upgrade AS (
  INSERT INTO app_configs (key, value, description)
  VALUES ('migration.privacy-defaults-enabled', 'true', '隐私验证存量升级已执行')
  ON CONFLICT (key) DO NOTHING
  RETURNING key
)
INSERT INTO privacy_settings (user_id, require_friend_approval, require_group_approval)
SELECT id, true, true FROM users
WHERE EXISTS (SELECT 1 FROM first_upgrade)
ON CONFLICT (user_id) DO UPDATE
SET require_friend_approval = true,
    require_group_approval = true,
    updated_at = NOW();

COMMIT;
