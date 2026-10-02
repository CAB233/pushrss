import { type ApiServices, createApp } from "../apps/server/src/app.ts";
import type { Repositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { fetchFeed, fetchPublicFeed } from "../packages/core/fetch-feed.ts";
import { dispatchItems, sendDelivery } from "../packages/core/notifications.ts";
import {
  CHANNEL_TYPES,
  createNotifiers,
  publicUrl,
} from "../packages/notifier/mod.ts";
import type { Job } from "../packages/shared/contracts.ts";
import { equal, rejects } from "./data-contract.ts";

export async function verifyRelay(repositories: Repositories) {
  const jobs: Job[] = [], channels: string[] = [];
  let version = 0, sent = 0;
  const document = () =>
    `<rss version="2.0"><channel><title>样例源</title><link>https://relay.example/</link>${
      Array.from({ length: version === 0 ? 2 : 16 }, (_, i) =>
        `<item><guid>relay-${i}</guid><title>${
          i === 2 ? "other" : "Deno"
        } ${i}</title><link>https://relay.example/${i}</link><description>摘要</description><pubDate>${
          new Date(1700000000000 + i * 1000).toUTCString()
        }</pubDate></item>`).join("")
    }</channel></rss>`;
  const services: ApiServices = {
    repositories,
    adminPassword: "relay-test",
    sessionSecret: "relay-session-test",
    secrets: await createSecretStore(btoa("r".repeat(32))),
    fetch: (() => Promise.resolve(new Response(document()))) as typeof fetch,
    queue: {
      enqueue(job) {
        jobs.push(job);
        return Promise.resolve();
      },
    },
    notifiers: Object.fromEntries(CHANNEL_TYPES.map((type) => [type, {
      send() {
        sent++;
        return Promise.resolve({ ok: true as const });
      },
    }])),
  };
  const app = createApp("deno", services);
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await app.request("/api" + path, {
      method,
      headers: {
        Authorization: "Bearer relay-test",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? undefined : await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    return data;
  }
  try {
    equal((await app.request("/api/feeds")).status, 401);
    for (const type of CHANNEL_TYPES) {
      const channel = await api("/channels", "POST", {
        type,
        name: `relay-${type}`,
        target: type === "serverchan"
          ? "sctp1tRelaySecret"
          : type === "telegram"
          ? "-100123"
          : "https://hooks.example/send?key=RelaySecret",
        token: "123:RelaySecret",
      });
      channels.push(channel.id);
      equal(JSON.stringify(channel).includes("RelaySecret"), false);
      await api(`/channels/${channel.id}/test`, "POST");
    }
    equal(sent, 8);
    const preview = await api("/feeds/preview", "POST", {
      url: "https://relay.example/feed",
    });
    equal(preview.title, "样例源");
    equal(preview.itemCount, 2);
    const feed = await api("/feeds", "POST", {
      url: "https://relay.example/feed",
      title: "",
      category: "技术",
      keywords: ["Deno"],
      channelIds: channels,
    });
    equal(feed.notificationLimit, 10);
    equal(feed.title, "样例源");
    equal(feed.category, "技术");
    equal(feed.status, "ok");
    equal(feed.itemCount, 2);
    equal(feed.siteUrl, "https://relay.example/");
    equal(feed.channelIds.length, 8);
    equal(
      (await repositories.items.list(feed.id)).every((item) => !item.notify),
      true,
    );
    equal(jobs.length, 0);
    version = 1;
    const updated = await fetchFeed(repositories, feed.id, {
      fetch: services.fetch,
    });
    if (updated.status !== "updated") throw new Error("RSS 样例抓取失败");
    equal(updated.added.length, 14);
    equal(updated.notificationItems.length, 10);
    equal(
      updated.notificationItems.every((item) => item.title.includes("Deno")),
      true,
    );
    const deliveries = await dispatchItems(services, updated.notificationItems);
    equal(deliveries.length, 80);
    for (const id of deliveries) {
      equal(await sendDelivery(services, id), "sent");
    }
    equal(
      (await api("/channels")).find((c: { id: string }) => c.id === channels[0])
        .deliveredCount,
      11,
    );
    const refresh = await api(`/feeds/${feed.id}/refresh`, "POST");
    equal(refresh.accepted, true);
    await api(`/feeds/${feed.id}`, "PATCH", {
      notificationLimit: 1,
      category: "阅读",
      keywords: [],
      channelIds: [channels[0]],
    });
    const changed = (await api("/feeds")).find((f: { id: string }) =>
      f.id === feed.id
    );
    equal(changed.notificationLimit, 1);
    equal(changed.category, "阅读");
    for (const notificationLimit of [0, -1, 11, 1.5, "1", null]) {
      equal(
        (await app.request(`/api/feeds/${feed.id}`, {
          method: "PATCH",
          headers: {
            Authorization: "Bearer relay-test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notificationLimit }),
        })).status,
        400,
      );
    }
    equal(
      (await api(`/feeds/${feed.id}`, "PATCH", { title: "样例源" }))
        .notificationLimit,
      1,
    );
    equal(changed.channelIds, [channels[0]]);
    equal(changed.latestItems.length, 5);
    await api(`/feeds/${feed.id}`, "PATCH", { enabled: false });
    equal(
      (await app.request(`/api/feeds/${feed.id}/refresh`, {
        method: "POST",
        headers: { Authorization: "Bearer relay-test" },
      })).status,
      409,
    );
    await api(`/channels/${channels[0]}`, "DELETE");
    equal((await repositories.subscriptions.list(feed.id)).length, 0);
    await api(`/feeds/${feed.id}`, "DELETE");
  } finally {
    for (const feed of await repositories.feeds.list(500)) {
      if (feed.url === "https://relay.example/feed") {
        await repositories.feeds.remove(feed.id);
      }
    }
    for (const id of channels) await repositories.channels.remove(id);
  }
  for (
    const value of [
      "http://127.0.0.1/feed",
      "http://[::1]/feed",
      "http://192.168.0.1/feed",
      "file:///tmp/feed",
      "https://u:p@rss.example/feed",
    ]
  ) {
    await rejects(() => Promise.resolve(publicUrl(value)));
  }
  equal(publicUrl("https://fc2.example/feed"), "https://fc2.example/feed");
  const redirects: string[] = [];
  const redirectFetch = ((url, init) => {
    equal(init?.redirect, "manual");
    redirects.push(String(url));
    return Promise.resolve(
      redirects.length === 1
        ? new Response(null, { status: 301, headers: { location: "/new" } })
        : new Response("<rss/>"),
    );
  }) as typeof fetch;
  equal(
    (await fetchPublicFeed("https://relay.example/old", {}, redirectFetch))
      .status,
    200,
  );
  equal(redirects, ["https://relay.example/old", "https://relay.example/new"]);
  await rejects(() =>
    fetchPublicFeed(
      "https://relay.example/old",
      {},
      (() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/" },
          }),
        )) as typeof fetch,
    )
  );
  for (
    const type of CHANNEL_TYPES.filter((type) =>
      type !== "telegram" && type !== "serverchan"
    )
  ) {
    let payload: Record<string, unknown> = {};
    const notifiers = createNotifiers({
      fetch: ((_url, init) => {
        payload = JSON.parse(init!.body as string);
        return Promise.resolve(Response.json({ code: 0, errcode: 0 }));
      }) as typeof fetch,
    });
    equal(
      (await notifiers[type].send({ target: "https://hooks.example/relay" }, {
        title: "更新",
        body: "摘要",
        url: "https://relay.example/article",
        feedTitle: "订阅",
        publishedAt: null,
      })).ok,
      true,
    );
    if (type === "webhook") equal(payload.feed, "订阅");
    if (type === "feishu") equal(payload.msg_type, "text");
    if (type === "dingtalk" || type === "wecom") equal(payload.msgtype, "text");
  }
}
