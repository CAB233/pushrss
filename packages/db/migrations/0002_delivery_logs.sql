-- 推送记录显示标记与渠道测试失败记录，保留投递唯一约束和任务状态。
CREATE TABLE deliveries_next (
 id TEXT PRIMARY KEY NOT NULL, item_id TEXT REFERENCES feed_items(id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), last_error TEXT, external_message_id TEXT,
 log_visible INTEGER NOT NULL DEFAULT 1 CHECK(log_visible IN (0,1)),
 sent_at INTEGER, next_attempt_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(item_id IS NOT NULL OR status='failed' OR (status='sent' AND sent_at IS NOT NULL))
);
INSERT INTO deliveries_next(id,item_id,channel_id,status,attempts,last_error,external_message_id,sent_at,next_attempt_at,created_at,updated_at)
 SELECT id,item_id,channel_id,status,attempts,last_error,external_message_id,sent_at,next_attempt_at,created_at,updated_at FROM deliveries;
DROP TABLE deliveries;
ALTER TABLE deliveries_next RENAME TO deliveries;
CREATE UNIQUE INDEX deliveries_item_channel ON deliveries(item_id,channel_id);
CREATE INDEX deliveries_retry ON deliveries(status,next_attempt_at);
CREATE INDEX deliveries_channel ON deliveries(channel_id);
CREATE INDEX deliveries_log ON deliveries(log_visible,updated_at);
