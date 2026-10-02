import { useState } from "react";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { CategoryInput } from "./category-input.tsx";
import {
  api,
  CHANNEL_META,
  parseKeywords,
  useChannels,
} from "../../lib/client.ts";
import type { Feed } from "../../lib/types.ts";

interface PreviewResult {
  title: string;
  itemCount: number;
  items: { title: string }[];
}

interface FeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feed?: Feed | null;
  categories: readonly string[];
}

export function FeedDialog({
  open,
  onOpenChange,
  feed,
  categories,
}: FeedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open && (
          <FeedForm
            key={feed?.id ?? "new"}
            feed={feed ?? null}
            categories={categories}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FeedForm({ feed, onDone, categories }: {
  feed: Feed | null;
  onDone: () => void;
  categories: readonly string[];
}) {
  const isEdit = Boolean(feed);
  const { data: channels = [] } = useChannels();
  const [url, setUrl] = useState(feed?.url ?? "");
  const [title, setTitle] = useState(feed?.title ?? "");
  const [category, setCategory] = useState(feed?.category ?? "");
  const [keywords, setKeywords] = useState(feed?.keywords.join("，") ?? "");
  const [notificationLimit, setNotificationLimit] = useState(
    String(feed?.notificationLimit ?? 10),
  );
  const [channelIds, setChannelIds] = useState<string[]>(
    feed?.channelIds ?? [],
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkUrl() {
    if (!url.trim()) return;
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const result = await api<PreviewResult>("/api/feeds/preview", {
        method: "POST",
        body: { url },
      });
      setPreview(result);
      if (!title) setTitle(result.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "检测失败");
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      title,
      category,
      keywords: parseKeywords(keywords),
      channelIds,
      ...(isEdit ? { notificationLimit: Number(notificationLimit) } : {}),
    };
    try {
      if (feed) {
        await api(`/api/feeds/${feed.id}`, { method: "PATCH", body });
        toast.success("订阅源已更新");
      } else {
        const created = await api<Feed>("/api/feeds", {
          method: "POST",
          body: { ...body, url },
        });
        if (created.status === "error") {
          toast.warning("已添加，但首次抓取失败", {
            description: created.lastError ?? undefined,
          });
        } else {toast.success("订阅源已添加", {
            description:
              `已建立基线，共 ${created.itemCount} 条，后续新内容将自动推送`,
          });}
      }
      await mutate("/api/feeds");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleChannel(id: string, checked: boolean) {
    setChannelIds((
      prev,
    ) => (checked ? [...prev, id] : prev.filter((c) => c !== id)));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{isEdit ? "编辑订阅源" : "添加订阅源"}</DialogTitle>
        <DialogDescription>
          支持 RSS 2.0、RSS 1.0 (RDF) 与 Atom 格式。
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="feed-url">订阅地址</Label>
        <div className="flex gap-2">
          <Input
            id="feed-url"
            type="url"
            required
            disabled={isEdit}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            placeholder="https://example.com/feed.xml"
            className="font-mono text-sm"
          />
          {!isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={checkUrl}
              disabled={checking || !url.trim()}
            >
              {checking
                ? <Loader2 className="animate-spin" aria-hidden="true" />
                : <Search aria-hidden="true" />}
              检测
            </Button>
          )}
        </div>
        {preview && (
          <div className="flex flex-col gap-1 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
            <p className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {preview.title || "未命名订阅"} · {preview.itemCount} 条内容
            </p>
            {preview.items[0] && (
              <p className="truncate text-xs opacity-80">
                最新：{preview.items[0].title}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="feed-title">名称</Label>
          <Input
            id="feed-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="留空则使用订阅标题"
            required={isEdit}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="feed-category">分类</Label>
          <CategoryInput
            id="feed-category"
            value={category}
            onChange={setCategory}
            categories={categories}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="feed-keywords">关键词过滤</Label>
        <Input
          id="feed-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="用逗号分隔，留空则推送全部"
        />
        <p className="text-xs text-muted-foreground">
          仅当标题或摘要包含任一关键词时才推送。
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">推送到</legend>
        {channels.length === 0
          ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              还没有推送渠道，可先保存，稍后在「推送渠道」中添加。
            </p>
          )
          : (
            <div className="grid gap-2 sm:grid-cols-2">
              {channels.map((c) => {
                const Icon = CHANNEL_META[c.type].icon;
                return (
                  <Label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
                  >
                    <Checkbox
                      checked={channelIds.includes(c.id)}
                      onCheckedChange={(v) => toggleChannel(c.id, v === true)}
                    />
                    <Icon
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">{c.name}</span>
                  </Label>
                );
              })}
            </div>
          )}
      </fieldset>

      {isEdit && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="feed-notification-limit">推送数量上限</Label>
          <Input
            id="feed-notification-limit"
            type="number"
            min={1}
            max={10}
            step={1}
            required
            value={notificationLimit}
            onChange={(e) => setNotificationLimit(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isEdit ? "保存" : "添加并抓取"}
        </Button>
      </DialogFooter>
    </form>
  );
}
