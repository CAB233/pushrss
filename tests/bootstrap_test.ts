import { inspectFeed } from "../packages/core/mod.ts";
import { createApp } from "../apps/server/src/app.ts";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { runScheduler } from "../packages/platform/deno/scheduler.ts";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
const compatibilityProbe = sqliteTable("compatibility_probe", {
  id: integer("id").primaryKey(),
  value: text("value").notNull(),
});
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(JSON.stringify({ actual, expected }));
  }
}
Deno.test("RSS 与 Atom 固定样例", async () => {
  equal(inspectFeed(await Deno.readTextFile("tests/fixtures/rss.xml")), {
    format: "rss",
    title: "示例 RSS",
    count: 2,
  });
  equal(inspectFeed(await Deno.readTextFile("tests/fixtures/atom.xml")), {
    format: "atom",
    title: "示例 Atom",
    count: 1,
  });
});
Deno.test("无效 XML 有明确错误", () => {
  for (const xml of ["<rss>", "<html/>"]) {
    let failed = false;
    try {
      inspectFeed(xml);
    } catch {
      failed = true;
    }
    equal(failed, true);
  }
});
Deno.test("Hono 状态与未知路由", async () => {
  const app = createApp("deno");
  equal(await (await app.request("/health")).json(), {
    name: "PushRSS",
    runtime: "deno",
    stage: "api",
  });
  equal((await app.request("/missing")).status, 404);
});
Deno.test("SQLite 与 Drizzle 参数写入和读取", async () => {
  const connection = openDatabase(":memory:");
  try {
    connection.client.exec(
      "CREATE TABLE compatibility_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    await connection.db.insert(compatibilityProbe).values({
      id: 1,
      value: "中文 ' 参数",
    });
    equal(await connection.db.select().from(compatibilityProbe), [{
      id: 1,
      value: "中文 ' 参数",
    }]);
    equal(await connection.db.select().from(compatibilityProbe).get(), {
      id: 1,
      value: "中文 ' 参数",
    });
  } finally {
    connection.close();
  }
});
Deno.test("调度错误后继续，退出时清理定时器", async () => {
  const controller = new AbortController();
  let calls = 0;
  let errors = 0;
  await runScheduler(
    () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("模拟失败"));
      controller.abort();
      return Promise.resolve();
    },
    1,
    controller.signal,
    () => {
      errors++;
    },
  );
  equal([calls, errors], [2, 1]);
});
