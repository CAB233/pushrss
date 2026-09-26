import type { Repositories, StoredItem } from "../db/repositories.ts";
import { createNotifiers, failure } from "../notifier/mod.ts";
import type { ChannelType } from "../notifier/mod.ts";
import type {
  DeliveryResult,
  JobQueue,
  NotificationMessage,
  Notifier,
  SecretStore,
} from "../shared/contracts.ts";
export const RETRY_POLICY = { maxAttempts: 5, baseSeconds: 30 } as const;
export interface NotificationServices {
  repositories: Repositories;
  secrets: SecretStore;
  queue: JobQueue;
  notifiers?: Record<ChannelType, Notifier<unknown>>;
  now?: () => number;
  assertActive?: () => void | Promise<void>;
}
/** 输入为抓取结果 notificationItems；首次与后续抓取的新增文章均参与分发。 */
export async function dispatchItems(
  services: NotificationServices,
  items: StoredItem[],
): Promise<string[]> {
  const r = services.repositories;
  const ids: string[] = [];
  for (const item of items) {
    for (const channel of await r.subscriptions.channelsForFeed(item.feedId)) {
      const now = (services.now ?? Date.now)();
      const row = await r.deliveries.insert({
        id: crypto.randomUUID(),
        itemId: item.id,
        channelId: channel.id,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: now,
      });
      if (row) {
        ids.push(row.id);
        await services.queue.enqueue({
          type: "send_notification",
          deliveryId: row.id,
        }, now);
      }
    }
  }
  return ids;
}
function itemMessage(item: StoredItem): NotificationMessage {
  const body = (item.summary ?? item.content ?? "").replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    "",
  ).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ")
    .trim().slice(0, 2500);
  return { title: item.title.slice(0, 200), body, url: item.link ?? undefined };
}
async function send(
  services: NotificationServices,
  channelId: string,
  message: NotificationMessage,
): Promise<DeliveryResult> {
  const channel = await services.repositories.channels.get(channelId);
  if (!channel || !channel.enabled) return failure("通知渠道已停用或删除");
  let config: unknown;
  try {
    config = JSON.parse(
      await services.secrets.decrypt(channel.encryptedConfig, channel.id),
    );
  } catch {
    return failure("渠道凭据解密或解析失败");
  }
  try {
    await services.assertActive?.();
    return await (services.notifiers ?? createNotifiers())[channel.type].send(
      config,
      message,
    );
  } catch {
    return failure("通知执行异常，发送结果未知", false, "unknown");
  }
}
export async function sendDelivery(
  services: NotificationServices,
  deliveryId: string,
): Promise<"skipped" | "sent" | "pending" | "failed"> {
  const now = services.now ?? Date.now;
  const r = services.repositories;
  const row = await r.deliveries.claim(deliveryId, now());
  if (!row) return "skipped";
  const item = await r.items.get(row.itemId);
  const result = item
    ? await send(services, row.channelId, itemMessage(item))
    : failure("投递文章已删除");
  const completed = now();
  if (result.ok) {
    await r.deliveries.update(row.id, {
      status: "sent",
      sentAt: completed,
      externalMessageId: result.externalMessageId ?? null,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: completed,
    });
    return "sent";
  }
  const retry = result.retryable && result.outcome === "rejected" &&
    row.attempts < RETRY_POLICY.maxAttempts;
  const next = retry
    ? completed +
      Math.max(
          RETRY_POLICY.baseSeconds * 2 ** (row.attempts - 1),
          result.retryAfterSeconds ?? 0,
        ) * 1000
    : null;
  const status = retry ? "pending" : "failed";
  await r.deliveries.update(row.id, {
    status,
    lastError: (result.outcome === "unknown" ? "发送结果未知；" : "") +
      result.error,
    nextAttemptAt: next,
    updatedAt: completed,
  });
  if (next !== null) {
    await services.queue.enqueue({
      type: "send_notification",
      deliveryId: row.id,
    }, next);
  }
  return status;
}
/** 手动重试开启新一轮最多 5 次尝试，保留上次错误供待发送期间展示。 */
export async function retryDelivery(
  services: NotificationServices,
  id: string,
): Promise<boolean> {
  const now = (services.now ?? Date.now)();
  const row = await services.repositories.deliveries.retry(id, now);
  if (!row) return false;
  await services.queue.enqueue(
    { type: "send_notification", deliveryId: id },
    now,
  );
  return true;
}
export async function testChannel(
  services: NotificationServices,
  channelId: string,
): Promise<DeliveryResult> {
  const latest = await services.repositories.items.latestForChannel(channelId);
  const message = latest
    ? { ...itemMessage(latest), title: `【测试】${latest.title.slice(0, 196)}` }
    : {
      title: "PushRSS 测试通知",
      body: "收到此消息表示通知渠道配置成功。",
    };
  return await send(services, channelId, message);
}
