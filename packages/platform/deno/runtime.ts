import { createApp } from "../../../apps/server/src/app.ts";
import { sessionSigningSecret } from "../../shared/auth.ts";
import { createSecretStore } from "../../core/secrets.ts";
import { createRepositories } from "../../db/repositories.ts";
import { openDatabase } from "./sqlite.ts";
import { migrate } from "./migrate.ts";
import { createQueue } from "./queue.ts";
import { runScheduler } from "./scheduler.ts";
import {
  readSchedulingConfig,
  type SchedulingConfig,
} from "../../shared/scheduling.ts";
export async function createRuntime(
  config: {
    databasePath: string;
    masterKey: string;
    adminPassword: string;
    scheduling?: SchedulingConfig;
  },
  options: { fetch?: typeof globalThis.fetch } = {},
) {
  if (!config.adminPassword.trim()) {
    throw new Error("请设置非空的 PUSHRSS_ADMIN_PASSWORD");
  }
  const secrets = await createSecretStore(config.masterKey);
  const scheduling = config.scheduling ?? readSchedulingConfig({});
  const db = openDatabase(config.databasePath);
  try {
    const directory = new URL("../../db/migrations/", import.meta.url);
    const names = [];
    for await (const file of Deno.readDir(directory)) {
      if (file.isFile && file.name.endsWith(".sql")) names.push(file.name);
    }
    migrate(
      db.client,
      await Promise.all(
        names.sort().map(async (name) => ({
          name,
          sql: await Deno.readTextFile(new URL(name, directory)),
        })),
      ),
    );
    const queue = createQueue(db.client);
    const app = createApp("deno", {
      repositories: createRepositories(db.db),
      secrets,
      queue,
      fetch: options.fetch,
      fetchIntervalSeconds: scheduling.fetchIntervalSeconds,
      adminPassword: config.adminPassword,
      sessionSecret: sessionSigningSecret(
        config.masterKey,
        config.adminPassword,
      ),
    });
    const controller = new AbortController();
    let lastCheckedAt = -Infinity;
    const background = runScheduler(
      async () => {
        const at = Date.now();
        const scanFeeds = at - lastCheckedAt >= scheduling.checkIntervalMs;
        queue.recover({
          scanFeeds,
          fetchIntervalSeconds: scheduling.fetchIntervalSeconds,
        });
        if (scanFeeds) lastCheckedAt = at;
        for (
          let i = 0;
          i < 20 && !controller.signal.aborted;
          i++
        ) if (!await queue.consume({ secrets }, options)) break;
      },
      1000,
      controller.signal,
      () => console.error("后台任务执行失败，将在下一轮继续"),
    );
    return {
      app,
      queue,
      async close() {
        controller.abort();
        await background;
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
