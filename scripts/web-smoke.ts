import { handleJob } from "../packages/core/jobs.ts";
import type { ApiServices } from "../apps/server/src/app.ts";
/** 真实浏览器 + Hono / SQLite；Feed 与通知服务使用固定数据。 */
import { chromium, expect, type Page as BrowserPage } from "@playwright/test";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { sessionSigningSecret } from "../packages/shared/auth.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Job } from "../packages/shared/contracts.ts";
async function navigate(page: BrowserPage, name: string) {
  const mobile = (page.viewportSize()?.width ?? 1360) < 768;
  if (mobile) await page.locator('[data-slot="sidebar-trigger"]').click();
  await page.getByRole("navigation").getByRole("button", { name, exact: true })
    .click();
  if (mobile) await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
}
async function selectLanguage(
  page: BrowserPage,
  label: string,
  option: string,
) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(
    0,
  );
}
const database = openDatabase(":memory:");
for (
  const name of [
    "0001_initial.sql",
    "0002_queue.sql",
    "0003_initial_notifications.sql",
    "0004_latest_notification.sql",
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
      path !== "/" && path !== "/pushrss-icon-v1.svg" &&
      !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)
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
            : path.endsWith(".svg")
            ? "image/svg+xml"
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
    locale: "zh-CN",
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
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "跟随系统", exact: true })
    .click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  console.log("主题切换、刷新持久化与系统主题跟随通过");
  await expect(page.getByRole("heading", { name: "运行信息" })).toBeVisible();
  const logo = page.locator('[data-slot="sidebar-header"] img');
  await expect(logo).toHaveAttribute(
    "src",
    await page.locator('link[rel="icon"]').getAttribute("href") ?? "",
  );
  await expect.poll(() =>
    logo.evaluate((element: HTMLImageElement) => element.naturalWidth)
  ).toBeGreaterThan(0);
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.locator('[data-slot="sidebar-trigger"]').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => {
    const logoBox = await logo.boundingBox();
    const iconBox = await page.getByRole("navigation").getByRole("button", {
      name: "概览",
      exact: true,
    }).locator("svg").boundingBox();
    if (!logoBox || !iconBox) return Infinity;
    return Math.abs(
      logoBox.x + logoBox.width / 2 - iconBox.x - iconBox.width / 2,
    );
  }).toBeLessThan(1);
  const languageButton = page.getByRole("button", {
    name: "页面语言",
    exact: true,
  });
  const updateButton = page.getByRole("button", {
    name: "更新数据",
    exact: true,
  });
  const [languageBox, updateBox] = await Promise.all([
    languageButton.boundingBox(),
    updateButton.boundingBox(),
  ]);
  if (!languageBox || !updateBox || languageBox.x >= updateBox.x) {
    throw new Error("页面语言按钮位置错误");
  }
  await selectLanguage(page, "页面语言", "English");
  await expect(page.getByRole("heading", { name: "Runtime information" }))
    .toBeVisible();
  await selectLanguage(page, "Page language", "简体中文");
  await page.screenshot({
    path: "/tmp/pushrss-sidebar-collapsed.png",
    fullPage: true,
  });
  await navigate(page, "设置");
  await expect(page.getByRole("heading", { name: "设置", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "运行信息" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "页面语言" })).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await navigate(page, "通知渠道");
  await page.getByRole("button", { name: "添加通知渠道" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("浏览器测试渠道");
  await dialog.getByLabel("SendKey").fill("sctp123tBrowserTest");
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "发送测试通知" }).click();
  await expect(page.getByRole("status")).toContainText("测试通知已发送");
  if (testCount !== 1) throw new Error("测试通知调用次数错误");
  await page.route(
    "**/api/channels/*/test",
    (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "NOTIFICATION_FAILED", message: "模拟渠道拒绝请求" },
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "发送测试通知" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟渠道拒绝请求");
  await page.getByRole("button", { name: "编辑渠道" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("更名渠道");
  await expect(dialog.getByLabel("替换完整渠道配置")).not.toBeChecked();
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  await navigate(page, "订阅源");
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("浏览器测试源");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://example.test/rss");
  await expect(dialog.getByLabel("抓取周期")).toHaveValue("30");
  await dialog.getByLabel("抓取周期").fill("1.5");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(1);
  await dialog.getByLabel("抓取周期").fill("2");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("每 2 分钟", { exact: false })).toBeVisible();
  if ((await repositories.feeds.list())[0].intervalSeconds !== 120) {
    throw new Error("订阅源分钟换算失败");
  }
  // 重复资源错误应出现在仍打开的表单中。
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("重复源");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://example.test/rss");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog.getByRole("alert")).toContainText("资源重复");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const legacyFeed = (await repositories.feeds.list())[0];
  await repositories.feeds.edit(legacyFeed.id, { intervalSeconds: 90 });
  await page.getByRole("button", { name: "更新数据" }).click();
  await expect(page.getByText("约每 2 分钟", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("抓取周期")).toHaveValue("2");
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  if ((await repositories.feeds.get(legacyFeed.id))?.intervalSeconds !== 90) {
    throw new Error("编辑其他字段时改变了旧周期");
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("抓取周期")).toHaveValue("2");
  await dialog.getByLabel("抓取周期").fill("5");
  await dialog.getByLabel("RSS / Atom 地址").fill("https://moved.example/rss");
  await dialog.getByRole("checkbox", { name: "更名渠道", exact: true }).check();
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("每 5 分钟", { exact: false })).toBeVisible();
  await expect(page.getByText("https://moved.example/rss", { exact: true }))
    .toBeVisible();
  const editedFeed = (await repositories.feeds.list())[0];
  if (
    editedFeed.intervalSeconds !== 300 ||
    (await repositories.subscriptions.list(editedFeed.id)).length !== 1
  ) {
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
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "名称", exact: true }))
    .toHaveAttribute(
      "placeholder",
      "名称留空时，下一次成功抓取会使用 RSS / Atom 中的标题",
    );
  await dialog.getByRole("checkbox", { name: "更名渠道", exact: true }).check();
  await dialog.getByRole("button", { name: "保存订阅源" }).click();
  await expect(dialog).toHaveCount(0);
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
  await repositories.feeds.edit(feed.id, { title: "" });
  await navigate(page, "投递记录");
  await page.getByLabel("投递状态").selectOption("failed");
  await expect(page.getByRole("heading", { name: "安全文章" })).toBeVisible();
  await expect(
    page.getByText("订阅源：https://moved.example/rss · 通知渠道：更名渠道"),
  )
    .toBeVisible();
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
  await navigate(page, "设置");
  await page.getByLabel("添加订阅源时的默认周期").fill("4.5");
  await page.getByRole("button", { name: "保存设置" }).click();
  if (await repositories.settings.get("defaultIntervalSeconds") !== undefined) {
    throw new Error("默认周期接受了小数分钟");
  }
  await page.getByLabel("添加订阅源时的默认周期").fill("4");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toContainText("默认抓取周期已保存");
  await expect(page.getByLabel("添加订阅源时的默认周期")).toHaveValue("4");
  if (await repositories.settings.get("defaultIntervalSeconds") !== 240) {
    throw new Error("设置保存失败");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await selectLanguage(page, "页面语言", "English");
  await page.locator('[data-slot="sidebar-trigger"]').click();
  await expect(page.getByRole("dialog", { name: "Main navigation" }))
    .toBeVisible();
  await page.screenshot({
    path: "/tmp/pushrss-sidebar-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
  await selectLanguage(page, "Page language", "简体中文");
  for (const name of ["概览", "订阅源", "通知渠道", "投递记录", "设置"]) {
    await navigate(page, name);
    await expect(page.getByRole("heading", { name, exact: true }))
      .toBeVisible();
    if (
      await page.evaluate(() =>
        document.documentElement.scrollWidth > innerWidth
      )
    ) throw new Error(`${name} 窄屏溢出`);
  }
  await navigate(page, "订阅源");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByRole("button", { name: "立即刷新" })).toBeDisabled();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("添加第一个订阅源，开始收集新文章。"))
    .toBeVisible();
  await navigate(page, "通知渠道");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("添加通知渠道，再前往订阅源详情完成关联。"))
    .toBeVisible();
  await page.getByRole("button", { name: "添加通知渠道" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道名称").fill("Telegram 测试");
  await dialog.getByLabel("渠道类型").selectOption("telegram");
  await dialog.getByLabel("Bot Token").fill("123:FakeToken");
  await dialog.getByLabel("Chat ID").fill("-100123");
  await dialog.getByLabel("话题 ID").fill("42");
  await dialog.getByLabel("解析模式").selectOption("HTML");
  await dialog.getByRole("button", { name: "保存渠道" }).click();
  await expect(dialog).toHaveCount(0);
  // 新建时先绑定渠道，首次抓取保存两篇文章并通知最新一篇。
  await navigate(page, "订阅源");
  await page.getByRole("button", { name: "添加订阅源" }).click();
  dialog = page.getByRole("dialog");
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
    initialFeed.title !== "" ||
    (await repositories.subscriptions.list(initialFeed.id)).length !== 1
  ) throw new Error("首次抓取前的渠道配置错误");
  const initialOptions = {
    fetch: (() =>
      Promise.resolve(
        new Response(
          "<rss><channel><title>测试</title><item><guid>first-1</guid><title>第一篇</title><pubDate>Fri, 25 Sep 2026 00:00:00 GMT</pubDate></item><item><guid>first-2</guid><title>第二篇</title><pubDate>Sat, 26 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>",
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
  const firstDeliveries = await repositories.deliveries.list("sent");
  if (
    testCount !== sentBefore + 1 || firstDeliveries.length !== 1 ||
    (await repositories.feeds.get(initialFeed.id))?.title !== "测试" ||
    (await repositories.items.list(initialFeed.id)).length !== 2 ||
    (await repositories.items.get(firstDeliveries[0].itemId))?.title !==
      "第二篇"
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
  await navigate(page, "通知渠道");
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
  await navigate(page, "订阅源");
  await expect(page.getByRole("alert")).toContainText("模拟暂时不可用");
  await page.getByRole("button", { name: "更新数据" }).click();
  await expect(page.getByRole("heading", { name: "分页订阅 0", exact: false }))
    .toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("heading", { name: "分页订阅 20", exact: false }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await navigate(page, "概览");
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
  // Browser preferences, explicit selection, persistence and automatic switching.
  const english = await browser.newPage({ locale: "en-US" });
  english.on("pageerror", (e) => errors.push(e.message));
  await english.goto(`http://127.0.0.1:${server.addr.port}`);
  await expect(english.locator("html")).toHaveAttribute("lang", "en");
  await expect(english.getByLabel("Page language")).toHaveValue("system");
  await english.getByLabel("Admin password").fill("wrong");
  await english.getByRole("button", { name: "Open dashboard" }).click();
  await expect(english.getByRole("alert")).toHaveText(
    "Incorrect admin password",
  );
  await english.getByLabel("Admin password").fill(token);
  await english.getByRole("button", { name: "Open dashboard" }).click();
  await expect(english.getByRole("heading", { name: "Overview", exact: true }))
    .toBeVisible();
  for (
    const name of ["Feeds", "Notification channels", "Deliveries", "Settings"]
  ) {
    await navigate(english, name);
    await expect(english.getByRole("heading", { name, exact: true }))
      .toBeVisible();
  }
  await selectLanguage(english, "Page language", "简体中文");
  await expect(english.getByRole("heading", { name: "设置", exact: true }))
    .toBeVisible();
  await expect(english.locator("html")).toHaveAttribute("lang", "zh-CN");
  await english.reload();
  await expect(english.getByRole("heading", { name: "概览", exact: true }))
    .toBeVisible();
  await navigate(english, "设置");
  await english.getByRole("button", { name: "页面语言", exact: true }).click();
  await expect(english.getByRole("menuitemradio", { name: "简体中文" }))
    .toHaveAttribute("aria-checked", "true");
  await english.getByRole("menuitemradio", { name: "跟随浏览器" }).click();
  await expect(english.getByRole("heading", { name: "Settings", exact: true }))
    .toBeVisible();
  await english.evaluate(() => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-CN"],
    });
    globalThis.dispatchEvent(new Event("languagechange"));
  });
  await expect(english.getByRole("heading", { name: "设置", exact: true }))
    .toBeVisible();
  await selectLanguage(english, "页面语言", "English");
  await english.evaluate(() =>
    globalThis.dispatchEvent(new Event("languagechange"))
  );
  await expect(english.locator("html")).toHaveAttribute("lang", "en");
  await english.setViewportSize({ width: 390, height: 844 });
  if (
    await english.evaluate(() =>
      document.documentElement.scrollWidth > innerWidth
    )
  ) {
    throw new Error("英文设置页窄屏溢出");
  }
  await english.getByRole("button", { name: "Sign out", exact: true }).click();
  await english.reload();
  await expect(english.getByLabel("Admin password")).toBeVisible();
  await expect(english.getByLabel("Page language")).toHaveValue("en");
  await english.getByLabel("Page language").selectOption("system");
  await english.reload();
  await expect(english.getByLabel("Page language")).toHaveValue("system");
  await english.close();

  const fallback = await browser.newPage({ locale: "fr-FR" });
  await fallback.addInitScript(() =>
    localStorage.setItem("pushrss.language", "invalid")
  );
  await fallback.goto(`http://127.0.0.1:${server.addr.port}`);
  await expect(fallback.getByLabel("Admin password")).toBeVisible();
  await expect(fallback.getByLabel("Page language")).toHaveValue("system");
  await fallback.close();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "shadcn 侧边栏折叠、键盘、移动导航、组件表单、中英文语言检测、切换、持久化、回退、窄屏及中文界面登录、刷新保持会话、退出、配置、关联、模拟测试通知、文章安全展示、投递重试、设置、删除及窄屏验证通过",
  );
} finally {
  await browser.close();
  await server.shutdown();
  database.close();
}
