import { DatabaseSync } from "node:sqlite";
import { migrate } from "../packages/platform/deno/migrate.ts";
import type {
  D1Binding,
  D1Statement,
} from "../packages/platform/cloudflare/bindings.ts";
import { verifyCloudflare } from "./cloudflare-contract.ts";
Deno.test("Cloudflare 任务契约：基线与更新推送、重复消费、退避、租约及补偿", async () => {
  const client = new DatabaseSync(":memory:");
  client.exec("PRAGMA foreign_keys=ON");
  const bindings = new WeakMap<
    D1Statement,
    { sql: string; params: unknown[] }
  >();
  const db: D1Binding = {
    prepare(sql) {
      function bound(params: unknown[]): D1Statement {
        const statement: D1Statement = {
          bind: (...params) => bound(params),
          raw: () =>
            Promise.resolve(
              client.prepare(sql).all(...params as (string | number | null)[])
                .map(Object.values),
            ),
          run: () =>
            Promise.resolve(
              client.prepare(sql).run(...params as (string | number | null)[]),
            ),
        };
        bindings.set(statement, { sql, params });
        return statement;
      }
      return bound([]);
    },
    batch(statements) {
      client.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => {
          const { sql, params } = bindings.get(s)!;
          return {
            results: client.prepare(sql).all(
              ...params as (string | number | null)[],
            ),
          };
        });
        client.exec("COMMIT");
        return Promise.resolve(results);
      } catch (e) {
        client.exec("ROLLBACK");
        return Promise.reject(e);
      }
    },
  };
  try {
    const names = [];
    for await (const file of Deno.readDir("packages/db/migrations")) {
      if (file.name.endsWith(".sql")) names.push(file.name);
    }
    migrate(
      client,
      await Promise.all(
        names.sort().map(async (name) => ({
          name,
          sql: await Deno.readTextFile("packages/db/migrations/" + name),
        })),
      ),
    );
    await verifyCloudflare(db);
  } finally {
    client.close();
  }
});
