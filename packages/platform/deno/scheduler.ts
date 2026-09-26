/** 单次任务完成后等待下一轮，避免慢任务重叠；AbortSignal 控制退出。 */
export async function runScheduler(
  tick: () => Promise<void>,
  intervalMs: number,
  signal: AbortSignal,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("调度间隔必须为正数");
  }
  while (!signal.aborted) {
    try {
      await tick();
    } catch (error) {
      onError(error);
    }
    if (signal.aborted) break;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, intervalMs);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }
}
