import { handleJob } from "../packages/core/jobs.ts";
import type { ApiServices } from "../apps/server/src/app.ts";
/** 真实浏览器 + Hono / SQLite；Feed 与通知服务使用固定数据。 */
import { chromium, expect } from "@playwright/test";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { sessionSigningSecret } from "../packages/shared/auth.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Job } from "../packages/shared/contracts.ts";
const database = openDatabase(":memory:");
for (
  const name of [
    "0001_initial.sql",
    "0002_queue.sql",
    "0003_initial_notifications.sql",
  ]
) {
  migrate(database.client, [{
    name,
    sql: await Deno.readTextFile(
      new URL(`../packages/db/migrations/${name}`, import.meta.url),
    ),
  }]);
}
const repositories = createRepositories(database.db);
const jobs: Job[] = [];
let testCount = 0;
const token = "短密码1";
const services: ApiServices = {
  repositories,
  adminPassword: token,
  sessionSecret: sessionSigningSecret(btoa("a".repeat(32)), token),
  secrets: await createSecretStore(btoa("a".repeat(32))),
  queue: {
    enqueue(job) {
      jobs.push(job);
      return Promise.resolve();
    },
  },
  notifiers: {
    serverchan: {
      send() {
        testCount++;
        return Promise.resolve({ ok: true as const });
      },
    },
    telegram: {
      send() {
        testCount++;
        return Promise.resolve({ ok: true as const });
      },
    },
  },
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
      path !== "/" && !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)
    ) return new Response("Not found", { status: 404 });
    try {
      const file = await Deno.readFile(
        new URL(
          `../apps/web/dist${path === "/" ? "/index.html" : path}`,
          import.meta.url,
        ),
      );
      return new Response(file, {
        headers: {
          "content-type": path.endsWith(".js")
            ? "application/javascript"
            : path.endsWith(".css")
            ? "text/css"
            : "text/html",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
);
const errors: string[] = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 900 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.addr.port}`);
  await page.getByLabel("管理密码").fill(
    "invalid-token-with-at-least-32-characters",
  );
  await page.getByRole("button", { name: "进入控制台" }).click();
  await expect(page.getByRole("alert")).toContainText("管理密码错误");
  await page.getByLabel("管理密码").fill(token);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await expect(page.getByRole("heading", { name: "概览", exact: true }))
    .toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "通知渠道" }).click();
  await page.getByRole("button", { name: "添加渠道" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("浏览器测试渠道");
  await dialog.getByLabel("SendKey").fill("sctp123tBrowserTest");
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "发送测试通知" }).click();
  await expect(page.getByRole("status")).toContainText("测试通知已发送");
  if (testCount !== 1) throw new Error("测试通知调用次数错误");
  await page.getByRole("button", { name: "编辑渠道" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("更名渠道");
  await expect(dialog.getByLabel("替换完整渠道配置")).not.toBeChecked();
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  await nav.getByRole("button", { name: "订阅源" }).click();
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("浏览器测试源");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://example.test/rss");
  await dialog.getByLabel("抓取周期").fill("120");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  // 重复资源错误应出现在仍打开的表单中。
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("重复源");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://example.test/rss");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog.getByRole("alert")).toContainText("资源重复");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("抓取周期").fill("300");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://moved.example/rss");
  await dialog.getByRole("checkbox", { name: "更名渠道", exact: true }).check();
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("每 300 秒", { exact: false })).toBeVisible();
  await expect(page.getByText("https://moved.example/rss", { exact: true }))
    .toBeVisible();
  const editedFeed = (await repositories.feeds.list())[0];
  if ((await repositories.subscriptions.list(editedFeed.id)).length !== 1) {
    throw new Error("编辑表单渠道保存失败");
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "更名渠道", exact: true }))
    .toBeChecked();
  await dialog.getByRole("checkbox", { name: "更名渠道", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "立即刷新" }).click();
  await expect(page.getByRole("status")).toContainText("刷新已入队");
  if (jobs[0]?.type !== "fetch_feed") throw new Error("刷新入队失败");
  await page.getByRole("button", { name: "文章与渠道" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "关联", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "解除关联" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const [feed] = await repositories.feeds.list();
  const [channel] = await repositories.channels.list();
  const now = Date.now();
  await repositories.items.insert({
    id: "web-item",
    feedId: feed.id,
    fingerprint: "web",
    title: "安全文章",
    link: "javascript:alert(1)",
    content: "<img src=x onerror=alert(1)>",
    createdAt: now,
  });
  await repositories.deliveries.insert({
    id: "web-delivery",
    itemId: "web-item",
    channelId: channel.id,
    status: "failed",
    attempts: 5,
    lastError: "模拟限流",
    createdAt: now,
    updatedAt: now,
  });
  await nav.getByRole("button", { name: "投递记录" }).click();
  await page.getByLabel("投递状态").selectOption("failed");
  await page.getByRole("button", { name: "查看详情" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("更名渠道");
  await expect(dialog).toContainText("<img src=x onerror=alert(1)>");
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("重试已入队");
  if (jobs.at(-1)?.type !== "send_notification") {
    throw new Error("重试入队失败");
  }
  await nav.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("新订阅源默认周期").fill("240");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toContainText("默认抓取周期已保存");
  if (await repositories.settings.get("defaultIntervalSeconds") !== 240) {
    throw new Error("设置保存失败");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["概览", "订阅源", "通知渠道", "投递记录", "设置"]) {
    await nav.getByRole("button", { name }).click();
    await expect(page.getByRole("heading", { name, exact: true }))
      .toBeVisible();
    if (
      await page.evaluate(() =>
        document.documentElement.scrollWidth > innerWidth
      )
    ) throw new Error(`${name} 窄屏溢出`);
  }
  await nav.getByRole("button", { name: "订阅源" }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("button", { name: "立即刷新" })).toBeDisabled();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("添加第一个订阅源，开始收集新文章。"))
    .toBeVisible();
  await nav.getByRole("button", { name: "通知渠道" }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("添加通知渠道，再前往订阅源详情完成关联。"))
    .toBeVisible();
  await page.getByRole("button", { name: "添加渠道" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("Telegram 测试");
  await dialog.getByLabel("渠道类型").selectOption("telegram");
  await dialog.getByLabel("Bot Token").fill("123:FakeToken");
  await dialog.getByLabel("Chat ID").fill("-100123");
  await dialog.getByLabel("话题 ID").fill("42");
  await dialog.getByLabel("解析模式").selectOption("HTML");
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  // 新建时先绑定渠道，首次抓取即可消费两篇文章的通知任务。
  await nav.getByRole("button", { name: "订阅源" }).click();
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("首次推送测试");
  await dialog.getByLabel("RSS / Atom 地址").fill(
    "https://initial.example/rss",
  );
  await dialog.getByRole("checkbox", { name: "Telegram 测试", exact: true })
    .check();
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  const initialFeed = (await repositories.feeds.list())[0];
  if (
    !initialFeed.enabled ||
    (await repositories.subscriptions.list(initialFeed.id)).length !== 1
  ) throw new Error("首次抓取前的渠道配置错误");
  const initialOptions = {
    fetch: (() =>
      Promise.resolve(
        new Response(
          "<rss><channel><title>测试</title><item><guid>first-1</guid><title>第一篇</title></item><item><guid>first-2</guid><title>第二篇</title></item></channel></rss>",
        ),
      )) as typeof fetch,
  };
  jobs.length = 0;
  const sentBefore = testCount;
  await handleJob(
    services,
    { type: "fetch_feed", feedId: initialFeed.id },
    initialOptions,
  );
  for (const job of [...jobs]) {
    await handleJob(services, job);
  }
  if (
    testCount !== sentBefore + 2 ||
    (await repositories.deliveries.list("sent")).length !== 2
  ) throw new Error("首次抓取推送失败");
  jobs.length = 0;
  await handleJob(
    services,
    { type: "fetch_feed", feedId: initialFeed.id },
    initialOptions,
  );
  if (jobs.length) throw new Error("重复抓取产生重复推送");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("添加第一个订阅源，开始收集新文章。"))
    .toBeVisible();
  await nav.getByRole("button", { name: "通知渠道" }).click();
  // 真实仓储分页与前端错误恢复。
  for (let i = 0; i < 21; i++) {
    await repositories.feeds.save({
      id: `page-${String(i).padStart(2, "0")}`,
      url: `https://page.test/${i}`,
      title: `分页订阅 ${i}`,
      enabled: false,
      createdAt: now,
      updatedAt: now,
      nextFetchAt: now,
    });
  }
  await page.route(
    "**/api/feeds?*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "模拟暂时不可用" } }),
      }),
    { times: 1 },
  );
  await nav.getByRole("button", { name: "订阅源" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟暂时不可用");
  await page.getByRole("button", { name: "更新数据" }).click();
  await expect(page.getByRole("heading", { name: "分页订阅 0", exact: false }))
    .toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("heading", { name: "分页订阅 20", exact: false }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await nav.getByRole("button", { name: "概览" }).click();
  await expect(page.locator(".stats strong").first()).toHaveText("21");
  await page.screenshot({ path: "/tmp/pushrss-m6-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.screenshot({
    path: "/tmp/pushrss-m6-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "概览", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByLabel("管理密码")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("管理密码")).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "中文界面登录、刷新保持会话、退出、配置、关联、模拟测试通知、文章安全展示、投递重试、设置、删除及窄屏验证通过",
  );
} finally {
  await browser.close();
  await server.shutdown();
  database.close();
}
