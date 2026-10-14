-- 最近上线时间：私聊顶栏展示「在线 / 1周内有上线」，方便判断客户多久没来
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
