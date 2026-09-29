import {
  passwordAuthorization,
  sessionSigningSecret,
} from "../packages/shared/auth.ts";
import { createApp } from "../apps/server/src/app.ts";
import { generateSignedCookie } from "hono/cookie";
import type { Repositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
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
    (await app.request("/api/channels/missing", {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    })).status === 403,
  );
  assert(
    (await app.request("/api/channels/missing", {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    })).status === 404,
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

  for (
    const path of [
      "/overview",
      "/settings",
      "/deliveries",
      "/subscriptions",
      "/relay/feeds",
    ]
  ) assert((await req(path)).status === 404);
  assert(Array.isArray(await ok("/feeds")));
  assert(Array.isArray(await ok("/channels")));
  assert((await req("/stats?start=-1&end=1")).status === 400);
  assert(
    (await req("/channels", "POST", {
      type: "invalid",
      name: "测试",
      target: "https://hooks.example/",
    })).status === 400,
  );
  assert(
    (await req("/feeds", "POST", { url: "file:///etc/passwd" })).status === 400,
  );
  assert(
    (await req("/feeds", "POST", { url: "http://127.0.0.1/feed" })).status ===
      400,
  );
  assert(
    (await req("/feeds", "POST", {
      url: "https://example.com/rss",
      keywords: [123],
    })).status === 400,
  );
  assert(
    (await app.request("/api/channels", {
      method: "POST",
      headers: { Authorization: "Bearer short", "content-type": "text/plain" },
      body: "{}",
    })).status === 415,
  );
  assert(
    (await req("/channels", "POST", { name: "x".repeat(20000) })).status ===
      413,
  );
}
