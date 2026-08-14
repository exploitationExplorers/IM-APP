-- ============================================================
-- 008 APP 版本状态列补充
-- app_versions 建表时遗漏 status 列；后台已实现版本上下架(draft|published)功能
-- 幂等：ADD COLUMN IF NOT EXISTS（迁移机制每次启动重跑全部 SQL）
-- ============================================================

ALTER TABLE app_versions ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'draft';
