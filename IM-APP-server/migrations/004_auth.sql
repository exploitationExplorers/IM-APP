-- Phase 3: 认证与账号（按 GOAL-APP 接口清单）
-- users: E.164 唯一键 + 注销标记
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

-- 用 country_code + phone 填充 E.164（首次迁移执行一次，幂等）
UPDATE users SET phone_e164 = CASE
    WHEN phone LIKE '+%' THEN phone
    ELSE CONCAT(country_code, phone)
END
WHERE phone_e164 IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164);

-- 短信验证码：哈希存储 + 错误次数 + 一次消费
ALTER TABLE sms_codes ADD COLUMN IF NOT EXISTS code_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE sms_codes ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE sms_codes ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 5;
ALTER TABLE sms_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_scene ON sms_codes(phone, scene, created_at DESC);

-- 登录会话（可撤销 refresh token）
CREATE TABLE IF NOT EXISTS auth_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id          VARCHAR(64)  NOT NULL DEFAULT '',
    refresh_token_hash TEXT         NOT NULL UNIQUE,
    ip                 VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent         VARCHAR(256) NOT NULL DEFAULT '',
    expires_at         TIMESTAMPTZ  NOT NULL,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- 短信发送日志
CREATE TABLE IF NOT EXISTS sms_send_logs (
    id              BIGSERIAL PRIMARY KEY,
    phone_e164      VARCHAR(32) NOT NULL DEFAULT '',
    country_code    VARCHAR(8)  NOT NULL DEFAULT '',
    scene           VARCHAR(32) NOT NULL DEFAULT '',
    provider        VARCHAR(32) NOT NULL DEFAULT 'dev',
    provider_msg_id VARCHAR(64) NOT NULL DEFAULT '',
    status          VARCHAR(16) NOT NULL DEFAULT 'sent',
    error_code      VARCHAR(32) NOT NULL DEFAULT '',
    ip_hash         VARCHAR(64) NOT NULL DEFAULT '',
    device_id       VARCHAR(64) NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_send_logs_phone ON sms_send_logs(phone_e164, created_at DESC);

-- 触发器：INSERT/UPDATE users 时自动填充 phone_e164（保证 seed 与注册都带上 E.164）
CREATE OR REPLACE FUNCTION fill_phone_e164() RETURNS trigger AS $$
BEGIN
  NEW.phone_e164 := COALESCE(
      NEW.phone_e164,
      CASE WHEN NEW.phone LIKE '+%' THEN NEW.phone ELSE CONCAT(NEW.country_code, NEW.phone) END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_phone_e164 ON users;
CREATE TRIGGER trg_fill_phone_e164 BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fill_phone_e164();
