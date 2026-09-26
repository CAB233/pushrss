import {
  passwordAuthorization,
  sessionSigningSecret,
} from "../packages/shared/auth.ts";
import { createApp } from "../apps/server/src/app.ts";
import { generateSignedCookie } from "hono/cookie";
import type { Repositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { fetchFeed } from "../packages/core/fetch-feed.ts";
import { dispatchItems, sendDelivery } from "../packages/core/notifications.ts";
import type { Job } from "../packages/shared/contracts.ts";
function assert(value: unknown, message = "API 契约失败"): asserts value {
  if (!value) throw new Error(message);
}
export async function verifyApi(repositories: Repositories) {
  const jobs: Job[] = [];
  const masterKey = btoa("a".repeat(32));
  const services = {
    repositories,
    adminPassword: "short",
    sessionSecret: sessionSigningSecret(masterKey, "short"),
    secrets: await createSecretStore(masterKey),
    queue: {
      enqueue(job: Job) {
        jobs.push(job);
        return Promise.resolve();
      },
    },
    notifiers: {
      telegram: {
        send: () =>
          Promise.resolve({ ok: true as const, externalMessageId: "42" }),
      },
      serverchan: { send: () => Promise.resolve({ ok: true as const }) },
    },
  };
  const app = createApp("deno", services);
  const passwordApp = createApp("deno", {
    ...services,
    adminPassword: " 密码 ",
    sessionSecret: sessionSigningSecret(masterKey, " 密码 "),
  });
  assert(
    (await passwordApp.request("/api/status", {
      headers: { Authorization: passwordAuthorization(" 密码 ") },
    })).status === 200,
  );
  assert(
    (await passwordApp.request("/api/status", {
      headers: { Authorization: passwordAuthorization("密码") },
    })).status === 401,
  );
  assert(
    (await createApp("deno", { ...services, adminPassword: "" }).request(
      "/api/status",
    )).status === 503,
  );

  const req = (
    path: string,
    method = "GET",
    data?: unknown,
    token = services.adminPassword,
  ) =>
    app.request("/api" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const ok = async (
    path: string,
    method = "GET",
    data?: unknown,
    status = 200,
  ) => {
    const res = await req(path, method, data);
    assert(
      res.status === status,
      `${method} ${path}: ${res.status} ${await res.clone().text()}`,
    );
    return status === 204 ? null : await res.json();
  };
  assert((await createApp("deno").request("/api/status")).status === 503);
  assert((await req("/status", "GET", undefined, "wrong")).status === 401);
  assert(
    (await req("/feeds", "POST", { url: "https://example.com" }, "wrong"))
      .status === 401,
  );
  assert((await req("/status")).headers.get("cache-control") === "no-store");
  await ok("/status");
  const wrongLogin = await app.request("/api/session", {
    method: "POST",
    headers: { Authorization: passwordAuthorization("wrong") },
  });
  assert(wrongLogin.status === 401);
  assert(wrongLogin.headers.get("set-cookie") === null);
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { Authorization: passwordAuthorization("short") },
  });
  assert(login.status === 200);
  const setCookie = login.headers.get("set-cookie") ?? "";
  assert(setCookie.includes("HttpOnly"));
  assert(setCookie.includes("SameSite=Strict"));
  assert(setCookie.includes("Path=/api"));
  assert(setCookie.includes("Max-Age=604800"));
  assert(!setCookie.includes("short"));
  const cookie = setCookie.split(";")[0];
  assert(
    (await app.request("/api/status", { headers: { Cookie: cookie } }))
      .status === 200,
  );
  const expiredCookie = await generateSignedCookie(
    "pushrss_session",
    `${Date.now() - 1000}-${crypto.randomUUID()}`,
    services.sessionSecret,
    { path: "/api" },
  );
  assert(
    (await app.request("/api/status", {
      headers: { Cookie: expiredCookie.split(";")[0] },
    })).status === 401,
  );
  assert(
    (await app.request("/api/settings", {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ defaultIntervalSeconds: 180 }),
    })).status === 403,
  );
  assert(
    (await app.request("/api/settings", {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ defaultIntervalSeconds: 180 }),
    })).status === 200,
  );
  assert(
    (await createApp("deno", {
      ...services,
      adminPassword: "changed",
      sessionSecret: sessionSigningSecret(masterKey, "changed"),
    }).request("/api/status", { headers: { Cookie: cookie } })).status === 401,
  );
  const logout = await app.request("/api/session", {
    method: "DELETE",
    headers: { Cookie: cookie, Origin: "http://localhost" },
  });
  assert(logout.status === 204);
  assert((logout.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
  const secureLogin = await app.request("https://example.com/api/session", {
    method: "POST",
    headers: { Authorization: passwordAuthorization("short") },
  });
  assert((secureLogin.headers.get("set-cookie") ?? "").includes("Secure"));
  const before = await ok(`/overview?start=0&end=86400000`);
  assert(typeof before.feeds === "number" && before.articlesToday === 0);
  assert((await req("/overview?start=-1&end=1")).status === 400);
  assert((await req("/overview?start=0&end=90000001")).status === 400);

  await ok("/settings", "PATCH", { defaultIntervalSeconds: 120 });
  for (
    const input of [
      { url: "file:///etc/passwd" },
      { url: "https://u:p@example.com" },
      { url: "https://example.com", enabled: "true" },
      { url: "https://example.com", intervalSeconds: 0 },
      { url: "https://example.com", extra: true },
    ]
  ) assert((await req("/feeds", "POST", input)).status === 400);
  assert((await req("/feeds?limit=101")).status === 400);
  assert((await req("/feeds?offset=-1")).status === 400);
  assert((await req("/deliveries?status=invalid")).status === 400);
  assert((await req("/feeds/missing")).status === 404);
  assert(
    (await app.request("/api/feeds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${services.adminPassword}`,
        "content-type": "application/json",
      },
      body: "{",
    })).status === 400,
  );
  assert(
    (await req("/feeds", "POST", { url: "x".repeat(17000) })).status === 413,
  );
  const feed = await ok("/feeds", "POST", {
    url: "https://api-test.example/rss",
    title: "API 测试",
  }, 201);
  assert(feed.intervalSeconds === 120);
  assert((await req("/feeds", "POST", { url: feed.url })).status === 409);
  await ok(`/feeds/${feed.id}`, "PATCH", {
    enabled: false,
    intervalSeconds: 180,
  });
  assert((await req(`/feeds/${feed.id}/refresh`, "POST")).status === 409);
  await ok(`/feeds/${feed.id}`, "PATCH", { enabled: true });
  assert(
    (await req(`/feeds/${feed.id}`, "PATCH", {
      url: "https://another.example",
    })).status === 200,
  );
  const config = { botToken: "123:SecretToken", chatId: "123" };
  assert(
    (await req("/channels", "POST", {
      name: "错误",
      type: "telegram",
      config: {},
    })).status === 400,
  );
  const channel = await ok("/channels", "POST", {
    name: "测试渠道",
    type: "telegram",
    config,
  }, 201);
  assert(
    !JSON.stringify(channel).includes("SecretToken") &&
      !("encryptedConfig" in channel),
  );
  const stored = await repositories.channels.get(channel.id);
  assert(stored && !stored.encryptedConfig.includes("SecretToken"));
  await ok(`/channels/${channel.id}`, "PATCH", {
    name: "更名",
    enabled: false,
  });
  await ok("/subscriptions", "POST", {
    feedId: feed.id,
    channelId: channel.id,
  });
  await ok("/subscriptions", "POST", {
    feedId: feed.id,
    channelId: channel.id,
  });
  assert((await ok(`/subscriptions?feedId=${feed.id}`)).items.length === 1);
  await ok(`/channels/${channel.id}`, "PATCH", { enabled: true });
  assert((await ok(`/channels/${channel.id}/test`, "POST")).ok);
  const failedTest = await createApp("deno", {
    ...services,
    notifiers: {
      ...services.notifiers,
      telegram: {
        send: () =>
          Promise.resolve({
            ok: false as const,
            error: "通知渠道拒绝请求",
            retryable: false,
            outcome: "rejected" as const,
          }),
      },
    },
  }).request(`/api/channels/${channel.id}/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${services.adminPassword}` },
  });
  assert(failedTest.status === 502);
  assert((await failedTest.json()).error.message === "通知渠道拒绝请求");
  await ok(`/feeds/${feed.id}/refresh`, "POST", undefined, 202);
  assert(jobs[0].type === "fetch_feed" && jobs[0].feedId === feed.id);
  let version = 1;
  const fetcher = () =>
    Promise.resolve(
      new Response(
        `<rss version="2.0"><channel><title>测试</title><item><guid>${version}</guid><title>文章 ${version}</title></item></channel></rss>`,
      ),
    );
  await fetchFeed(repositories, feed.id, { fetch: fetcher });
  version = 2;
  const result = await fetchFeed(repositories, feed.id, { fetch: fetcher });
  assert(result.status === "updated");
  const [deliveryId] = await dispatchItems(services, result.notificationItems);
  await sendDelivery(services, deliveryId);
  assert(
    (await ok(`/feeds/${feed.id}/items?limit=1&offset=1`)).items.length === 1,
  );
  assert((await ok(`/deliveries/${deliveryId}`)).externalMessageId === "42");
  const item = await ok(`/items/${result.notificationItems[0].id}`);
  assert(item.title === "文章 2");
  const day = Math.floor(Date.now() / 86400000) * 86400000;
  const summary = await ok(`/overview?start=${day}&end=${day + 86400000}`);
  assert(
    summary.feeds === before.feeds + 1 && summary.articlesToday >= 2 &&
      summary.sentToday >= 1,
  );
  assert(summary.recentFeeds.some((f: { id: string }) => f.id === feed.id));

  assert(
    (await ok("/deliveries?status=sent")).items.some((v: { id: string }) =>
      v.id === deliveryId
    ),
  );
  assert((await req(`/deliveries/${deliveryId}/retry`, "POST")).status === 409);
  await repositories.deliveries.update(deliveryId, { status: "failed" });
  await ok(`/deliveries/${deliveryId}/retry`, "POST", undefined, 202);
  assert(jobs.at(-1)?.type === "send_notification");
  const list = await ok("/channels?limit=1");
  assert(
    list.items.length === 1 &&
      !JSON.stringify(list).includes("encryptedConfig"),
  );
  await ok(`/subscriptions/${feed.id}/${channel.id}`, "DELETE", undefined, 204);
  assert((await ok(`/subscriptions?feedId=${feed.id}`)).items.length === 0);
  await ok(`/feeds/${feed.id}`, "DELETE", undefined, 204);
  assert((await req(`/deliveries/${deliveryId}`)).status === 404);
  await ok(`/channels/${channel.id}`, "DELETE", undefined, 204);
  await repositories.settings.set("defaultIntervalSeconds", 1800, Date.now());
}
