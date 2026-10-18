-- Additive only. Apply this migration explicitly when startup uses verify mode.
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS media_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Cursor scanning must advance past failed legacy sources, without starving
-- later rows. This index contains no message bodies or external credentials.
CREATE INDEX IF NOT EXISTS idx_favorites_unarchived_media
    ON favorites(id) WHERE NOT media_archived AND msg_type IN ('image','voice','video','file');
