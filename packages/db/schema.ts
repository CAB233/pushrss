import {
  type $Type,
  type BuildColumns,
  type HasDefault,
  type IsPrimaryKey,
  type NotNull,
  sql,
} from "drizzle-orm";
import {
  check,
  index,
  integer,
  type SQLiteBooleanBuilderInitial,
  type SQLiteColumnBuilderBase,
  type SQLiteIntegerBuilderInitial,
  sqliteTable,
  type SQLiteTableWithColumns,
  type SQLiteTextBuilderInitial,
  type SQLiteTextJsonBuilderInitial,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// 公开表类型保留列名、空值、默认值与枚举信息；各表定义使用 satisfies 校验同步。
type Text<N extends string> = SQLiteTextBuilderInitial<
  N,
  [string, ...string[]],
  number | undefined
>;
type EnumText<N extends string, V extends [string, ...string[]]> =
  SQLiteTextBuilderInitial<N, V, number | undefined>;
type Num<N extends string> = SQLiteIntegerBuilderInitial<N>;
type Bool<N extends string> = SQLiteBooleanBuilderInitial<N>;
type Required<T extends SQLiteColumnBuilderBase> = NotNull<T>;
type Defaulted<T extends SQLiteColumnBuilderBase> = HasDefault<T>;
type Key<T extends SQLiteColumnBuilderBase> = IsPrimaryKey<NotNull<T>>;
type Id = Key<Text<"id">>;
type Created = Required<Num<"created_at">>;
type Table<
  N extends string,
  C extends Record<string, SQLiteColumnBuilderBase>,
> = SQLiteTableWithColumns<{
  name: N;
  schema: undefined;
  columns: BuildColumns<N, C, "sqlite">;
  dialect: "sqlite";
}>;
type FeedColumns = {
  id: Id;
  url: Required<Text<"url">>;
  title: Required<Text<"title">>;
  enabled: Defaulted<Required<Bool<"enabled">>>;
  intervalSeconds: Defaulted<Required<Num<"interval_seconds">>>;
  lastFetchedAt: Num<"last_fetched_at">;
  nextFetchAt: Required<Num<"next_fetch_at">>;
  etag: Text<"etag">;
  lastModified: Text<"last_modified">;
  failureCount: Defaulted<Required<Num<"failure_count">>>;
  lastError: Text<"last_error">;
  createdAt: Created;
  updatedAt: Required<Num<"updated_at">>;
};
type FeedItemColumns = {
  id: Id;
  feedId: Required<Text<"feed_id">>;
  fingerprint: Required<Text<"fingerprint">>;
  guid: Text<"guid">;
  title: Required<Text<"title">>;
  link: Text<"link">;
  content: Text<"content">;
  summary: Text<"summary">;
  author: Text<"author">;
  publishedAt: Num<"published_at">;
  createdAt: Created;
};
type ChannelColumns = {
  id: Id;
  name: Required<Text<"name">>;
  type: Required<EnumText<"type", ["serverchan", "telegram"]>>;
  encryptedConfig: Required<Text<"encrypted_config">>;
  enabled: Defaulted<Required<Bool<"enabled">>>;
  createdAt: Created;
  updatedAt: Required<Num<"updated_at">>;
};
type SubscriptionColumns = {
  id: Id;
  feedId: Required<Text<"feed_id">>;
  channelId: Required<Text<"channel_id">>;
  createdAt: Created;
};
type DeliveryColumns = {
  id: Id;
  itemId: Required<Text<"item_id">>;
  channelId: Required<Text<"channel_id">>;
  status: Defaulted<
    Required<EnumText<"status", ["pending", "sending", "sent", "failed"]>>
  >;
  attempts: Defaulted<Required<Num<"attempts">>>;
  lastError: Text<"last_error">;
  externalMessageId: Text<"external_message_id">;
  sentAt: Num<"sent_at">;
  nextAttemptAt: Num<"next_attempt_at">;
  createdAt: Created;
  updatedAt: Required<Num<"updated_at">>;
};
type JobColumns = {
  id: Id;
  type: Required<EnumText<"type", ["fetch_feed", "send_notification"]>>;
  payload: Required<
    $Type<SQLiteTextJsonBuilderInitial<"payload">, Record<string, string>>
  >;
  status: Defaulted<
    Required<EnumText<"status", ["pending", "running", "completed", "failed"]>>
  >;
  attempts: Defaulted<Required<Num<"attempts">>>;
  availableAt: Required<Num<"available_at">>;
  lockedUntil: Num<"locked_until">;
  lockToken: Text<"lock_token">;
  lastError: Text<"last_error">;
  createdAt: Created;
  updatedAt: Required<Num<"updated_at">>;
};
type SettingColumns = {
  key: Key<Text<"key">>;
  value: Required<$Type<SQLiteTextJsonBuilderInitial<"value">, unknown>>;
  updatedAt: Required<Num<"updated_at">>;
};
type NotificationOutboxColumns = {
  itemId: Key<Text<"item_id">>;
};
const id = (): Id => text("id").primaryKey();
const created = (): Created => integer("created_at").notNull();
export const feeds: Table<"feeds", FeedColumns> = sqliteTable(
  "feeds",
  {
    id: id(),
    url: text("url").notNull(),
    title: text("title").notNull(),
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
  } satisfies FeedColumns,
  (t) => [
    uniqueIndex("feeds_url_unique").on(t.url),
    index("feeds_due").on(t.enabled, t.nextFetchAt),
    check("feeds_interval_positive", sql`${t.intervalSeconds} > 0`),
    check("feeds_failures_valid", sql`${t.failureCount} >= 0`),
    check("feeds_enabled_valid", sql`${t.enabled} IN (0,1)`),
  ],
);
export const feedItems: Table<"feed_items", FeedItemColumns> = sqliteTable(
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
    createdAt: created(),
  } satisfies FeedItemColumns,
  (t) => [
    uniqueIndex("items_feed_fingerprint").on(t.feedId, t.fingerprint),
    index("items_feed_created").on(t.feedId, t.createdAt),
  ],
);
export const notificationChannels: Table<
  "notification_channels",
  ChannelColumns
