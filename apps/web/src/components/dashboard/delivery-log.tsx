import { useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { api, CHANNEL_META, relativeTime, useLogs } from "../../lib/client.ts";
import { safeLink } from "../../api.ts";
import { EmptyState } from "./empty-state.tsx";

export function DeliveryLogPanel() {
  const { data: logs, isLoading, error, mutate } = useLogs();
  const [clearing, setClearing] = useState(false);

  async function clear() {
    if (!globalThis.confirm("确定清空全部推送记录吗？")) return;
    setClearing(true);
    try {
      await api("/api/logs", { method: "DELETE" });
      await mutate();
      toast.success("推送记录已清空");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "清空失败");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section aria-labelledby="logs-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="logs-heading" className="text-sm text-muted-foreground">
          最近 100 条推送记录，每 15 秒自动刷新。
        </h2>
        {!!logs?.length && (
          <Button
            variant="outline"
            size="sm"
            disabled={clearing}
            onClick={clear}
          >
            {clearing && (
              <Loader2
                data-icon="inline-start"
                aria-hidden="true"
                className="animate-spin"
              />
            )}
            清空记录
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {error
          ? (
            <p
              role="alert"
              className="px-4 py-10 text-center text-sm text-destructive"
            >
              {error.message}
            </p>
          )
          : isLoading
          ? (
            <p
              role="status"
              className="px-4 py-10 text-center text-sm text-muted-foreground"
            >
              加载中…
            </p>
          )
          : !logs?.length
          ? (
            <EmptyState
              title="暂无推送记录"
              description="订阅源推送新内容或发送测试消息后，记录会出现在这里。"
            />
          )
          : (
            <ol className="divide-y divide-border">
              {logs.map((log) => {
                const Icon = CHANNEL_META[log.channelType].icon;
                const link = safeLink(log.itemLink);
                return (
                  <li key={log.id} className="flex items-start gap-3 px-4 py-3">
                    <Badge
                      variant={log.ok ? "secondary" : "destructive"}
                      className="mt-0.5 size-5 p-0"
                    >
                      {log.ok
                        ? <Check aria-hidden="true" />
                        : <X aria-hidden="true" />}
                      <span className="sr-only">
                        {log.ok ? "成功" : "失败"}
                      </span>
                    </Badge>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {link
                        ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-sm hover:underline"
                            title={log.itemTitle}
                          >
                            {log.itemTitle}
                          </a>
                        )
                        : (
                          <p className="truncate text-sm" title={log.itemTitle}>
                            {log.itemTitle}
                          </p>
                        )}
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="max-w-40 truncate"
                          title={log.feedTitle}
                        >
                          {log.feedTitle}
                        </span>
                        <ArrowRight className="size-3" aria-hidden="true" />
                        <Icon className="size-3" aria-hidden="true" />
                        <span
                          className="max-w-40 truncate"
                          title={log.channelName}
                        >
                          {log.channelName}
                        </span>
                      </p>
                      {log.error && (
                        <p className="break-words font-mono text-xs text-destructive">
                          {log.error}
                        </p>
                      )}
                    </div>
                    <time
                      dateTime={log.at}
                      title={new Date(log.at).toLocaleString("zh-CN")}
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    >
                      {relativeTime(log.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
      </div>
    </section>
  );
}
