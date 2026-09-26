import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createQueue } from "../packages/platform/deno/queue.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import { createRuntime } from "../packages/platform/deno/runtime.ts";
function assert(value: unknown, message = "持久化任务验证失败"): asserts value {
  if (!value) throw new Error(message);
}
async function migrations() {
  return await Promise.all(
    ["0001_initial.sql", "0002_queue.sql", "0003_initial_notifications.sql"]
      .map(async (name) => ({
        name,
        sql: await Deno.readTextFile("packages/db/migrations/" + name),
      })),
  );
}
Deno.test("持久队列：双连接领取、延迟、租约恢复、旧执行者隔离、重启及重试上限", async () => {
  const dir = await Deno.makeTempDir({ dir: "/tmp", prefix: "pushrss-queue-" });
  let a = openDatabase(dir + "/test.db");
  let b: ReturnType<typeof openDatabase> | undefined;
  try {
    migrate(a.client, await migrations());
    let time = 100000;
    let q = createQueue(a.client, () => time);
    b = openDatabase(dir + "/test.db");
    const other = createQueue(b.client, () => time);
    await Promise.all([
      q.enqueue({ type: "fetch_feed", feedId: "missing" }, time + 1000),
      other.enqueue({ type: "fetch_feed", feedId: "missing" }, time + 1000),
    ]);
    assert(
      Number(a.client.prepare("SELECT count(*) n FROM jobs").get()?.n) === 1,
    );
    assert(!q.claim());
    time += 1000;
    const c = q.claim();
    assert(c);
    assert(!other.claim());
    time += 60001;
    other.recover();
    const next = other.claim();
    assert(next && next.attempts === 2 && next.token !== c.token);
    let stale = false;
    try {
      await q.repositories(c).feeds.get("missing");
    } catch {
      stale = true;
    }
    assert(stale);
    stale = false;
    try {
      q.finish(c);
    } catch {
      stale = true;
    }
    assert(stale);
    other.finish(next, true);
    assert(!q.claim());
    time += 60000;
    a.close();
    a = openDatabase(dir + "/test.db");
    q = createQueue(a.client, () => time);
    for (let attempt = 3; attempt <= 5; attempt++) {
      const row = q.claim();
      assert(row?.attempts === attempt);
      q.finish(row, true);
      time += 30000 * 2 ** (attempt - 1);
    }
    assert(
      a.client.prepare("SELECT status FROM jobs").get()?.status === "failed",
    );
    time += 31 * 86400000;
    q.recover();
    assert(!a.client.prepare("SELECT id FROM jobs").get());
  } finally {
    b?.close();
    a.close();
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("持久化抓取投递：首次推送、崩溃补偿、限流续投、启停、周期及失败隔离", async () => {
  const c = openDatabase(":memory:");
  try {
    migrate(c.client, await migrations());
    let time = 1000;
    const now = () => time;
    const q = createQueue(c.client, now);
    const r = createRepositories(c.db);
    const secrets = await createSecretStore(btoa("a".repeat(32)));
    await r.channels.save({
      id: "channel",
      name: "测试",
      type: "telegram",
      encryptedConfig: await secrets.encrypt("{}", "channel"),
      createdAt: time,
      updatedAt: time,
    });
    for (const id of ["feed", "bad"]) {
      await r.feeds.save({
        id,
        url: "https://" + id + ".example/rss",
        title: id,
        nextFetchAt: time,
        intervalSeconds: 60,
        createdAt: time,
        updatedAt: time,
      });
    }
    await r.subscriptions.add({
      id: "sub",
      feedId: "feed",
      channelId: "channel",
      createdAt: time,
    });
    let version = 1, sends = 0;
    const services = {
      secrets,
      notifiers: {
        telegram: {
          send() {
            sends++;
            return Promise.resolve(
              sends === 1
                ? {
                  ok: false as const,
                  error: "限流",
                  retryable: true,
                  outcome: "rejected" as const,
                  retryAfterSeconds: 90,
                }
                : { ok: true as const, externalMessageId: "42" },
            );
          },
        },
        serverchan: { send: () => Promise.resolve({ ok: true as const }) },
      },
    };
    const options = {
      fetch: ((url: URL | string | Request) =>
        Promise.resolve(
          String(url).includes("bad.example")
            ? new Response("error", { status: 500 })
            : new Response(
              `<rss version="2.0"><channel><title>测试</title><item><guid>${version}</guid><title>文章</title></item></channel></rss>`,
            ),
        )) as typeof fetch,
    };
    q.recover();
    q.recover();
    assert(
      Number(
        c.client.prepare("SELECT count(*) n FROM jobs WHERE status='pending'")
          .get()?.n,
      ) === 2,
    );
    for (let i = 0; i < 4; i++) await q.consume(services, options);
    assert((await r.feeds.get("bad"))?.failureCount === 1);
    assert((await r.items.list("feed")).length === 1);
    assert((await r.deliveries.list()).length === 1);
    await r.feeds.edit("bad", { enabled: false });
    time += 60000;
    version = 1;
    q.recover();
    for (let i = 0; i < 3; i++) {
      await q.consume(services, options);
    }
    q.recover();
    for (let i = 0; i < 3; i++) await q.consume(services, options);
    let delivery = (await r.deliveries.list())[0];
    assert(delivery?.status === "pending" && delivery.attempts === 1);
    assert(sends === 1);
    await r.feeds.edit("feed", { enabled: false });
    time += 90000;
    q.recover();
    for (let i = 0; i < 3; i++) await q.consume(services, options);
    delivery = (await r.deliveries.list())[0];
    assert(delivery.status === "sent" && delivery.externalMessageId === "42");
    // 模拟文章已提交、进程在创建投递前中断；触发器中的标记承担恢复。
    await r.items.insert({
      id: "orphan",
      feedId: "feed",
      fingerprint: "orphan",
      title: "待恢复文章",
      createdAt: time,
    });
    assert(
      c.client.prepare(
        "SELECT item_id FROM notification_outbox WHERE item_id='orphan'",
      ).get(),
    );
    q.recover();
    const restored = (await r.deliveries.list()).find((d) =>
      d.itemId === "orphan"
    );
    assert(restored);
    const claimed = q.claim();
    assert(claimed?.job.type === "send_notification");
    await q.repositories(claimed).deliveries.claim(restored.id, time);
    time += 60001;
    q.recover();
    assert((await r.deliveries.get(restored.id))?.status === "failed");
    assert((await r.deliveries.get(restored.id))?.lastError?.includes("未知"));
    for (let i = 0; i < 3; i++) await q.consume(services, options);
    assert(Number(sends) === 2);
    // 模拟手动重试已写入 pending，但入队前中断。
    await r.deliveries.retry(restored.id, time);
    q.recover();
    await q.consume(services, options);
    assert((await r.deliveries.get(restored.id))?.status === "sent");
    await r.feeds.edit("feed", {
      enabled: true,
      intervalSeconds: 120,
      nextFetchAt: time,
    });
    q.recover();
    await q.consume(services, options);
    assert((await r.feeds.get("feed"))?.nextFetchAt === time + 120000);
    await q.enqueue({ type: "fetch_feed", feedId: "feed" });
    await q.consume(services, {
      fetch: async () => {
        await r.feeds.edit("feed", { intervalSeconds: 240 });
        return new Response(null, { status: 304 });
      },
    });
    assert((await r.feeds.get("feed"))?.nextFetchAt === time + 240000);
  } finally {
    c.close();
  }
});
Deno.test("Deno 服务组装：迁移、认证、持久 API 与正常关闭后重开", async () => {
  const dir = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "pushrss-runtime-",
  });
  const config = {
    databasePath: dir + "/service.db",
    masterKey: btoa("a".repeat(32)),
    adminPassword: "short",
  };
  try {
    let runtime = await createRuntime(config);
    let id: string;
    try {
      const response = await runtime.app.request("/api/feeds", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.adminPassword,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: "https://disabled.example/rss",
          enabled: false,
        }),
      });
      assert(response.status === 201);
      id = (await response.json()).id;
    } finally {
      await runtime.close();
    }
    runtime = await createRuntime(config);
    try {
      assert(
        (await runtime.app.request("/api/feeds/" + id, {
          headers: { Authorization: "Bearer " + config.adminPassword },
        })).status === 200,
      );
    } finally {
      await runtime.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
