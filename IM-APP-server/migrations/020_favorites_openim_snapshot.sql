-- OpenIM 消息不落 PostgreSQL messages 表，收藏改为存客户端快照。
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_message_id_fkey;
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_conversation_id_fkey;
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_sender_id_fkey;

ALTER TABLE favorites
    ALTER COLUMN message_id TYPE TEXT USING message_id::text,
    ALTER COLUMN conversation_id TYPE TEXT USING conversation_id::text,
    ALTER COLUMN sender_id TYPE TEXT USING sender_id::text;

ALTER TABLE favorites ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE favorites ALTER COLUMN sender_id DROP NOT NULL;
