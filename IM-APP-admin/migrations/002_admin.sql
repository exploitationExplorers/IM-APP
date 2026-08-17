-- 补充：国家/地区（APP 公共配置也需要的表，管理后台先行建）与群加入方式
CREATE TABLE IF NOT EXISTS countries (
    code       VARCHAR(8)  PRIMARY KEY,          -- 国家码，如 CN / HK / US
    dial_code  VARCHAR(8)  NOT NULL DEFAULT '',  -- 区号，如 86 / 852 / 1
    cn_name    VARCHAR(64) NOT NULL DEFAULT '',
    en_name    VARCHAR(64) NOT NULL DEFAULT '',
    phone_rule VARCHAR(128) NOT NULL DEFAULT '',
    enabled    BOOLEAN     NOT NULL DEFAULT true, -- true=允许该国家注册/发短信
    sort_order INT         NOT NULL DEFAULT 0
);

-- 群加入方式（direct=直接加入 / approval=需审核）
-- 默认值与 server 007 保持一致为 'open'，避免因部署顺序导致默认值不同
ALTER TABLE groups ADD COLUMN IF NOT EXISTS join_mode VARCHAR(16) NOT NULL DEFAULT 'open';

-- ============================================================
-- 表 / 字段注释
-- ============================================================

COMMENT ON TABLE countries IS '国家/地区（注册/短信区号配置，APP 公共配置共用）';
COMMENT ON COLUMN countries.code IS '国家码，如 CN / HK / US';
COMMENT ON COLUMN countries.dial_code IS '国际区号，如 86 / 852 / 1';
COMMENT ON COLUMN countries.cn_name IS '中文名称';
COMMENT ON COLUMN countries.en_name IS '英文名称';
COMMENT ON COLUMN countries.phone_rule IS '手机号格式规则（正则）';
COMMENT ON COLUMN countries.enabled IS '是否允许该国家注册/发短信：true=启用';
COMMENT ON COLUMN countries.sort_order IS '排序权重（越小越靠前）';

COMMENT ON COLUMN groups.join_mode IS '群加入方式：direct=直接加入 / approval=需审核';
