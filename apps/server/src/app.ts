import { createResourceApp } from "./resources.ts";
import { passwordAuthorization } from "../../../packages/shared/auth.ts";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { RuntimeStatus } from "../../../packages/shared/mod.ts";
import type { NotificationServices } from "../../../packages/core/notifications.ts";
import { ApiError } from "./validation.ts";
export interface ApiServices extends NotificationServices {
  fetch?: typeof globalThis.fetch;
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
  app.get("/api/status", (c) => c.json({ name: "PushRSS", runtime }));
  if (services) app.route("/api", createResourceApp(services));
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
