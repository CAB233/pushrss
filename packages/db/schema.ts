// Drizzle 表结构由构建器推导，仓储通过 $inferSelect / $inferInsert 获取准确类型。
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { CHANNEL_TYPES } from "../notifier/mod.ts";
const id = () => text("id").primaryKey().notNull();
const created = () => integer("created_at").notNull();
export const feeds = sqliteTable(
  "feeds",
  {
    id: id(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("未分类"),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull()
      .default([]),
    notificationLimit: integer("notification_limit").notNull().default(10),
    siteUrl: text("site_url").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    intervalSeconds: integer("interval_seconds").notNull().default(1800),
    lastFetchedAt: integer("last_fetched_at"),
    nextFetchAt: integer("next_fetch_at").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  },
  (
    t,
  ) => [
    uniqueIndex("feeds_url_unique").on(t.url),
    index("feeds_due").on(t.enabled, t.nextFetchAt),
    check(
      "feeds_notification_limit_valid",
      sql`${t.notificationLimit} BETWEEN 1 AND 10`,
    ),
    check("feeds_interval_positive", sql`${t.intervalSeconds} > 0`),
    check("feeds_failures_valid", sql`${t.failureCount} >= 0`),
    check("feeds_enabled_valid", sql`${t.enabled} IN (0,1)`),
  ],
);
export const feedItems = sqliteTable(
  "feed_items",
  {
    id: id(),
    feedId: text("feed_id").notNull().references(() => feeds.id, {
      onDelete: "cascade",
    }),
    fingerprint: text("fingerprint").notNull(),
    guid: text("guid"),
    title: text("title").notNull(),
    link: text("link"),
    content: text("content"),
    summary: text("summary"),
    author: text("author"),
    publishedAt: integer("published_at"),
    notify: integer("notify", { mode: "boolean" }).notNull().default(true),
    createdAt: created(),
  },
  (
    t,
  ) => [
    uniqueIndex("items_feed_fingerprint").on(t.feedId, t.fingerprint),
    index("items_feed_created").on(t.feedId, t.createdAt),
    check("items_notify_valid", sql`${t.notify} IN (0,1)`),
  ],
);
export const notificationChannels = sqliteTable(
  "notification_channels",
  {
    id: id(),
    name: text("name").notNull(),
    type: text("type", { enum: [...CHANNEL_TYPES] }).notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  },
  (
    t,
  ) => [
    check(
      "channels_type_valid",
      sql`${t.type} IN ('serverchan','telegram','webhook','slack','discord','feishu','dingtalk','wecom')`,
    ),
    check("channels_enabled_valid", sql`${t.enabled} IN (0,1)`),
  ],
);
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    feedId: text("feed_id").notNull().references(() => feeds.id, {
      onDelete: "cascade",
    }),
    channelId: text("channel_id").notNull().references(
      () => notificationChannels.id,
      { onDelete: "cascade" },
    ),
  },
  (
    t,
  ) => [
    primaryKey({ columns: [t.feedId, t.channelId] }),
    index("subscriptions_channel").on(t.channelId),
  ],
);
/** itemId 为空的成功或失败记录表示固定渠道测试消息。 */
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: id(),
    itemId: text("item_id").references(() => feedItems.id, {
      onDelete: "cascade",
    }),
    channelId: text("channel_id").notNull().references(
      () => notificationChannels.id,
      { onDelete: "cascade" },
    ),
    status: text("status", { enum: ["pending", "sending", "sent", "failed"] })
      .notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    externalMessageId: text("external_message_id"),
    logVisible: integer("log_visible", { mode: "boolean" }).notNull().default(
      true,
    ),
    sentAt: integer("sent_at"),
    nextAttemptAt: integer("next_attempt_at"),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  },
  (
    t,
  ) => [
    uniqueIndex("deliveries_item_channel").on(t.itemId, t.channelId),
    index("deliveries_retry").on(t.status, t.nextAttemptAt),
    index("deliveries_channel").on(t.channelId),
    check(
      "deliveries_status_valid",
      sql`${t.status} IN ('pending','sending','sent','failed')`,
    ),
    check("deliveries_attempts_valid", sql`${t.attempts} >= 0`),
    check(
      "deliveries_test_valid",
      sql`${t.itemId} IS NOT NULL OR ${t.status} = 'failed' OR (${t.status} = 'sent' AND ${t.sentAt} IS NOT NULL)`,
    ),
    index("deliveries_log").on(t.logVisible, t.updatedAt),
  ],
);
export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    type: text("type", { enum: ["fetch_feed", "send_notification"] }).notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, string>>()
      .notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at").notNull(),
    lockedUntil: integer("locked_until"),
    lockToken: text("lock_token"),
    lastError: text("last_error"),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  },
  (
    t,
  ) => [
    index("jobs_ready").on(t.status, t.availableAt),
    uniqueIndex("jobs_active_target").on(
      t.type,
      sql`coalesce(json_extract(${t.payload}, '$.feedId'), json_extract(${t.payload}, '$.deliveryId'))`,
    ).where(sql`${t.status} IN ('pending','running')`),
    check(
      "jobs_type_valid",
      sql`${t.type} IN ('fetch_feed','send_notification')`,
    ),
    check(
      "jobs_status_valid",
      sql`${t.status} IN ('pending','running','completed','failed')`,
    ),
    check("jobs_attempts_valid", sql`${t.attempts} >= 0`),
  ],
);
/** 入库触发器与文章写入原子提交，补偿中断时的通知分发。 */
export const notificationOutbox = sqliteTable("notification_outbox", {
  itemId: text("item_id").primaryKey().notNull().references(
    () => feedItems.id,
    { onDelete: "cascade" },
  ),
});
