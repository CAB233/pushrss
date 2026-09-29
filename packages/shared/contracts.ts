/** 时间统一为 UTC Unix 毫秒，抓取周期为秒。 */
export interface FeedItem {
  guid: string | null;
  title: string;
  link: string | null;
  content: string | null;
  summary: string | null;
  author: string | null;
  publishedAt: number | null;
}
export interface NotificationMessage {
  title: string;
  body: string;
  feedTitle?: string;
  publishedAt?: string | null;
  url?: string;
}
export type DeliveryResult = { ok: true; externalMessageId?: string } | {
  ok: false;
  error: string;
  retryable: boolean;
  outcome: "rejected" | "unknown";
  retryAfterSeconds?: number;
};
export type Job =
  | { type: "fetch_feed"; feedId: string }
  | {
    type: "send_notification";
    deliveryId: string;
  };
/** enqueue 成功意味着平台已持久化任务；消费者按至少一次执行设计。 */
export interface JobQueue {
  enqueue(job: Job, availableAt?: number): Promise<void>;
}
export interface Notifier<Config> {
  send(config: Config, message: NotificationMessage): Promise<DeliveryResult>;
}
/** context 绑定渠道 ID，防止密文在渠道之间被替换。 */
export interface SecretStore {
  encrypt(plaintext: string, context: string): Promise<string>;
  decrypt(envelope: string, context: string): Promise<string>;
}
