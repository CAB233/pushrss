import { createApp } from "../../../apps/server/src/app.ts";
import { sessionSigningSecret } from "../../shared/auth.ts";
import type { NotificationServices } from "../../core/notifications.ts";
import type { FetchOptions } from "../../core/fetch-feed.ts";
import { loadSecretStore } from "./secrets.ts";
import { createD1Repositories } from "./database.ts";
import { createCloudflareQueue } from "./queue.ts";
import type { QueueBatch, WorkerEnv } from "./bindings.ts";
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
  const repositories = createD1Repositories(env.DB);
  const queue = createCloudflareQueue(env.DB, env.JOB_QUEUE, options.now);
  const services = { secrets, now: options.now, notifiers: options.notifiers };
  return {
    app: createApp("cloudflare", {
      ...services,
      fetch: options.fetch,
      repositories,
      queue,
      adminPassword,
      sessionSecret: sessionSigningSecret(masterKey, adminPassword),
    }),
    queue,
    async scheduled() {
      await queue.recover();
      await queue.publish();
    },
    async consume(batch: QueueBatch) {
      for (const message of batch.messages) {
        await queue.consume(message, services, options);
      }
    },
  };
}
