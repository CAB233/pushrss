import type { Context } from "hono";
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 502 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function invalid(): never {
  throw new ApiError(400, "INVALID_INPUT", "请求参数无效");
}
export function string(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    invalid();
  }
  return value.trim();
}
export function interval(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 60 ||
    value > 2592000
  ) invalid();
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
export function feedUrl(value: unknown): string {
  const text = string(value, 2048);
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) || url.username ||
      url.password || url.hash
    ) invalid();
    return url.href;
  } catch {
    return invalid();
  }
}
export function pagination(c: Context): [number, number] {
  const read = (key: string, fallback: number) => {
    const v = c.req.query(key);
    if (v === undefined) return fallback;
    if (!/^\d+$/.test(v)) invalid();
    return Number(v);
  };
  const limit = read("limit", 50), offset = read("offset", 0);
  if (!Number.isSafeInteger(offset) || limit < 1 || limit > 100) invalid();
  return [limit, offset];
}
export async function body(
  c: Context,
  keys: string[],
): Promise<Record<string, unknown>> {
  if (
    c.req.header("content-type")?.split(";")[0].trim() !== "application/json"
  ) throw new ApiError(415, "JSON_REQUIRED", "请使用 application/json");
  const reader = c.req.raw.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "请求体超过 16 KiB");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let value;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  ) invalid();
  return value;
}
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new ApiError(404, "NOT_FOUND", "资源不存在");
  return value;
}
