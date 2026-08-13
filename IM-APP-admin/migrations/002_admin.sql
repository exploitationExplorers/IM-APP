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
ALTER TABLE groups ADD COLUMN IF NOT EXISTS join_mode VARCHAR(16) NOT NULL DEFAULT 'direct';
