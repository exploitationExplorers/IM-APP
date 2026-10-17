-- 热更新渠道增加 canary。列本身已是 VARCHAR(32)，不必改表结构。
COMMENT ON COLUMN app_releases.channel IS 'canary | test | prod';
