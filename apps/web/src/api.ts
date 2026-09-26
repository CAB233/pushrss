import { passwordAuthorization } from "../../../packages/shared/auth.ts";
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function createApi(
  password?: string,
  unauthorized: () => void = () => {},
  request: typeof fetch = fetch,
) {
  return async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(`/api${path}`, {
        method,
        signal,
        credentials: "same-origin",
        headers: {
          ...(password === undefined
            ? {}
            : { Authorization: passwordAuthorization(password) }),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("连接失败，请检查服务后重试");
    }
    if (response.status === 401) unauthorized();
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        data?.error?.message ?? `请求失败（${response.status}）`,
      );
    }
    return response.status === 204 ? undefined as T : await response.json();
  };
}
export async function createSession(
  password: string,
  request: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await request("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { Authorization: passwordAuthorization(password) },
    });
  } catch {
    throw new Error("连接失败，请检查服务后重试");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      data?.error?.message ?? `请求失败（${response.status}）`,
    );
  }
}
export async function deleteSession(
  request: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await request("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("连接失败，请检查服务后重试");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      data?.error?.message ?? `请求失败（${response.status}）`,
    );
  }
}
export type Api = ReturnType<typeof createApi>;
export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
}
export function safeLink(value: string | null): string | undefined {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
