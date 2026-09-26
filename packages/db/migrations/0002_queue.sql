CREATE TABLE notification_outbox (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE
);
CREATE TRIGGER items_notification_outbox AFTER INSERT ON feed_items
WHEN (SELECT last_fetched_at FROM feeds WHERE id = NEW.feed_id) IS NOT NULL
BEGIN
  INSERT INTO notification_outbox(item_id) VALUES (NEW.id);
END;
-- coalesce 避免 SQLite 唯一索引中 NULL 互不冲突。
CREATE UNIQUE INDEX jobs_active_target ON jobs(type, coalesce(json_extract(payload, '$.feedId'), json_extract(payload, '$.deliveryId'))) WHERE status IN ('pending','running');
