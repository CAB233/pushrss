import { fetchFeed, fingerprint, parseFeed } from "../packages/core/mod.ts";
import type { Repositories } from "../packages/db/repositories.ts";
import { equal, rejects } from "./data-contract.ts";
export async function verifyFeeds(
  repos: Repositories,
  rss: string,
  atom: string,
) {
  const a = parseFeed(rss, "https://example.com/feed.xml");
  equal(a.title, "新闻 & 技术");
  equal(a.items[0], {
    guid: "001",
    title: "标题 & 测试",
    link: "https://example.com/posts/1",
    content: "<p>正文</p>",
    summary: "<p>摘要</p>",
    author: "作者",
    publishedAt: 1790294400000,
  });
  equal(a.items[2].publishedAt, null);
  equal(a.items[4].title, "无标题");
  const b = parseFeed(atom);
  equal(
    parseFeed(
      '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:id>001</a:id><a:title>前缀</a:title></a:entry></a:feed>',
    ).items[0].guid,
    "001",
  );
  equal(b.items[0].link, "https://example.com/blog/posts/1");
  equal(b.items[0].author, "默认作者");
  equal(b.items[0].content, "<p>正文</p>");
  equal(b.items[0].publishedAt, a.items[0].publishedAt);
  equal(b.items[1].author, "甲, 乙");
  equal(b.items[1].content?.includes("<p>内容</p>"), true);
  equal(await fingerprint(a.items[0]), "guid:001");
  equal(await fingerprint(a.items[2]), "link:https://example.com/posts/2");
  equal((await fingerprint(a.items[3])).startsWith("hash:"), true);
  equal(
    await fingerprint(a.items[3]),
    await fingerprint({ ...a.items[3], content: "修改正文" }),
  );
  await rejects(() => parseFeed("<rss>"));
  await rejects(() =>
    parseFeed('<!DOCTYPE rss [<!ENTITY x "test">]><rss><channel/></rss>')
  );
  const id = crypto.randomUUID();
  const other = crypto.randomUUID();
  let time = 1000;
  const now = () => time;
  const create = (id: string) =>
    repos.feeds.save({
      id,
      url: `https://example.com/${id}`,
      title: "自定义标题",
      intervalSeconds: 60,
      nextFetchAt: 0,
      createdAt: 0,
      updatedAt: 0,
    });
  let response = () =>
    new Response(rss, {
      headers: {
        etag: '"v1"',
        "last-modified": "Fri, 25 Sep 2026 00:00:00 GMT",
      },
    });
  let headers = new Headers();
  const mock: typeof fetch = (_input, init) => {
    headers = new Headers(init?.headers);
    return Promise.resolve(response());
  };
  const run = () => fetchFeed(repos, id, { fetch: mock, now });
  await create(id);
  await create(other);
  try {
    const first = await run();
    if (first.status !== "updated") throw new Error("首次抓取失败");
    equal(first.added.length, 4);
    equal(first.notificationItems.length, 1);
    equal(first.notificationItems[0].title, "标题 & 测试");
    equal(first.initial, true);
    equal(headers.has("if-none-match"), false);
    equal((await repos.feeds.get(id))?.title, "自定义标题");
    const repeat = await run();
    if (repeat.status !== "updated") throw new Error("重复抓取失败");
    equal(repeat.added.length, 0);
    equal(headers.get("if-none-match"), '"v1"');
    equal(headers.get("if-modified-since"), "Fri, 25 Sep 2026 00:00:00 GMT");
    time = 2000;
    response = () =>
      new Response(null, { status: 304, headers: { etag: '"v2"' } });
    equal((await run()).status, "not_modified");
    equal((await repos.feeds.get(id))?.nextFetchAt, 62000);
    equal((await repos.feeds.get(id))?.etag, '"v2"');
    equal(
      (await fetchFeed(repos, other, { fetch: mock, now })).status,
      "failed",
    );
    for (const status of [404, 429, 500]) {
      response = () => new Response("私密响应内容", { status });
      equal(await run(), {
        status: "failed",
        error: `Feed HTTP 错误：${status}`,
      });
    }
    response = () => new Response("<broken>");
    equal((await run()).status, "failed");
    equal((await repos.feeds.get(id))?.lastFetchedAt, 2000);
    equal((await repos.feeds.get(id))?.failureCount, 4);
    response = () => new Response(atom);
    const recovered = await run();
    if (recovered.status !== "updated") throw new Error("恢复失败");
    equal(recovered.notificationItems.length, 1);
    equal((await repos.feeds.get(id))?.failureCount, 0);
    equal((await repos.feeds.get(id))?.lastError, null);
    equal((await repos.feeds.get(id))?.etag, null);
    const second = await fetchFeed(repos, other, { fetch: mock, now });
    if (second.status !== "updated") throw new Error("第二个 Feed 失败");
    equal(second.added.length, 2);
    equal(second.notificationItems.length, 1);
    equal(second.initial, true);
    response = () =>
      new Response(
        `<rss version="2.0"><channel><title>测试</title>
        <item><guid>older</guid><title>较早</title><pubDate>Fri, 25 Sep 2026 00:00:00 GMT</pubDate></item>
        <item><guid>newer</guid><title>最新</title><pubDate>Sat, 26 Sep 2026 00:00:00 GMT</pubDate></item>
        </channel></rss>`,
      );
    const manual = await fetchFeed(repos, other, {
      fetch: mock,
      now,
      latestOnly: true,
    });
    if (manual.status !== "updated") throw new Error("手动刷新失败");
    equal(manual.added.length, 2);
    equal(manual.notificationItems.map((item) => item.title), ["最新"]);
    response = () =>
      new Response(
        `<rss version="2.0"><channel><title>测试</title>
        <item><guid>newer</guid><title>最新</title><pubDate>Sat, 26 Sep 2026 00:00:00 GMT</pubDate></item>
        <item><guid>middle</guid><title>中间</title><pubDate>Fri, 25 Sep 2026 12:00:00 GMT</pubDate></item>
        <item><guid>earliest</guid><title>更早</title><pubDate>Thu, 24 Sep 2026 00:00:00 GMT</pubDate></item>
        </channel></rss>`,
      );
    const scheduled = await fetchFeed(repos, other, { fetch: mock, now });
    if (scheduled.status !== "updated") throw new Error("定时抓取失败");
    equal(scheduled.notificationItems.map((item) => item.title), [
      "中间",
      "更早",
    ]);
    equal(
      (await fetchFeed(repos, id, { fetch: mock, now, maxBytes: 10 })).status,
      "failed",
    );
    const network: typeof fetch = () =>
      Promise.reject(new Error("含私密 URL 的网络错误"));
    equal(await fetchFeed(repos, id, { fetch: network, now }), {
      status: "failed",
      error: "Feed 抓取或保存失败",
    });
    const timeout: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("abort")),
          { once: true },
        );
      });
    equal(await fetchFeed(repos, id, { fetch: timeout, now, timeoutMs: 5 }), {
      status: "failed",
      error: "Feed 抓取超时",
    });
    const current = (await repos.feeds.get(id))!;
    const slowBody: typeof fetch = (_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<rss>"));
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new Error("abort")),
                { once: true },
              );
            },
          }),
        ),
      );
    equal(await fetchFeed(repos, id, { fetch: slowBody, now, timeoutMs: 5 }), {
      status: "failed",
      error: "Feed 抓取超时",
    });
    // 更换地址保留文章；旧请求的文章写入和缓存更新由 SQL 条件隔离。
    const beforeCount = (await repos.items.list(id)).length;
    await repos.feeds.edit(id, {
      url: "https://moved.example/rss",
      nextFetchAt: time,
    });
    equal((await repos.feeds.get(id))?.etag, null);
    equal((await repos.feeds.get(id))?.lastFetchedAt, null);
    equal((await repos.items.list(id)).length, beforeCount);
    await repos.feeds.updateFetch(
      id,
      { etag: "stale", lastFetchedAt: time },
      current.url,
    );
    equal((await repos.feeds.get(id))?.etag, null);
    equal(
      await repos.items.insert({
        id: crypto.randomUUID(),
        feedId: id,
        fingerprint: "stale",
        title: "旧请求",
        createdAt: time,
      }, current.url),
      undefined,
    );
    equal(
      (await fetchFeed(repos, id, {
        fetch: async () => {
          await repos.feeds.edit(id, {
            url: "https://moved-again.example/rss",
          });
          return new Response(rss);
        },
      })).status,
      "skipped",
    );
    response = () => new Response(rss);
    const moved = await run();
    if (moved.status !== "updated") throw new Error("新地址抓取失败");
    // 相对链接会按新地址解析为新链接；GUID 相同的历史条目继续去重。
    equal(moved.added.length, 1);
    equal(moved.notificationItems.length, 1);
    const movedRepeat = await run();
    if (movedRepeat.status !== "updated") throw new Error("新地址重复抓取失败");
    equal(movedRepeat.added.length, 0);
    equal(headers.has("if-none-match"), false);
    await repos.feeds.save({ ...current, enabled: false });
    equal(await fetchFeed(repos, id, { fetch: network }), {
      status: "skipped",
    });
    equal(await fetchFeed(repos, "missing", { fetch: network }), {
      status: "skipped",
    });
  } finally {
    await repos.feeds.remove(id);
    await repos.feeds.remove(other);
  }
}
