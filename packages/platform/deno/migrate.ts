import type { DatabaseSync } from "node:sqlite";
/** SQL 文件与 Wrangler migrations 共用；每个版本在独立事务中提交。 */
export function migrate(
  client: DatabaseSync,
  migrations: readonly { name: string; sql: string }[],
) {
  client.exec(
    "CREATE TABLE IF NOT EXISTS pushrss_migrations (name TEXT PRIMARY KEY NOT NULL)",
  );
  for (const migration of migrations) {
    client.exec("BEGIN IMMEDIATE");
    try {
      if (
        !client.prepare("SELECT name FROM pushrss_migrations WHERE name = ?")
          .get(migration.name)
      ) {
        client.exec(migration.sql);
        client.prepare("INSERT INTO pushrss_migrations(name) VALUES (?)").run(
          migration.name,
        );
      }
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
}
