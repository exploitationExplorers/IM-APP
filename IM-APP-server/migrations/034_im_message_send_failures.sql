CREATE TABLE IF NOT EXISTS im_message_send_failures (
    id              BIGSERIAL PRIMARY KEY,
    client_msg_id   VARCHAR(128) NOT NULL DEFAULT '',
    source          VARCHAR(16)  NOT NULL,
    sender_id       UUID,
    sender_im_id    VARCHAR(64)  NOT NULL DEFAULT '',
    peer_type       VARCHAR(16)  NOT NULL,
    target_id       UUID,
    target_im_id    VARCHAR(64)  NOT NULL DEFAULT '',
    content_type    INTEGER      NOT NULL DEFAULT 0,
    stage           VARCHAR(24)  NOT NULL DEFAULT '',
    fail_code       VARCHAR(48)  NOT NULL DEFAULT '',
    fail_message    TEXT         NOT NULL DEFAULT '',
    client_platform VARCHAR(24)  NOT NULL DEFAULT '',
    app_version     VARCHAR(32)  NOT NULL DEFAULT '',
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  im_message_send_failures            IS '消息发送失败记录（客户端上报 + beforeSend 拒绝落库）';
COMMENT ON COLUMN im_message_send_failures.id         IS '记录ID';
COMMENT ON COLUMN im_message_send_failures.client_msg_id   IS '客户端消息ID（幂等定位，可空串）';
COMMENT ON COLUMN im_message_send_failures.source          IS '来源：client=客户端上报 / before_hook=服务端拦截';
COMMENT ON COLUMN im_message_send_failures.sender_id       IS '发送方业务用户ID（可空）';
COMMENT ON COLUMN im_message_send_failures.sender_im_id    IS '发送方 OpenIM ID（UUID 去横线小写）';
COMMENT ON COLUMN im_message_send_failures.peer_type       IS '会话类型：c2c=单聊 / group=群聊';
COMMENT ON COLUMN im_message_send_failures.target_id       IS '接收方业务用户/群ID（可空）';
COMMENT ON COLUMN im_message_send_failures.target_im_id    IS '接收方 OpenIM 用户/群 ID';
COMMENT ON COLUMN im_message_send_failures.content_type    IS 'OpenIM 数字消息类型（101文本/102图片/103语音/104视频/105文件…）';
COMMENT ON COLUMN im_message_send_failures.stage           IS '失败阶段：create=创建 / upload=上传 / send=发送 / timeout=超时 / blocked=拦截';
COMMENT ON COLUMN im_message_send_failures.fail_code       IS '失败码（如 upload_timeout / not_friend）';
COMMENT ON COLUMN im_message_send_failures.fail_message    IS '失败详情（原始错误信息）';
COMMENT ON COLUMN im_message_send_failures.client_platform IS '客户端平台：app|h5|ios|android';
COMMENT ON COLUMN im_message_send_failures.app_version     IS '客户端版本号';
COMMENT ON COLUMN im_message_send_failures.occurred_at     IS '失败发生时间（客户端上报，缺省服务端 NOW()）';
COMMENT ON COLUMN im_message_send_failures.created_at      IS '入库时间';

CREATE INDEX IF NOT EXISTS idx_msg_fail_created  ON im_message_send_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_fail_sender   ON im_message_send_failures(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_fail_type     ON im_message_send_failures(content_type);
CREATE INDEX IF NOT EXISTS idx_msg_fail_code     ON im_message_send_failures(fail_code);

-- 幂等：同一 client_msg_id + stage 只记一次
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_fail_client_stage
    ON im_message_send_failures(client_msg_id, stage) WHERE client_msg_id <> '';
