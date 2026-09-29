/** rss 页面浏览器验收：同源登录、样例表单、列表、卡片与路由，模拟出站请求。 */
import { chromium, expect } from "@playwright/test";
import { type ApiServices, createApp } from "../apps/server/src/app.ts";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { sessionSigningSecret } from "../packages/shared/auth.ts";
import { handleJob } from "../packages/core/jobs.ts";
import { CHANNEL_TYPES } from "../packages/notifier/mod.ts";
import { testMigrations } from "../tests/migrations.ts";
import type { Job } from "../packages/shared/contracts.ts";

const database = openDatabase(":memory:");
migrate(database.client, await testMigrations());
const repositories = createRepositories(database.db), jobs: Job[] = [];
let version = 0, sent = 0;
const password = "样例登录密码";
const feedXml = () =>
  `<rss version="2.0"><channel><title>示例技术源</title><link>https://feed.example/</link><item><guid>baseline</guid><title>Deno 基线文章</title><link>https://feed.example/first</link><description>基础</description></item>${
    version
      ? "<item><guid>new</guid><title>Deno 新文章</title><link>https://feed.example/new</link><description>更新</description></item>"
      : ""
  }</channel></rss>`;
const services: ApiServices = {
  repositories,
  adminPassword: password,
  sessionSecret: sessionSigningSecret(btoa("a".repeat(32)), password),
  secrets: await createSecretStore(btoa("a".repeat(32))),
  fetch: (() => Promise.resolve(new Response(feedXml()))) as typeof fetch,
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
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (request) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || path === "/health") {
      return app.fetch(
        request,
      );
    }
    if (
      path !== "/" && path !== "/pushrss-icon-v1.svg" &&
      !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)
    ) return new Response("Not found", { status: 404 });
    try {
      return new Response(
        await Deno.readFile(
          new URL(
            `../apps/web/dist${path === "/" ? "/index.html" : path}`,
            import.meta.url,
          ),
        ),
        {
          headers: {
            "content-type": path.endsWith(".js")
              ? "application/javascript"
              : path.endsWith(".css")
              ? "text/css"
              : path.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html",
          },
        },
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
);
const errors: string[] = [],
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 900 },
    locale: "zh-CN",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.addr.port}`);
  await expect(page.getByText("登录 PushRSS")).toBeVisible();
  await page.screenshot({ path: "/tmp/pushrss-relay-login.png" });
  await page.getByLabel("管理密码").fill("wrong");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("管理密码错误");
  await page.getByLabel("管理密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.locator("header").getByRole("button")).toHaveCount(1);
  const cookie = (await page.context().cookies()).find((c) =>
    c.name === "pushrss_session"
  );
  if (!cookie?.httpOnly || cookie.sameSite !== "Strict") {
    throw new Error("登录 Cookie 属性错误");
  }
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByText("还没有订阅源")).toBeVisible();
  await page.getByRole("tab", { name: "推送渠道" }).click();
  await page.getByRole("button", { name: "添加渠道", exact: true }).click();
  const channelDialog = page.getByRole("dialog");
  await channelDialog.getByLabel("渠道类型").click();
  await expect(page.getByRole("option")).toHaveCount(8);
  await page.getByRole("option", { name: "Server酱³" }).click();
  await channelDialog.getByLabel("名称", { exact: true }).fill("Server酱测试");
  await channelDialog.getByLabel("SendKey").fill("sctp1tBrowserSecret");
  await channelDialog.getByRole("button", { name: "添加渠道", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Server酱测试", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送测试", exact: true }).click();
  await expect.poll(() => sent).toBe(1);
  if ((await page.content()).includes("BrowserSecret")) {
    throw new Error("凭据出现在渠道列表");
  }
  await page.getByRole("tab", { name: "订阅源" }).click();
  await page.getByRole("button", { name: "添加订阅源", exact: true }).click();
  const feedDialog = page.getByRole("dialog");
  await feedDialog.getByLabel("订阅地址").fill("https://feed.example/rss");
  await feedDialog.getByRole("button", { name: "检测", exact: true }).click();
  await expect(feedDialog.getByLabel("名称", { exact: true })).toHaveValue(
    "示例技术源",
  );
  await feedDialog.getByLabel("分类", { exact: true }).fill("技术");
  await feedDialog.getByLabel("关键词过滤").fill("Deno，Workers");
  await feedDialog.getByRole("checkbox").check();
  await feedDialog.getByRole("button", { name: "添加并抓取", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("示例技术源", { exact: true })).toBeVisible();
  if (jobs.length !== 0 || sent !== 1) throw new Error("首次抓取基线策略错误");
  await page.getByRole("button", { name: /示例技术源 技术/ }).click();
  await expect(page.getByRole("link", { name: "Deno 基线文章" })).toBeVisible();
  version = 1;
  await page.getByRole("button", { name: "立即抓取", exact: true }).click();
  await expect.poll(() => jobs.length).toBe(1);
  while (jobs.length) {
    await handleJob(services, jobs.shift()!, { fetch: services.fetch });
  }
  await expect.poll(() => sent).toBe(2);
  await expect(page.getByRole("link", { name: "Deno 新文章" })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(feedDialog.getByLabel("订阅地址")).toBeDisabled();
  await expect(feedDialog.getByLabel("关键词过滤")).toHaveValue(
    "Deno，Workers",
  );
  await feedDialog.getByLabel("分类", { exact: true }).fill("开发");
  await feedDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("搜索订阅源").fill("no-match");
  await expect(page.getByText("没有匹配的订阅源")).toBeVisible();
  await page.getByLabel("搜索订阅源").fill("");
  await page.screenshot({
    path: "/tmp/pushrss-relay-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "路由矩阵" }).click();
  const binding = page.getByRole("checkbox", {
    name: "示例技术源 → Server酱测试",
  });
  await expect(binding).toBeChecked();
  await binding.uncheck();
  await expect.poll(async () =>
    (await repositories.subscriptions.list(
      (await repositories.feeds.list())[0].id,
    )).length
  ).toBe(0);
  await page.getByRole("button", { name: "Server酱测试", exact: true }).click();
  await expect(binding).toBeChecked();
  await page.getByRole("tab", { name: "订阅源" }).click();
  await expect(page.getByRole("tab", { name: "订阅源" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "编辑", exact: true }))
    .toBeVisible();
  await page.screenshot({
    path: "/tmp/pushrss-relay-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ) throw new Error("手机页面横向溢出");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("还没有订阅源")).toBeVisible();
  await page.getByRole("tab", { name: "推送渠道" }).click();
  await page.getByRole("button", { name: "删除 Server酱测试" }).click();
  await expect(page.getByText("还没有推送渠道")).toBeVisible();
  // 清除会话后 API 返回 401，页面回到密码登录。
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByLabel("管理密码")).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "rss 页面验收通过：登录、八种渠道选项、检测与分类关键词、基线、队列刷新、编辑、搜索、路由、移动端、删除",
  );
} finally {
  await browser.close();
  await server.shutdown();
  database.close();
}
