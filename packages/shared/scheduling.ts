export const DEFAULT_FETCH_INTERVAL_SECONDS = 30 * 60;

export interface SchedulingEnv {
  PUSHRSS_FETCH_INTERVAL_MINUTES?: string;
  PUSHRSS_CHECK_INTERVAL_MINUTES?: string;
}

export interface SchedulingConfig {
  /** 显式配置时同步已有订阅源；省略时沿用数据库中的周期。 */
  fetchIntervalSeconds?: number;
  checkIntervalMs: number;
}

export interface FeedScanOptions {
  scanFeeds?: boolean;
  fetchIntervalSeconds?: number;
}

function minutes(value: string | undefined, name: string) {
  const text = value?.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  if (
    !/^\d+$/.test(text) || !Number.isSafeInteger(parsed) || parsed <= 0 ||
    !Number.isSafeInteger(parsed * 60_000)
  ) {
    throw new Error(`${name} 必须是正整数分钟`);
  }
  return parsed;
}

/** 标准字符串环境变量解析，供 Deno 与 Workers 共用。 */
export function readSchedulingConfig(env: SchedulingEnv): SchedulingConfig {
  const fetchMinutes = minutes(
    env.PUSHRSS_FETCH_INTERVAL_MINUTES,
    "PUSHRSS_FETCH_INTERVAL_MINUTES",
  );
  const checkMinutes = minutes(
    env.PUSHRSS_CHECK_INTERVAL_MINUTES,
    "PUSHRSS_CHECK_INTERVAL_MINUTES",
  ) ?? 1;
  return {
    fetchIntervalSeconds: fetchMinutes === undefined
      ? undefined
      : fetchMinutes * 60,
    checkIntervalMs: checkMinutes * 60_000,
  };
}
