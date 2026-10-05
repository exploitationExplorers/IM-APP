-- 邀请入群需验证改为默认关闭。
-- 已有行是按旧默认 true 写入的，一并改回 false，否则已注册账号打开隐私页仍是开。
ALTER TABLE privacy_settings
  ALTER COLUMN require_group_approval SET DEFAULT false;

UPDATE privacy_settings
SET require_group_approval = false,
    updated_at = NOW()
WHERE require_group_approval = true;
