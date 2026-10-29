-- 旧版本在这里关闭全部用户的入群验证。启动会重放历史迁移，
-- 因此这里只维护安全默认值，不再覆盖用户已经保存的选择。
ALTER TABLE privacy_settings
  ALTER COLUMN require_group_approval SET DEFAULT true;