> = sqliteTable(
  "notification_channels",
  {
    id: id(),
    name: text("name").notNull(),
    type: text("type", { enum: ["serverchan", "telegram"] }).notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  } satisfies ChannelColumns,
  (t) => [
    check("channels_type_valid", sql`${t.type} IN ('serverchan','telegram')`),
    check("channels_enabled_valid", sql`${t.enabled} IN (0,1)`),
  ],
);
export const subscriptions: Table<"subscriptions", SubscriptionColumns> =
  sqliteTable(
    "subscriptions",
    {
      id: id(),
      feedId: text("feed_id").notNull().references(() => feeds.id, {
        onDelete: "cascade",
      }),
      channelId: text("channel_id").notNull().references(
        () => notificationChannels.id,
        { onDelete: "cascade" },
      ),
      createdAt: created(),
    } satisfies SubscriptionColumns,
    (t) => [
      uniqueIndex("subscriptions_pair").on(t.feedId, t.channelId),
      index("subscriptions_channel").on(t.channelId),
    ],
  );
export const deliveries: Table<"deliveries", DeliveryColumns> = sqliteTable(
  "deliveries",
  {
    id: id(),
    itemId: text("item_id").notNull().references(() => feedItems.id, {
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
    sentAt: integer("sent_at"),
    nextAttemptAt: integer("next_attempt_at"),
    createdAt: created(),
    updatedAt: integer("updated_at").notNull(),
  } satisfies DeliveryColumns,
  (t) => [
    uniqueIndex("deliveries_item_channel").on(t.itemId, t.channelId),
    index("deliveries_retry").on(t.status, t.nextAttemptAt),
    index("deliveries_channel").on(t.channelId),
    check(
      "deliveries_status_valid",
      sql`${t.status} IN ('pending','sending','sent','failed')`,
    ),
    check("deliveries_attempts_valid", sql`${t.attempts} >= 0`),
  ],
);
export const jobs: Table<"jobs", JobColumns> = sqliteTable(
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
  } satisfies JobColumns,
  (t) => [
    index("jobs_ready").on(t.status, t.availableAt),
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
export const settings: Table<"settings", SettingColumns> = sqliteTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  } satisfies SettingColumns,
);

/** 由迁移中的触发器原子写入；Deno 恢复扫描负责分发。 */
export const notificationOutbox: Table<
  "notification_outbox",
  NotificationOutboxColumns
> = sqliteTable(
  "notification_outbox",
  {
    itemId: text("item_id").primaryKey().notNull().references(
      () => feedItems.id,
      { onDelete: "cascade" },
    ),
  } satisfies NotificationOutboxColumns,
);
