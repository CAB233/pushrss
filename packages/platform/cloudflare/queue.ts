import type { Job, JobQueue } from "../../shared/contracts.ts";
import type { NotificationServices } from "../../core/notifications.ts";
import type { FetchOptions } from "../../core/fetch-feed.ts";
import { handleJob } from "../../core/jobs.ts";
import type {
  D1Binding,
  D1Statement,
  QueueBinding,
  QueueMessage,
} from "./bindings.ts";
import { createD1Repositories } from "./database.ts";
export const LEASE_MS = 60000;
export interface Claim {
  id: string;
  token: string;
  job: Job;
  attempts: number;
}
/** Queues 运输消息；D1 jobs 保存业务任务、租约及入队恢复状态。 */
export function createCloudflareQueue(
  db: D1Binding,
  transport: QueueBinding,
  now = Date.now,
) {
  const stmt = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).bind(...params);
  const target = (job: Job) =>
    job.type === "fetch_feed" ? job.feedId : job.deliveryId;
  function guard(c: Claim) {
    // SQLite CASE 惰性求值：租约不属于当前执行者时触发错误，D1 回滚整个 batch。
    return stmt(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='running' AND lock_token=? AND locked_until>?) THEN 1 ELSE json('expired-lease') END AS owned",
      c.id,
      c.token,
      now(),
    );
  }
  async function enqueue(job: Job, at = now(), owner?: Claim) {
    const batch = await db.batch([
      ...(owner ? [guard(owner)] : []),
      stmt(
        "INSERT OR IGNORE INTO jobs(id,type,payload,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        crypto.randomUUID(),
        job.type,
        JSON.stringify(job),
        at,
        now(),
        now(),
      ),
      stmt(
        "SELECT id,status,available_at FROM jobs WHERE type=? AND coalesce(json_extract(payload,'$.feedId'),json_extract(payload,'$.deliveryId'))=? AND status IN ('pending','running')",
        job.type,
        target(job),
      ),
    ]);
    const row = batch.at(-1)!.results[0];
    if (
      row?.status === "pending" && Number(row.available_at) - now() <= 86400000
    ) {
      await transport.send({ jobId: String(row.id) }, {
        delaySeconds: Math.max(
          0,
          Math.ceil((Number(row.available_at) - now()) / 1000),
        ),
      });
    }
  }
  async function recover() {
    // 50 个 item ID 加时间参数保持在 D1 单语句参数限额内。
    const markers = await stmt(
      "SELECT item_id FROM notification_outbox ORDER BY item_id LIMIT 50",
    ).raw();
    const ids = markers.map((row) => String(row[0]));
    const statements: D1Statement[] = [
      stmt(
        "UPDATE deliveries SET status='failed',last_error='发送结果未知；任务执行中断，请手动重试',next_attempt_at=NULL,updated_at=? WHERE status='sending' AND EXISTS(SELECT 1 FROM jobs WHERE type='send_notification' AND json_extract(payload,'$.deliveryId')=deliveries.id AND status='running' AND locked_until<=?)",
        now(),
        now(),
      ),
      stmt(
        "UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL,lock_token=NULL,available_at=?,updated_at=?,last_error='任务租约过期' WHERE status='running' AND locked_until<=?",
        now(),
        now(),
        now(),
      ),
    ];
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      statements.push(
        stmt(
          `INSERT OR IGNORE INTO deliveries(id,item_id,channel_id,created_at,updated_at,next_attempt_at) SELECT lower(hex(randomblob(16))),i.id,c.id,?,?,? FROM notification_outbox o JOIN feed_items i ON i.id=o.item_id JOIN subscriptions s ON s.feed_id=i.feed_id JOIN notification_channels c ON c.id=s.channel_id WHERE c.enabled=1 AND o.item_id IN (${marks})`,
          now(),
          now(),
          now(),
          ...ids,
        ),
        stmt(
          `DELETE FROM notification_outbox WHERE item_id IN (${marks})`,
          ...ids,
        ),
      );
    }
    statements.push(
      stmt(
        "INSERT OR IGNORE INTO jobs(id,type,payload,available_at,created_at,updated_at) SELECT lower(hex(randomblob(16))),'send_notification',json_object('type','send_notification','deliveryId',d.id),coalesce(d.next_attempt_at,?),?,? FROM deliveries d WHERE d.status='pending' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.type='send_notification' AND json_extract(j.payload,'$.deliveryId')=d.id AND j.status IN ('pending','running')) ORDER BY d.next_attempt_at,d.id LIMIT 100",
        now(),
        now(),
        now(),
      ),
      stmt(
        "INSERT OR IGNORE INTO jobs(id,type,payload,available_at,created_at,updated_at) SELECT lower(hex(randomblob(16))),'fetch_feed',json_object('type','fetch_feed','feedId',f.id),?,?,? FROM feeds f WHERE f.enabled=1 AND f.next_fetch_at<=? AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.type='fetch_feed' AND json_extract(j.payload,'$.feedId')=f.id AND j.status IN ('pending','running')) ORDER BY f.next_fetch_at,f.id LIMIT 100",
        now(),
        now(),
        now(),
        now(),
      ),
      stmt(
        "DELETE FROM jobs WHERE status IN ('completed','failed') AND updated_at<?",
        now() - 30 * 86400000,
      ),
    );
    await db.batch(statements);
  }
  async function publish() {
    const rows = await stmt(
      "SELECT id FROM jobs WHERE status='pending' AND available_at<=? ORDER BY available_at,id LIMIT 100",
      now(),
    ).raw();
    if (rows.length) {
      await transport.sendBatch(
        rows.map((row) => ({ body: { jobId: String(row[0]) } })),
      );
    }
  }
  async function claim(id: string): Promise<Claim | undefined> {
    const token = crypto.randomUUID();
    const [row] = await stmt(
      "UPDATE jobs SET status='running',attempts=attempts+1,lock_token=?,locked_until=?,updated_at=? WHERE id=? AND status='pending' AND available_at<=? RETURNING id,payload,attempts",
      token,
      now() + LEASE_MS,
      now(),
      id,
      now(),
    ).raw();
    return row
      ? {
        id: String(row[0]),
        token,
        job: JSON.parse(String(row[1])) as Job,
        attempts: Number(row[2]),
      }
      : undefined;
  }
  function repositories(c: Claim) {
    return createD1Repositories(db, () => guard(c));
  }
  async function finish(c: Claim, failed = false) {
    const statements = [guard(c)];
    if (failed && c.job.type === "send_notification") {
      statements.push(
        stmt(
          "UPDATE deliveries SET status='failed',last_error='发送结果未知；任务执行异常，请手动重试',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='sending'",
          now(),
          c.job.deliveryId,
        ),
      );
    }
    statements.push(
      stmt(
        "UPDATE jobs SET status=?,available_at=?,locked_until=NULL,lock_token=NULL,last_error=?,updated_at=? WHERE id=? AND lock_token=?",
        failed ? (c.attempts >= 5 ? "failed" : "pending") : "completed",
        now() + 30000 * 2 ** (c.attempts - 1),
        failed ? "任务执行失败" : null,
        now(),
        c.id,
        c.token,
      ),
    );
    await db.batch(statements);
  }
  async function consume(
    message: QueueMessage,
    services: Omit<NotificationServices, "repositories" | "queue">,
    options: FetchOptions = {},
  ) {
    const body = message.body;
    if (
      !body || typeof body !== "object" || !("jobId" in body) ||
      typeof body.jobId !== "string" || !body.jobId || body.jobId.length > 128
    ) {
      message.ack();
      return;
    }
    let c: Claim | undefined;
    let heartbeat: Promise<unknown> = Promise.resolve();
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      c = await claim(body.jobId);
      if (!c) {
        const [row] = await stmt(
          "SELECT status,available_at FROM jobs WHERE id=?",
          body.jobId,
        ).raw();
        if (row?.[0] === "pending") {
          message.retry({
            delaySeconds: Math.min(
              86400,
              Math.max(1, Math.ceil((Number(row[1]) - now()) / 1000)),
            ),
          });
        } else message.ack();
        return;
      }
      const owned = c;
      timer = setInterval(() => {
        heartbeat = heartbeat.then(() =>
          db.batch([
            guard(owned),
            stmt(
              "UPDATE jobs SET locked_until=? WHERE id=? AND lock_token=?",
              now() + LEASE_MS,
              owned.id,
              owned.token,
            ),
          ])
        ).catch(() => {});
      }, LEASE_MS / 3);
      const queue: JobQueue = { enqueue: (job, at) => enqueue(job, at, owned) };
      await handleJob(
        {
          ...services,
          now,
          repositories: repositories(c),
          queue,
          assertActive: async () => {
            await db.batch([guard(owned)]);
          },
        },
        c.job,
        { ...options, now },
      );
      await finish(c);
      // 发送退避时，当前任务仍活跃导致 enqueue 合并；结束后补建下一轮任务。
      if (c.job.type === "send_notification") {
        const delivery = await createD1Repositories(db).deliveries.get(
          c.job.deliveryId,
        );
        if (delivery?.status === "pending") {
          await enqueue(c.job, delivery.nextAttemptAt ?? now());
        }
      }
      message.ack();
    } catch {
      if (c) {
        try {
          await finish(c, true);
        } catch { /* 租约已失效或数据库临时不可用，Cron 负责恢复。 */ }
      }
      message.retry({
        delaySeconds: Math.min(
          86400,
          30 * 2 ** Math.min((c?.attempts ?? 1) - 1, 10),
        ),
      });
    } finally {
      if (timer !== undefined) clearInterval(timer);
      await heartbeat;
    }
  }
  return { enqueue, recover, publish, claim, finish, repositories, consume };
}
