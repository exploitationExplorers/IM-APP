ALTER TABLE group_reports
    ADD COLUMN IF NOT EXISTS image_paths TEXT[] NOT NULL DEFAULT '{}';
