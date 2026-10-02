import { verifyRelay } from "./relay-contract.ts";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { testMigrations } from "./migrations.ts";
import { equal } from "./data-contract.ts";
import { parseFeed } from "../packages/core/feed.ts";
Deno.test("RSS 样例：表单、分类、关键词、八种渠道、基线与持久化分发", async () => {
  const database = openDatabase(":memory:");
  try {
    migrate(database.client, await testMigrations());
    await verifyRelay(createRepositories(database.db));
    equal(database.client.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
  const rdf = parseFeed(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RDF 源</title><link>https://rdf.example/</link></channel><item><title>条目</title><link>https://rdf.example/1</link></item></rdf:RDF>',
  );
  equal(rdf.title, "RDF 源");
  equal(rdf.items.length, 1);
});
Deno.test("新数据库使用统一的七张业务表与复合订阅主键", async () => {
  const database = openDatabase(":memory:");
  try {
    const migrations = await testMigrations();
    equal(migrations.map((m) => m.name), [
      "0001_schema.sql",
      "0002_delivery_logs.sql",
      "0003_feed_notification_limit.sql",
    ]);
    migrate(database.client, migrations.slice(0, 2));
    database.client.prepare(
      "INSERT INTO feeds (id,url,title,next_fetch_at,created_at,updated_at) VALUES ('upgrade','https://upgrade.example/feed','升级测试',0,0,0)",
    ).run();
    migrate(database.client, migrations);
    migrate(database.client, migrations);
    equal(
      database.client.prepare(
        "SELECT notification_limit FROM feeds WHERE id='upgrade'",
      ).get()?.notification_limit,
      10,
    );
    const names = database.client.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name <> 'pushrss_migrations' ORDER BY name",
    ).all().map((r) => r.name);
    equal(names, [
      "deliveries",
      "feed_items",
      "feeds",
      "jobs",
      "notification_channels",
      "notification_outbox",
      "subscriptions",
    ]);
    const columns = database.client.prepare("PRAGMA table_info(subscriptions)")
      .all().map((r) => r.name);
    equal(columns, ["feed_id", "channel_id"]);
    equal(database.client.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
