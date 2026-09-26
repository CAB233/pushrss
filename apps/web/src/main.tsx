import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  Channel,
  Delivery,
  Feed,
  Overview,
  StoredItem,
} from "../../../packages/db/repositories.ts";
import type { DeliveryResult } from "../../../packages/shared/contracts.ts";
import {
  type Api,
  createApi,
  createSession,
  deleteSession,
  type Page,
  safeLink,
} from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Card, CardContent } from "./components/ui/card.tsx";
import { Badge } from "./components/ui/badge.tsx";
import "./style.css";
type PublicChannel = Omit<Channel, "encryptedConfig">;
const date = (n: number | null) =>
  n === null ? "暂无记录" : new Date(n).toLocaleString("zh-CN");
const names = {
  pending: "等待发送",
  sending: "发送中",
  sent: "已送达",
  failed: "失败",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children = "暂无记录" }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}
function useData<T>(api: Api, path: string, revision: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setData(undefined);
    api<T>(path, "GET", undefined, abort.signal).then((value) => {
      if (!abort.signal.aborted) setData(value);
    }).catch((e) => {
      if (!abort.signal.aborted) setError(e.message);
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [api, path, revision]);
  return { data, error, loading };
}
function Result(
  { state, children }: {
    state: { loading: boolean; error: string };
    children: ReactNode;
  },
) {
  return state.loading
    ? <Empty>正在加载…</Empty>
    : state.error
    ? (
      <p role="alert" className="error">
        {state.error}，请点击“更新数据”重试。
      </p>
    )
    : <>{children}</>;
}
function Pager(
  { offset, count, set }: {
    offset: number;
    count: number;
    set: (n: number) => void;
  },
) {
  return (
    <div className="actions pager">
      <Button
        variant="outline"
        disabled={!offset}
        onClick={() => set(offset - 20)}
      >
        上一页
      </Button>
      <span>第 {offset / 20 + 1} 页</span>
      <Button
        variant="outline"
        disabled={count < 20}
        onClick={() => set(offset + 20)}
      >
        下一页
      </Button>
    </div>
  );
}
const Feedback = createContext({ error: "", message: "", busy: false });
function Modal(
  { title, close, children }: {
    title: string;
    close: () => void;
    children: ReactNode;
  },
) {
  const feedback = useContext(Feedback);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!feedback.busy) close();
      }}
      aria-label={title}
    >
      <div className="section-head">
        <h2>{title}</h2>
        <Button variant="outline" disabled={feedback.busy} onClick={close}>
          关闭
        </Button>
      </div>
      {feedback.error && <p role="alert" className="error">{feedback.error}</p>}
      {feedback.message && (
        <p role="status" className="success">{feedback.message}</p>
      )}
      {children}
    </dialog>
  );
}
type Run = (work: () => Promise<unknown>, message: string) => Promise<boolean>;
type Props = { api: Api; revision: number; run: Run; busy: boolean };
function OverviewPage({ api, revision }: Props) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const state = useData<Overview>(
    api,
    `/overview?start=${start.getTime()}&end=${end.getTime()}`,
    revision,
  );
  return (
    <Result state={state}>
      {state.data && (
        <>
          <div className="stats">
            {[
              ["订阅源", state.data.feeds],
              ["今日新增文章", state.data.articlesToday],
              ["今日送达", state.data.sentToday],
              ["失败投递", state.data.failed],
            ].map(([name, n]) => (
              <Card key={name}>
                <CardContent>
                  <p>{name}</p>
                  <strong>{n}</strong>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="muted">
            今日按浏览器所在时区统计；文章以入库时间计算，包含首次抓取的文章。
          </p>
          <div className="columns">
            {[["最近成功抓取", state.data.recentFeeds], [
              "异常订阅源",
              state.data.failingFeeds,
            ]].map(([title, feeds]) => (
              <Card key={title as string}>
                <CardContent>
                  <h2>{title as string}</h2>
                  {(feeds as Feed[]).length
                    ? (feeds as Feed[]).map((f) => (
                      <div className="row" key={f.id}>
                        <b>{f.title || f.url}</b>
                        <p className={f.lastError ? "error" : "muted"}>
                          {title === "异常订阅源"
                            ? f.lastError
                            : date(f.lastFetchedAt)}
                        </p>
                      </div>
                    ))
                    : <Empty />}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </Result>
  );
}
function Article({ item }: { item: StoredItem }) {
  return (
    <article>
      <h3>{item.title}</h3>
      <p className="muted">
        {item.author || "作者未提供"} · {date(item.publishedAt)}
      </p>
      {safeLink(item.link) && (
        <a href={safeLink(item.link)} target="_blank" rel="noopener noreferrer">
          阅读原文 ↗
        </a>
      )}
      <pre className="content">{item.content || item.summary || "正文为空"}</pre>
    </article>
  );
}
function FeedDetail(
  { feed, api, revision, run, busy }: Props & { feed: Feed },
) {
  const [offset, setOffset] = useState(0),
    [channelOffset, setChannelOffset] = useState(0);
  const items = useData<Page<StoredItem>>(
    api,
    `/feeds/${feed.id}/items?limit=20&offset=${offset}`,
    revision,
  );
  const channels = useData<Page<PublicChannel>>(
    api,
    `/channels?limit=20&offset=${channelOffset}`,
    revision,
  );
  // 关联查询取全量，避免超过一页的关联误判。
  const [selected, setSelected] = useState<string[]>([]),
    [subError, setSubError] = useState(""),
    [subLoading, setSubLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setSubError("");
    setSelected([]);
    setSubLoading(true);
    (async () => {
      const ids: string[] = [];
      for (let offset = 0;; offset += 100) {
        const p = await api<Page<{ channelId: string }>>(
          `/subscriptions?feedId=${feed.id}&limit=100&offset=${offset}`,
          "GET",
          undefined,
          abort.signal,
        );
        ids.push(...p.items.map((i) => i.channelId));
        if (p.items.length < 100) break;
      }
      if (!abort.signal.aborted) setSelected(ids);
    })().catch((e) => {
      if (!abort.signal.aborted) setSubError(e.message);
    }).finally(() => {
      if (!abort.signal.aborted) setSubLoading(false);
    });
    return () => abort.abort();
  }, [api, feed.id, revision]);
  return (
    <>
      <h3>关联通知渠道</h3>
      <Result state={channels}>
        {subError
          ? <p role="alert">{subError}</p>
          : channels.data?.items.map((ch) => (
            <div className="row section-head" key={ch.id}>
              <span>{ch.name} · {ch.enabled ? "启用" : "暂停"}</span>
              <Button
                disabled={busy || subLoading || !!subError}
                variant="outline"
                onClick={() =>
                  run(() =>
                    selected.includes(ch.id)
                      ? api(`/subscriptions/${feed.id}/${ch.id}`, "DELETE")
                      : api("/subscriptions", "POST", {
                        feedId: feed.id,
                        channelId: ch.id,
                      }), "渠道关联已更新")}
              >
                {selected.includes(ch.id) ? "解除关联" : "关联"}
              </Button>
            </div>
          ))}
        {!channels.data?.items.length && (
          <Empty>请先在通知渠道页创建渠道。</Empty>
        )}
        <Pager
          offset={channelOffset}
          count={channels.data?.items.length ?? 0}
          set={setChannelOffset}
        />
      </Result>
      <h3>文章记录</h3>
      <Result state={items}>
        {items.data?.items.map((item) => (
          <details key={item.id}>
            <summary>{item.title}</summary>
            <Article item={item} />
          </details>
        ))}
        {!items.data?.items.length && (
          <Empty>首次成功抓取后，文章会显示在这里。</Empty>
        )}
        <Pager
          offset={offset}
          count={items.data?.items.length ?? 0}
          set={setOffset}
        />
      </Result>
    </>
  );
}
async function allItems<T>(
  api: Api,
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0;; offset += 100) {
    const page = await api<Page<T>>(
      `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`,
      "GET",
      undefined,
      signal,
    );
    items.push(...page.items);
    if (page.items.length < 100) return items;
  }
}
function FeedsPage(props: Props) {
  const { api, revision, run, busy } = props;
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Feed | "new" | null>(null);
  const [detail, setDetail] = useState<Feed | null>(null);
  const createdId = useRef<string | undefined>(undefined);
  const state = useData<Page<Feed>>(
    api,
    `/feeds?limit=20&offset=${offset}`,
    revision,
  );
  return (
    <>
      <div className="section-head list-heading">
        <p className="muted">为订阅源设置抓取周期，并连接通知渠道。</p>
        <Button
          onClick={() => {
            createdId.current = undefined;
            setEditing("new");
          }}
        >
          ＋ 添加订阅源
        </Button>
      </div>
      <Result state={state}>
        <Card>
          <CardContent>
            {state.data?.items.map((f) => (
              <div className="row" key={f.id}>
                <div className="section-head">
                  <div>
                    <h3>
                      {f.title || "未命名订阅源"}{" "}
                      <Badge variant="secondary">
                        {f.enabled ? "启用" : "暂停"}
                      </Badge>
                    </h3>
                    <p className="url">{f.url}</p>
                  </div>
                  <div className="actions">
                    <Button variant="outline" onClick={() => setDetail(f)}>
                      文章与渠道
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(f)}>
                      编辑
                    </Button>
                  </div>
                </div>
                <p className="muted">
                  每 {f.intervalSeconds} 秒 · 上次成功：{date(f.lastFetchedAt)}
                  {" "}
                  · 下次：{f.enabled ? date(f.nextFetchAt) : "已暂停"}
                </p>
                {f.lastError && (
                  <p className="error">
                    {f.lastError}（连续失败 {f.failureCount} 次）
                  </p>
                )}
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={busy || !f.enabled}
                    onClick={() =>
                      run(
                        () => api(`/feeds/${f.id}/refresh`, "POST"),
                        "刷新已入队，请稍后更新数据查看结果",
                      )}
                  >
                    立即刷新
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api(`/feeds/${f.id}`, "PATCH", {
                            enabled: !f.enabled,
                          }),
                        "状态已更新",
                      )}
                  >
                    {f.enabled ? "暂停" : "启用"}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `删除“${f.title || f.url}”及其文章、投递和关联记录？`,
                        )
                      ) {
                        run(
                          () => api(`/feeds/${f.id}`, "DELETE"),
                          "订阅源已删除",
                        );
                      }
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {!state.data?.items.length && (
              <Empty>添加第一个订阅源，开始收集新文章。</Empty>
            )}
            <Pager
              offset={offset}
              count={state.data?.items.length ?? 0}
              set={setOffset}
            />
          </CardContent>
        </Card>
      </Result>
      {editing && (
        <Modal
          title={editing === "new" ? "添加订阅源" : "编辑订阅源"}
          close={() => setEditing(null)}
        >
          <FeedForm
            api={api}
            feed={editing === "new" ? undefined : editing}
            busy={busy}
            save={async (body, channelIds) => {
              if (
                await run(async () => {
                  let id = editing === "new" ? createdId.current : editing.id;
                  if (!id) {
                    const created = await api<Feed>("/feeds", "POST", {
                      ...body,
                      enabled: false,
                    });
                    id = created.id;
                    createdId.current = id;
                  }
                  const existing = await allItems<{ channelId: string }>(
                    api,
                    `/subscriptions?feedId=${id}`,
                  );
                  for (const channelId of channelIds) {
                    if (!existing.some((s) => s.channelId === channelId)) {
                      await api("/subscriptions", "POST", {
                        feedId: id,
                        channelId,
                      });
                    }
                  }
                  for (const sub of existing) {
                    if (!channelIds.includes(sub.channelId)) {
                      await api(
                        `/subscriptions/${id}/${sub.channelId}`,
                        "DELETE",
                      );
                    }
                  }
                  await api(`/feeds/${id}`, "PATCH", body);
                }, "订阅源与通知渠道已保存")
              ) setEditing(null);
            }}
          />
        </Modal>
      )}
      {detail && (
        <Modal
          title={detail.title || "订阅源详情"}
          close={() => setDetail(null)}
        >
          <FeedDetail {...props} feed={detail} />
        </Modal>
      )}
    </>
  );
}
function FeedForm(
  { feed, api, save, busy }: {
    feed?: Feed;
    api: Api;
    save: (
      b: {
        title: string;
        url: string;
        intervalSeconds: number;
        enabled: boolean;
      },
      channelIds: string[],
    ) => void;
    busy: boolean;
  },
) {
  const defaults = useData<{ defaultIntervalSeconds: number }>(
    api,
    "/settings",
    0,
  );
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [channelError, setChannelError] = useState("");
  const [channelsLoading, setChannelsLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      allItems<PublicChannel>(api, "/channels", abort.signal),
      feed
        ? allItems<{ channelId: string }>(
          api,
          `/subscriptions?feedId=${feed.id}`,
          abort.signal,
        )
        : Promise.resolve([]),
    ]).then(([channels, subscriptions]) => {
      if (!abort.signal.aborted) {
        setChannels(channels);
        setSelected(subscriptions.map((s) => s.channelId));
      }
    }).catch((error) => {
      if (!abort.signal.aborted) setChannelError(error.message);
    })
      .finally(() => {
        if (!abort.signal.aborted) setChannelsLoading(false);
      });
    return () => abort.abort();
  }, [api, feed?.id]);
  if (!feed && defaults.loading) return <Empty>正在加载默认设置…</Empty>;
  if (!feed && defaults.error) {
    return (
      <p role="alert" className="error">
        {defaults.error}，请关闭后重新打开表单。
      </p>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        save({
          title: String(d.get("title")),
          url: String(d.get("url")),
          intervalSeconds: Number(d.get("interval")),
          enabled: d.get("enabled") === "on",
        }, selected);
      }}
    >
      <Field label="名称">
        <Input
          name="title"
          defaultValue={feed?.title}
          maxLength={500}
        />
      </Field>
      <p className="muted">
        名称留空时，下一次成功抓取会使用 RSS / Atom 中的标题。
      </p>
      <Field label="RSS / Atom 地址">
        <Input
          name="url"
          type="url"
          required
          defaultValue={feed?.url}
        />
      </Field>
      {feed && (
        <p className="muted">
          修改地址后保留已有文章与投递记录，清除抓取缓存，并按新地址继续去重。
        </p>
      )}
      <Field label="抓取周期（秒，60～2592000）">
        <Input
          name="interval"
          type="number"
          min="60"
          max="2592000"
          required
          defaultValue={feed?.intervalSeconds ??
            defaults.data?.defaultIntervalSeconds ?? 1800}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={feed?.enabled ?? true}
        />启用订阅源
      </label>
      <fieldset disabled={busy || channelsLoading}>
        <legend className="mb-2 font-medium">通知渠道</legend>
        {channelsLoading
          ? <Empty>正在加载通知渠道…</Empty>
          : channelError
          ? (
            <p role="alert" className="error">
              {channelError}，请关闭后重新打开表单。
            </p>
          )
          : channels.length
          ? channels.map((channel) => (
            <label className="check" key={channel.id}>
              <input
                type="checkbox"
                checked={selected.includes(channel.id)}
                onChange={(e) =>
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, channel.id]
                      : ids.filter((id) => id !== channel.id)
                  )}
              />
              {channel.name}
              {channel.enabled ? "" : "（已暂停）"}
            </label>
          ))
          : <Empty>请先创建通知渠道，再编辑订阅源完成选择。</Empty>}
      </fieldset>
      <p className="muted">
        首次抓取和手动刷新仅推送最新一篇新增文章；定时抓取会推送全部新增文章。
        勾选的渠道随表单保存生效。
      </p>
      <Button
        type="submit"
        disabled={busy || channelsLoading || !!channelError ||
          (!feed && defaults.loading)}
      >
        保存订阅源
      </Button>
    </form>
  );
}
function ChannelsPage({ api, revision, run, busy }: Props) {
  const [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<PublicChannel | "new" | null>(null);
  const state = useData<Page<PublicChannel>>(
    api,
    `/channels?limit=20&offset=${offset}`,
    revision,
  );
  return (
    <>
      <div className="section-head list-heading">
        <p className="muted">将新文章发送到指定通知渠道。</p>
        <Button onClick={() => setEditing("new")}>＋ 添加渠道</Button>
      </div>
      <Result state={state}>
        <Card>
          <CardContent>
            {state.data?.items.map((ch) => (
              <div className="row" key={ch.id}>
                <h3>
                  {ch.name}{" "}
                  <Badge variant="secondary">
                    {ch.enabled ? "启用" : "暂停"}
                  </Badge>
                </h3>
                <p className="muted">
                  {ch.type === "serverchan" ? "Server酱³" : "Telegram Bot"}{" "}
                  · 凭据已加密保存
                </p>
                <div className="actions">
                  <Button variant="outline" onClick={() => setEditing(ch)}>
                    编辑渠道
                  </Button>
                  <Button
                    disabled={busy || !ch.enabled}
                    variant="outline"
                    onClick={() => {
                      if (
                        confirm(
                          `向“${ch.name}”发送一条测试通知？已关联文章时使用最新一篇。`,
                        )
                      ) {
                        run(async () => {
                          const result = await api<DeliveryResult>(
                            `/channels/${ch.id}/test`,
                            "POST",
                          );
                          if (!result.ok) throw new Error(result.error);
                        }, "测试通知已发送");
                      }
                    }}
                  >
                    发送测试通知
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`删除“${ch.name}”及其关联和投递记录？`)) {
                        run(
                          () => api(`/channels/${ch.id}`, "DELETE"),
                          "渠道已删除",
                        );
                      }
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {!state.data?.items.length && (
              <Empty>添加通知渠道，再前往订阅源详情完成关联。</Empty>
            )}
            <Pager
              offset={offset}
              count={state.data?.items.length ?? 0}
              set={setOffset}
            />
          </CardContent>
        </Card>
      </Result>
      {editing && (
        <Modal
          title={editing === "new" ? "添加通知渠道" : "编辑通知渠道"}
          close={() => setEditing(null)}
        >
          <ChannelForm
            channel={editing === "new" ? undefined : editing}
            busy={busy}
            save={async (body) => {
              if (
                await run(() =>
                  api(
                    editing === "new" ? "/channels" : `/channels/${editing.id}`,
                    editing === "new" ? "POST" : "PATCH",
                    body,
                  ), "渠道已保存")
              ) setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ChannelForm(
  { channel, save, busy }: {
    channel?: PublicChannel;
    save: (b: unknown) => void;
    busy: boolean;
  },
) {
  const [type, setType] = useState(channel?.type ?? "serverchan"),
    [replace, setReplace] = useState(!channel);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const config = type === "serverchan" ? { sendKey: d.get("sendKey") } : {
          botToken: d.get("botToken"),
          chatId: d.get("chatId"),
          ...(d.get("threadId") ? { threadId: Number(d.get("threadId")) } : {}),
          ...(d.get("parseMode") ? { parseMode: d.get("parseMode") } : {}),
          disablePreview: d.get("disablePreview") === "on",
        };
        save({
          name: d.get("name"),
          type,
          enabled: d.get("enabled") === "on",
          ...(replace ? { config } : {}),
        });
      }}
    >
      <Field label="渠道名称">
        <Input name="name" required defaultValue={channel?.name} />
      </Field>
      <Field label="渠道类型">
        <select
          value={type}
          disabled={!!channel}
          onChange={(e) => setType(e.target.value as PublicChannel["type"])}
        >
          <option value="serverchan">Server酱³</option>
          <option value="telegram">Telegram Bot</option>
        </select>
      </Field>
      {channel && (
        <label className="check">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />替换完整渠道配置
        </label>
      )}
      {channel && (
        <p className="muted">
          默认保留已有配置。选择替换时，请填写完整凭据与发送选项。
        </p>
      )}
      {replace && (type === "serverchan"
        ? (
          <Field label="SendKey">
            <Input
              name="sendKey"
              type="password"
              autoComplete="new-password"
              required
              pattern="sctp[0-9]+t[A-Za-z0-9_-]+"
              placeholder="sctp…"
            />
          </Field>
        )
        : (
          <>
            <Field label="Bot Token">
              <Input
                name="botToken"
                type="password"
                autoComplete="new-password"
                required
                pattern="[0-9]+:[A-Za-z0-9_-]+"
              />
            </Field>
            <Field label="Chat ID">
              <Input
                name="chatId"
                required
                placeholder="-100… 或 @channel"
                pattern="-?[0-9]+|@[A-Za-z0-9_]+"
              />
            </Field>
            <Field label="话题 ID（可选）">
              <Input name="threadId" type="number" min="1" />
            </Field>
            <Field label="解析模式">
              <select name="parseMode">
                <option value="">纯文本</option>
                <option>HTML</option>
                <option>MarkdownV2</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                name="disablePreview"
                defaultChecked
              />关闭链接预览
            </label>
          </>
        ))}
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={channel?.enabled ?? true}
        />启用渠道
      </label>
      <Button type="submit" disabled={busy}>保存渠道</Button>
    </form>
  );
}
function DeliveryDetail({ id, ...props }: Props & { id: string }) {
  const state = useData<Delivery>(
    props.api,
    `/deliveries/${id}`,
    props.revision,
  );
  const d = state.data;
  return (
    <Result state={state}>
      {d && (
        <>
          <p>状态：{names[d.status]} · 本轮尝试 {d.attempts} 次</p>
          <p>
            创建：{date(d.createdAt)}
            <br />送达：{date(d.sentAt)}
            <br />下次尝试：{date(d.nextAttemptAt)}
          </p>
          <p>外部消息 ID：{d.externalMessageId ?? "暂无"}</p>
          {d.lastError && <p className="error">最近错误：{d.lastError}</p>}
          <DeliveryRelations {...props} delivery={d} />
        </>
      )}
    </Result>
  );
}
function DeliveryRelations(
  { api, revision, delivery }: Props & { delivery: Delivery },
) {
  const item = useData<StoredItem>(api, `/items/${delivery.itemId}`, revision);
  const ch = useData<PublicChannel>(
    api,
    `/channels/${delivery.channelId}`,
    revision,
  );
  return (
    <>
      <Result state={ch}>
        <p>通知渠道：{ch.data?.name}</p>
      </Result>
      <Result state={item}>{item.data && <Article item={item.data} />}</Result>
    </>
  );
}
function DeliveriesPage(props: Props) {
  const { api, revision, run, busy } = props;
  const [offset, setOffset] = useState(0),
    [status, setStatus] = useState(""),
    [detail, setDetail] = useState<string>();
  const state = useData<Page<Delivery>>(
    api,
    `/deliveries?limit=20&offset=${offset}${status ? `&status=${status}` : ""}`,
    revision,
  );
  return (
    <>
      <Field label="投递状态">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(names).map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>
      </Field>
      <Result state={state}>
        <Card>
          <CardContent>
            {state.data?.items.map((d) => (
              <div className="row section-head" key={d.id}>
                <div>
                  <h3>
                    <Badge
                      variant={d.status === "failed"
                        ? "destructive"
                        : "secondary"}
                    >
                      {names[d.status]}
                    </Badge>{" "}
                    · 本轮尝试 {d.attempts} 次
                  </h3>
                  <p className="muted">{date(d.createdAt)}</p>
                  {d.lastError && <p className="error">{d.lastError}</p>}
                </div>
                <div className="actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDetail(d.id)}
                  >
                    查看详情
                  </Button>
                  {d.status === "failed" && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "开启新一轮发送？结果未知的投递可能重复送达。",
                          )
                        ) {
                          run(
                            () => api(`/deliveries/${d.id}/retry`, "POST"),
                            "重试已入队",
                          );
                        }
                      }}
                    >
                      重试
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!state.data?.items.length && (
              <Empty>当前筛选下暂无投递记录。</Empty>
            )}
            <Pager
              offset={offset}
              count={state.data?.items.length ?? 0}
              set={setOffset}
            />
          </CardContent>
        </Card>
      </Result>
      {detail && (
        <Modal title="投递详情" close={() => setDetail(undefined)}>
          <DeliveryDetail {...props} id={detail} />
        </Modal>
      )}
    </>
  );
}
function SettingsPage({ api, revision, run, busy }: Props) {
  const settings = useData<{ defaultIntervalSeconds: number }>(
    api,
    "/settings",
    revision,
  );
  const status = useData<
    {
      runtime: string;
      retryPolicy: { maxAttempts: number; baseSeconds: number };
    }
  >(api, "/status", revision);
  return (
    <div className="columns">
      <Card>
        <CardContent>
          <h2>抓取设置</h2>
          <Result state={settings}>
            {settings.data && (
              <form
                key={settings.data.defaultIntervalSeconds}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() =>
                    api("/settings", "PATCH", {
                      defaultIntervalSeconds: Number(
                        new FormData(e.currentTarget).get("interval"),
                      ),
                    }), "默认抓取周期已保存");
                }}
              >
                <Field label="新订阅源默认周期（秒）">
                  <Input
                    name="interval"
                    type="number"
                    required
                    min="60"
                    max="2592000"
                    defaultValue={settings.data.defaultIntervalSeconds}
                  />
                </Field>
                <p className="muted">
                  此设置用于新建订阅源，已有订阅源按各自周期运行。
                </p>
                <Button type="submit" disabled={busy}>保存设置</Button>
              </form>
            )}
          </Result>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2>运行信息</h2>
          <Result state={status}>
            <p>运行平台：{status.data?.runtime}</p>
            <p>每轮最多尝试：{status.data?.retryPolicy.maxAttempts} 次</p>
            <p className="muted">
              文章与投递保留至手动删除关联资源。任务记录保留 30 天。
            </p>
          </Result>
        </CardContent>
      </Card>
    </div>
  );
}
const pages = ["概览", "订阅源", "通知渠道", "投递记录", "设置"];
const pageIcons: ReactNode[] = [
  <Fragment key="overview">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Fragment>,
  <Fragment key="feeds">
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </Fragment>,
  <Fragment key="channels">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </Fragment>,
  <Fragment key="deliveries">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Fragment>,
  <Fragment key="settings">
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Fragment>,
];
function App() {
  const [session, setSession] = useState<
      "checking" | "signed-in" | "signed-out"
    >(
      "checking",
    ),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const lock = useRef(false);
  const logout = useCallback(() => {
    setSession("signed-out");
    setMessage("");
    setError("登录已过期，请重新输入管理密码");
  }, []);
  const api = useMemo(() => createApi(undefined, logout), [logout]);
  useEffect(() => {
    const controller = new AbortController();
    createApi()("/status", "GET", undefined, controller.signal).then(() => {
      if (!controller.signal.aborted) setSession("signed-in");
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setSession("signed-out");
        if (cause?.status !== 401) setError(cause.message);
      }
    });
    return () => controller.abort();
  }, []);
  const run: Run = async (work, text) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(text);
      setRevision((n) => n + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const props = { api, revision, run, busy };
  if (session === "checking") {
    return (
      <main className="login">
        <div className="brand">PushRSS</div>
        <p role="status" className="muted">正在检查登录状态…</p>
      </main>
    );
  }
  if (session === "signed-out") {
    return (
      <main className="login">
        <div className="brand">PushRSS</div>
        <h1>登录 PushRSS</h1>
        <p className="muted">登录管理订阅源、通知渠道和投递记录。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const password = String(
              new FormData(e.currentTarget).get("password") ?? "",
            );
            if (await run(() => createSession(password), "已连接管理服务")) {
              setSession("signed-in");
            }
          }}
        >
          <Field label="管理密码">
            <Input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="输入你设置的管理密码"
            />
          </Field>
          <p className="muted">
            登录状态会在当前浏览器保留 7 天；退出时清除。
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "正在连接…" : "进入控制台 →"}
          </Button>
        </form>
      </main>
    );
  }
  return (
    <Feedback.Provider value={{ error, message, busy }}>
      <div className="shell">
        <aside>
          <div className="brand">PushRSS</div>
          <nav aria-label="主导航">
            {pages.map((p, i) => (
              <Button
                type="button"
                key={p}
                variant={page === i ? "secondary" : "ghost"}
                aria-current={page === i ? "page" : undefined}
                onClick={() => {
                  setPage(i);
                  setMessage("");
                  setError("");
                }}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {pageIcons[i]}
                </svg>
                {p}
              </Button>
            ))}
          </nav>
        </aside>
        <main>
          <header className="section-head">
            <div>
              <p className="eyebrow">工作台 / {pages[page]}</p>
              <h1>{pages[page]}</h1>
            </div>
            <div className="actions">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => setRevision((n) => n + 1)}
              >
                更新数据
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={async () => {
                  if (await run(() => deleteSession(), "已退出")) {
                    setSession("signed-out");
                    setMessage("");
                    setError("");
                  }
                }}
              >
                退出
              </Button>
            </div>
          </header>
          <div role="status" aria-live="polite">
            {message && <p className="success">{message}</p>}
          </div>
          {error && <p role="alert" className="error notice">{error}</p>}
          <div key={page}>
            {page === 0
              ? <OverviewPage {...props} />
              : page === 1
              ? <FeedsPage {...props} />
              : page === 2
              ? <ChannelsPage {...props} />
              : page === 3
              ? <DeliveriesPage {...props} />
              : <SettingsPage {...props} />}
          </div>
        </main>
      </div>
    </Feedback.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
