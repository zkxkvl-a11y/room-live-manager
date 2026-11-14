CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, uid TEXT NOT NULL, endpoint TEXT NOT NULL, subscription TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS subscriptions_uid ON subscriptions(uid);
CREATE TABLE IF NOT EXISTS deliveries (event_id TEXT PRIMARY KEY, room_name TEXT NOT NULL, created_at INTEGER NOT NULL);
