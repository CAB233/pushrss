import { passwordAuthorization } from "../../../packages/shared/auth.ts";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { RuntimeStatus } from "../../../packages/shared/mod.ts";
import {
  type NotificationServices,
  RETRY_POLICY,
  retryDelivery,
  testChannel,
} from "../../../packages/core/notifications.ts";
import { publicChannel } from "../../../packages/core/secrets.ts";
import {
  type ChannelType,
  validateConfig,
} from "../../../packages/notifier/mod.ts";
import {
  ApiError,
  body,
  boolean,
  feedUrl,
  interval,
  invalid,
  pagination,
  required,
  string,
} from "./validation.ts";
export interface ApiServices extends NotificationServices {
  adminPassword: string;
  sessionSecret: string;
}
const SESSION_COOKIE = "pushrss_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
function cookieOptions(url: string) {
  const parsed = new URL(url);
  return {
    path: "/api",
    httpOnly: true,
    sameSite: "Strict" as const,
    maxAge: SESSION_SECONDS,
    secure: parsed.protocol === "https:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname),
  };
}
async function validAuthorization(
  supplied: string,
  password: string,
): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [actual, expected] = await Promise.all([
    digest(supplied),
    digest(
      supplied.startsWith("Basic ")
        ? passwordAuthorization(password)
        : `Bearer ${password}`,
    ),
  ]);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  return request.headers.get("Origin") === new URL(request.url).origin;
}
export function createApp(
  runtime: RuntimeStatus["runtime"],
  services?: ApiServices,
): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ name: "PushRSS", runtime, stage: "api" }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/api/session", async (c) => {
    if (!services || !services.adminPassword.trim()) {
      throw new ApiError(503, "NOT_CONFIGURED", "管理服务待配置");
    }
    const supplied = c.req.header("Authorization") ?? "";
    if (
      !supplied.startsWith("Basic ") ||
      !await validAuthorization(supplied, services.adminPassword)
    ) {
      throw new ApiError(401, "UNAUTHORIZED", "管理密码错误");
    }
    const expiresAt = Date.now() + SESSION_SECONDS * 1000;
    await setSignedCookie(
      c,
      SESSION_COOKIE,
      `${expiresAt}-${crypto.randomUUID()}`,
      services.sessionSecret,
      cookieOptions(c.req.url),
    );
    return c.json({ authenticated: true });
  });
  app.delete("/api/session", (c) => {
    if (!sameOrigin(c.req.raw)) {
      throw new ApiError(403, "FORBIDDEN", "请求来源校验失败");
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/api" });
    return c.body(null, 204);
  });
  app.use("/api/*", async (c, next) => {
    if (!services || !services.adminPassword.trim()) {
      throw new ApiError(503, "NOT_CONFIGURED", "管理服务待配置");
    }
    const supplied = c.req.header("Authorization") ?? "";
    if (supplied) {
      if (!await validAuthorization(supplied, services.adminPassword)) {
        throw new ApiError(401, "UNAUTHORIZED", "管理密码错误");
      }
      await next();
      return;
    }
    const session = await getSignedCookie(
      c,
      services.sessionSecret,
      SESSION_COOKIE,
    );
    const expiresAt = session &&
        /^\d{13}-[0-9a-f-]{36}$/.test(session)
      ? Number(session.slice(0, 13))
      : 0;
    if (expiresAt <= Date.now()) {
      throw new ApiError(401, "UNAUTHORIZED", "登录已过期，请重新输入管理密码");
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      !sameOrigin(c.req.raw)
    ) {
      throw new ApiError(403, "FORBIDDEN", "请求来源校验失败");
    }
    await next();
  });
  const r = services?.repositories;
  const now = services?.now ?? Date.now;
  const settings = async () => ({
    defaultIntervalSeconds: (await r!.settings.get("defaultIntervalSeconds")) ??
      1800,
  });
  app.get(
    "/api/status",
    (c) =>
      c.json({
        name: "PushRSS",
        runtime,
        stage: "api",
        retryPolicy: RETRY_POLICY,
      }),
  );
  app.get("/api/overview", async (c) => {
    const start = Number(c.req.query("start"));
    const end = Number(c.req.query("end"));
    if (
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end <= start || end - start > 90000000
    ) invalid();
    return c.json(await r!.overview(start, end));
  });
  app.get(
    "/api/items/:id",
    async (c) => c.json(required(await r!.items.get(c.req.param("id")))),
  );
  app.get("/api/settings", async (c) => c.json(await settings()));
  app.patch("/api/settings", async (c) => {
    const b = await body(c, ["defaultIntervalSeconds"]);
    await r!.settings.set(
      "defaultIntervalSeconds",
      interval(b.defaultIntervalSeconds),
      now(),
    );
    return c.json(await settings());
  });
  app.get("/api/feeds", async (c) => {
    const [limit, offset] = pagination(c);
    return c.json({ items: await r!.feeds.list(limit, offset), limit, offset });
  });
  app.post("/api/feeds", async (c) => {
    const b = await body(c, ["url", "title", "enabled", "intervalSeconds"]),
      time = now();
    return c.json(
      await r!.feeds.save({
        id: crypto.randomUUID(),
        url: feedUrl(b.url),
        title: b.title === undefined ? "" : string(b.title),
        enabled: b.enabled === undefined ? true : boolean(b.enabled),
        intervalSeconds: interval(
          b.intervalSeconds ?? (await settings()).defaultIntervalSeconds,
        ),
        nextFetchAt: time,
        createdAt: time,
        updatedAt: time,
      }),
      201,
    );
  });
  app.get(
    "/api/feeds/:id",
    async (c) => c.json(required(await r!.feeds.get(c.req.param("id")))),
  );
  app.patch("/api/feeds/:id", async (c) => {
    const id = c.req.param("id");
    const old = required(await r!.feeds.get(id));
    const b = await body(c, ["url", "title", "enabled", "intervalSeconds"]);
    const url = b.url === undefined ? old.url : feedUrl(b.url);
    // 仅写入用户编辑字段，保留并发抓取产生的缓存及状态。
    return c.json(
      required(
        await r!.feeds.edit(id, {
          url,
          title: b.title === undefined ? old.title : string(b.title),
          enabled: b.enabled === undefined ? old.enabled : boolean(b.enabled),
          intervalSeconds: b.intervalSeconds === undefined
            ? old.intervalSeconds
            : interval(b.intervalSeconds),
          ...(url !== old.url || b.enabled === true ||
              b.intervalSeconds !== undefined
            ? { nextFetchAt: now() }
            : {}),
          updatedAt: now(),
        }),
      ),
    );
  });
  app.delete("/api/feeds/:id", async (c) => {
    required(await r!.feeds.get(c.req.param("id")));
    await r!.feeds.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  app.get("/api/feeds/:id/items", async (c) => {
    required(await r!.feeds.get(c.req.param("id")));
    const [limit, offset] = pagination(c);
    return c.json({
      items: await r!.items.list(c.req.param("id"), limit, offset),
      limit,
      offset,
    });
  });
  app.post("/api/feeds/:id/refresh", async (c) => {
    const feed = required(await r!.feeds.get(c.req.param("id")));
    if (!feed.enabled) {
      throw new ApiError(409, "FEED_DISABLED", "请先启用订阅源");
    }
    await services!.queue.enqueue(
      { type: "fetch_feed", feedId: feed.id },
      now(),
    );
    return c.json({ accepted: true }, 202);
  });
  app.get("/api/channels", async (c) => {
    const [limit, offset] = pagination(c);
    return c.json({
      items: (await r!.channels.list(limit, offset)).map(publicChannel),
      limit,
      offset,
    });
  });
  app.get(
    "/api/channels/:id",
    async (c) =>
      c.json(publicChannel(required(await r!.channels.get(c.req.param("id"))))),
  );
  for (const method of ["post", "patch"] as const) {
    app[method](
      method === "post" ? "/api/channels" : "/api/channels/:id",
      async (c) => {
        const old = method === "patch"
          ? required(await r!.channels.get(c.req.param("id")!))
          : undefined;
        const b = await body(c, ["name", "type", "config", "enabled"]);
        const type = b.type ?? old?.type;
        if (type !== "serverchan" && type !== "telegram") invalid();
        if (old && old.type !== type) {
          throw new ApiError(
            409,
            "CHANNEL_TYPE_IMMUTABLE",
            "渠道类型固定，请创建新的渠道",
          );
        }
        const id = old?.id ?? crypto.randomUUID();
        let encryptedConfig = old?.encryptedConfig;
        if (b.config !== undefined) {
          let config;
          try {
            config = validateConfig(type as ChannelType, b.config);
          } catch {
            invalid();
          }
          encryptedConfig = await services!.secrets.encrypt(
            JSON.stringify(config),
            id,
          );
        }
        if (!encryptedConfig) invalid();
        const row = await r!.channels.save({
          id,
          name: b.name === undefined ? old?.name ?? invalid() : string(b.name),
          type: type as ChannelType,
          encryptedConfig,
          enabled: b.enabled === undefined
            ? old?.enabled ?? true
            : boolean(b.enabled),
          createdAt: old?.createdAt ?? now(),
          updatedAt: now(),
        });
        return c.json(publicChannel(row), method === "post" ? 201 : 200);
      },
    );
  }
  app.delete("/api/channels/:id", async (c) => {
    required(await r!.channels.get(c.req.param("id")));
    await r!.channels.remove(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/api/channels/:id/test", async (c) => {
    required(await r!.channels.get(c.req.param("id")));
    return c.json(await testChannel(services!, c.req.param("id")));
  });
  app.get("/api/subscriptions", async (c) => {
    const [limit, offset] = pagination(c);
    const feedId = c.req.query("feedId");
    if (feedId !== undefined) required(await r!.feeds.get(feedId));
    return c.json({
      items: await r!.subscriptions.list(feedId, limit, offset),
      limit,
      offset,
    });
  });
  app.post("/api/subscriptions", async (c) => {
    const b = await body(c, ["feedId", "channelId"]);
    const feedId = string(b.feedId), channelId = string(b.channelId);
    required(await r!.feeds.get(feedId));
    required(await r!.channels.get(channelId));
    await r!.subscriptions.add({
      id: crypto.randomUUID(),
      feedId,
      channelId,
      createdAt: now(),
    });
    return c.json({ feedId, channelId }, 200);
  });
  app.delete("/api/subscriptions/:feedId/:channelId", async (c) => {
    await r!.subscriptions.remove(
      c.req.param("feedId"),
      c.req.param("channelId"),
    );
    return c.body(null, 204);
  });
  app.get("/api/deliveries", async (c) => {
    const [limit, offset] = pagination(c);
    const status = c.req.query("status");
    if (
      status !== undefined &&
      !["pending", "sending", "sent", "failed"].includes(status)
    ) invalid();
    return c.json({
      items: await r!.deliveries.list(
        status as "pending" | "sending" | "sent" | "failed" | undefined,
        limit,
        offset,
      ),
      limit,
      offset,
    });
  });
  app.get(
    "/api/deliveries/:id",
    async (c) => c.json(required(await r!.deliveries.get(c.req.param("id")))),
  );
  app.post("/api/deliveries/:id/retry", async (c) => {
    required(await r!.deliveries.get(c.req.param("id")));
    if (!await retryDelivery(services!, c.req.param("id"))) {
      throw new ApiError(409, "DELIVERY_NOT_FAILED", "仅失败投递可开启重试");
    }
    return c.json({ accepted: true }, 202);
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "资源不存在" } }, 404)
  );
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    // 数据库错误仅用于分类，响应始终使用固定文本。
    let cause: unknown = error;
    for (let i = 0; i < 4 && cause instanceof Error; i++, cause = cause.cause) {
      if (
        /UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(
          cause.message,
        )
      ) {
        return c.json({
          error: { code: "CONFLICT", message: "资源重复或关联资源已变更" },
        }, 409);
      }
    }
    return c.json({
      error: { code: "INTERNAL_ERROR", message: "操作失败，请稍后重试" },
    }, 500);
  });
  return app;
}
