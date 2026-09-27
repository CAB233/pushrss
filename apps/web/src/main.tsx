import { I18nextProvider, useTranslation } from "react-i18next";
import {
  getLanguagePreference,
  i18n,
  type LanguagePreference,
  setLanguagePreference,
  subscribeLanguagePreference,
} from "./i18n.ts";
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
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  Channel,
  Delivery,
  DeliverySummary,
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
  n === null
    ? i18n.t("common.empty")
    : new Date(n).toLocaleString(i18n.resolvedLanguage);
const secondsToMinutes = (seconds: number) =>
  Math.max(1, Math.round(seconds / 60));
const minutesToSeconds = (minutes: number, existingSeconds?: number) =>
  existingSeconds !== undefined &&
    minutes === secondsToMinutes(existingSeconds)
    ? existingSeconds
    : minutes * 60;
const names = {
  pending: "status.pending",
  sending: "status.sending",
  sent: "status.sent",
  failed: "status.failed",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return <p className="empty">{children ?? t("common.empty")}</p>;
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
  const { t } = useTranslation();
  return state.loading
    ? <Empty>{t("common.loading")}</Empty>
    : state.error
    ? (
      <p role="alert" className="error">
        {t("error.refresh", { error: state.error })}
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
  const { t } = useTranslation();
  return (
    <div className="actions pager">
      <Button
        variant="outline"
        disabled={!offset}
        onClick={() => set(offset - 20)}
      >
        {t("common.previous")}
      </Button>
      <span>{t("common.page", { page: offset / 20 + 1 })}</span>
      <Button
        variant="outline"
        disabled={count < 20}
        onClick={() => set(offset + 20)}
      >
        {t("common.next")}
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
  const { t } = useTranslation();
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
          {t("common.close")}
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
  const { t } = useTranslation();
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
              [t("nav.feeds"), state.data.feeds],
              [t("overview.articles"), state.data.articlesToday],
              [t("overview.sent"), state.data.sentToday],
              [t("overview.failed"), state.data.failed],
            ].map(([name, n]) => (
              <Card key={name}>
                <CardContent>
                  <p>{name}</p>
                  <strong>{n}</strong>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="columns">
            {[[t("overview.recent"), state.data.recentFeeds], [
              t("overview.failing"),
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
                          {title === t("overview.failing")
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
  const { t } = useTranslation();
  return (
    <article>
      <h3>{item.title}</h3>
      <p className="muted">
        {item.author || t("article.noAuthor")} · {date(item.publishedAt)}
      </p>
      {safeLink(item.link) && (
        <a href={safeLink(item.link)} target="_blank" rel="noopener noreferrer">
          {t("article.read")}
        </a>
      )}
      <pre className="content">{item.content || item.summary || t("article.empty")}</pre>
    </article>
  );
}
function FeedDetail(
  { feed, api, revision, run, busy }: Props & { feed: Feed },
) {
  const { t } = useTranslation();
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
      <h3>{t("feeds.linkedChannels")}</h3>
      <Result state={channels}>
        {subError
          ? <p role="alert">{subError}</p>
          : channels.data?.items.map((ch) => (
            <div className="row section-head" key={ch.id}>
              <span>
                {ch.name} ·{" "}
                {ch.enabled ? t("common.enabled") : t("common.inactive")}
              </span>
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
                      }), t("feeds.linksUpdated"))}
              >
                {selected.includes(ch.id) ? t("feeds.unlink") : t("feeds.link")}
              </Button>
            </div>
          ))}
        {!channels.data?.items.length && (
          <Empty>{t("feeds.createChannel")}</Empty>
        )}
        <Pager
          offset={channelOffset}
          count={channels.data?.items.length ?? 0}
          set={setChannelOffset}
        />
      </Result>
      <h3>{t("feeds.articles")}</h3>
      <Result state={items}>
        {items.data?.items.map((item) => (
          <details key={item.id}>
            <summary>{item.title}</summary>
            <Article item={item} />
          </details>
        ))}
        {!items.data?.items.length && <Empty>{t("feeds.articlesEmpty")}</Empty>}
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
  const { t } = useTranslation();
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
        <Button
          onClick={() => {
            createdId.current = undefined;
            setEditing("new");
          }}
        >
          {t("feeds.add")}
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
                      {f.title || t("feeds.unnamed")}{" "}
                      <Badge variant="secondary">
                        {f.enabled ? t("common.enabled") : t("common.inactive")}
                      </Badge>
                    </h3>
                    <p className="url">{f.url}</p>
                  </div>
                  <div className="actions">
                    <Button variant="outline" onClick={() => setDetail(f)}>
                      {t("feeds.detailsAction")}
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(f)}>
                      {t("common.edit")}
                    </Button>
                  </div>
                </div>
                <p className="muted">
                  {t(
                    f.intervalSeconds % 60
                      ? "feeds.scheduleApprox"
                      : "feeds.schedule",
                    {
                      minutes: secondsToMinutes(f.intervalSeconds),
                      last: date(f.lastFetchedAt),
                      next: f.enabled
                        ? date(f.nextFetchAt)
                        : t("common.paused"),
                    },
                  )}
                </p>
                {f.lastError && (
                  <p className="error">
                    {t("feeds.failures", {
                      error: f.lastError,
                      count: f.failureCount,
                    })}
                  </p>
                )}
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={busy || !f.enabled}
                    onClick={() =>
                      run(
                        () => api(`/feeds/${f.id}/refresh`, "POST"),
                        t("feeds.refreshQueued"),
                      )}
                  >
                    {t("feeds.refresh")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api(`/feeds/${f.id}`, "PATCH", {
                          enabled: !f.enabled,
                        }),
                        t("common.statusUpdated"),
                      )}
                  >
                    {f.enabled ? t("common.pause") : t("common.enabled")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          t("feeds.deleteConfirm", { name: f.title || f.url }),
                        )
                      ) {
                        run(
                          () => api(`/feeds/${f.id}`, "DELETE"),
                          t("feeds.deleted"),
                        );
                      }
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            {!state.data?.items.length && <Empty>{t("feeds.empty")}</Empty>}
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
          title={editing === "new" ? t("feeds.add") : t("feeds.edit")}
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
                }, t("feeds.saved"))
              ) setEditing(null);
            }}
          />
        </Modal>
      )}
      {detail && (
        <Modal
          title={detail.title || t("feeds.details")}
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
  const { t } = useTranslation();
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
  if (!feed && defaults.loading) {
    return <Empty>{t("feeds.loadingDefaults")}</Empty>;
  }
  if (!feed && defaults.error) {
    return (
      <p role="alert" className="error">
        {t("error.reopen", { error: defaults.error })}
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
          intervalSeconds: minutesToSeconds(
            Number(d.get("interval")),
            feed?.intervalSeconds,
          ),
          enabled: d.get("enabled") === "on",
        }, selected);
      }}
    >
      <Field label={t("feeds.name")}>
        <Input
          name="title"
          defaultValue={feed?.title}
          maxLength={500}
        />
      </Field>
      <p className="muted">
        {t("feeds.nameHelp")}
      </p>
      <Field label={t("feeds.url")}>
        <Input
          name="url"
          type="url"
          required
          defaultValue={feed?.url}
        />
      </Field>
      {feed && (
        <p className="muted">
          {t("feeds.urlHelp")}
        </p>
      )}
      <Field label={t("feeds.interval")}>
        <Input
          name="interval"
          type="number"
          min="1"
          max="43200"
          step="1"
          required
          defaultValue={secondsToMinutes(
            feed?.intervalSeconds ??
              defaults.data?.defaultIntervalSeconds ?? 1800,
          )}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={feed?.enabled ?? true}
        />
        {t("feeds.enable")}
      </label>
      <fieldset disabled={busy || channelsLoading}>
        <legend className="mb-2 font-medium">{t("nav.channels")}</legend>
        {channelsLoading
          ? <Empty>{t("feeds.loadingChannels")}</Empty>
          : channelError
          ? (
            <p role="alert" className="error">
              {t("error.reopen", { error: channelError })}
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
              {channel.enabled ? "" : t("common.pausedSuffix")}
            </label>
          ))
          : <Empty>{t("feeds.selectChannelsHelp")}</Empty>}
      </fieldset>
      <p className="muted">
        {t("feeds.policy")}
      </p>
      <Button
        type="submit"
        disabled={busy || channelsLoading || !!channelError ||
          (!feed && defaults.loading)}
      >
        {t("feeds.save")}
      </Button>
    </form>
  );
}
function ChannelsPage({ api, revision, run, busy }: Props) {
  const { t } = useTranslation();
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
        <Button onClick={() => setEditing("new")}>{t("channels.add")}</Button>
      </div>
      <Result state={state}>
        <Card>
          <CardContent>
            {state.data?.items.map((ch) => (
              <div className="row" key={ch.id}>
                <h3>
                  {ch.name}{" "}
                  <Badge variant="secondary">
                    {ch.enabled ? t("common.enabled") : t("common.inactive")}
                  </Badge>
                </h3>
                <p className="muted">
                  {ch.type === "serverchan"
                    ? t("channels.serverchan")
                    : t("channels.telegram")} {t("channels.encrypted")}
                </p>
                <div className="actions">
                  <Button variant="outline" onClick={() => setEditing(ch)}>
                    {t("channels.editAction")}
                  </Button>
                  <Button
                    disabled={busy || !ch.enabled}
                    variant="outline"
                    onClick={() => {
                      if (
                        confirm(
                          t("channels.testConfirm", { name: ch.name }),
                        )
                      ) {
                        run(async () => {
                          const result = await api<DeliveryResult>(
                            `/channels/${ch.id}/test`,
                            "POST",
                          );
                          if (!result.ok) throw new Error(result.error);
                        }, t("channels.testSent"));
                      }
                    }}
                  >
                    {t("channels.test")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(t("channels.deleteConfirm", { name: ch.name }))
                      ) {
                        run(
                          () => api(`/channels/${ch.id}`, "DELETE"),
                          t("channels.deleted"),
                        );
                      }
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            {!state.data?.items.length && <Empty>{t("channels.empty")}</Empty>}
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
          title={editing === "new" ? t("channels.add") : t("channels.edit")}
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
                  ), t("channels.saved"))
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
  const { t } = useTranslation();
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
      <Field label={t("channels.name")}>
        <Input name="name" required defaultValue={channel?.name} />
      </Field>
      <Field label={t("channels.type")}>
        <select
          value={type}
          disabled={!!channel}
          onChange={(e) => setType(e.target.value as PublicChannel["type"])}
        >
          <option value="serverchan">{t("channels.serverchan")}</option>
          <option value="telegram">{t("channels.telegram")}</option>
        </select>
      </Field>
      {channel && (
        <label className="check">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          {t("channels.replace")}
        </label>
      )}
      {channel && (
        <p className="muted">
          {t("channels.replaceHelp")}
        </p>
      )}
      {replace && (type === "serverchan"
        ? (
          <Field label={t("channels.sendKey")}>
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
            <Field label={t("channels.botToken")}>
              <Input
                name="botToken"
                type="password"
                autoComplete="new-password"
                required
                pattern="[0-9]+:[A-Za-z0-9_-]+"
              />
            </Field>
            <Field label={t("channels.chatId")}>
              <Input
                name="chatId"
                required
                placeholder={t("channels.chatPlaceholder")}
                pattern="-?[0-9]+|@[A-Za-z0-9_]+"
              />
            </Field>
            <Field label={t("channels.thread")}>
              <Input name="threadId" type="number" min="1" />
            </Field>
            <Field label={t("channels.parseMode")}>
              <select name="parseMode">
                <option value="">{t("channels.plainText")}</option>
                <option value="HTML">{t("channels.html")}</option>
                <option value="MarkdownV2">{t("channels.markdown")}</option>
              </select>
            </Field>
            <label className="check">
              <input
                type="checkbox"
                name="disablePreview"
                defaultChecked
              />
              {t("channels.disablePreview")}
            </label>
          </>
        ))}
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={channel?.enabled ?? true}
        />
        {t("channels.enable")}
      </label>
      <Button type="submit" disabled={busy}>{t("channels.save")}</Button>
    </form>
  );
}
function DeliveryDetail({ id, ...props }: Props & { id: string }) {
  const { t } = useTranslation();
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
          <p>
            {t("deliveries.statusAttempts", {
              status: t(names[d.status]),
              count: d.attempts,
            })}
          </p>
          <p>
            {t("deliveries.created", { date: date(d.createdAt) })}
            <br />
            {t("deliveries.sent", { date: date(d.sentAt) })}
            <br />
            {t("deliveries.next", { date: date(d.nextAttemptAt) })}
          </p>
          <p>
            {t("deliveries.externalId", {
              id: d.externalMessageId ?? t("common.none"),
            })}
          </p>
          {d.lastError && (
            <p className="error">
              {t("deliveries.error", { error: d.lastError })}
            </p>
          )}
          <DeliveryRelations {...props} delivery={d} />
        </>
      )}
    </Result>
  );
}
function DeliveryRelations(
  { api, revision, delivery }: Props & { delivery: Delivery },
) {
  const { t } = useTranslation();
  const item = useData<StoredItem>(api, `/items/${delivery.itemId}`, revision);
  const ch = useData<PublicChannel>(
    api,
    `/channels/${delivery.channelId}`,
    revision,
  );
  return (
    <>
      <Result state={ch}>
        <p>{t("deliveries.channel", { name: ch.data?.name ?? "" })}</p>
      </Result>
      <Result state={item}>{item.data && <Article item={item.data} />}</Result>
    </>
  );
}
function DeliveriesPage(props: Props) {
  const { t } = useTranslation();
  const { api, revision, run, busy } = props;
  const [offset, setOffset] = useState(0),
    [status, setStatus] = useState(""),
    [detail, setDetail] = useState<string>();
  const state = useData<Page<DeliverySummary>>(
    api,
    `/deliveries?limit=20&offset=${offset}${status ? `&status=${status}` : ""}`,
    revision,
  );
  return (
    <>
      <Field label={t("deliveries.filter")}>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("deliveries.all")}</option>
          {Object.entries(names).map(([key, name]) => (
            <option key={key} value={key}>{t(name)}</option>
          ))}
        </select>
      </Field>
      <Result state={state}>
        <Card>
          <CardContent>
            {state.data?.items.map((d) => (
              <div className="row section-head" key={d.id}>
                <div>
                  <h3>{d.itemTitle}</h3>
                  <p className="muted">
                    {t("deliveries.relations", {
                      feed: d.feedTitle || d.feedUrl,
                      channel: d.channelName,
                    })}
                  </p>
                  <p>
                    <Badge
                      variant={d.status === "failed"
                        ? "destructive"
                        : "secondary"}
                    >
                      {t(names[d.status])}
                    </Badge>{" "}
                    · {t("deliveries.attempts", { count: d.attempts })}
                  </p>
                  <p className="muted">{date(d.createdAt)}</p>
                  {d.lastError && <p className="error">{d.lastError}</p>}
                </div>
                <div className="actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDetail(d.id)}
                  >
                    {t("deliveries.detailsAction")}
                  </Button>
                  {d.status === "failed" && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            t("deliveries.retryConfirm"),
                          )
                        ) {
                          run(
                            () => api(`/deliveries/${d.id}/retry`, "POST"),
                            t("deliveries.retryQueued"),
                          );
                        }
                      }}
                    >
                      {t("deliveries.retry")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!state.data?.items.length && <Empty>{t("deliveries.empty")}
            </Empty>}
            <Pager
              offset={offset}
              count={state.data?.items.length ?? 0}
              set={setOffset}
            />
          </CardContent>
        </Card>
      </Result>
      {detail && (
        <Modal
          title={t("deliveries.details")}
          close={() => setDetail(undefined)}
        >
          <DeliveryDetail {...props} id={detail} />
        </Modal>
      )}
    </>
  );
}
function LanguageSelector() {
  const { t } = useTranslation();
  const preference = useSyncExternalStore(
    subscribeLanguagePreference,
    getLanguagePreference,
  );
  return (
    <Field label={t("settings.language")}>
      <select
        value={preference}
        onChange={(event) =>
          setLanguagePreference(event.target.value as LanguagePreference)}
      >
        <option value="system">{t("settings.system")}</option>
        <option value="zh-CN" lang="zh-CN">{t("language.zhCN")}</option>
        <option value="en" lang="en">{t("language.en")}</option>
      </select>
    </Field>
  );
}
function SettingsPage({ api, revision, run, busy }: Props) {
  const { t } = useTranslation();
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
          <LanguageSelector />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2>{t("settings.fetch")}</h2>
          <Result state={settings}>
            {settings.data && (
              <form
                key={settings.data.defaultIntervalSeconds}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() =>
                    api("/settings", "PATCH", {
                      defaultIntervalSeconds: minutesToSeconds(
                        Number(new FormData(e.currentTarget).get("interval")),
                        settings.data?.defaultIntervalSeconds,
                      ),
                    }), t("settings.saved"));
                }}
              >
                <Field label={t("settings.interval")}>
                  <Input
                    name="interval"
                    type="number"
                    required
                    min="1"
                    max="43200"
                    step="1"
                    defaultValue={secondsToMinutes(
                      settings.data.defaultIntervalSeconds,
                    )}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  {t("settings.save")}
                </Button>
              </form>
            )}
          </Result>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <h2>{t("settings.info")}</h2>
          <Result state={status}>
            <p>
              {t("settings.runtime", { runtime: status.data?.runtime ?? "" })}
            </p>
            <p>
              {t("settings.attempts", {
                count: status.data?.retryPolicy.maxAttempts ?? 0,
              })}
            </p>
            <p className="muted">
              {t("settings.retention")}
            </p>
          </Result>
        </CardContent>
      </Card>
    </div>
  );
}
const pages = [
  "nav.overview",
  "nav.feeds",
  "nav.channels",
  "nav.deliveries",
  "nav.settings",
];
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
  const { t } = useTranslation();
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
  useEffect(() => {
    const clearFeedback = () => {
      setMessage("");
      setError("");
    };
    i18n.on("languageChanged", clearFeedback);
    return () => {
      i18n.off("languageChanged", clearFeedback);
    };
  }, []);
  const lock = useRef(false);
  const logout = useCallback(() => {
    setSession("signed-out");
    setMessage("");
    setError(i18n.t("auth.expired"));
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
      setError(e instanceof Error ? e.message : t("error.operation"));
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
        <p role="status" className="muted">{t("auth.checking")}</p>
      </main>
    );
  }
  if (session === "signed-out") {
    return (
      <main className="login">
        <div className="brand">PushRSS</div>
        <h1>{t("auth.title")}</h1>
        <LanguageSelector />
        <p className="muted">{t("auth.description")}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const password = String(
              new FormData(e.currentTarget).get("password") ?? "",
            );
            if (await run(() => createSession(password), t("auth.connected"))) {
              setSession("signed-in");
            }
          }}
        >
          <Field label={t("auth.password")}>
            <Input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("auth.placeholder")}
            />
          </Field>
          <p className="muted">
            {t("auth.session")}
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? t("auth.connecting") : t("auth.submit")}
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
          <nav aria-label={t("nav.main")}>
            {pages.map((p, i) => (
              <Button
                type="button"
                key={t(p)}
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
                {t(p)}
              </Button>
            ))}
          </nav>
        </aside>
        <main>
          <header className="section-head">
            <div>
              <p className="eyebrow">
                {t("nav.breadcrumb", { page: t(pages[page]) })}
              </p>
              <h1>{t(pages[page])}</h1>
            </div>
            <div className="actions">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => setRevision((n) => n + 1)}
              >
                {t("common.refresh")}
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={async () => {
                  if (await run(() => deleteSession(), t("auth.signedOut"))) {
                    setSession("signed-out");
                    setMessage("");
                    setError("");
                  }
                }}
              >
                {t("auth.signOut")}
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
createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>,
);
