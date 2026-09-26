import { inspectFeed } from "../packages/core/mod.ts";

async function withServer(
  args: string[],
  port: number,
  verify: (url: string) => Promise<void>,
  environment: Record<string, string> = {},
) {
  const child = new Deno.Command(Deno.execPath(), {
    args,
    env: {
      PORT: String(port),
      PUSHRSS_ADMIN_TOKEN: "",
      PUSHRSS_ADMIN_PASSWORD: "",
      PUSHRSS_MASTER_KEY: "",
      ...environment,
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs",
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let exited = false;
  const finished = child.status.then((status) => {
    exited = true;
    return status;
  });
  try {
    const url = "http://127.0.0.1:" + port;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (exited) throw new Error("服务提前退出");
      try {
        const response = await fetch(url + "/health", {
          signal: AbortSignal.timeout(500),
        });
        await response.body?.cancel();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch { /* 等待监听端口 */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("服务启动超时");
    await verify(url);
  } finally {
    if (!exited) child.kill("SIGINT");
    await finished;
  }
}
async function checkStatus(url: string, runtime: string) {
  const status = await (await fetch(url + "/health")).json();
  if (status.name !== "PushRSS" || status.runtime !== runtime) {
    throw new Error("平台状态错误");
  }
}
const temp = await Deno.makeTempDir({ prefix: "pushrss-smoke-" });
const adminPassword = "test";
const environment = {
  DATABASE_PATH: temp + "/pushrss.db",
  PUSHRSS_ADMIN_PASSWORD: adminPassword,
  PUSHRSS_MASTER_KEY: btoa("a".repeat(32)),
  PUSHRSS_WEB_DIR: "apps/web/dist",
};
const headers = {
  Authorization: "Bearer " + adminPassword,
  "content-type": "application/json",
};
let feedId = "";
let channelId = "";
try {
  await withServer(
    ["run", "-A", "packages/platform/deno/main.ts"],
    18780,
    async (url) => {
      await checkStatus(url, "deno");
      const page = await fetch(url + "/");
      const html = await page.text();
      if (!page.ok || !html.includes('id="root"')) {
        throw new Error("Deno 静态前端失败");
      }
      const asset = html.match(/src="([^\"]+\.js)"/)?.[1];
      if (!asset || !(await fetch(url + asset)).ok) {
        throw new Error("Deno 前端脚本失败");
      }
      const fallback = await fetch(url + "/feeds", {
        headers: { Accept: "text/html" },
      });
      if (!fallback.ok || !(await fallback.text()).includes('id="root"')) {
        throw new Error("Deno 前端页面回退失败");
      }
      const response = await fetch(url + "/api/feeds", {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: "https://smoke.example/rss",
          enabled: false,
        }),
      });
      if (response.status !== 201) throw new Error("Deno API 创建失败");
      feedId = (await response.json()).id;
      const channel = await fetch(url + "/api/channels", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "备份测试渠道",
          type: "telegram",
          config: { botToken: "123:BackupTest", chatId: "123" },
        }),
      });
      if (channel.status !== 201) throw new Error("备份测试渠道创建失败");
      channelId = (await channel.json()).id;
      const subscription = await fetch(url + "/api/subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify({ feedId, channelId }),
      });
      if (!subscription.ok) throw new Error("备份测试关联创建失败");
      const backup = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "scripts/backup.ts", temp + "/snapshot.db"],
        env: environment,
      }).output();
      if (!backup.success) throw new Error("运行中 SQLite 备份失败");
    },
    environment,
  );
  await Deno.copyFile(temp + "/snapshot.db", temp + "/restored.db");
  await withServer(
    ["run", "-A", "packages/platform/deno/main.ts"],
    18780,
    async (url) => {
      const response = await fetch(url + "/api/feeds/" + feedId, { headers });
      if (
        !response.ok || (await response.json()).enabled !== false
      ) throw new Error("进程重启后数据恢复失败");
      const channels = await fetch(url + "/api/channels", { headers });
      const subscriptions = await fetch(
        url + "/api/subscriptions?feedId=" + feedId,
        { headers },
      );
      if (
        !channels.ok ||
        !(await channels.json()).items.some((channel: { id: string }) =>
          channel.id === channelId
        ) ||
        !subscriptions.ok ||
        !(await subscriptions.json()).items.some(
          (subscription: { channelId: string }) =>
            subscription.channelId === channelId,
        )
      ) throw new Error("快照恢复后渠道或订阅关联缺失");
    },
    { ...environment, DATABASE_PATH: temp + "/restored.db" },
  );
} finally {
  await Deno.remove(temp, { recursive: true });
}
const migration = await new Deno.Command(Deno.execPath(), {
  args: [
    "task",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "pushrss-test",
    "--local",
    "--config",
    "tests/wrangler.jsonc",
  ],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!migration.success) throw new Error("本地 D1 迁移失败");
await withServer(
  [
    "run",
    "-A",
    "node_modules/wrangler/wrangler-dist/cli.js",
    "dev",
    "--local",
    "--test-scheduled",
    "--config",
    "tests/wrangler.jsonc",
    "--port",
    "18781",
  ],
  18781,
  async (url) => {
    await checkStatus(url, "cloudflare");
    const data = await fetch(url + "/__test/data", {
      method: "POST",
      body: JSON.stringify({
        rss: await Deno.readTextFile("tests/fixtures/rss-full.xml"),
        atom: await Deno.readTextFile("tests/fixtures/atom-full.xml"),
      }),
    });
    if (!data.ok || !(await data.json()).ok) {
      throw new Error("D1 仓储、Feed 抓取或 Workers 加密验证失败");
    }
    const assets = await fetch(url + "/");
    if (!assets.ok || !(await assets.text()).includes('id="root"')) {
      throw new Error("Worker 静态前端失败");
    }
    const sampleRss = await Deno.readTextFile("tests/fixtures/rss.xml");
    const sampleAtom = await Deno.readTextFile("tests/fixtures/atom.xml");
    await fetch(url + "/__test/live/setup", {
      method: "POST",
      body: JSON.stringify({ rss: sampleRss, atom: sampleAtom }),
    });
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(url + "/api" + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `本地 Worker API 失败：${method} ${path} ${response.status}`,
        );
      }
      return response.status === 204 ? undefined : await response.json();
    };
    const channels: { id: string }[] = [];
    const feeds: { id: string }[] = [];
    try {
      channels.push(
        await api("/channels", "POST", {
          name: "Live Telegram",
          type: "telegram",
          config: { botToken: "123:test", chatId: "123" },
        }),
      );
      channels.push(
        await api("/channels", "POST", {
          name: "Live Serverchan",
          type: "serverchan",
          config: { sendKey: "sctp123tTest" },
        }),
      );
      for (const format of ["rss", "atom"]) {
        const feed = await api("/feeds", "POST", {
          url: `https://live.example/${format}`,
          enabled: false,
          intervalSeconds: 60,
        });
        feeds.push(feed);
        for (const channel of channels) {
          await api("/subscriptions", "POST", {
            feedId: feed.id,
            channelId: channel.id,
          });
        }
        await api(`/feeds/${feed.id}`, "PATCH", { enabled: true });
      }
      const cron = await fetch(
        url + "/cdn-cgi/local/scheduled?cron=*+*+*+*+*&format=json",
      );
      if (!cron.ok || (await cron.json()).outcome !== "ok") {
        throw new Error("本地 Cron 触发失败");
      }
      const expected = 2 *
        (inspectFeed(sampleRss).count + inspectFeed(sampleAtom).count);
      let complete = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const deliveries = (await api("/deliveries?limit=100")).items.filter((
          d: { channelId: string },
        ) => channels.some((c) => c.id === d.channelId));
        if (
          deliveries.length === expected &&
          deliveries.every((d: { status: string }) => d.status === "sent")
        ) {
          complete = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!complete) throw new Error("真实 Cron / Queues 首次多渠道投递超时");
      // 手动刷新同样经过真实 Queues；文章唯一约束保持投递数稳定。
      for (const feed of feeds) await api(`/feeds/${feed.id}/refresh`, "POST");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const delivered = (await api("/deliveries?limit=100")).items.filter((
        d: { channelId: string },
      ) => channels.some((c) => c.id === d.channelId));
      if (delivered.length !== expected) {
        throw new Error("重复刷新产生额外投递");
      }
    } finally {
      for (const feed of feeds) await api(`/feeds/${feed.id}`, "DELETE");
      for (const channel of channels) {
        await api(`/channels/${channel.id}`, "DELETE");
      }
    }
    for (const format of ["rss", "atom"]) {
      const xml = await Deno.readTextFile("tests/fixtures/" + format + ".xml");
      const response = await fetch(url + "/__test/parse", {
        method: "POST",
        body: xml,
      });
      const actual = await response.json();
      if (
        JSON.stringify(actual) !== JSON.stringify(inspectFeed(xml))
      ) throw new Error("双平台解析结果不同");
    }
  },
);
console.log(
  "Deno / Workers API、静态前端、RSS / Atom、D1、Cron、Queues 多渠道投递及恢复契约验证通过",
);
