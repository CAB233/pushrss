import type {
  DeliveryResult,
  NotificationMessage,
  Notifier,
} from "../shared/contracts.ts";
export type ChannelType = "serverchan" | "telegram";
export interface ServerchanConfig {
  sendKey: string;
}
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  threadId?: number;
  parseMode?: "HTML" | "MarkdownV2";
  disablePreview?: boolean;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
export function validateConfig(
  type: ChannelType,
  value: unknown,
): ServerchanConfig | TelegramConfig {
  const c = object(value);
  if (
    type === "serverchan" && typeof c.sendKey === "string" &&
    /^sctp\d+t[A-Za-z0-9_-]+$/.test(c.sendKey)
  ) return { sendKey: c.sendKey };
  if (
    type === "telegram" && typeof c.botToken === "string" &&
    /^\d+:[A-Za-z0-9_-]+$/.test(c.botToken) && typeof c.chatId === "string" &&
    /^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(c.chatId) &&
    (c.threadId === undefined ||
      (Number.isSafeInteger(c.threadId) && (c.threadId as number) > 0)) &&
    (c.parseMode === undefined || c.parseMode === "HTML" ||
      c.parseMode === "MarkdownV2") &&
    (c.disablePreview === undefined || typeof c.disablePreview === "boolean")
  ) {
    return {
      botToken: c.botToken,
      chatId: c.chatId,
      threadId: c.threadId as number | undefined,
      parseMode: c.parseMode as TelegramConfig["parseMode"],
      disablePreview: c.disablePreview as boolean | undefined,
    };
  }
  throw new Error("渠道配置无效");
}
export function failure(
  error: string,
  retryable = false,
  outcome: "rejected" | "unknown" = "rejected",
  retryAfterSeconds?: number,
): DeliveryResult {
  return { ok: false, error, retryable, outcome, retryAfterSeconds };
}
function diagnostic(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: "unknown" };
  const name = ["TypeError", "AbortError", "Error"].includes(error.name)
    ? error.name
    : "other";
  const cause = object(error.cause);
  const code = cause.code;
  return {
    name,
    code: typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)
      ? code
      : undefined,
  };
}
/** 上游错误正文可能包含凭据，统一转换为固定诊断。 */
export function createNotifiers(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Record<ChannelType, Notifier<unknown>> {
  const request = options.fetch ?? globalThis.fetch;
  const timeout = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("通知超时参数无效");
  }
  async function send(
    type: ChannelType,
    config: unknown,
    message: NotificationMessage,
  ): Promise<DeliveryResult> {
    let c: ServerchanConfig | TelegramConfig;
    try {
      c = validateConfig(type, config);
    } catch {
      return failure("渠道配置无效");
    }
    let url: string;
    let payload: Record<string, unknown>;
    const text = [message.title, message.body, message.url].filter(Boolean)
      .join("\n\n");
    if ("sendKey" in c) {
      const shard = /^sctp(\d+)t/.exec(c.sendKey)![1];
      url = `https://${shard}.push.ft07.com/send/${c.sendKey}.send`;
      payload = {
        title: message.title,
        desp: [message.body, message.url].filter(Boolean).join("\n\n"),
      };
    } else {
      // 先按 UTF-16 长度截断，再转义；保留单次投递语义。
      let safe = text.slice(0, 4000).replace(/[\uD800-\uDBFF]$/, "");
      if (c.parseMode === "HTML") {
        safe = safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
          />/g,
          "&gt;",
        );
      }
      if (c.parseMode === "MarkdownV2") {
        safe = safe.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
      }
      url = `https://api.telegram.org/bot${c.botToken}/sendMessage`;
      payload = {
        chat_id: c.chatId,
        text: safe,
        message_thread_id: c.threadId,
        parse_mode: c.parseMode,
        link_preview_options: { is_disabled: c.disablePreview ?? true },
      };
    }
    if (!message.title.trim()) return failure("通知标题为空");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await request(url, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        return failure(
          `通知服务返回重定向（HTTP ${response.status}），发送结果未知`,
          false,
          "unknown",
        );
      }
      let data: Record<string, unknown> = {};
      try {
        data = object(await response.json());
      } catch { /* 根据 HTTP 状态判定 */ }
      const code = type === "telegram" ? data.error_code : data.code;
      const limited = response.status === 429 || code === 429;
      if (limited) {
        const raw = object(data.parameters).retry_after ??
          response.headers.get("Retry-After");
        const seconds = Number(raw);
        return failure(
          "通知渠道限流",
          true,
          "rejected",
          Number.isFinite(seconds) && seconds > 0 && seconds <= 2147483
            ? Math.ceil(seconds)
            : undefined,
        );
      }
      if (response.status >= 500 || response.status === 408) {
        return failure("通知服务异常，发送结果未知", false, "unknown");
      }
      if (!response.ok) return failure(`通知服务 HTTP ${response.status}`);
      if (type === "serverchan" && code === 0) return { ok: true };
      const result = object(data.result);
      if (
        type === "telegram" && data.ok === true &&
        Number.isSafeInteger(result.message_id)
      ) return { ok: true, externalMessageId: String(result.message_id) };
      if (
        (type === "serverchan" && typeof code === "number" && code !== 0) ||
        (type === "telegram" && data.ok === false)
      ) return failure("通知渠道拒绝请求");
      return failure("通知响应无效，发送结果未知", false, "unknown");
    } catch (error) {
      const timedOut = abort.signal.aborted;
      console.error("通知出站请求失败", {
        channel: type,
        category: timedOut ? "timeout" : "connection",
        ...diagnostic(error),
      });
      return failure(
        timedOut ? "通知请求超时，发送结果未知" : "通知连接失败，发送结果未知",
        false,
        "unknown",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    serverchan: { send: (c, m) => send("serverchan", c, m) },
    telegram: { send: (c, m) => send("telegram", c, m) },
  };
}
