import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createRepositories } from "../../db/repositories.ts";
import type { D1Binding, D1Statement } from "./bindings.ts";
/** guard 与业务 SQL 在同一个 D1 batch 事务中，过期租约使整个事务回滚。 */
export function createD1Repositories(db: D1Binding, guard?: () => D1Statement) {
  return createRepositories(drizzle(async (sql, params, method) => {
    const statement = db.prepare(sql).bind(...params);
    let rows: unknown[][];
    if (guard) {
      const result = await db.batch([guard(), statement]);
      rows = result[1].results.map(Object.values);
    } else if (method === "run") {
      await statement.run();
      rows = [];
    } else rows = await statement.raw();
    return { rows: method === "get" ? rows[0] ?? [] : rows };
  }));
}
