CREATE TABLE feeds (
 id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT '未分类', keywords TEXT NOT NULL DEFAULT '[]', site_url TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 interval_seconds INTEGER NOT NULL DEFAULT 1800 CHECK(interval_seconds > 0),
 last_fetched_at INTEGER, next_fetch_at INTEGER NOT NULL, etag TEXT, last_modified TEXT,
 failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0), last_error TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX feeds_url_unique ON feeds(url);
CREATE INDEX feeds_due ON feeds(enabled,next_fetch_at);
CREATE TABLE feed_items (
 id TEXT PRIMARY KEY NOT NULL, feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, guid TEXT, title TEXT NOT NULL, link TEXT, content TEXT,
 summary TEXT, author TEXT, published_at INTEGER, notify INTEGER NOT NULL DEFAULT 1 CHECK(notify IN (0,1)), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX items_feed_fingerprint ON feed_items(feed_id,fingerprint);
CREATE INDEX items_feed_created ON feed_items(feed_id,created_at);
CREATE TABLE notification_channels (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('serverchan','telegram','webhook','slack','discord','feishu','dingtalk','wecom')),
 encrypted_config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE subscriptions (
 feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
 PRIMARY KEY(feed_id,channel_id)
);
CREATE INDEX subscriptions_channel ON subscriptions(channel_id);
CREATE TABLE deliveries (
 id TEXT PRIMARY KEY NOT NULL, item_id TEXT REFERENCES feed_items(id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), last_error TEXT, external_message_id TEXT,
 sent_at INTEGER, next_attempt_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(item_id IS NOT NULL OR (status='sent' AND sent_at IS NOT NULL))
);
CREATE UNIQUE INDEX deliveries_item_channel ON deliveries(item_id,channel_id);
CREATE INDEX deliveries_retry ON deliveries(status,next_attempt_at);
CREATE INDEX deliveries_channel ON deliveries(channel_id);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL CHECK(type IN ('fetch_feed','send_notification')),
 payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at INTEGER NOT NULL,
 locked_until INTEGER, lock_token TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_ready ON jobs(status,available_at);
CREATE UNIQUE INDEX jobs_active_target ON jobs(type,coalesce(json_extract(payload,'$.feedId'),json_extract(payload,'$.deliveryId'))) WHERE status IN ('pending','running');
CREATE TABLE notification_outbox (
 item_id TEXT PRIMARY KEY NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE
);
CREATE TRIGGER items_notification_outbox AFTER INSERT ON feed_items
WHEN NEW.notify = 1
BEGIN
 INSERT INTO notification_outbox(item_id) VALUES (NEW.id);
END;
