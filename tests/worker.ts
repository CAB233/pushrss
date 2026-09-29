let liveFeeds: Record<string, string> = {};
import { verifyRelay } from "./relay-contract.ts";
import { verifyApi } from "./api-contract.ts";
import { verifyNotifierProtocol } from "./notifier-contract.ts";
import { verifyNotifications } from "./notification-contract.ts";
import { createD1Repositories } from "../packages/platform/cloudflare/database.ts";
import { verifyCloudflare } from "./cloudflare-contract.ts";
import { verifyRepositories, verifySecrets } from "./data-contract.ts";
import { verifyFeeds } from "./feed-contract.ts";
import type {
  D1Binding,
  QueueBatch,
  WorkerEnv,
} from "../packages/platform/cloudflare/bindings.ts";
import { createWorker } from "../packages/platform/cloudflare/main.ts";
import { inspectFeed } from "../packages/core/mod.ts";
function liveWorker() {
  return createWorker({
    fetch: (url) => {
      const format = String(url).includes("atom") ? "atom" : "rss";
      return Promise.resolve(
        new Response(
          liveFeeds[format] ?? "",
        ),
      );
    },
    notifiers: {
      telegram: {
        send: () =>
          Promise.resolve({
            ok: true as const,
            externalMessageId: "local-telegram",
          }),
      },
      serverchan: { send: () => Promise.resolve({ ok: true as const }) },
    },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv & { DB: D1Binding }) {
    if (new URL(request.url).pathname === "/__test/data") {
      const repositories = createD1Repositories(env.DB);
      await verifyRepositories(repositories);
      await verifySecrets();
      await verifyNotifications(repositories);
      await verifyNotifierProtocol();
      await verifyApi(repositories);
      await verifyRelay(repositories);
      await verifyCloudflare(env.DB);
      const { rss, atom } = await request.json() as {
        rss: string;
        atom: string;
      };
      await verifyFeeds(repositories, rss, atom);
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === "/__test/parse") {
      return Response.json(inspectFeed(await request.text()));
    }
    if (new URL(request.url).pathname === "/__test/live/setup") {
      const data = await request.json() as {
        rss: string;
        atom: string;
        due?: boolean;
      };
      const r = createD1Repositories(env.DB);
      liveFeeds = { rss: data.rss, atom: data.atom };
      if (data.due) {
        for (const feed of await r.feeds.list(500)) {
          if (feed.url.startsWith("https://live.example/")) {
            await r.feeds.edit(feed.id, { nextFetchAt: Date.now() });
          }
        }
      }
      return Response.json({ ok: true });
    }
    return liveWorker().fetch(request, env);
  },
  async scheduled(event: unknown, env: WorkerEnv & { DB: D1Binding }) {
    await liveWorker().scheduled(event, env);
  },
  async queue(batch: QueueBatch, env: WorkerEnv & { DB: D1Binding }) {
    await liveWorker().queue(batch, env);
  },
};
