CREATE TABLE IF NOT EXISTS app_releases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform            VARCHAR(16)  NOT NULL,
    channel             VARCHAR(32)  NOT NULL,
    version_name        VARCHAR(32)  NOT NULL,
    version_code        INT          NOT NULL,
    package_type        VARCHAR(8)   NOT NULL,
    min_native_version  INT          NOT NULL DEFAULT 0,
    download_url        TEXT         NOT NULL,
    object_key          TEXT         NOT NULL DEFAULT '',
    changelog           VARCHAR(2000) NOT NULL DEFAULT '',
    force_update        BOOLEAN      NOT NULL DEFAULT FALSE,
    published           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_releases_platform_channel_code
    ON app_releases(platform, channel, version_code);

CREATE INDEX IF NOT EXISTS idx_app_releases_latest
    ON app_releases(platform, channel, published, version_code DESC);

COMMENT ON TABLE app_releases IS '客户端热更新/整包发布记录；wgt 热更新，apk/ipa 整包更新';
COMMENT ON COLUMN app_releases.platform IS 'android | ios';
COMMENT ON COLUMN app_releases.channel IS 'test | prod';
COMMENT ON COLUMN app_releases.package_type IS 'wgt | apk | ipa';
COMMENT ON COLUMN app_releases.min_native_version IS 'wgt 要求的最低原生壳 versionCode；整包记录为 0';
COMMENT ON COLUMN app_releases.version_code IS '单调递增的资源/安装包版本号';
