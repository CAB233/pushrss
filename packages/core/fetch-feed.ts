import { publicUrl } from "../notifier/mod.ts";
import type { Repositories, StoredItem } from "../db/repositories.ts";
import { fingerprint, parseFeed } from "./feed.ts";

export interface FetchOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  maxBytes?: number;
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
export async function readBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
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
/** 使用标准 Web API 跟随公开地址重定向，复用调用者的超时信号。 */
export async function fetchPublicFeed(
  url: string,
  init: RequestInit,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  let target = publicUrl(url);
  for (let attempt = 0; attempt <= 5; attempt++) {
    const response = await request(target, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new FeedError("Feed 重定向地址缺失");
    target = publicUrl(new URL(location, target).href);
  }
  throw new FeedError("Feed 重定向次数超过限制");
}
/** 样例源首次建立基线，后续过滤并分发至多十条新增文章。 */
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
    const request = options.fetch ?? globalThis.fetch;
    const response = await fetchPublicFeed(feed.url, {
      headers,
      signal: controller.signal,
    }, request);
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
      if (parsed.siteUrl) {
        await repos.feeds.updateFetch(
          feedId,
          { siteUrl: parsed.siteUrl },
          feed.url,
        );
      }
      if (parsed.title && !feed.title.trim()) {
        await repos.feeds.fillTitleIfBlank(
          feedId,
          parsed.title.slice(0, 500),
          feed.url,
        );
      }
      const added: StoredItem[] = [];
      const notificationItems: StoredItem[] = [];
      const initial = feed.lastFetchedAt === null;
      for (const item of parsed.items) {
        const matches = feed.keywords.length === 0 ||
          feed.keywords.some((keyword) =>
            `${item.title} ${
              (item.summary ?? item.content ?? "").replace(/<[^>]*>/g, " ")
                .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(
                  0,
                  280,
                )
            }`
              .toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
          );
        const notify = !initial && matches && notificationItems.length < 10;
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
          if (notify) {
            notificationItems.push(saved);
          }
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
