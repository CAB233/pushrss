-- 首次入库文章与后续新增文章均持久化待分发标记；已有文章保持原有投递历史。
DROP TRIGGER items_notification_outbox;
CREATE TRIGGER items_notification_outbox AFTER INSERT ON feed_items
BEGIN
  INSERT INTO notification_outbox(item_id) VALUES (NEW.id);
END;
