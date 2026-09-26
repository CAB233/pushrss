import type { Repositories } from "../packages/db/repositories.ts";
import { createSecretStore, publicChannel } from "../packages/core/secrets.ts";
export function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("断言失败: " + JSON.stringify({ actual, expected }));
  }
}
export async function rejects(fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error("预期失败");
}
export async function verifyRepositories(r: Repositories) {
  const prefix = crypto.randomUUID();
  const f = prefix + "f",
    g = prefix + "g",
    c = prefix + "c",
    d = prefix + "d",
    i = prefix + "i";
  try {
    for (const id of [f, g]) {
      await r.feeds.save({
        id,
        url: "https://example.com/" + id,
        title: "中文 ' 标题",
        nextFetchAt: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    equal((await r.feeds.get(f))?.intervalSeconds, 1800);
    await r.feeds.save({
      id: f,
      url: "https://example.com/" + f,
      title: "更新",
      nextFetchAt: 0,
      createdAt: 9,
      updatedAt: 2,
    });
    equal((await r.feeds.get(f))?.createdAt, 1);
    equal(
      (await r.feeds.due(1)).filter((x) => [f, g].includes(x.id)).length,
      2,
    );
    await rejects(() =>
      r.feeds.save({
        id: prefix + "bad",
        url: "bad",
        title: "错误",
        intervalSeconds: 0,
        nextFetchAt: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    for (const id of [c, d]) {
      await r.channels.save({
        id,
        name: id,
        type: "telegram",
        encryptedConfig: "v1.test",
        createdAt: 1,
        updatedAt: 1,
      });
    }
    for (const channelId of [c, d]) {
      await r.subscriptions.add({
        id: prefix + channelId,
        feedId: f,
        channelId,
        createdAt: 1,
      });
    }
    await r.subscriptions.add({
      id: prefix + "duplicate",
      feedId: f,
      channelId: c,
      createdAt: 1,
    });
    equal((await r.subscriptions.channelsForFeed(f)).length, 2);
    equal(
      JSON.stringify(publicChannel((await r.channels.get(c))!)).includes(
        "v1.test",
      ),
      false,
    );
    const item = {
      id: i,
      feedId: f,
      fingerprint: "same",
      title: "文章",
      createdAt: 1,
    };
    equal((await r.items.insert(item))?.id, i);
    equal(
      await r.items.insert({ ...item, id: prefix + "duplicate" }),
      undefined,
    );
    equal(
      (await r.items.insert({ ...item, id: prefix + "other", feedId: g }))
        ?.feedId,
      g,
    );
    await rejects(() =>
      r.items.insert({ ...item, id: prefix + "orphan", feedId: "missing" })
    );
    for (const channelId of [c, d]) {
      await r.deliveries.insert({
        id: prefix + "delivery" + channelId,
        itemId: i,
        channelId,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    equal(
      await r.deliveries.insert({
        id: prefix + "dupDelivery",
        itemId: i,
        channelId: c,
        createdAt: 1,
        updatedAt: 1,
      }),
      undefined,
    );
    await r.deliveries.update(prefix + "delivery" + c, {
      status: "sent",
      attempts: 1,
      sentAt: 2,
      updatedAt: 2,
    });
    equal((await r.deliveries.get(prefix + "delivery" + c))?.status, "sent");
    await r.settings.set("contract", { locale: "中文" }, 1);
    equal(await r.settings.get("contract"), { locale: "中文" });
    await r.feeds.remove(f);
    equal((await r.items.list(f)).length, 0);
    equal(await r.deliveries.get(prefix + "delivery" + c), undefined);
    equal((await r.subscriptions.channelsForFeed(f)).length, 0);
  } finally {
    await r.feeds.remove(f);
    await r.feeds.remove(g);
    await r.channels.remove(c);
    await r.channels.remove(d);
  }
}
export async function verifySecrets() {
  const key = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
  const store = await createSecretStore(key);
  const secret = '{"token":"测试凭据"}';
  const a = await store.encrypt(secret, "channel");
  const b = await store.encrypt(secret, "channel");
  equal(a === b, false);
  equal(await store.decrypt(a, "channel"), secret);
  await rejects(() => store.decrypt(a, "other"));
  const wrong = await createSecretStore(
    btoa(String.fromCharCode(...new Uint8Array(32))),
  );
  await rejects(() => wrong.decrypt(a, "channel"));
  const parts = a.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await rejects(() => store.decrypt(parts.join("."), "channel"));
  for (const value of [undefined, "abc", ""]) {
    await rejects(() => createSecretStore(value));
  }
  await rejects(() => store.decrypt("v2.invalid", "channel"));
}
