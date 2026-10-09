-- 存量群的成员上限抬到 2000。
--
-- 为什么需要单独改这里：群的实际上限是
--     min(groups.max_members, maxGroupMembers, GROUP_MEMBER_HARD_LIMIT)
-- （见 IM-APP-server/internal/repository/group.go 的 effectiveGroupLimit）。
-- max_members 是每群一行的独立列，024 迁移建它时默认 200。
-- 所以只把「系统上限」调到 2000 是不够的 —— 已存在的群仍然被自己那行
-- max_members=200 卡住，前台看起来配好了、实际还是 200。
-- 线上群 100018 已经有 199 人，几乎撑满，正是这种状态。
--
-- 系统上限本身不在这里改：它由管理后台「系统限制」页保存并发布
-- （app_config_versions 里 status='published' 的那一版）。后台没部署时，
-- 用环境变量 GROUP_MEMBER_MAX / DEFAULT_GROUP_MAX_MEMBERS 覆盖，见 config.Config。
--
-- 幂等：只动 < 2000 的行，重复执行无副作用。只处理 active 群。
UPDATE groups
SET max_members = 2000
WHERE COALESCE(status, 'active') = 'active'
  AND COALESCE(max_members, 0) < 2000;
