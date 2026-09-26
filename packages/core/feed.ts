import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import type { FeedItem } from "../shared/contracts.ts";

type Node = Record<string, unknown>;
const node = (v: unknown): Node =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Node : {};
const array = (v: unknown): unknown[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  return typeof v === "object" && v ? text(node(v)["#text"]) : null;
}
function markup(v: unknown): string | null {
  const n = node(v);
  if (n["@_type"] === "xhtml") {
    const children = Object.fromEntries(
      Object.entries(n).filter(([k]) => !k.startsWith("@_")),
    );
    return new XMLBuilder({ ignoreAttributes: false }).build(children).trim() ||
      null;
  }
  return text(v);
}
function url(value: unknown, base?: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const u = new URL(raw, base);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
const baseOf = (n: Node, base?: string) => url(n["@_xml:base"], base) ?? base;
function date(value: unknown): number | null {
  const raw = text(value);
  const result = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(result) ? result : null;
}
function author(value: unknown): string | null {
  return array(value).map((a) => text(node(a).name) ?? text(a)).filter(Boolean)
    .join(", ") || null;
}
export interface ParsedFeed {
  format: "rss" | "atom";
  title: string;
  items: FeedItem[];
}
function namespaces(
  value: unknown,
  inherited: Record<string, string> = {},
): unknown {
  if (Array.isArray(value)) return value.map((v) => namespaces(v, inherited));
  if (!value || typeof value !== "object") return value;
  const bindings = { ...inherited };
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith("@_xmlns:") && typeof v === "string") {
      bindings[key.slice(8)] = v;
    }
  }
  const result: Node = {};
  for (const [key, v] of Object.entries(value)) {
    const colon = key.indexOf(":");
    const prefix = key.slice(0, colon);
    const uri = node(v)[`@_xmlns:${prefix}`] ?? bindings[prefix];
    const local = key.slice(colon + 1);
    const name = !key.startsWith("@_") && colon > 0
      ? uri === "http://www.w3.org/2005/Atom"
        ? local
        : uri === "http://purl.org/rss/1.0/modules/content/"
        ? `content:${local}`
        : uri === "http://purl.org/dc/elements/1.1/"
        ? `dc:${local}`
        : key
      : key;
    result[name] = namespaces(v, bindings);
  }
  return result;
}
/** 保留 HTML 正文；渲染层负责按用途转义或净化。拒绝 DTD，避免自定义实体展开。 */
export function parseFeed(xml: string, sourceUrl?: string): ParsedFeed {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error("Feed XML 格式无效");
  }
  const doc = namespaces(new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: true,
  }).parse(xml)) as Node;
  const rss = node(doc.rss);
  const atom = node(doc.feed);
  const isRss = "channel" in rss;
  if (!isRss && !("feed" in doc)) throw new Error("仅支持 RSS 与 Atom");
  const root = isRss ? node(rss.channel) : atom;
  const base = baseOf(root, baseOf(rss, sourceUrl));
  const items = array(root[isRss ? "item" : "entry"]).map((value): FeedItem => {
    const item = node(value);
    const itemBase = baseOf(item, base);
    const alternate = array(item.link).map(node).find((l) =>
      !l["@_rel"] || l["@_rel"] === "alternate"
    );
    return {
      guid: text(isRss ? item.guid : item.id),
      title: markup(item.title) ?? "无标题",
      link: isRss
        ? url(item.link, itemBase)
        : url(alternate?.["@_href"], baseOf(alternate ?? {}, itemBase)),
      content: isRss ? text(item["content:encoded"]) : markup(item.content),
      summary: isRss ? text(item.description) : markup(item.summary),
      author: isRss
        ? text(item["dc:creator"]) ?? text(item.author)
        : author(item.author) ?? author(root.author),
      publishedAt: isRss
        ? date(item.pubDate) ?? date(item["dc:date"])
        : date(item.published) ?? date(item.updated),
    };
  });
  return {
    format: isRss ? "rss" : "atom",
    title: text(root.title) ?? "",
    items,
  };
}
/** 类型前缀隔离 GUID 与链接空间，回退使用结构化元组的 SHA-256。 */
export async function fingerprint(item: FeedItem): Promise<string> {
  if (item.guid) return `guid:${item.guid}`;
  if (item.link) return `link:${item.link}`;
  const bytes = new TextEncoder().encode(
    JSON.stringify([item.title, item.publishedAt]),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `hash:${
    Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}
