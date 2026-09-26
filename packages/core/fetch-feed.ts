import type { Repositories, StoredItem } from "../db/repositories.ts";
import { fingerprint, parseFeed } from "./feed.ts";

export interface FetchOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
  latestOnly?: boolean;
}
export type FetchResult =
  | { status: "skipped" }
  | { status: "failed"; error: string }
  | { status: "not_modified" }
  | {
    status: "updated";
    initial: boolean;
    added: StoredItem[];
    notificationItems: StoredItem[];
  };
class FeedError extends Error {}
async function readBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new FeedError("Feed 响应超过大小限制");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
/** 首次抓取与手动刷新仅通知最新新增文章；其余抓取通知全部新增文章。 */
export async function fetchFeed(
  repos: Repositories,
  feedId: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const feed = await repos.feeds.get(feedId);
  if (!feed || !feed.enabled) return { status: "skipped" };
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    !Number.isSafeInteger(maxBytes) || maxBytes <= 0
  ) throw new Error("抓取限制参数无效");
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: FetchResult;
  let etag: string | null = feed.etag;
  let lastModified: string | null = feed.lastModified;
  try {
    const u = new URL(feed.url);
    if (!["http:", "https:"].includes(u.protocol)) {
      throw new FeedError("Feed URL 协议无效");
    }
    const headers = new Headers({
      Accept:
        "application/atom+xml, application/rss+xml, application/xml, text/xml",
    });
    if (feed.lastFetchedAt !== null) {
      if (feed.etag) headers.set("If-None-Match", feed.etag);
      if (feed.lastModified) {
        headers.set("If-Modified-Since", feed.lastModified);
      }
    }
    const response = await (options.fetch ?? globalThis.fetch)(u, {
      headers,
      signal: controller.signal,
    });
    if ((await repos.feeds.get(feedId))?.url !== feed.url) {
      await response.body?.cancel();
      return { status: "skipped" };
    }
    if (response.status === 304) {
      if (feed.lastFetchedAt === null) {
        throw new FeedError("首次抓取收到 304，请返回完整 Feed 内容");
      }
      etag = response.headers.get("etag") ?? etag;
      lastModified = response.headers.get("last-modified") ?? lastModified;
      result = { status: "not_modified" };
    } else {
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new FeedError(`Feed HTTP 错误：${response.status}`);
      }
      const body = await readBody(response, maxBytes);
      let parsed;
      try {
        parsed = parseFeed(body, response.url || feed.url);
      } catch {
        throw new FeedError("Feed XML 无效或格式暂未支持");
      }
      const added: StoredItem[] = [];
      const notificationItems: StoredItem[] = [];
      const initial = feed.lastFetchedAt === null;
      const latestOnly = initial || options.latestOnly === true;
      const items = latestOnly
        ? parsed.items.toSorted((a, b) =>
          (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity)
        )
        : parsed.items;
      for (const item of items) {
        const notify = !latestOnly || notificationItems.length === 0;
        const saved = await repos.items.insert({
          ...item,
          id: crypto.randomUUID(),
          feedId,
          fingerprint: await fingerprint(item),
          notify,
          createdAt: now(),
        }, feed.url);
        if (saved) {
          added.push(saved);
          if (notify) notificationItems.push(saved);
        }
      }
      etag = response.headers.get("etag");
      lastModified = response.headers.get("last-modified");
      result = {
        status: "updated",
        initial,
        added,
        notificationItems,
      };
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? "Feed 抓取超时"
      : error instanceof FeedError
      ? error.message
      : "Feed 抓取或保存失败";
    const at = now();
    await repos.feeds.updateFetch(feedId, {
      failureCount: feed.failureCount + 1,
      lastError: message,
      nextFetchAt: at + feed.intervalSeconds * 1000,
      updatedAt: at,
    }, feed.url);
    return { status: "failed", error: message };
  } finally {
    clearTimeout(timer);
  }
  const at = now();
  await repos.feeds.updateFetch(feedId, {
    lastFetchedAt: at,
    nextFetchAt: at + feed.intervalSeconds * 1000,
    etag,
    lastModified,
    failureCount: 0,
    lastError: null,
    updatedAt: at,
  }, feed.url);
  return result;
}
