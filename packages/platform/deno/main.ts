import { createApp } from "../../../apps/server/src/app.ts";
import { createRuntime } from "./runtime.ts";
import { createAssetHandler } from "./assets.ts";
if (import.meta.main) {
  const token = Deno.env.get("PUSHRSS_ADMIN_PASSWORD") ??
    Deno.env.get("PUSHRSS_ADMIN_TOKEN");
  const key = Deno.env.get("PUSHRSS_MASTER_KEY");
  const runtime = token && key
    ? await createRuntime({
      adminPassword: token,
      masterKey: key,
      databasePath: Deno.env.get("DATABASE_PATH") ?? "pushrss.db",
    })
    : undefined;
  const app = runtime?.app ?? createApp("deno");
  const assetDirectory = Deno.env.get("PUSHRSS_WEB_DIR");
  const assets = assetDirectory
    ? await createAssetHandler(assetDirectory)
    : undefined;
  const server = Deno.serve({
    hostname: Deno.env.get("HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("PORT") ?? 8000),
  }, (request) => {
    const path = new URL(request.url).pathname;
    return path === "/health" || path.startsWith("/api/") ||
        path === "/api"
      ? app.fetch(request)
      : assets?.(request) ?? app.fetch(request);
  });
  let stopping: Promise<void> | undefined;
  const stop = () =>
    stopping ??= (async () => {
      await server.shutdown();
      await runtime?.close();
    })();
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);
  await server.finished;
  await stop();
  Deno.removeSignalListener("SIGINT", stop);
  Deno.removeSignalListener("SIGTERM", stop);
}
