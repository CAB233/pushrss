import { runServer } from "../packages/platform/deno/main.ts";

if (import.meta.main) {
  const rss = await Deno.readTextFile("tests/fixtures/rss.xml");
  await runServer({ fetch: () => Promise.resolve(new Response(rss)) });
}
