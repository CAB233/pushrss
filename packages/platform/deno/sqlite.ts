import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
/** 同步 SQLite 驱动通过 Drizzle 官方 proxy 接口接入。 */
export function openDatabase(path: string) {
  const client = new DatabaseSync(path);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec("PRAGMA busy_timeout = 5000");
  client.exec("PRAGMA journal_mode = WAL");
  const db = drizzle((sql, params, method) => {
    const statement = client.prepare(sql);
    if (method === "run") {
      statement.run(...params);
      return Promise.resolve({ rows: [] });
    }
    // Proxy 要求按查询字段顺序返回值；联表查询需显式使用唯一列别名。
    if (method === "get") {
      const row = statement.get(...params);
      return Promise.resolve({ rows: row ? Object.values(row) : [] });
    }
    return Promise.resolve({
      rows: statement.all(...params).map(Object.values),
    });
  });
  return { client, db, close: () => client.close() };
}
