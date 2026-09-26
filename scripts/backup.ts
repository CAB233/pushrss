import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(Deno.env.get("DATABASE_PATH") ?? "pushrss.db");
const destination = Deno.args[0] && resolve(Deno.args[0]);
if (!destination || destination === databasePath) {
  throw new Error("用法：deno task db:backup /data/backups/pushrss-日期.db");
}
if (!(await Deno.stat(databasePath)).isFile) {
  throw new Error(`数据库文件无效：${databasePath}`);
}
try {
  await Deno.stat(destination);
  throw new Error(`备份文件已存在：${destination}`);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
const db = new DatabaseSync(databasePath);
try {
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("VACUUM INTO ?").run(destination);
} finally {
  db.close();
}
const snapshot = new DatabaseSync(destination, { readOnly: true });
try {
  const check = snapshot.prepare("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  if (check.integrity_check !== "ok") {
    throw new Error(`备份完整性校验失败：${check.integrity_check}`);
  }
} finally {
  snapshot.close();
}
console.log(`数据库一致性备份已生成：${destination}`);
