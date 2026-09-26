import { createNotifiers } from "../packages/notifier/mod.ts";
import { equal } from "./data-contract.ts";
export async function verifyNotifierProtocol() {
  const config = { botToken: "1:test", chatId: "@test" };
  const message = { title: "a_*<>&", body: "内容" };
  for (
    const [status, body, outcome] of [
      [400, { ok: false, description: "1:test" }, "rejected"],
      [401, {}, "rejected"],
      [500, {}, "unknown"],
      [200, {}, "unknown"],
      [200, { ok: false }, "rejected"],
    ] as const
  ) {
    const n = createNotifiers({
      fetch: (() =>
        Promise.resolve(Response.json(body, { status }))) as typeof fetch,
    });
    const result = await n.telegram.send(config, message);
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.outcome, outcome);
      equal(result.retryable, false);
      equal(result.error.includes("1:test"), false);
    }
  }
  const limited = createNotifiers({
    fetch: (() =>
      Promise.resolve(
        new Response("busy", {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      )) as typeof fetch,
  });
  const limit = await limited.serverchan.send(
    { sendKey: "sctp1tabc" },
    message,
  );
  if (limit.ok) throw new Error("预期限流");
  equal(limit.retryAfterSeconds, 120);
  for (const parseMode of [undefined, "HTML", "MarkdownV2"] as const) {
    const n = createNotifiers({
      fetch: ((_url, init) => {
        equal(new Request(_url, init).redirect, "manual");
        const payload = JSON.parse(init!.body as string);
        equal(payload.parse_mode, parseMode);
        equal(payload.link_preview_options.is_disabled, false);
        if (parseMode === "HTML") {
          equal(payload.text, "a_*&lt;&gt;&amp;\n\n内容");
        }
        if (parseMode === "MarkdownV2") {
          equal(payload.text, "a\\_\\*<\\>&\n\n内容");
        }
        return Promise.resolve(
          Response.json({ ok: true, result: { message_id: 1 } }),
        );
      }) as typeof fetch,
    });
    equal(
      (await n.telegram.send(
        { ...config, parseMode, disablePreview: false },
        message,
      )).ok,
      true,
    );
  }
  const timeout = createNotifiers({
    timeoutMs: 5,
    fetch: ((_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("secret")),
          { once: true },
        );
      })) as typeof fetch,
  });
  const result = await timeout.telegram.send(config, message);
  if (result.ok) throw new Error("预期超时");
  equal(result.outcome, "unknown");
  equal(result.retryable, false);
  equal(result.error, "通知请求超时，发送结果未知");

  const redirect = createNotifiers({
    fetch: ((_url, init) => {
      equal(init?.redirect, "manual");
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/redirect" },
        }),
      );
    }) as typeof fetch,
  });
  const redirected = await redirect.telegram.send(config, message);
  if (redirected.ok) throw new Error("预期重定向失败");
  equal(redirected.error, "通知服务返回重定向（HTTP 302），发送结果未知");
  equal(redirected.outcome, "unknown");

  const originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const broken = createNotifiers({
      fetch: (() =>
        Promise.reject(
          new TypeError("https://api.telegram.org/bot1:test/sendMessage", {
            cause: { code: "ECONNRESET" },
          }),
        )) as typeof fetch,
    });
    const failed = await broken.telegram.send(config, message);
    if (failed.ok) throw new Error("预期连接失败");
    equal(failed.error, "通知连接失败，发送结果未知");
    equal(JSON.stringify(logs).includes("1:test"), false);
    equal(JSON.stringify(logs).includes("ECONNRESET"), true);
  } finally {
    console.error = originalError;
  }
}
