import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import {
  equal,
  rejects,
  verifyRepositories,
  verifySecrets,
} from "./data-contract.ts";
Deno.test("SQLite 迁移重复执行、约束、仓储、多渠道与级联清理", async () => {
  const c = openDatabase(":memory:");
  try {
    const migrations = [{
      name: "0001_initial.sql",
      sql: await Deno.readTextFile("packages/db/migrations/0001_initial.sql"),
    }];
    migrate(c.client, migrations);
    migrate(c.client, migrations);
    await verifyRepositories(createRepositories(c.db));
    equal(c.client.prepare("PRAGMA foreign_key_check").all(), []);
    await rejects(() =>
      migrate(c.client, [{
        name: "broken",
        sql: "CREATE TABLE rollback_probe(id TEXT); INVALID SQL;",
      }])
    );
    equal(
      c.client.prepare(
        "SELECT name FROM sqlite_master WHERE name = 'rollback_probe'",
      ).all(),
      [],
    );
  } finally {
    c.close();
  }
});
Deno.test("AES-GCM 随机 IV、上下文绑定、篡改和错误密钥", verifySecrets);
