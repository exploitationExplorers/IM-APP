-- Phase: iOS 上架合规 —— 账号注销（Apple 5.1.1(v) 删除账号及关联数据）
--
-- 设计要点：
-- 1) 业务侧物理删除 users 行：users.phone / users.phone_e164 是唯一键，
--    删行后手机号自然释放，用户可同号重新注册（符合用户直觉）。
-- 2) account_deletions 只做审计留痕，且**不存任何明文个人数据**：
--    手机号与昵称一律存 HMAC-SHA256 哈希，密钥来自服务端配置，
--    即使审计表泄露也无法反推用户身份。
-- 3) 审计表不建指向 users 的外键（users 行已被删除），
--    因此 IM / 对象存储的清理结果与失败原因落在这里，供后台补偿。

-- 一、审计表
CREATE TABLE IF NOT EXISTS account_deletions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 已注销用户的业务 ID（users 行已物理删除，故不加外键）
    user_id               UUID        NOT NULL,
    -- 匿名化留痕：只存 HMAC 哈希，严禁存明文
    phone_e164_hash       TEXT        NOT NULL DEFAULT '',
    nickname_hash         TEXT        NOT NULL DEFAULT '',
    country_code          VARCHAR(8)  NOT NULL DEFAULT '',
    -- 请求上下文，用于风控与申诉溯源
    request_ip            VARCHAR(64)  NOT NULL DEFAULT '',
    request_user_agent    VARCHAR(256) NOT NULL DEFAULT '',
    verification_method   VARCHAR(32)  NOT NULL DEFAULT 'sms',
    -- 影响范围快照（好友数/群数/群主群 ID 等），删除前采集
    summary               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- 旁路清理状态：失败不阻断主流程，只留痕供后台补偿
    im_cleanup_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (im_cleanup_status IN ('pending', 'done', 'failed', 'skipped')),
    im_cleanup_error      TEXT        NOT NULL DEFAULT '',
    storage_cleanup_status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (storage_cleanup_status IN ('pending', 'done', 'failed', 'skipped')),
    storage_cleanup_error  TEXT        NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_user ON account_deletions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_deletions_created ON account_deletions(created_at DESC);
-- 后台补偿扫描：只捞还没清干净的
CREATE INDEX IF NOT EXISTS idx_account_deletions_pending
    ON account_deletions(created_at DESC)
    WHERE im_cleanup_status = 'failed' OR storage_cleanup_status = 'failed';

-- 二、补齐会阻断物理删除的缺失级联
--
-- 注意：groups.owner_id **故意保持 NO ACTION**（不改为 CASCADE）。
-- 群主必须先转让或解散群才允许注销，这条外键是代码逻辑之外的最后一道防线，
-- 防止上层校验被绕过时整群数据被连带删除。
-- 其余 3 处 ON DELETE SET NULL（files/favorites/group_announcement_history）
-- 本身不阻断删除，保持原样。

-- 用动态查找而不是硬编码约束名：PG 的默认命名（表名_列名_fkey）在不同环境可能
-- 被改过，写死名字时 DROP IF EXISTS 会静默失败，随后 ADD 又叠一条同名约束，
-- 结果同一列上挂两个外键。这里按「表+列」查出真实名字再删，幂等且不会重复。
DO $$
DECLARE
    con_name text;
BEGIN
    -- 入群申请的处理人：人注销了，申请记录本身要保留供群主回看
    SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'group_join_requests'::regclass
      AND c.contype = 'f'
      AND a.attname = 'handler_id'
    LIMIT 1;
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE group_join_requests DROP CONSTRAINT %I', con_name);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'group_join_requests'::regclass AND contype = 'f'
          AND conname = 'group_join_requests_handler_id_fkey'
    ) THEN
        ALTER TABLE group_join_requests
            ADD CONSTRAINT group_join_requests_handler_id_fkey
            FOREIGN KEY (handler_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    -- 撤回记录：操作人不存在后记录无意义，直接级联
    con_name := NULL;
    SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'im_message_recalls'::regclass
      AND c.contype = 'f'
      AND a.attname = 'operator_user_id'
    LIMIT 1;
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE im_message_recalls DROP CONSTRAINT %I', con_name);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'im_message_recalls'::regclass AND contype = 'f'
          AND conname = 'im_message_recalls_operator_user_id_fkey'
    ) THEN
        ALTER TABLE im_message_recalls
            ADD CONSTRAINT im_message_recalls_operator_user_id_fkey
            FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
