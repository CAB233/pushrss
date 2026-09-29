import { parseFeed as parseSyndicationFeed } from "@feed/parser";
import type { FeedItem } from "../shared/contracts.ts";

type Node = Record<string, unknown>;

const node = (value: unknown): Node =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Node
    : {};
const array = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|apos|quot);/gi,
    (entity, reference: string) => {
      if (reference[0] !== "#") {
        return {
          amp: "&",
          apos: "'",
          gt: ">",
          lt: "<",
          quot: '"',
        }[reference.toLowerCase()] ?? entity;
      }
      const radix = reference[1].toLowerCase() === "x" ? 16 : 10;
      const digits = reference.slice(radix === 16 ? 2 : 1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isInteger(codePoint) && codePoint >= 0 &&
          codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function text(value: unknown, isXml = true): string | null {
  const candidate = typeof value === "string"
    ? value
    : typeof node(value)["#text"] === "string"
    ? node(value)["#text"] as string
    : null;
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  return isXml ? decodeXml(trimmed) : trimmed;
}

function escapeXmlText(value: string, preserveReferences: boolean): string {
  const escapedAmpersands = preserveReferences
    ? value.replace(
      /&(?!#(?:x[\da-f]+|\d+);|amp;|lt;|gt;|apos;|quot;)/gi,
      "&amp;",
    )
    : value.replaceAll("&", "&amp;");
  return escapedAmpersands.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function prepareXml(xml: string): { xml: string; feedTitleMissing: boolean } {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("Feed XML 格式无效");
  const outsideCdata = xml
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  if (
    /&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-f]+);)/i.test(outsideCdata)
  ) throw new Error("Feed XML 格式无效");

  let prepared = xml.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_match, content: string) => escapeXmlText(content, false),
  );

  const atomPrefixes = Array.from(
    prepared.matchAll(
      /xmlns:([\w.-]+)\s*=\s*(["'])http:\/\/www\.w3\.org\/2005\/Atom\2/gi,
    ),
    (match) => match[1],
  );
  for (const prefix of atomPrefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    prepared = prepared.replace(
      new RegExp(`(<\\/?\\s*)${escaped}:`, "g"),
      "$1",
    );
  }

  prepared = prepared.replace(
    /(<title\b[^>]*\btype\s*=\s*(["'])xhtml\2[^>]*>)([\s\S]*?)(<\/title\s*>)/gi,
    (
      _match,
      opening: string,
      _quote: string,
      content: string,
      closing: string,
    ) => opening + escapeXmlText(content, true) + closing,
  );

  const feedOpening = /<feed\b[^>]*>/i.exec(prepared);
  if (!feedOpening) return { xml: prepared, feedTitleMissing: false };
  const withoutEntries = prepared.replace(
    /<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi,
    "",
  );
  const feedBody = withoutEntries.slice(
    feedOpening.index + feedOpening[0].length,
  );
  if (/<title\b/i.test(feedBody)) {
    return { xml: prepared, feedTitleMissing: false };
  }
  const insertAt = feedOpening.index + feedOpening[0].length;
  return {
    xml: prepared.slice(0, insertAt) +
      "<title>PushRSS feed title placeholder</title>" +
      prepared.slice(insertAt),
    feedTitleMissing: true,
  };
}

function resolveUrl(value: unknown, base?: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const resolved = new URL(raw, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

function baseOf(value: unknown, base?: string): string | undefined {
  const resolved = resolveUrl(node(value)["@_xml:base"], base);
  return resolved ?? base;
}

function date(value: unknown): number | null {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : null;
}

function renderElement(name: string, value: unknown): string {
  return array(value).map((entry) => {
    if (typeof entry === "string") {
      return `<${name}>${escapeHtml(decodeXml(entry))}</${name}>`;
    }
    const fields = node(entry);
    const attributes = Object.entries(fields)
      .filter(([key]) => key.startsWith("@_"))
      .map(([key, attribute]) =>
        ` ${key.slice(2)}="${escapeHtml(text(attribute) ?? "")}"`
      ).join("");
    const body = renderXmlChildren(fields);
    return `<${name}${attributes}>${body}</${name}>`;
  }).join("");
}

function renderXmlChildren(value: Node): string {
  let result = typeof value["#text"] === "string"
    ? escapeHtml(decodeXml(value["#text"] as string))
    : "";
  for (const [name, child] of Object.entries(value)) {
    if (name.startsWith("@_") || name === "#text") continue;
    result += renderElement(name, child);
  }
  return result;
}

function xhtml(value: unknown): string | null {
  const fields = node(value);
  const markup = renderXmlChildren(
    Object.fromEntries(
      Object.entries(fields).filter(([key]) => !key.startsWith("@_")),
    ),
  );
  return markup || null;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function authors(value: unknown): string | null {
  const names = array(value).map((author) => {
    const person = node(author);
    return text(person.name) ?? text(person.email) ?? text(author);
  }).filter((name): name is string => name !== null);
  return names.length ? names.join(", ") : null;
}

export interface ParsedFeed {
  format: "rss" | "atom";
  title: string;
  siteUrl: string;
  items: FeedItem[];
}

/** 通过 @feed/parser 解析 Feed XML，再映射到 PushRSS 的标准文章模型。 */
export function parseFeed(xml: string, sourceUrl?: string): ParsedFeed {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("Feed XML 格式无效");
  if (/<(?:rdf:)?RDF\b/i.test(xml)) {
    const channel = /<channel\b[^>]*>([\s\S]*?)<\/channel\s*>/i.exec(xml);
    const items = Array.from(
      xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi),
      (match) => match[0],
    ).join("");
    if (!channel) throw new Error("Feed RDF 格式无效");
    xml = `<rss version="2.0"><channel>${channel[1]}${items}</channel></rss>`;
  }
  const prepared = prepareXml(xml);
  const parsed = parseSyndicationFeed(prepared.xml);
  if (parsed.format === "json") throw new Error("仅支持 RSS 与 Atom");

  const isRss = parsed.format === "rss";
  const rawDocument = node(parsed.raw);
  const rawRoot = node(rawDocument[isRss ? "rss" : "feed"]);
  const rawFeed = isRss ? node(rawRoot.channel) : rawRoot;
  const rootBase = isRss
    ? baseOf(rawFeed, baseOf(rawRoot, sourceUrl))
    : baseOf(rawFeed, sourceUrl);
  const rawItems = array(rawFeed[isRss ? "item" : "entry"]);

  return {
    format: parsed.format,
    title: prepared.feedTitleMissing ? "" : text(parsed.title) ?? "",
    siteUrl: resolveUrl(
      isRss ? rawFeed.link : node(
        array(rawFeed.link).find((link) =>
          !node(link)["@_rel"] || node(link)["@_rel"] === "alternate"
        ),
      )["@_href"],
      rootBase,
    ) ?? "",
    items: parsed.items.map((item, index): FeedItem => {
      const rawItem = node(rawItems[index]);
      const itemBase = baseOf(rawItem, rootBase);
      const rawLink = isRss
        ? rawItem.link
        : array(rawItem.link).map(node).find((link) => {
          const rel = text(link["@_rel"]);
          return !rel || rel === "alternate";
        });
      const link = resolveUrl(item.url, baseOf(rawLink, itemBase));
      const rawContent = rawItem.content;
      const contentType = text(node(rawContent)["@_type"]);
      const content = !isRss && contentType === "xhtml"
        ? xhtml(rawContent)
        : text(item.contentHtml) ?? text(item.contentText);
      const rawSummary = rawItem.summary;
      const summary = text(node(rawSummary)["@_type"]) === "xhtml"
        ? xhtml(rawSummary)
        : text(item.summary);
      const guid = text(rawItem[isRss ? "guid" : "id"]);
      const author = isRss
        ? text(rawItem["dc:creator"]) ?? text(rawItem.author)
        : authors(rawItem.author) ?? authors(parsed.authors);
      const publishedAt = date(item.datePublished) ??
        (isRss
          ? date(text(rawItem["dc:date"]) ?? "")
          : date(item.dateModified));

      return {
        guid,
        title: text(item.title) ?? "无标题",
        link,
        content,
        summary,
        author,
        publishedAt,
      };
    }),
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
    Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}
