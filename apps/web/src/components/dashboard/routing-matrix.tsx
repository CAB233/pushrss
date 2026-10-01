import { useRef, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Checkbox } from "../ui/checkbox.tsx";
import { api, CHANNEL_META, useChannels, useFeeds } from "../../lib/client.ts";
import type { Feed } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";
import { EmptyState } from "./empty-state.tsx";
import { StatusDot } from "./status-dot.tsx";

export function RoutingMatrix() {
  const { data: feeds = [], isLoading: feedsLoading, error: feedsError } =
    useFeeds();
  const {
    data: channels = [],
    isLoading: channelsLoading,
    error: channelsError,
  } = useChannels();

  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);

  async function setBinding(feed: Feed, channelId: string, on: boolean) {
    if (pending.current.has(feed.id)) return;
    pending.current.add(feed.id);
    setBusy(true);
    const channelIds = on
      ? [...feed.channelIds, channelId]
      : feed.channelIds.filter((id) => id !== channelId);
    try {
      await mutate<Feed[]>(
        "/api/feeds",
        (list) =>
          list?.map((f) => (f.id === feed.id ? { ...f, channelIds } : f)),
        { revalidate: false },
      );
      await api(`/api/feeds/${feed.id}`, {
        method: "PATCH",
        body: { channelIds },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      try {
        await mutate("/api/feeds");
      } finally {
        pending.current.delete(feed.id);
        setBusy(pending.current.size > 0);
      }
    }
  }

  async function setColumn(channelId: string, on: boolean) {
    const targets = feeds.filter((f) =>
      f.channelIds.includes(channelId) !== on
    );
    await Promise.all(targets.map((f) => setBinding(f, channelId, on)));
  }

  if (feedsError || channelsError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-destructive">
        {(feedsError ?? channelsError).message}
      </p>
    );
  }
  if (feedsLoading || channelsLoading) {
    return (
      <p
        role="status"
        className="py-10 text-center text-sm text-muted-foreground"
      >
        加载中…
      </p>
    );
  }

  if (feeds.length === 0 || channels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card">
        <EmptyState
          title="路由矩阵需要订阅源和渠道"
          description="至少添加一个订阅源和一个推送渠道后，就能在这里一眼看清、一键调整每条推送路线。"
        />
      </div>
    );
  }

  return (
    <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-56 bg-muted px-4 py-3 text-left text-xs font-normal text-muted-foreground"
              >
                订阅源 ╲ 渠道
              </th>
              {channels.map((c) => {
                const Icon = CHANNEL_META[c.type].icon;
                const all = feeds.every((f) =>
                  f.channelIds.includes(c.id)
                );
                return (
                  <th
                    key={c.id}
                    scope="col"
                    className="min-w-24 border-l border-border px-2 py-2 font-normal"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setColumn(c.id, !all)}
                      className={cn(
                        "flex w-full flex-col items-center gap-1 rounded-md px-1 py-1 hover:bg-background",
                        !c.enabled && "opacity-50",
                      )}
                      title={all ? "整列取消" : "整列勾选"}
                    >
                      <Icon
                        className="size-4 text-accent-foreground"
                        aria-hidden="true"
                      />
                      <span className="max-w-24 truncate text-xs">
                        {c.name}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {feeds.map((f) => (
              <tr
                key={f.id}
                className="border-b border-border last:border-b-0 hover:bg-accent/40"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <StatusDot status={f.status} />
                    <span
                      className={cn(
                        "max-w-52 truncate",
                        !f.enabled && "text-muted-foreground line-through",
                      )}
                    >
                      {f.title}
                    </span>
                  </span>
                </th>
                {channels.map((c) => {
                  const on = f.channelIds.includes(c.id);
                  return (
                    <td
                      key={c.id}
                      className={cn(
                        "border-l border-border text-center",
                        on && "bg-accent/70",
                      )}
                    >
                      <label className="flex h-11 cursor-pointer items-center justify-center">
                        <Checkbox
                          disabled={busy}
                          checked={on}
                          onCheckedChange={(v) =>
                            setBinding(f, c.id, v === true)}
                          aria-label={`${f.title} → ${c.name}`}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
