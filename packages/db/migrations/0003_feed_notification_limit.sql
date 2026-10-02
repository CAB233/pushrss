ALTER TABLE feeds ADD COLUMN notification_limit INTEGER NOT NULL DEFAULT 10
  CHECK (notification_limit BETWEEN 1 AND 10);
