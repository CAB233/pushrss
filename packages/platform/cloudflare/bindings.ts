/** 仅声明适配层实际使用的 Workers 绑定，便于在 SQLite 上执行相同契约。 */
export interface D1Result {
  results: Record<string, unknown>[];
}
export interface D1Statement {
  bind(...params: unknown[]): D1Statement;
  raw(): Promise<unknown[][]>;
  run(): Promise<unknown>;
}
export interface D1Binding {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}
export interface QueueEnvelope {
  jobId: string;
}
export interface QueueBinding {
  send(
    body: QueueEnvelope,
    options?: { delaySeconds: number },
  ): Promise<unknown>;
  sendBatch(
    messages: { body: QueueEnvelope; delaySeconds?: number }[],
  ): Promise<unknown>;
}
export interface QueueMessage {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds: number }): void;
}
export interface QueueBatch {
  messages: readonly QueueMessage[];
}
export interface WorkerEnv {
  DB?: D1Binding;
  JOB_QUEUE?: QueueBinding;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  PUSHRSS_MASTER_KEY?: string;
  PUSHRSS_ADMIN_PASSWORD?: string;
  PUSHRSS_ADMIN_TOKEN?: string;
}
