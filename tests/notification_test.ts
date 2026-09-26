import { verifyNotifierProtocol } from "./notifier-contract.ts";
import { openDatabase } from "../packages/platform/deno/sqlite.ts";
import { migrate } from "../packages/platform/deno/migrate.ts";
import { createRepositories } from "../packages/db/repositories.ts";
import { verifyNotifications } from "./notification-contract.ts";
Deno.test("通知渠道、多渠道分发、并发幂等、退避与手动重试", async () => {
  const c = openDatabase(":memory:");
  try {
    migrate(c.client, [{
      name: "0001_initial.sql",
      sql: await Deno.readTextFile("packages/db/migrations/0001_initial.sql"),
    }]);
    await verifyNotifications(createRepositories(c.db));
  } finally {
    c.close();
  }
});

Deno.test("通知协议、解析模式、错误脱敏与超时", verifyNotifierProtocol);
