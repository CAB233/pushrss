import { useState } from "react";
import { RefreshCw, Rss } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "../ui/button.tsx";
import { api, useChannels, useFeeds, useStats } from "../../lib/client.ts";
import type { RefreshResult } from "../../lib/types.ts";

export function AppHeader() {
  const { data: feeds } = useFeeds();
  const { data: channels } = useChannels();
  const { data: stats } = useStats();
  const [refreshing, setRefreshing] = useState(false);
  const pushedToday = stats?.sentToday ?? 0;
  const failing = feeds?.filter((f) => f.status === "error").length ?? 0;

  async function refreshAll() {
    setRefreshing(true);
    try {
      const results = await api<RefreshResult[]>("/api/feeds/refresh-all", {
        method: "POST",
      });
      toast.success(`已提交 ${results.length} 个订阅源的抓取任务`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
      mutate("/api/feeds");
      mutate("/api/channels");
      mutate("/api/stats");
    }
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Rss className="size-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold leading-tight">PushRSS</h1>
            <p className="text-xs tabular-nums text-muted-foreground">
              {feeds?.length ?? "–"} 源 · {channels?.length ?? "–"}{" "}
              渠道 · 今日推送 {pushedToday}
              {failing > 0 && (
                <span className="text-destructive">· {failing} 源异常</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button onClick={refreshAll} disabled={refreshing}>
            <RefreshCw
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            {refreshing ? "正在抓取…" : "立即抓取全部"}
          </Button>
        </div>
      </div>
    </header>
  );
}
