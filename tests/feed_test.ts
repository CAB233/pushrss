import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { verifyFeeds } from "./feed-contract.ts";
Deno.test("Feed 标准化、指纹、条件抓取、首次推送、地址变更与失败恢复", async () => {
  const c = openDatabase(":memory:");
  try {
    migrate(c.client, [{
      name: "0001_initial.sql",
      sql: await Deno.readTextFile("packages/db/migrations/0001_initial.sql"),
    }]);
    await verifyFeeds(
      createRepositories(c.db),
      await Deno.readTextFile("tests/fixtures/rss-full.xml"),
      await Deno.readTextFile("tests/fixtures/atom-full.xml"),
    );
  } finally {
    c.close();
  }
});
