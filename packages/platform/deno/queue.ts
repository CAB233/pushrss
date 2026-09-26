import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createRepositories } from "../../db/repositories.ts";
import type { Job, JobQueue } from "../../shared/contracts.ts";
import type { NotificationServices } from "../../core/notifications.ts";
import { handleJob } from "../../core/jobs.ts";
import type { FetchOptions } from "../../core/fetch-feed.ts";
export interface ClaimedJob {
  id: string;
  token: string;
  job: Job;
  attempts: number;
}
const LEASE_MS = 60000;
export function createQueue(
  client: DatabaseSync,
  now: () => number = Date.now,
) {
  function transaction<T>(fn: () => T): T {
    client.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      client.exec("COMMIT");
      return value;
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
  function insert(job: Job, at: number) {
    client.prepare(
      `INSERT OR IGNORE INTO jobs(id,type,payload,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
    ).run(crypto.randomUUID(), job.type, JSON.stringify(job), at, now(), now());
  }
  const queue: JobQueue = {
    enqueue(job, at = now()) {
      transaction(() => {
        insert(job, at);
        if (job.type === "fetch_feed" && job.latestOnly) {
          client.prepare(
            "UPDATE jobs SET payload=json_set(payload,'$.latestOnly',json('true')),available_at=min(available_at,?),updated_at=? WHERE type='fetch_feed' AND status='pending' AND json_extract(payload,'$.feedId')=?",
          ).run(at, now(), job.feedId);
        }
      });
      return Promise.resolve();
    },
  };
  function owns(claim: ClaimedJob) {
    if (
      !client.prepare(
        "SELECT id FROM jobs WHERE id=? AND status='running' AND lock_token=? AND locked_until>?",
      ).get(claim.id, claim.token, now())
    ) throw new Error("任务租约已失效");
  }
  function recover() {
    transaction(() => {
      const expired = client.prepare(
        "SELECT id,payload FROM jobs WHERE status='running' AND locked_until<=?",
      ).all(now());
      for (const row of expired) {
        const job = JSON.parse(String(row.payload)) as Job;
        if (job.type === "send_notification") {
          client.prepare(
            "UPDATE deliveries SET status='failed',last_error='发送结果未知；任务执行中断，请手动重试',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='sending'",
          ).run(now(), job.deliveryId);
        }
        client.prepare(
          "UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL,lock_token=NULL,available_at=?,updated_at=?,last_error='任务租约过期' WHERE id=?",
        ).run(now(), now(), row.id);
      }
      // 文章与待分发标记由触发器同时保存；多渠道投递与移除标记在同一事务提交。
      const items = client.prepare(
        "SELECT item_id FROM notification_outbox LIMIT 100",
      ).all();
      for (const item of items) {
        const channels = client.prepare(
          `SELECT c.id FROM notification_channels c JOIN subscriptions s ON s.channel_id=c.id JOIN feed_items i ON i.feed_id=s.feed_id WHERE i.id=? AND c.enabled=1`,
        ).all(item.item_id);
        for (const channel of channels) {
          client.prepare(
            "INSERT OR IGNORE INTO deliveries(id,item_id,channel_id,created_at,updated_at,next_attempt_at) VALUES(?,?,?,?,?,?)",
          ).run(
            crypto.randomUUID(),
            item.item_id,
            channel.id,
            now(),
            now(),
            now(),
          );
        }
        client.prepare("DELETE FROM notification_outbox WHERE item_id=?").run(
          item.item_id,
        );
      }
      const pending = client.prepare(
        `SELECT d.id,d.next_attempt_at FROM deliveries d WHERE d.status='pending' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.type='send_notification' AND json_extract(j.payload,'$.deliveryId')=d.id AND j.status IN ('pending','running')) ORDER BY d.next_attempt_at LIMIT 100`,
      ).all();
      for (const d of pending) {
        insert(
          { type: "send_notification", deliveryId: String(d.id) },
          Number(d.next_attempt_at ?? now()),
        );
      }
      const due = client.prepare(
        `SELECT f.id FROM feeds f WHERE f.enabled=1 AND f.next_fetch_at<=? AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.type='fetch_feed' AND json_extract(j.payload,'$.feedId')=f.id AND j.status IN ('pending','running')) ORDER BY f.next_fetch_at LIMIT 100`,
      ).all(now());
      for (const f of due) {
        insert({ type: "fetch_feed", feedId: String(f.id) }, now());
      }
      client.prepare(
        "DELETE FROM jobs WHERE status IN ('completed','failed') AND updated_at<?",
      ).run(now() - 30 * 86400000);
    });
  }
  function claim(): ClaimedJob | undefined {
    return transaction(() => {
      const token = crypto.randomUUID();
      const row = client.prepare(
        `UPDATE jobs SET status='running',attempts=attempts+1,lock_token=?,locked_until=?,updated_at=? WHERE id=(SELECT id FROM jobs WHERE status='pending' AND available_at<=? ORDER BY available_at,id LIMIT 1) RETURNING id,payload,attempts`,
      ).get(token, now() + LEASE_MS, now(), now());
      return row
        ? {
          id: String(row.id),
          token,
          job: JSON.parse(String(row.payload)),
          attempts: Number(row.attempts),
        }
        : undefined;
    });
  }
  function finish(c: ClaimedJob, failed = false) {
    transaction(() => {
      owns(c);
      // 异常可能发生在外部发送之后；保持结果未知的保守处理。
      if (failed && c.job.type === "send_notification") {
        client.prepare(
          "UPDATE deliveries SET status='failed',last_error='发送结果未知；任务执行异常，请手动重试',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='sending'",
        ).run(now(), c.job.deliveryId);
      }
      client.prepare(
        "UPDATE jobs SET status=?,available_at=?,locked_until=NULL,lock_token=NULL,last_error=?,updated_at=? WHERE id=? AND lock_token=?",
      ).run(
        failed ? (c.attempts >= 5 ? "failed" : "pending") : "completed",
        now() + 30000 * 2 ** (c.attempts - 1),
        failed ? "任务执行失败" : null,
        now(),
        c.id,
        c.token,
      );
    });
  }
  function repositories(c: ClaimedJob) {
    // 每条 SQL 在事务内核对租约，阻止过期执行者写入新一轮任务状态。
    return createRepositories(
      drizzle((sql, params, method) =>
        Promise.resolve(transaction(() => {
          owns(c);
          const statement = client.prepare(sql);
          if (method === "run") {
            statement.run(...params);
            return { rows: [] };
          }
          if (method === "get") {
            const row = statement.get(...params);
            return { rows: row ? Object.values(row) : [] };
          }
          return { rows: statement.all(...params).map(Object.values) };
        }))
      ),
    );
  }
  async function consume(
    services: Omit<NotificationServices, "repositories" | "queue">,
    options: FetchOptions = {},
  ) {
    const c = claim();
    if (!c) return false;
    const timer = setInterval(() => {
      try {
        transaction(() => {
          owns(c);
          client.prepare(
            "UPDATE jobs SET locked_until=? WHERE id=? AND lock_token=?",
          ).run(now() + LEASE_MS, c.id, c.token);
        });
      } catch { /* 失去租约后仓储拒绝继续读写。 */ }
    }, LEASE_MS / 3);
    try {
      await handleJob(
        {
          ...services,
          repositories: repositories(c),
          assertActive: () => transaction(() => owns(c)),
          queue: {
            enqueue(job, at) {
              return transaction(() => {
                owns(c);
                return queue.enqueue(job, at);
              });
            },
          },
          now,
        },
        c.job,
        { ...options, now },
      );
      finish(c);
    } catch {
      try {
        finish(c, true);
      } catch { /* 新执行者负责租约过期恢复。 */ }
    } finally {
      clearInterval(timer);
    }
    return true;
  }
  return { ...queue, recover, claim, finish, repositories, consume };
}
