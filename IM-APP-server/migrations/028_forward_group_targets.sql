-- 兼容队列增加群目标；旧 user_id 数据继续保留。
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS peer_type VARCHAR(16) NOT NULL DEFAULT 'c2c';
ALTER TABLE forward_task_targets ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);
ALTER TABLE forward_task_targets ALTER COLUMN user_id DROP NOT NULL;
UPDATE forward_task_targets SET peer_type='c2c' WHERE peer_type='';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='forward_target_peer_check') THEN
        ALTER TABLE forward_task_targets ADD CONSTRAINT forward_target_peer_check
            CHECK ((peer_type='c2c' AND user_id IS NOT NULL AND group_id IS NULL)
                OR (peer_type='group' AND group_id IS NOT NULL AND user_id IS NULL)) NOT VALID;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_targets_task_group
    ON forward_task_targets(task_id, group_id) WHERE peer_type='group';
