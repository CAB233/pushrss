import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as s from "./schema.ts";
export type Feed = typeof s.feeds.$inferSelect;
export type Channel = typeof s.notificationChannels.$inferSelect;
export type StoredItem = typeof s.feedItems.$inferSelect;
export type Delivery = typeof s.deliveries.$inferSelect;
export interface DeliveryLogRow {
  id: string;
  at: number;
  feedTitle: string;
  channelName: string;
  channelType: Channel["type"];
  itemTitle: string;
  itemLink: string | null;
  ok: boolean;
  error: string | null;
}
export interface FeedDetails {
  channelIds: string[];
  itemCount: number;
  latestItems: Pick<
    StoredItem,
    "id" | "title" | "link" | "summary" | "content" | "publishedAt"
  >[];
}
export interface ChannelStats {
  deliveredCount: number;
  lastDeliveryAt: number | null;
}
export interface Repositories {
  logs: {
    list(): Promise<DeliveryLogRow[]>;
    clear(): Promise<void>;
  };
  dashboard: {
    feeds(): Promise<(Feed & FeedDetails)[]>;
    channels(): Promise<(Channel & ChannelStats)[]>;
  };
  stats(start: number, end: number): Promise<{ sentToday: number }>;
  feeds: {
    fillTitleIfBlank(
      id: string,
      title: string,
      expectedUrl: string,
    ): Promise<void>;
    edit(
      id: string,
      value: Partial<
        Pick<
          Feed,
          | "category"
          | "keywords"
          | "url"
          | "title"
          | "enabled"
          | "intervalSeconds"
          | "nextFetchAt"
          | "updatedAt"
        >
      >,
    ): Promise<Feed | undefined>;
    save(value: typeof s.feeds.$inferInsert): Promise<Feed>;
    get(id: string): Promise<Feed | undefined>;
    updateFetch(
      id: string,
      value: Partial<
        Pick<
          Feed,
          | "siteUrl"
          | "lastFetchedAt"
          | "nextFetchAt"
          | "etag"
          | "lastModified"
          | "failureCount"
          | "lastError"
          | "updatedAt"
        >
      >,
      expectedUrl?: string,
    ): Promise<void>;
    list(
      limit?: number,
      offset?: number,
    ): Promise<Feed[]>;
    due(now: number, limit?: number): Promise<Feed[]>;
    remove(id: string): Promise<void>;
  };
  items: {
    get(id: string): Promise<StoredItem | undefined>;
    countForFeed(feedId: string): Promise<number>;
    insert(
      value: typeof s.feedItems.$inferInsert,
      expectedUrl?: string,
    ): Promise<StoredItem | undefined>;
    list(
      feedId: string,
      limit?: number,
      offset?: number,
    ): Promise<StoredItem[]>;
  };
  channels: {
    recordTest(id: string, at: number, error?: string): Promise<void>;
    stats(
      id: string,
    ): Promise<{ deliveredCount: number; lastDeliveryAt: number | null }>;
    save(value: typeof s.notificationChannels.$inferInsert): Promise<Channel>;
    get(id: string): Promise<Channel | undefined>;
    list(limit?: number, offset?: number): Promise<Channel[]>;
    remove(id: string): Promise<void>;
  };
  subscriptions: {
    list(
      feedId: string | undefined,
      limit?: number,
      offset?: number,
    ): Promise<(typeof s.subscriptions.$inferSelect)[]>;
    add(value: typeof s.subscriptions.$inferInsert): Promise<void>;
    remove(feedId: string, channelId: string): Promise<void>;
    channelsForFeed(feedId: string): Promise<Channel[]>;
  };
  deliveries: {
    list(
      status?: Delivery["status"],
      limit?: number,
      offset?: number,
    ): Promise<Delivery[]>;
    claim(id: string, now: number): Promise<Delivery | undefined>;
    retry(id: string, now: number): Promise<Delivery | undefined>;
    insert(
      value: typeof s.deliveries.$inferInsert,
    ): Promise<Delivery | undefined>;
    get(id: string): Promise<Delivery | undefined>;
    update(
      id: string,
      value: Partial<
        Pick<
          Delivery,
          | "status"
          | "attempts"
          | "lastError"
          | "externalMessageId"
          | "sentAt"
          | "nextAttemptAt"
          | "updatedAt"
        >
      >,
    ): Promise<void>;
  };
}
function page(limit = 50, offset = 0) {
  if (
    !Number.isInteger(limit) || limit < 1 || limit > 500 ||
    !Number.isInteger(offset) || offset < 0
  ) throw new Error("分页参数无效");
  return { limit, offset };
}
/** 单次方法为独立 SQL 操作；跨方法业务原子性由平台任务编排处理。 */
export function createRepositories(db: SqliteRemoteDatabase): Repositories {
  return {
    logs: {
      async list() {
        const rows = await db.select({
          id: s.deliveries.id,
          at: sql<
            number
          >`coalesce(${s.deliveries.sentAt}, ${s.deliveries.updatedAt})`,
          feedTitle: sql<
            string
          >`coalesce(nullif(${s.feeds.title}, ''), ${s.feeds.url}, '渠道测试')`,
          channelName: s.notificationChannels.name,
          channelType: s.notificationChannels.type,
          itemTitle: sql<
            string
          >`coalesce(${s.feedItems.title}, 'PushRSS测试通知')`,
          itemLink: s.feedItems.link,
          status: s.deliveries.status,
          error: s.deliveries.lastError,
        }).from(s.deliveries)
          .innerJoin(
            s.notificationChannels,
            eq(s.notificationChannels.id, s.deliveries.channelId),
          )
          .leftJoin(s.feedItems, eq(s.feedItems.id, s.deliveries.itemId))
          .leftJoin(s.feeds, eq(s.feeds.id, s.feedItems.feedId))
          .where(
            and(
              eq(s.deliveries.logVisible, true),
              or(
                eq(s.deliveries.status, "sent"),
                eq(s.deliveries.status, "failed"),
              ),
            ),
          )
          .orderBy(
            desc(
              sql`coalesce(${s.deliveries.sentAt}, ${s.deliveries.updatedAt})`,
            ),
            asc(s.deliveries.id),
          ).limit(100);
        return rows.map(({ status, ...row }) => ({
          ...row,
          ok: status === "sent",
        }));
      },
      async clear() {
        await db.update(s.deliveries).set({ logVisible: false }).where(
          or(
            eq(s.deliveries.status, "sent"),
            eq(s.deliveries.status, "failed"),
          ),
        );
      },
    },
    dashboard: {
      async feeds() {
        const rows = await db.select({
          feed: s.feeds,
          itemCount: sql<
            number
          >`(SELECT count(*) FROM feed_items WHERE feed_id = feeds.id)`,
          channelIds: sql<
            string
          >`(SELECT json_group_array(channel_id) FROM subscriptions WHERE feed_id = feeds.id)`,
          latestItems: sql<
            string
          >`(SELECT json_group_array(json_object('id', id, 'title', title, 'link', link, 'summary', summary, 'content', content, 'publishedAt', published_at)) FROM (SELECT id, title, link, summary, content, published_at FROM feed_items WHERE feed_id = feeds.id ORDER BY coalesce(published_at, created_at) DESC, created_at DESC, id ASC LIMIT 5))`,
        }).from(s.feeds).orderBy(desc(s.feeds.createdAt), asc(s.feeds.id));
        return rows.map(({ feed, channelIds, latestItems, itemCount }) => ({
          ...feed,
          itemCount,
          channelIds: JSON.parse(channelIds),
          latestItems: JSON.parse(latestItems),
        }));
      },
      async channels() {
        const rows = await db.select({
          channel: s.notificationChannels,
          deliveredCount: sql<
            number
          >`(SELECT count(*) FROM deliveries WHERE channel_id = notification_channels.id AND status = 'sent')`,
          lastDeliveryAt: sql<
            number | null
          >`(SELECT max(sent_at) FROM (SELECT sent_at FROM deliveries WHERE channel_id = notification_channels.id AND status = 'sent'))`,
        }).from(s.notificationChannels).orderBy(
          desc(s.notificationChannels.createdAt),
          asc(s.notificationChannels.id),
        );
        return rows.map(({ channel, ...stats }) => ({ ...channel, ...stats }));
      },
    },
    async stats(start, end) {
      const rows = await db.select({ sentToday: sql<number>`count(*)` }).from(
        s.deliveries,
      ).where(
        and(
          eq(s.deliveries.status, "sent"),
          sql`${s.deliveries.sentAt} >= ${start} AND ${s.deliveries.sentAt} < ${end}`,
        ),
      );
      return rows[0];
    },
    feeds: {
      async fillTitleIfBlank(id, title, expectedUrl) {
        await db.update(s.feeds).set({ title }).where(and(
          eq(s.feeds.id, id),
          eq(s.feeds.url, expectedUrl),
          sql`trim(${s.feeds.title}) = ''`,
        ));
      },
      async edit(id, value) {
        return (await db.update(s.feeds).set({
          ...value,
          ...(value.url === undefined ? {} : {
            etag:
              sql`CASE WHEN ${s.feeds.url} <> ${value.url} THEN NULL ELSE ${s.feeds.etag} END`,
            lastModified:
              sql`CASE WHEN ${s.feeds.url} <> ${value.url} THEN NULL ELSE ${s.feeds.lastModified} END`,
            lastFetchedAt:
              sql`CASE WHEN ${s.feeds.url} <> ${value.url} THEN NULL ELSE ${s.feeds.lastFetchedAt} END`,
            lastError:
              sql`CASE WHEN ${s.feeds.url} <> ${value.url} THEN NULL ELSE ${s.feeds.lastError} END`,
            failureCount:
              sql`CASE WHEN ${s.feeds.url} <> ${value.url} THEN 0 ELSE ${s.feeds.failureCount} END`,
          }),
        }).where(eq(s.feeds.id, id))
          .returning())[0];
      },
      async updateFetch(id, value, expectedUrl) {
        await db.update(s.feeds).set({
          ...value,
          ...(value.nextFetchAt !== undefined && value.updatedAt !== undefined
            ? {
              nextFetchAt:
                sql`${value.updatedAt} + ${s.feeds.intervalSeconds} * 1000`,
            }
            : {}),
        }).where(
          and(
            eq(s.feeds.id, id),
            expectedUrl === undefined
              ? undefined
              : eq(s.feeds.url, expectedUrl),
          ),
        );
      },
      async save(value) {
        const { id: _id, createdAt: _createdAt, ...changes } = value;
        const rows = await db.insert(s.feeds).values(value).onConflictDoUpdate({
          target: s.feeds.id,
          set: changes,
        }).returning();
        return rows[0];
      },
      async get(id) {
        return (await db.select().from(s.feeds).where(eq(s.feeds.id, id)).limit(
          1,
        ))[0];
      },
      async list(limit, offset) {
        const p = page(limit, offset);
        return await db.select().from(s.feeds).orderBy(asc(s.feeds.id))
          .limit(p.limit).offset(p.offset);
      },
      async due(now, limit) {
        const p = page(limit);
        return await db.select().from(s.feeds).where(
          and(eq(s.feeds.enabled, true), lte(s.feeds.nextFetchAt, now)),
        ).orderBy(asc(s.feeds.nextFetchAt), asc(s.feeds.id)).limit(p.limit);
      },
      async remove(id) {
        await db.delete(s.feeds).where(eq(s.feeds.id, id));
      },
    },
    items: {
      async get(id) {
        return (await db.select().from(s.feedItems).where(
          eq(s.feedItems.id, id),
        ).limit(1))[0];
      },
      async countForFeed(feedId) {
        const rows = await db.select({ total: sql<number>`count(*)` }).from(
          s.feedItems,
        ).where(eq(s.feedItems.feedId, feedId));
        return rows[0].total;
      },
      async insert(value, expectedUrl) {
        if (expectedUrl !== undefined) {
          return (await db.insert(s.feedItems).select(
            db.select({
              id: sql<string>`${value.id}`.as("id"),
              feedId: sql<string>`${value.feedId}`.as("feedId"),
              fingerprint: sql<string>`${value.fingerprint}`.as("fingerprint"),
              guid: sql<string | null>`${value.guid ?? null}`.as("guid"),
              title: sql<string>`${value.title}`.as("title"),
              link: sql<string | null>`${value.link ?? null}`.as("link"),
              content: sql<string | null>`${value.content ?? null}`.as(
                "content",
              ),
              summary: sql<string | null>`${value.summary ?? null}`.as(
                "summary",
              ),
              author: sql<string | null>`${value.author ?? null}`.as("author"),
              publishedAt: sql<number | null>`${value.publishedAt ?? null}`.as(
                "publishedAt",
              ),
              notify: sql<boolean>`${value.notify === false ? 0 : 1}`.as(
                "notify",
              ),
              createdAt: sql<number>`${value.createdAt}`.as("createdAt"),
            }).from(s.feeds).where(
              and(eq(s.feeds.id, value.feedId), eq(s.feeds.url, expectedUrl)),
            ),
          )
            .onConflictDoNothing({
              target: [s.feedItems.feedId, s.feedItems.fingerprint],
            }).returning())[0];
        }
        return (await db.insert(s.feedItems).values(value).onConflictDoNothing({
          target: [s.feedItems.feedId, s.feedItems.fingerprint],
        }).returning())[0];
      },
      async list(feedId, limit, offset) {
        const p = page(limit, offset);
        return await db.select().from(s.feedItems).where(
          eq(s.feedItems.feedId, feedId),
        ).orderBy(
          desc(
            sql`coalesce(${s.feedItems.publishedAt}, ${s.feedItems.createdAt})`,
          ),
          desc(s.feedItems.createdAt),
          asc(s.feedItems.id),
        ).limit(
          p.limit,
        ).offset(p.offset);
      },
    },
    channels: {
      async recordTest(id, at, error) {
        await db.insert(s.deliveries).values({
          id: crypto.randomUUID(),
          channelId: id,
          itemId: null,
          status: error === undefined ? "sent" : "failed",
          attempts: 1,
          sentAt: error === undefined ? at : null,
          lastError: error ?? null,
          createdAt: at,
          updatedAt: at,
        });
      },
      async stats(id) {
        const rows = await db.select({
          deliveredCount: sql<
            number
          >`(SELECT count(*) FROM deliveries WHERE channel_id = ${id} AND status = 'sent')`,
          lastDeliveryAt: sql<
            number | null
          >`(SELECT max(sent_at) FROM (SELECT sent_at FROM deliveries WHERE channel_id = ${id} AND status = 'sent'))`,
        }).from(sql`(SELECT 1)`);
        return rows[0];
      },
      async save(value) {
        const { id: _id, createdAt: _createdAt, ...changes } = value;
        return (await db.insert(s.notificationChannels).values(value)
          .onConflictDoUpdate({
            target: s.notificationChannels.id,
            set: changes,
          }).returning())[0];
      },
      async get(id) {
        return (await db.select().from(s.notificationChannels).where(
          eq(s.notificationChannels.id, id),
        ).limit(1))[0];
      },
      async list(limit, offset) {
        const p = page(limit, offset);
        return await db.select().from(s.notificationChannels).orderBy(
          asc(s.notificationChannels.id),
        ).limit(p.limit).offset(p.offset);
      },
      async remove(id) {
        await db.delete(s.notificationChannels).where(
          eq(s.notificationChannels.id, id),
        );
      },
    },
    subscriptions: {
      async list(feedId, limit, offset) {
        const p = page(limit, offset);
        return await db.select().from(s.subscriptions).where(
          feedId ? eq(s.subscriptions.feedId, feedId) : undefined,
        ).orderBy(asc(s.subscriptions.feedId), asc(s.subscriptions.channelId))
          .limit(p.limit).offset(p.offset);
      },
      async add(value) {
        await db.insert(s.subscriptions).values(value).onConflictDoNothing({
          target: [s.subscriptions.feedId, s.subscriptions.channelId],
        });
      },
      async remove(feedId, channelId) {
        await db.delete(s.subscriptions).where(
          and(
            eq(s.subscriptions.feedId, feedId),
            eq(s.subscriptions.channelId, channelId),
          ),
        );
      },
      async channelsForFeed(feedId) {
        return await db.select({
          id: s.notificationChannels.id,
          name: s.notificationChannels.name,
          type: s.notificationChannels.type,
          encryptedConfig: s.notificationChannels.encryptedConfig,
          enabled: s.notificationChannels.enabled,
          createdAt: s.notificationChannels.createdAt,
          updatedAt: s.notificationChannels.updatedAt,
        }).from(s.notificationChannels).innerJoin(
          s.subscriptions,
          eq(s.subscriptions.channelId, s.notificationChannels.id),
        ).where(
          and(
            eq(s.subscriptions.feedId, feedId),
            eq(s.notificationChannels.enabled, true),
          ),
        ).orderBy(asc(s.notificationChannels.id));
      },
    },
    deliveries: {
      async list(status, limit, offset) {
        const p = page(limit, offset);
        return await db.select().from(s.deliveries).where(
          status ? eq(s.deliveries.status, status) : undefined,
        ).orderBy(desc(s.deliveries.createdAt), asc(s.deliveries.id)).limit(
          p.limit,
        ).offset(p.offset);
      },
      async claim(id, now) {
        return (await db.update(s.deliveries).set({
          status: "sending",
          attempts: sql`${s.deliveries.attempts} + 1`,
          updatedAt: now,
        }).where(
          and(
            eq(s.deliveries.id, id),
            eq(s.deliveries.status, "pending"),
            or(
              isNull(s.deliveries.nextAttemptAt),
              lte(s.deliveries.nextAttemptAt, now),
            ),
          ),
        ).returning())[0];
      },
      async retry(id, now) {
        return (await db.update(s.deliveries).set({
          status: "pending",
          attempts: 0,
          logVisible: true,
          nextAttemptAt: now,
          updatedAt: now,
        }).where(
          and(
            eq(s.deliveries.id, id),
            eq(s.deliveries.status, "failed"),
            isNotNull(s.deliveries.itemId),
          ),
        ).returning())[0];
      },
      async insert(value) {
        return (await db.insert(s.deliveries).values(value).onConflictDoNothing(
          { target: [s.deliveries.itemId, s.deliveries.channelId] },
        ).returning())[0];
      },
      async get(id) {
        return (await db.select().from(s.deliveries).where(
          eq(s.deliveries.id, id),
        ).limit(1))[0];
      },
      async update(id, value) {
        await db.update(s.deliveries).set(value).where(eq(s.deliveries.id, id));
      },
    },
  };
}
