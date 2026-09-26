import { parseFeed } from "./feed.ts";
export { fingerprint, parseFeed } from "./feed.ts";
export { fetchFeed } from "./fetch-feed.ts";
export function inspectFeed(
  xml: string,
): { format: "rss" | "atom"; title: string; count: number } {
  const feed = parseFeed(xml);
  return { format: feed.format, title: feed.title, count: feed.items.length };
}
export {
  dispatchItems,
  RETRY_POLICY,
  retryDelivery,
  sendDelivery,
  testChannel,
} from "./notifications.ts";
export { handleJob } from "./jobs.ts";
