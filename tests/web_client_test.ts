import {
  ApiError,
  createApi,
  createSession,
  safeLink,
} from "../apps/web/src/api.ts";
Deno.test("管理客户端认证、错误、无内容响应及安全链接", async () => {
  let expired = false;
  const api = createApi(
    "test",
    () => {
      expired = true;
    },
    ((_url, init) => {
      if (
        (init?.headers as Record<string, string>).Authorization !==
          "Basic YWRtaW46dGVzdA=="
      ) throw new Error("缺少认证");
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "密码错误" } }), {
          status: 401,
        }),
      );
    }) as typeof fetch,
  );
  try {
    await api("/status");
    throw new Error("预期认证失败");
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !expired) throw e;
  }
  const empty = createApi(
    "test",
    () => {},
    (() =>
      Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch,
  );
  if (await empty("/feeds/a", "DELETE") !== undefined) {
    throw new Error("无内容响应错误");
  }
  const calls: string[] = [];
  const sessionRequest = ((_url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push(`${init?.method}:${headers?.Authorization ?? "cookie"}`);
    if (init?.credentials !== "same-origin") {
      throw new Error("会话请求未携带同源凭据");
    }
    return Promise.resolve(
      new Response(init?.method === "DELETE" ? null : "{}", {
        status: init?.method === "DELETE" ? 204 : 200,
      }),
    );
  }) as typeof fetch;
  await createSession("中文密码", sessionRequest);
  await createApi(undefined, () => {}, sessionRequest)("/status");
  if (
    calls[0] !== "POST:Basic YWRtaW46" +
        btoa(String.fromCharCode(...new TextEncoder().encode("中文密码"))) ||
    calls[1] !== "GET:cookie"
  ) throw new Error("会话请求认证方式错误");
  for (
    const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      null,
      "/relative",
    ]
  ) if (safeLink(value)) throw new Error("危险链接未拦截");
  if (safeLink("https://example.com") !== "https://example.com/") {
    throw new Error("合法链接错误");
  }
});
