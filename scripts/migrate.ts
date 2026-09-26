import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
const path = Deno.env.get("DATABASE_PATH") ?? "pushrss.db";
const connection = openDatabase(path);
try {
  const directory = new URL("../packages/db/migrations/", import.meta.url);
  const names = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  const migrations = await Promise.all(
    names.sort().map(async (name) => ({
      name,
      sql: await Deno.readTextFile(new URL(name, directory)),
    })),
  );
  migrate(connection.client, migrations);
  console.log("数据库迁移完成");
} finally {
  connection.close();
}
