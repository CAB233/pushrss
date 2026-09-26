import type { Repositories } from "../packages/db/repositories.ts";
import { createNotifiers, validateConfig } from "../packages/notifier/mod.ts";
import {
  dispatchItems,
  retryDelivery,
  sendDelivery,
  testChannel,
} from "../packages/core/notifications.ts";
import { createSecretStore } from "../packages/core/secrets.ts";
import type { Job } from "../packages/shared/contracts.ts";
import { equal, rejects } from "./data-contract.ts";
export async function verifyNotifications(r: Repositories) {
  const f = crypto.randomUUID(),
    a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const secrets = await createSecretStore(btoa("x".repeat(32)));
  let time = 1000, calls = 0, mode = "limit";
  const queued: { job: Job; at?: number }[] = [];
  const notifiers = createNotifiers({
    fetch: ((_url, init) => {
      calls++;
      equal(init?.redirect, "error");
      if (String(_url).includes("ft07")) {
        equal(String(_url), "https://123.push.ft07.com/send/sctp123tabc.send");
        const body = JSON.parse(init!.body as string);
        equal(typeof body.title, "string");
        equal(typeof body.desp, "string");
        return Promise.resolve(Response.json({ code: 0 }));
      }
      const body = JSON.parse(init!.body as string);
      equal(body.chat_id, "-123");
      equal(body.message_thread_id, 7);
      equal(body.parse_mode, "HTML");
      equal(body.link_preview_options.is_disabled, true);
      equal(body.text.includes("<b>"), false);
      if (mode === "limit") {
        return Promise.resolve(
          Response.json({
            ok: false,
            error_code: 429,
            parameters: { retry_after: 90 },
            description: "secret",
          }, { status: 429 }),
        );
      }
      if (mode === "unknown") return Promise.reject(new Error("secret token"));
      return Promise.resolve(
        Response.json({ ok: true, result: { message_id: 42 } }),
      );
    }) as typeof fetch,
  });
  const services = {
    repositories: r,
    secrets,
    notifiers,
    now: () => time,
    queue: {
      enqueue(job: Job, at?: number) {
        queued.push({ job, at });
        return Promise.resolve();
      },
    },
  };
  try {
    await r.feeds.save({
      id: f,
      url: "https://example.com/" + f,
      title: "测试",
      nextFetchAt: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    for (
      const [id, type, config] of [[a, "serverchan", {
        sendKey: "sctp123tabc",
      }], [b, "telegram", {
        botToken: "123:abc",
        chatId: "-123",
        threadId: 7,
        parseMode: "HTML",
      }]] as const
    ) {
      await r.channels.save({
        id,
        type,
        name: type,
        encryptedConfig: await secrets.encrypt(JSON.stringify(config), id),
        createdAt: 0,
        updatedAt: 0,
      });
      await r.subscriptions.add({
        id: crypto.randomUUID(),
        feedId: f,
        channelId: id,
        createdAt: 0,
      });
    }
    const item = (await r.items.insert({
      id: crypto.randomUUID(),
      feedId: f,
      fingerprint: "a",
      title: "<b>测试</b>",
      summary: "<p>正文</p>",
      createdAt: 0,
    }))!;
    const ids = await dispatchItems(services, [item]);
    equal(ids.length, 2);
    equal(await dispatchItems(services, [item]), []);
    equal(queued.length, 2);
    const rows = await Promise.all(ids.map((id) => r.deliveries.get(id)));
    const aid = rows.find((v) => v?.channelId === a)!.id,
      bid = rows.find((v) => v?.channelId === b)!.id;
    const result = await Promise.all([
      sendDelivery(services, aid),
      sendDelivery(services, aid),
    ]);
    equal(result.sort(), ["sent", "skipped"]);
    equal(calls, 1);
    equal(await sendDelivery(services, bid), "pending");
    equal((await r.deliveries.get(bid))?.nextAttemptAt, 91000);
    equal(await sendDelivery(services, bid), "skipped");
    time = 91000;
    mode = "ok";
    equal(await sendDelivery(services, bid), "sent");
    equal((await r.deliveries.get(bid))?.externalMessageId, "42");
    equal(await retryDelivery(services, bid), false);
    equal((await testChannel(services, b)).ok, true);
    // 新文章验证重试上限和手动重试。
    const item2 = (await r.items.insert({
      id: crypto.randomUUID(),
      feedId: f,
      fingerprint: "b",
      title: "测试",
      createdAt: 0,
    }))!;
    const retryIds = await dispatchItems(services, [item2]);
    const target = (await Promise.all(retryIds.map((id) =>
      r.deliveries.get(id)
    ))).find((v) =>
      v?.channelId === b
    )!;
    mode = "limit";
    for (let n = 1; n <= 5; n++) {
      equal(
        await sendDelivery(services, target.id),
        n === 5 ? "failed" : "pending",
      );
      const row = (await r.deliveries.get(target.id))!;
      equal(row.attempts, n);
      time = row.nextAttemptAt ?? time;
    }
    equal(await retryDelivery(services, target.id), true);
    mode = "unknown";
    equal(await sendDelivery(services, target.id), "failed");
    const unknown = (await r.deliveries.get(target.id))!;
    equal(unknown.nextAttemptAt, null);
    equal(unknown.lastError?.includes("未知"), true);
    equal(unknown.lastError?.includes("secret"), false);
    equal(await retryDelivery(services, target.id), true);
    mode = "ok";
    equal(await sendDelivery(services, target.id), "sent");
    await rejects(() =>
      validateConfig("serverchan", { sendKey: "https://evil" })
    );
    await rejects(() =>
      validateConfig("telegram", {
        botToken: "123:abc",
        chatId: "-123",
        threadId: -1,
      })
    );
    const invalid = await notifiers.telegram.send({}, {
      title: "test",
      body: "",
    });
    equal(invalid.ok, false);
  } finally {
    await r.feeds.remove(f);
    await r.channels.remove(a);
    await r.channels.remove(b);
  }
}
