-- Additive only: preserve all URLs and treat existing records as legacy MinIO.
-- Apply to the NEW test database first. No data copy, rewrite or delete occurs.
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'minio';
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT '';
