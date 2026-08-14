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

UPDATE groups
   SET public_id = nextval('group_public_id_seq')::TEXT
 WHERE public_id IS NULL OR public_id = '';

ALTER TABLE groups
    ALTER COLUMN public_id SET DEFAULT nextval('group_public_id_seq'::regclass)::TEXT,
    ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_public_id ON groups(public_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'groups_public_id_numeric_check'
           AND conrelid = 'groups'::regclass
    ) THEN
        ALTER TABLE groups
            ADD CONSTRAINT groups_public_id_numeric_check
            CHECK (public_id ~ '^[0-9]+$');
    END IF;
END $$;
