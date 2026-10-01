import { i18n } from "./i18n.ts";
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
      throw new Error(i18n.t("error.network"));
    }
    if (response.status === 401) unauthorized();
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        apiErrorMessage(data, response.status),
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
    throw new Error(i18n.t("error.network"));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      apiErrorMessage(data, response.status),
    );
  }
}
export function safeLink(value: string | null): string | undefined {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function apiErrorMessage(
  data: { error?: { code?: string; message?: string } } | null,
  status: number,
): string {
  const key = `error.${data?.error?.code}`;
  return i18n.exists(key)
    ? i18n.t(key)
    : data?.error?.message ?? i18n.t("error.request", { status });
}
