import type {
  D1Binding,
  QueueEnvelope,
  QueueMessage,
} from "../packages/platform/cloudflare/bindings.ts";
import { createD1Repositories } from "../packages/platform/cloudflare/database.ts";
import { createCloudflareRuntime } from "../packages/platform/cloudflare/runtime.ts";
import worker from "../packages/platform/cloudflare/main.ts";
import { passwordAuthorization } from "../packages/shared/auth.ts";
import { equal, rejects } from "./data-contract.ts";
export async function verifyCloudflare(db: D1Binding) {
  const r = createD1Repositories(db);
  let time = 100000;
  let sends = 0;
  let unavailable = false;
  const messages: QueueEnvelope[] = [];
  const env = {
    DB: db,
    PUSHRSS_ADMIN_PASSWORD: "test",
    PUSHRSS_MASTER_KEY: btoa("a".repeat(32)),
    JOB_QUEUE: {
      send(body: QueueEnvelope, options?: { delaySeconds: number }) {
        if (
          options && (options.delaySeconds < 0 || options.delaySeconds > 86400)
        ) throw new Error("非法队列延迟");
        if (unavailable) return Promise.reject(new Error("模拟 Queues 不可用"));
        messages.push(body);
        return Promise.resolve();
      },
      sendBatch(batch: { body: QueueEnvelope }[]) {
        messages.push(...batch.map((m) => m.body));
        return Promise.resolve();
      },
    },
  };
  const runtime = await createCloudflareRuntime(env, {
    now: () => time,
    fetch: () =>
      Promise.resolve(
        new Response(
          "<rss><channel><title>测试</title><item><guid>cf-1</guid><title>文章</title></item></channel></rss>",
        ),
      ),
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
              : { ok: true as const },
          );
        },
      },
      serverchan: { send: () => Promise.resolve({ ok: true as const }) },
    },
  });
  const api = (path: string, method = "GET", body?: unknown) =>
    runtime.app.request("/api" + path, {
      method,
      headers: {
        Authorization: "Bearer test",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  equal(
    (await worker.fetch(new Request("https://local/health"), env)).status,
    200,
  );
  const login = await worker.fetch(
    new Request("https://local/api/session", {
      method: "POST",
      headers: { Authorization: passwordAuthorization("test") },
    }),
    env,
  );
  equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !login.headers.get("set-cookie")?.includes("Secure")) {
    throw new Error("Worker 会话 Cookie 配置错误");
  }
  equal(
    (await worker.fetch(
      new Request("https://local/api/status", {
        headers: { Cookie: cookie },
      }),
      env,
    )).status,
    200,
  );
  equal(
    (await worker.fetch(new Request("https://local/api/status"), env)).status,
    401,
  );
  equal(
    (await worker.fetch(new Request("https://local/api/status"), {})).status,
    503,
  );
  equal(
    (await worker.fetch(new Request("https://local/api/status"), {
      ...env,
      PUSHRSS_MASTER_KEY: "invalid",
    })).status,
    503,
  );
  equal(
    await (await worker.fetch(new Request("https://local/"), {
      ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
    })).text(),
    "asset",
  );
  const feed = await (await api("/feeds", "POST", {
    url: "https://cf-contract.example/rss",
    intervalSeconds: 60,
  })).json();
  const channel = await (await api("/channels", "POST", {
    name: "Cloudflare 测试",
    type: "telegram",
    config: { botToken: "123:test", chatId: "123" },
  })).json();
  await api("/subscriptions", "POST", {
    feedId: feed.id,
    channelId: channel.id,
  });
  const notify = (body: unknown) => {
    let ack = 0, retry = 0;
    const message: QueueMessage = {
      body,
      ack() {
        ack++;
      },
      retry() {
        retry++;
      },
    };
    return { message, result: () => ({ ack, retry }) };
  };
  async function drain() {
    const batch = messages.splice(0).map((body) => notify(body));
    await runtime.consume({ messages: batch.map((m) => m.message) });
    return batch;
  }
  try {
    await runtime.scheduled();
    const duplicate = messages[0];
    // 两个独立消费者同时领取同一业务任务。
    const pair = [notify(duplicate), notify(duplicate)];
    messages.length = 0;
    await Promise.all(
      pair.map((m) => runtime.consume({ messages: [m.message] })),
    );
    equal((await r.items.list(feed.id)).length, 1);
    equal(
      (await r.deliveries.list()).filter((d) => d.channelId === channel.id)
        .length,
      1,
    );
    await drain();
    equal(sends, 1);
    let [delivery] = (await r.deliveries.list()).filter((d) =>
      d.channelId === channel.id
    );
    equal(delivery.status, "pending");
    equal(delivery.nextAttemptAt, time + 90000);
    const early = await drain();
    equal(early.some((m) => m.result().retry === 1), true);
    await r.feeds.edit(feed.id, { enabled: false });
    time += 90000;
    await runtime.scheduled();
    await drain();
    equal((await r.deliveries.get(delivery.id))?.status, "sent");
    equal(sends, 2);
    await runtime.consume({ messages: [notify(duplicate).message] });
    equal(sends, 2);
    // 文章入库后中断，Cron 从 outbox 原子恢复投递。
    await r.items.insert({
      id: "cf-orphan",
      feedId: feed.id,
      fingerprint: "orphan",
      title: "恢复文章",
      createdAt: time,
    });
    await runtime.scheduled();
    delivery = (await r.deliveries.list()).find((d) =>
      d.itemId === "cf-orphan"
    )!;
    const [envelope] = messages.splice(0);
    const old = await runtime.queue.claim(envelope.jobId);
    if (!old) throw new Error("任务领取失败");
    await runtime.queue.repositories(old).deliveries.claim(delivery.id, time);
    time += 60001;
    await runtime.scheduled();
    equal((await r.deliveries.get(delivery.id))?.status, "failed");
    await rejects(() =>
      runtime.queue.repositories(old).settings.set("stale-write", true, time)
    );
    equal(await r.settings.get("stale-write"), undefined);
    await rejects(() => runtime.queue.finish(old));
    await drain();
    equal(sends, 2);
    // 手动重试的持久化任务在传输失败后由 Cron 补发。
    unavailable = true;
    equal((await api(`/deliveries/${delivery.id}/retry`, "POST")).status, 500);
    unavailable = false;
    await runtime.scheduled();
    await drain();
    equal((await r.deliveries.get(delivery.id))?.status, "sent");
    equal(sends, 3);
    // 超过 24 小时的通知等待保存在 D1，抵达到期时间后再传输。
    await r.deliveries.update(delivery.id, { status: "failed" });
    await r.deliveries.retry(delivery.id, time);
    await r.deliveries.update(delivery.id, { nextAttemptAt: time + 172800000 });
    messages.length = 0;
    await runtime.queue.enqueue({
      type: "send_notification",
      deliveryId: delivery.id,
    }, time + 172800000);
    equal(messages.length, 0);
    time += 172800000;
    await runtime.scheduled();
    await drain();
    equal(sends, 4);
    const poison = notify({ type: "unknown" });
    await runtime.consume({ messages: [poison.message] });
    equal(poison.result().ack, 1);
    const malformed = notify({ jobId: "missing" });
    await runtime.consume({ messages: [malformed.message] });
    equal(malformed.result().ack, 1);
    // 失败 Feed 的任务最多执行五次；消息退避期间仍可处理其他消息。
    await runtime.queue.enqueue({ type: "fetch_feed", feedId: feed.id });
    const pending = messages.pop()!;
    for (let attempts = 1; attempts <= 5; attempts++) {
      const claim = await runtime.queue.claim(pending.jobId);
      if (!claim) throw new Error("重试领取失败");
      equal(claim.attempts, attempts);
      await runtime.queue.finish(claim, true);
      time += 30000 * 2 ** (attempts - 1);
    }
    equal(
      (await db.prepare("SELECT status FROM jobs WHERE id=?").bind(
        pending.jobId,
      ).raw())[0][0],
      "failed",
    );
    messages.length = 0;
    await runtime.queue.enqueue(
      { type: "fetch_feed", feedId: "manual-probe" },
      time + 10000,
    );
    await runtime.queue.enqueue(
      { type: "fetch_feed", feedId: "manual-probe", latestOnly: true },
      time,
    );
    const manualRows = await db.prepare(
      "SELECT payload,available_at FROM jobs WHERE type='fetch_feed' AND json_extract(payload,'$.feedId')='manual-probe' AND status='pending'",
    ).raw();
    equal(manualRows.length, 1);
    equal(JSON.parse(String(manualRows[0][0])).latestOnly, true);
    equal(manualRows[0][1], time);
    await db.prepare(
      "DELETE FROM jobs WHERE type='fetch_feed' AND json_extract(payload,'$.feedId')='manual-probe'",
    ).run();
    messages.length = 0;
    time += 31 * 86400000;
    await runtime.queue.recover();
    equal(
      (await db.prepare("SELECT id FROM jobs WHERE id=?").bind(pending.jobId)
        .raw()).length,
      0,
    );
  } finally {
    await r.feeds.remove(feed.id);
    await r.channels.remove(channel.id);
  }
}
