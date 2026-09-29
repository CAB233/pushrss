import { Hono } from "hono";
import type { ApiServices } from "./app.ts";
import {
  ApiError,
  body,
  boolean,
  feedUrl,
  invalid,
  required,
  string,
} from "./validation.ts";
import type {
  Channel,
  ChannelStats,
  Feed,
  FeedDetails,
} from "../../../packages/db/repositories.ts";
import {
  CHANNEL_TYPES,
  type ChannelType,
  publicUrl,
  validateConfig,
} from "../../../packages/notifier/mod.ts";
import {
  fetchFeed,
  fetchPublicFeed,
  readBody,
} from "../../../packages/core/fetch-feed.ts";
import { parseFeed } from "../../../packages/core/feed.ts";
import { testChannel } from "../../../packages/core/notifications.ts";

const iso = (time: number | null) =>
  time === null ? null : new Date(time).toISOString();
async function all<T>(
  list: (limit: number, offset: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0;; offset += 500) {
    const page = await list(500, offset);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
function checkedUrl(value: unknown): string {
  const url = feedUrl(value);
  try {
    return publicUrl(url);
  } catch (cause) {
    throw new ApiError(
      400,
      "INVALID_URL",
      cause instanceof Error ? cause.message : "订阅地址无效",
    );
  }
}
function keywords(value: unknown): string[] {
  if (
    !Array.isArray(value) || value.length > 50 ||
    value.some((v) => typeof v !== "string" || v.length > 200)
  ) invalid();
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
}
function title(value: unknown) {
  return typeof value === "string" && value.length <= 500
    ? value.trim()
    : invalid();
}
function channelConfig(
  type: ChannelType,
  value: Record<string, unknown>,
  previous?: ReturnType<typeof validateConfig>,
) {
  const target = value.target === undefined
    ? previous &&
      ("target" in previous
        ? previous.target
        : "chatId" in previous
        ? previous.chatId
        : previous.sendKey)
    : string(value.target, 4096);
  const token = type !== "telegram"
    ? undefined
    : value.token === undefined
    ? previous && "botToken" in previous ? previous.botToken : undefined
    : string(value.token, 2048);
  try {
    return validateConfig(
      type,
      type === "serverchan" ? { sendKey: target } : type === "telegram"
        ? {
          ...previous,
          botToken: token,
          chatId: target,
          disablePreview: previous && "disablePreview" in previous
            ? previous.disablePreview
            : false,
        }
        : { target },
    );
  } catch {
    invalid();
  }
}
/** rss 样例的数组资源与表单契约，复用两种运行平台的持久化仓储和队列。 */
export function createResourceApp(services: ApiServices) {
  const app = new Hono();
  const r = services.repositories, now = services.now ?? Date.now;
  async function publicFeed(feed: Feed, details?: FeedDetails) {
    const [bindings, items, count] = details
      ? [
        details.channelIds.map((channelId) => ({ channelId })),
        details.latestItems,
        details.itemCount,
      ]
      : await Promise.all([
        all((limit, offset) => r.subscriptions.list(feed.id, limit, offset)),
        r.items.list(feed.id, 5),
        r.items.countForFeed(feed.id),
      ]);
    return {
      id: feed.id,
      title: feed.title || "未命名订阅",
      url: feed.url,
      siteUrl: feed.siteUrl,
      category: feed.category,
      enabled: feed.enabled,
      keywords: feed.keywords,
      channelIds: bindings.map((b) => b.channelId),
      status: feed.lastError
        ? "error"
        : feed.lastFetchedAt === null
        ? "pending"
        : "ok",
      lastError: feed.lastError,
      lastFetchedAt: iso(feed.lastFetchedAt),
      itemCount: count,
      latestItems: items.map((item) => ({
        id: item.id,
        title: item.title,
        link: item.link ?? "",
        summary: (item.summary ?? item.content ?? "").replace(/<[^>]*>/g, " ")
          .slice(0, 280),
        publishedAt: iso(item.publishedAt),
      })),
      createdAt: iso(feed.createdAt),
    };
  }
  async function publicChannel(channel: Channel, details?: ChannelStats) {
    let targetPreview = "凭据待恢复";
    try {
      const config = validateConfig(
        channel.type,
        JSON.parse(
          await services.secrets.decrypt(channel.encryptedConfig, channel.id),
        ),
      );
      // URL 的路径、查询与 SendKey 均包含凭据；列表仅显示公开主机。
      targetPreview = "target" in config
        ? `${new URL(config.target).origin}/••••`
        : "chatId" in config
        ? config.chatId
        : "SendKey ••••";
    } catch { /* 密钥恢复后可正常使用原配置 */ }
    const stats = details ?? await r.channels.stats(channel.id);
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      targetPreview,
      hasToken: channel.type === "telegram" || channel.type === "serverchan",
      enabled: channel.enabled,
      ...stats,
      lastDeliveryAt: iso(stats.lastDeliveryAt),
      createdAt: iso(channel.createdAt),
    };
  }
  async function validChannels(value: unknown): Promise<string[]> {
    if (
      !Array.isArray(value) || value.length > 500 ||
      value.some((id) => typeof id !== "string")
    ) invalid();
    const ids = [...new Set(value as string[])];
    for (const id of ids) required(await r.channels.get(id));
    return ids;
  }
  async function bindings(feedId: string, ids: string[]) {
    const current = await all((limit, offset) =>
      r.subscriptions.list(feedId, limit, offset)
    );
    for (const id of ids) {
      await r.subscriptions.add({ feedId, channelId: id });
    }
    for (const row of current) {
      if (!ids.includes(row.channelId)) {
        await r.subscriptions.remove(feedId, row.channelId);
      }
    }
  }
  app.get("/stats", async (c) => {
    const date = new Date(now());
    date.setUTCHours(0, 0, 0, 0);
    const start = c.req.query("start") === undefined
      ? date.getTime()
      : Number(c.req.query("start"));
    const end = c.req.query("end") === undefined
      ? date.getTime() + 86400000
      : Number(c.req.query("end"));
    if (
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end <= start || end - start > 90000000
    ) invalid();
    const stats = await r.stats(start, end);
    return c.json({ sentToday: stats.sentToday });
  });
  app.get("/logs", async (c) =>
    c.json((await r.logs.list()).map((row) => ({
      ...row,
      at: iso(row.at),
      itemLink: row.itemLink ?? "",
    }))));
  app.delete("/logs", async (c) => {
    await r.logs.clear();
    return c.body(null, 204);
  });
  app.get(
    "/feeds",
    async (c) =>
      c.json(
        await Promise.all(
          (await r.dashboard.feeds()).map((row) => publicFeed(row, row)),
        ),
      ),
  );
  app.post("/feeds/preview", async (c) => {
    const b = await body(c, ["url"]), url = checkedUrl(b.url);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetchPublicFeed(url, {
        signal: abort.signal,
        redirect: "manual",
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      }, services.fetch);
      if (!response.ok || response.status >= 300) {
        await response.body?.cancel();
        throw new ApiError(
          422,
          "FEED_PREVIEW_FAILED",
          `Feed HTTP ${response.status}，请使用订阅源的最终地址`,
        );
      }
      const parsed = parseFeed(
        await readBody(response, 2 * 1024 * 1024),
        response.url || url,
      );
      return c.json({
        title: parsed.title,
        siteUrl: parsed.siteUrl,
        itemCount: parsed.items.length,
        items: parsed.items.slice(0, 3).map(({ title }) => ({ title })),
      });
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(
        422,
        "FEED_PREVIEW_FAILED",
        abort.signal.aborted
          ? "检测超时"
          : "订阅源检测失败，请检查地址与 Feed 格式",
      );
    } finally {
      clearTimeout(timer);
    }
  });
  app.post("/feeds", async (c) => {
    const b = await body(c, [
      "url",
      "title",
      "category",
      "keywords",
      "channelIds",
    ]);
    const ids = await validChannels(b.channelIds ?? []), time = now();
    const feed = await r.feeds.save({
      id: crypto.randomUUID(),
      url: checkedUrl(b.url),
      title: title(b.title ?? ""),
      category: title(b.category ?? "") || "未分类",
      keywords: keywords(b.keywords ?? []),

      enabled: false,
      intervalSeconds: 1800,
      nextFetchAt: time + 1800000,
      createdAt: time,
      updatedAt: time,
    });
    try {
      await bindings(feed.id, ids);
      await r.feeds.edit(feed.id, { enabled: true, updatedAt: now() });
    } catch (cause) {
      await r.feeds.remove(feed.id);
      throw cause;
    }
    await fetchFeed(r, feed.id, { fetch: services.fetch, now });
    return c.json(await publicFeed(required(await r.feeds.get(feed.id))), 201);
  });
  app.patch("/feeds/:id", async (c) => {
    const id = c.req.param("id"), old = required(await r.feeds.get(id));
    const b = await body(c, [
      "title",
      "category",
      "keywords",
      "channelIds",
      "enabled",
    ]);
    const changes = {
      title: b.title === undefined ? old.title : string(b.title),
      category: b.category === undefined
        ? old.category
        : title(b.category) || "未分类",
      keywords: b.keywords === undefined ? old.keywords : keywords(b.keywords),
      enabled: b.enabled === undefined ? old.enabled : boolean(b.enabled),

      updatedAt: now(),
    };
    if (b.channelIds !== undefined) {
      await bindings(id, await validChannels(b.channelIds));
    }
    return c.json(await publicFeed(required(await r.feeds.edit(id, changes))));
  });
  app.delete("/feeds/:id", async (c) => {
    required(await r.feeds.get(c.req.param("id")));
    await r.feeds.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  async function refresh(feed: Feed) {
    if (!feed.enabled) {
      throw new ApiError(409, "FEED_DISABLED", "请先启用订阅源");
    }
    await services.queue.enqueue(
      { type: "fetch_feed", feedId: feed.id },
      now(),
    );
    return {
      feedId: feed.id,
      ok: true,
      accepted: true,
      newItems: 0,
      delivered: 0,
      failed: 0,
    };
  }
  app.post("/feeds/refresh-all", async (c) => {
    const feeds = (await all(r.feeds.list)).filter((feed) => feed.enabled);
    const results = [];
    for (const feed of feeds) results.push(await refresh(feed));
    return c.json(results, 202);
  });
  app.post(
    "/feeds/:id/refresh",
    async (c) =>
      c.json(
        await refresh(required(await r.feeds.get(c.req.param("id")))),
        202,
      ),
  );
  app.get(
    "/channels",
    async (c) =>
      c.json(
        await Promise.all(
          (await r.dashboard.channels()).map((row) => publicChannel(row, row)),
        ),
      ),
  );
  app.post("/channels", async (c) => {
    const b = await body(c, ["type", "name", "target", "token"]),
      type = b.type as ChannelType;
    if (!CHANNEL_TYPES.includes(type)) invalid();
    const config = channelConfig(type, b);
    const id = crypto.randomUUID(), time = now();
    const channel = await r.channels.save({
      id,
      name: string(b.name),
      type,
      enabled: true,
      encryptedConfig: await services.secrets.encrypt(
        JSON.stringify(config),
        id,
      ),
      createdAt: time,
      updatedAt: time,
    });
    return c.json(await publicChannel(channel), 201);
  });
  app.patch("/channels/:id", async (c) => {
    const old = required(await r.channels.get(c.req.param("id"))),
      b = await body(c, ["name", "enabled", "type", "target", "token"]);
    const type = b.type === undefined ? old.type : b.type as ChannelType;
    if (!CHANNEL_TYPES.includes(type)) invalid();
    let encryptedConfig = old.encryptedConfig;
    if (type !== old.type || b.target !== undefined || b.token !== undefined) {
      let previous: ReturnType<typeof validateConfig> | undefined;
      if (type === old.type) {
        try {
          previous = validateConfig(
            old.type,
            JSON.parse(
              await services.secrets.decrypt(old.encryptedConfig, old.id),
            ),
          );
        } catch { /* 完整的新凭据可用于修复原配置。 */ }
      }
      encryptedConfig = await services.secrets.encrypt(
        JSON.stringify(channelConfig(type, b, previous)),
        old.id,
      );
    }
    return c.json(
      await publicChannel(
        await r.channels.save({
          ...old,
          type,
          encryptedConfig,
          name: b.name === undefined ? old.name : string(b.name),
          enabled: b.enabled === undefined ? old.enabled : boolean(b.enabled),
          updatedAt: now(),
        }),
      ),
    );
  });
  app.delete("/channels/:id", async (c) => {
    required(await r.channels.get(c.req.param("id")));
    await r.channels.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/channels/:id/test", async (c) => {
    required(await r.channels.get(c.req.param("id")));
    const result = await testChannel(services, c.req.param("id"));
    await r.channels.recordTest(
      c.req.param("id"),
      now(),
      result.ok ? undefined : result.error,
    );
    if (!result.ok) {
      throw new ApiError(502, "NOTIFICATION_FAILED", result.error);
    }
    return c.json(result);
  });
  return app;
}
