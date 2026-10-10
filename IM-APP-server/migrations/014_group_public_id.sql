-- 对外使用短纯数字群号；内部主键、外键和 OpenIM 映射继续使用 UUID。
CREATE SEQUENCE IF NOT EXISTS group_public_id_seq
    START WITH 100001
    MINVALUE 100001;

ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS public_id VARCHAR(20);

-- 迁移文件会在每次启动时重复执行，因此先把 sequence 追到已有最大群号。
DO $$
DECLARE
    max_public_id BIGINT;
    sequence_value BIGINT;
    sequence_called BOOLEAN;
BEGIN
    SELECT MAX(public_id::BIGINT)
      INTO max_public_id
      FROM groups
     WHERE public_id ~ '^[0-9]+$';

    SELECT last_value, is_called
      INTO sequence_value, sequence_called
      FROM group_public_id_seq;

    IF (max_public_id IS NULL OR max_public_id < 100001)
       AND sequence_value <= 100001 AND NOT sequence_called THEN
        PERFORM setval('group_public_id_seq', 100001, false);
    ELSE
        PERFORM setval(
            'group_public_id_seq',
            GREATEST(COALESCE(max_public_id, 100000), sequence_value),
            true
        );
    END IF;
END $$;

-- 兼容历史数据：库里曾出现过 qun_xxx 形式的群号（既非空、也非纯数字）。
-- 原来的回填条件只认 NULL 和空串，这类值会被整个漏掉，于是下面那条
-- ADD CONSTRAINT 必然失败；而迁移一失败 api 就 log.Fatalf 退出，
-- 表现就是「容器反复重启，启动日志不停刷 SQLSTATE 23514」。
--
-- 处理方式：先把这类历史值原样留档，再统一改成序列分配的数字群号，
-- 让这个迁移真正自愈，而不是每换一个环境就再炸一次。
-- 留档表是幂等的：重复启动时 ON CONFLICT 不会覆盖首次的快照。
CREATE TABLE IF NOT EXISTS groups_public_id_backup (
    group_id     UUID PRIMARY KEY,
    name         TEXT,
    public_id    VARCHAR(20),
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO groups_public_id_backup(group_id, name, public_id)
SELECT id, name, public_id
  FROM groups
 WHERE public_id IS NULL OR public_id = '' OR public_id !~ '^[0-9]+$'
ON CONFLICT (group_id) DO NOTHING;

UPDATE groups
   SET public_id = nextval('group_public_id_seq')::TEXT
 WHERE public_id IS NULL OR public_id = '' OR public_id !~ '^[0-9]+$';

ALTER TABLE groups
    ALTER COLUMN public_id SET DEFAULT nextval('group_public_id_seq'::regclass)::TEXT,
    ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_public_id ON groups(public_id);

-- 不再恢复 groups_public_id_numeric_check：
-- 本仓库迁移每次启动会全量重跑；046 已把群号改成 qun_ 并 DROP 该约束。
-- 若这里继续 ADD 纯数字 CHECK，存量 qun_ 行会直接让 api 启动失败（SQLSTATE 23514）。
