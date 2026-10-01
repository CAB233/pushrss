import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { useFeeds } from "../../lib/client.ts";
import type { Feed } from "../../lib/types.ts";
import { EmptyState } from "./empty-state.tsx";
import { FeedDialog } from "./feed-dialog.tsx";
import { FeedRow } from "./feed-row.tsx";

export function FeedsPanel() {
  const { data: feeds, isLoading, error } = useFeeds();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Feed | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(feeds?.map((f) => f.category) ?? [])),
    [feeds],
  );
  const activeCategory = category !== null && categories.includes(category)
    ? category
    : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (feeds ?? []).filter(
      (f) =>
        (activeCategory === null || f.category === activeCategory) &&
        (!q || f.title.toLowerCase().includes(q) ||
          f.url.toLowerCase().includes(q)),
    );
  }, [feeds, query, activeCategory]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(feed: Feed) {
    setEditing(feed);
    setDialogOpen(true);
  }

  return (
    <section aria-labelledby="feeds-heading" className="flex flex-col gap-4">
      <h2 id="feeds-heading" className="sr-only">
        订阅源
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) =>
              setQuery(e.target.value)}
            placeholder="搜索名称或地址"
            aria-label="搜索订阅源"
            className="bg-card pl-8"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          添加订阅源
        </Button>
      </div>

      {categories.length > 0 && (
        <div
          role="group"
          className="flex flex-wrap items-center gap-2"
          aria-label="按分类筛选"
        >
          <Badge
            asChild
            variant={activeCategory === null ? "default" : "outline"}
            className="cursor-pointer px-3 py-1 text-sm"
          >
            <button
              type="button"
              aria-pressed={activeCategory === null}
              onClick={() => setCategory(null)}
            >
              全部
            </button>
          </Badge>
          {categories.map((c) => (
            <Badge
              key={c}
              asChild
              variant={activeCategory === c ? "default" : "outline"}
              className="cursor-pointer px-3 py-1 text-sm"
            >
              <button
                type="button"
                aria-pressed={activeCategory === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[1fr_9rem_7rem_6rem_auto] items-center gap-4 border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground md:grid">
          <span>订阅源</span>
          <span>推送渠道</span>
          <span>上次抓取</span>
          <span>启用</span>
          <span className="w-24 text-right">操作</span>
        </div>
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
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          )
          : visible.length === 0
          ? (
            <EmptyState
              title={feeds?.length ? "没有匹配的订阅源" : "还没有订阅源"}
              description={feeds?.length
                ? "调整分类或搜索关键词试试。"
                : "添加第一个 RSS 或 Atom 地址，开始追踪更新。"}
            />
          )
          : (
            <ul className="divide-y divide-border">
              {visible.map((feed) => (
                <FeedRow
                  key={feed.id}
                  feed={feed}
                  onEdit={() => openEdit(feed)}
                />
              ))}
            </ul>
          )}
      </div>

      <FeedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        feed={editing}
        categories={categories}
      />
    </section>
  );
}
