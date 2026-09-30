import { createApp } from "../../../apps/server/src/app.ts";
import { sessionSigningSecret } from "../../shared/auth.ts";
import type { NotificationServices } from "../../core/notifications.ts";
import type { FetchOptions } from "../../core/fetch-feed.ts";
import { loadSecretStore } from "./secrets.ts";
import { createD1Repositories } from "./database.ts";
import { createCloudflareQueue } from "./queue.ts";
import type { QueueBatch, WorkerEnv } from "./bindings.ts";
import { readSchedulingConfig } from "../../shared/scheduling.ts";
export interface RuntimeOptions extends FetchOptions {
  notifiers?: NotificationServices["notifiers"];
}
export async function createCloudflareRuntime(
  env: WorkerEnv,
  options: RuntimeOptions = {},
) {
  const adminPassword = env.PUSHRSS_ADMIN_PASSWORD ?? env.PUSHRSS_ADMIN_TOKEN;
  const masterKey = env.PUSHRSS_MASTER_KEY;
  if (!env.DB || !env.JOB_QUEUE || !adminPassword?.trim() || !masterKey) {
    throw new Error("Cloudflare 绑定或管理密码待配置");
  }
  const secrets = await loadSecretStore(env);
  const scheduling = readSchedulingConfig(env);
  const repositories = createD1Repositories(env.DB);
  const queue = createCloudflareQueue(env.DB, env.JOB_QUEUE, options.now);
  const services = { secrets, now: options.now, notifiers: options.notifiers };
  return {
    app: createApp("cloudflare", {
      ...services,
      fetch: options.fetch,
      fetchIntervalSeconds: scheduling.fetchIntervalSeconds,
      repositories,
      queue,
      adminPassword,
      sessionSecret: sessionSigningSecret(masterKey, adminPassword),
    }),
    queue,
    async scheduled(scheduledAt = (options.now ?? Date.now)()) {
      // 使用 Cron 的计划时间按 UTC 分钟分段，适用于多个独立 Worker 实例。
      const minute = Math.floor(scheduledAt / 60_000);
      const checkMinutes = scheduling.checkIntervalMs / 60_000;
      await queue.recover({
        scanFeeds: minute % checkMinutes === 0,
        fetchIntervalSeconds: scheduling.fetchIntervalSeconds,
      });
      await queue.publish();
    },
    async consume(batch: QueueBatch) {
      for (const message of batch.messages) {
        await queue.consume(message, services, options);
      }
    },
  };
}
