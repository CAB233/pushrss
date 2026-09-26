ALTER TABLE feed_items ADD COLUMN notify INTEGER NOT NULL DEFAULT 1 CHECK(notify IN (0,1));
DROP TRIGGER items_notification_outbox;
CREATE TRIGGER items_notification_outbox AFTER INSERT ON feed_items
WHEN NEW.notify = 1
BEGIN
  INSERT INTO notification_outbox(item_id) VALUES (NEW.id);
END;
