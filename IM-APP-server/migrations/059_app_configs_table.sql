-- 补齐 app_configs 表。
--
-- 047 / 056 / 057 都在 UPDATE app_configs，但历史上没有任何迁移创建过这张表
-- （只有配套的版本表 app_config_versions，由 032 创建）。生产库是增量演进出来的
-- 所以一直没暴露，但空库从 001 顺序装迁移时会在 047 直接失败：
--   ERROR: relation "app_configs" does not exist
-- 结果是新环境无法初始化。这里把建表补上。
--
-- 幂等：表已存在时 CREATE IF NOT EXISTS 不动它，也不会覆盖既有配置行。

CREATE TABLE IF NOT EXISTS app_configs (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_configs IS '已发布的平台配置；value 为 JSON 文本，例如 system.limits';
COMMENT ON COLUMN app_configs.key IS '配置键，例如 system.limits';
COMMENT ON COLUMN app_configs.value IS 'JSON 文本，缺省为空对象';

-- 表存在但没有 system.limits 行时，047/056/057 的 UPDATE 会命中 0 行，
-- 平台默认上限也就永远落不了地。已有时不覆盖线上真实配置。
INSERT INTO app_configs (key, value) VALUES ('system.limits', '{}')
ON CONFLICT (key) DO NOTHING;
