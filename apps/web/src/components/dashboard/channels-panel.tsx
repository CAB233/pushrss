import { useState } from "react";
import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import {
  api,
  CHANNEL_META,
  relativeTime,
  useChannels,
  useFeeds,
} from "../../lib/client.ts";
import type { Channel } from "../../lib/types.ts";
import { cn } from "../../lib/utils.ts";
import { ChannelDialog } from "./channel-dialog.tsx";
import { EmptyState } from "./empty-state.tsx";

export function ChannelsPanel() {
  const { data: channels, isLoading, error } = useChannels();
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="channels-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="channels-heading" className="text-sm text-muted-foreground">
          新内容会推送到已启用且已绑定的渠道。
        </h2>
        <Button
          onClick={() =>
            setOpen(true)}
        >
          <Plus aria-hidden="true" />
          添加渠道
        </Button>
      </div>

      {error
        ? (
          <p
            role="alert"
            className="py-10 text-center text-sm text-destructive"
          >
            {error.message}
          </p>
        )
        : isLoading
        ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        )
        : !channels?.length
        ? (
          <div className="rounded-lg border border-dashed border-border bg-card">
            <EmptyState
              title="还没有推送渠道"
              description="支持飞书、钉钉、企业微信、Telegram、Server酱³、Slack、Discord 以及任意自定义 Webhook。"
              action={
                <Button
                  variant="outline"
                  onClick={() => setOpen(true)}
                >
                  <Plus aria-hidden="true" />
                  添加第一个渠道
                </Button>
              }
            />
          </div>
        )
        : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((c) => <ChannelCard key={c.id} channel={c} />)}
          </ul>
        )}

      <ChannelDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

function ChannelCard({ channel }: { channel: Channel }) {
  const { data: feeds = [] } = useFeeds();
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const meta = CHANNEL_META[channel.type];
  const Icon = meta.icon;
  const feedCount =
    feeds.filter((f) => f.channelIds.includes(channel.id)).length;

  async function toggle(enabled: boolean) {
    await mutate<Channel[]>(
      "/api/channels",
      (list) => list?.map((c) => (c.id === channel.id ? { ...c, enabled } : c)),
      { revalidate: false },
    );
    try {
      await api(`/api/channels/${channel.id}`, {
        method: "PATCH",
        body: { enabled },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
    mutate("/api/channels");
  }

  async function test() {
    setTesting(true);
    try {
      await api(`/api/channels/${channel.id}/test`, { method: "POST" });
      toast.success(`测试消息已发送到「${channel.name}」`);
    } catch (err) {
      toast.error("测试推送失败", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setTesting(false);
      mutate("/api/channels");
      mutate("/api/stats");
      mutate("/api/logs");
    }
  }

  async function remove() {
    if (
      !globalThis.confirm(
        `确定删除渠道「${channel.name}」吗？相关绑定会一并移除。`,
      )
    ) return;
    try {
      await api(`/api/channels/${channel.id}`, { method: "DELETE" });
      toast.success("已删除渠道");
      mutate("/api/channels");
      mutate("/api/feeds");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-card p-4",
        !channel.enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{channel.name}</span>
            <span className="text-xs text-muted-foreground">{meta.label}</span>
          </div>
        </div>
        <Switch
          checked={channel.enabled}
          onCheckedChange={toggle}
          aria-label={`启用 ${channel.name}`}
        />
      </div>

      <p className="truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {channel.targetPreview}
      </p>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">绑定源</dt>
          <dd className="tabular-nums">{feedCount}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">已推送</dt>
          <dd className="tabular-nums">{channel.deliveredCount}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">最近</dt>
          <dd className="tabular-nums">
            {relativeTime(channel.lastDeliveryAt)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={test}
          disabled={testing || !channel.enabled}
        >
          {testing
            ? <Loader2 className="animate-spin" aria-hidden="true" />
            : <Send aria-hidden="true" />}
          发送测试
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(true)}
            aria-label={`编辑 ${channel.name}`}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={remove}
            aria-label={`删除 ${channel.name}`}
            className="hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ChannelDialog
        channel={channel}
        open={editing}
        onOpenChange={setEditing}
      />
    </li>
  );
}
