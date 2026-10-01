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
    ["run", "-A", "tests/deno-server.ts"],
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
      const manifest = await fetch(url + "/site.webmanifest");
      if (
        !manifest.ok ||
        manifest.headers.get("content-type") !==
          "application/manifest+json; charset=utf-8"
      ) {
        throw new Error("Deno 前端清单类型失败");
      }
      const response = await fetch(url + "/api/feeds", {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: "https://smoke.example/rss",
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
          token: "123:BackupTest",
          target: "123",
        }),
      });
      if (channel.status !== 201) throw new Error("备份测试渠道创建失败");
      channelId = (await channel.json()).id;
      const subscription = await fetch(url + "/api/feeds/" + feedId, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: false, channelIds: [channelId] }),
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
    ["run", "-A", "tests/deno-server.ts"],
    18780,
    async (url) => {
      const response = await fetch(url + "/api/feeds", { headers });
      const feed = (await response.json()).find((row: { id: string }) =>
        row.id === feedId
      );
      if (
        !response.ok || !feed || feed.enabled !== false || feed.itemCount !== 2
      ) {
        throw new Error("进程重启后数据恢复失败");
      }
      const channels = await fetch(url + "/api/channels", { headers });
      if (
        !channels.ok || !(await channels.json()).some((row: { id: string }) =>
          row.id === channelId
        ) || !feed.channelIds.includes(channelId)
      ) {
        throw new Error("快照恢复后渠道或订阅关联缺失");
      }
    },
    { ...environment, DATABASE_PATH: temp + "/restored.db" },
  );
} finally {
  await Deno.remove(temp, { recursive: true });
}
const workerState = await Deno.makeTempDir({ prefix: "pushrss-d1-smoke-" });
try {
  const migration = await new Deno.Command(Deno.execPath(), {
    args: [
      "task",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "pushrss-test",
      "--local",
      "--persist-to",
      workerState,
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
      "--persist-to",
      workerState,
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
            token: "123:test",
            target: "123",
          }),
        );
        channels.push(
          await api("/channels", "POST", {
            name: "Live Serverchan",
            type: "serverchan",
            target: "sctp123tTest",
          }),
        );
        for (const format of ["rss", "atom"]) {
          const feed = await api("/feeds", "POST", {
            url: `https://live.example/${format}`,
            channelIds: channels.map((c) => c.id),
          });
          feeds.push(feed);
          if (
            feed.itemCount !==
              inspectFeed(format === "rss" ? sampleRss : sampleAtom).count
          ) {
            throw new Error("首次抓取文章保存不完整");
          }
        }
        if (
          (await api("/channels")).some((
            c: { id: string; deliveredCount: number },
          ) =>
            channels.some((row) => row.id === c.id) && c.deliveredCount !== 0
          )
        ) {
          throw new Error("首次基线产生了投递");
        }
        const updatedRss = sampleRss.replace(
          /<guid>([^<]*)<\/guid>/g,
          "<guid>$1-new</guid>",
        );
        const updatedAtom = sampleAtom.replace(
          /<id>([^<]*)<\/id>/g,
          "<id>$1-new</id>",
        );
        await fetch(url + "/__test/live/setup", {
          method: "POST",
          body: JSON.stringify({
            rss: updatedRss,
            atom: updatedAtom,
            due: true,
          }),
        });
        const cron = await fetch(
          url + "/cdn-cgi/local/scheduled?cron=*+*+*+*+*&format=json",
        );
        if (!cron.ok || (await cron.json()).outcome !== "ok") {
          throw new Error("本地 Cron 触发失败");
        }
        const expectedPerChannel = inspectFeed(sampleRss).count +
          inspectFeed(sampleAtom).count;
        const counts = async () =>
          (await api("/channels")).filter((c: { id: string }) =>
            channels.some((row) => row.id === c.id)
          );
        let complete = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await counts();
          if (
            rows.length === channels.length &&
            rows.every((c: { deliveredCount: number }) =>
              c.deliveredCount === expectedPerChannel
            )
          ) {
            complete = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (!complete) throw new Error("真实 Cron / Queues 多渠道更新投递超时");
        const saved = await api("/feeds");
        for (const [index, feed] of feeds.entries()) {
          const expectedItems =
            inspectFeed(index === 0 ? sampleRss : sampleAtom).count * 2;
          if (
            saved.find((row: { id: string }) => row.id === feed.id)
              ?.itemCount !== expectedItems
          ) {
            throw new Error("更新抓取文章保存不完整");
          }
        }
        // 手动刷新同样经过真实 Queues；文章唯一约束保持投递数稳定。
        for (const feed of feeds) {
          await api(`/feeds/${feed.id}/refresh`, "POST");
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (
          (await counts()).some((c: { deliveredCount: number }) =>
            c.deliveredCount !== expectedPerChannel
          )
        ) {
          throw new Error("重复刷新产生额外投递");
        }
      } finally {
        for (const feed of feeds) await api(`/feeds/${feed.id}`, "DELETE");
        for (const channel of channels) {
          await api(`/channels/${channel.id}`, "DELETE");
        }
      }
      for (const format of ["rss", "atom"]) {
        const xml = await Deno.readTextFile(
          "tests/fixtures/" + format + ".xml",
        );
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
} finally {
  await Deno.remove(workerState, { recursive: true });
}
console.log(
  "Deno / Workers API、静态前端、RSS / Atom、D1、Cron、Queues 多渠道投递及恢复契约验证通过",
);
