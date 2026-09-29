import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import {
  api,
  CHANNEL_META,
  relativeTime,
  useChannels,
} from "../../lib/client.ts";
import type { Feed, RefreshResult } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";
import { StatusDot } from "./status-dot.tsx";

export function FeedRow({ feed, onEdit }: { feed: Feed; onEdit: () => void }) {
  const { data: channels = [] } = useChannels();
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const bound = channels.filter((c) => feed.channelIds.includes(c.id));
  const panelId = `feed-items-${feed.id}`;

  async function toggleEnabled(enabled: boolean) {
    await mutate<Feed[]>(
      "/api/feeds",
      (list) => list?.map((f) => (f.id === feed.id ? { ...f, enabled } : f)),
      { revalidate: false },
    );
    try {
      await api(`/api/feeds/${feed.id}`, {
        method: "PATCH",
        body: { enabled },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
    mutate("/api/feeds");
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await api<RefreshResult>(`/api/feeds/${feed.id}/refresh`, {
        method: "POST",
      });
      if (r.ok) toast.success(`「${feed.title}」已提交抓取任务`);
      else toast.error("抓取失败", { description: r.error });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
      mutate("/api/feeds");
      mutate("/api/channels");
      mutate("/api/stats");
    }
  }

  async function remove() {
    if (!globalThis.confirm(`确定删除「${feed.title}」吗？`)) return;
    try {
      await api(`/api/feeds/${feed.id}`, { method: "DELETE" });
      toast.success("已删除订阅源");
      mutate("/api/feeds");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <li className={cn(!feed.enabled && "bg-muted/40")}>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 px-4 py-3 md:grid-cols-[1fr_9rem_7rem_6rem_auto]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="col-span-2 flex min-w-0 items-start gap-3 text-left md:col-span-1"
        >
          <StatusDot status={feed.status} className="mt-1.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "truncate font-medium",
                  !feed.enabled && "text-muted-foreground",
                )}
              >
                {feed.title}
              </span>
              <Badge variant="secondary" className="shrink-0 font-normal">
                {feed.category}
              </Badge>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {feed.url}
            </span>
            {feed.status === "error" && feed.lastError && (
              <span className="text-xs text-destructive">{feed.lastError}</span>
            )}
            {feed.keywords.length > 0 && (
              <span className="truncate text-xs text-accent-foreground">
                过滤：{feed.keywords.join(" / ")}
              </span>
            )}
          </span>
        </button>

        <div
          className="flex flex-wrap items-center gap-1"
          aria-label="已绑定渠道"
        >
          {bound.length === 0
            ? <span className="text-xs text-muted-foreground">未绑定</span>
            : (
              bound.map((c) => {
                const Icon = CHANNEL_META[c.type].icon;
                return (
                  <span
                    key={c.id}
                    title={c.name}
                    className={cn(
                      "flex size-6 items-center justify-center rounded border border-border bg-background",
                      !c.enabled && "opacity-40",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">{c.name}</span>
                  </span>
                );
              })
            )}
        </div>

        <span className="hidden text-xs tabular-nums text-muted-foreground md:block">
          {relativeTime(feed.lastFetchedAt)}
        </span>

        <div className="hidden md:block">
          <Switch
            checked={feed.enabled}
            onCheckedChange={toggleEnabled}
            aria-label={`启用 ${feed.title}`}
          />
        </div>

        <div className="col-span-2 flex items-center justify-between gap-1 md:col-span-1 md:w-24 md:justify-end">
          <div className="flex items-center gap-2 md:hidden">
            <Switch
              checked={feed.enabled}
              onCheckedChange={toggleEnabled}
              aria-label={`启用 ${feed.title}`}
            />
            <span className="text-xs tabular-nums text-muted-foreground">
              {relativeTime(feed.lastFetchedAt)}
            </span>
          </div>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={refresh}
              disabled={refreshing}
              aria-label="立即抓取"
            >
              <RefreshCw
                className={cn(refreshing && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label="编辑"
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={remove}
              aria-label="删除"
              className="hover:text-destructive"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="border-t border-dashed border-border bg-background/60 px-4 py-3 md:pl-9"
        >
          {feed.latestItems.length === 0
            ? (
              <p className="text-sm text-muted-foreground">
                暂无内容，点击刷新按钮抓取。
              </p>
            )
            : (
              <ol className="flex flex-col gap-2">
                {feed.latestItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-4 text-sm"
                  >
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-w-0 items-center gap-1.5 hover:text-primary"
                    >
                      <span className="truncate">{item.title}</span>
                      <ExternalLink
                        className="size-3 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </a>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {relativeTime(item.publishedAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            共 {feed.itemCount} 条 · 显示最新 5 条
          </p>
        </div>
      )}
    </li>
  );
}
