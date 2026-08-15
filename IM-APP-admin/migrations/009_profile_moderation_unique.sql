-- 修复 profile_moderation_records 缺少 UNIQUE(user_id, field) 导致的并发重复插入（清单 07）
-- 先清理同 (user_id, field) 的重复记录（保留 id 最大即最新一条），再补唯一约束。

DELETE FROM profile_moderation_records a
USING profile_moderation_records b
WHERE a.user_id = b.user_id AND a.field = b.field AND a.id < b.id;

ALTER TABLE profile_moderation_records
    ADD CONSTRAINT uq_profile_mod_user_field UNIQUE (user_id, field);
