import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { verifyApi } from "./api-contract.ts";
Deno.test("管理 API：认证、校验、CRUD、分页、脱敏与刷新投递链路", async () => {
  const c = openDatabase(":memory:");
  try {
    migrate(c.client, [{
      name: "0001_initial.sql",
      sql: await Deno.readTextFile("packages/db/migrations/0001_initial.sql"),
    }]);
    await verifyApi(createRepositories(c.db));
  } finally {
    c.close();
  }
});
