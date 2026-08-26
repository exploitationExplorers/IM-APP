-- 新建群默认禁止成员互加好友（allow_member_add_friend=false）。
-- 不回写历史群；仅改列默认值，影响后续 INSERT 未显式赋值的行。
ALTER TABLE groups
  ALTER COLUMN allow_member_add_friend SET DEFAULT false;
