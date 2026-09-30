import { createApp } from "../../../apps/server/src/app.ts";
import { createCloudflareRuntime, type RuntimeOptions } from "./runtime.ts";
import type { QueueBatch, WorkerEnv } from "./bindings.ts";
interface WorkerHandler {
  fetch(request: Request, env?: WorkerEnv): Promise<Response>;
  scheduled(event: unknown, env: WorkerEnv): Promise<void>;
  queue(batch: QueueBatch, env: WorkerEnv): Promise<void>;
}
const unavailable = createApp("cloudflare");
export function createWorker(options: RuntimeOptions = {}): WorkerHandler {
  return {
    async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/health") return unavailable.fetch(request);
      if (!path.startsWith("/api/") && path !== "/api") {
        return env.ASSETS
          ? env.ASSETS.fetch(request)
          : unavailable.fetch(request);
      }
      let runtime;
      try {
        runtime = await createCloudflareRuntime(env, options);
      } catch {
        return unavailable.fetch(request);
      }
      return runtime.app.fetch(request);
    },
    async scheduled(event: unknown, env: WorkerEnv) {
      const scheduledAt = typeof event === "object" && event !== null &&
          "scheduledTime" in event && typeof event.scheduledTime === "number"
        ? event.scheduledTime
        : undefined;
      await (await createCloudflareRuntime(env, options)).scheduled(
        scheduledAt,
      );
    },
    async queue(batch: QueueBatch, env: WorkerEnv) {
      try {
        await (await createCloudflareRuntime(env, options)).consume(batch);
      } catch {
        for (const message of batch.messages) {
          message.retry({ delaySeconds: 60 });
        }
      }
    },
  };
}
const worker: WorkerHandler = createWorker();
export default worker;
