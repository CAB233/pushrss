export type ChannelType =
  | "serverchan"
  | "webhook"
  | "slack"
  | "discord"
  | "telegram"
  | "feishu"
  | "dingtalk"
  | "wecom";

export type FeedStatus = "pending" | "ok" | "error";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: string | null;
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  siteUrl: string;
  category: string;
  enabled: boolean;
  keywords: string[];
  channelIds: string[];
  status: FeedStatus;
  lastError: string | null;
  lastFetchedAt: string | null;
  itemCount: number;
  latestItems: FeedItem[];
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  targetPreview: string;
  hasToken: boolean;
  enabled: boolean;
  deliveredCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export interface DeliveryLog {
  id: string;
  at: string;
  feedTitle: string;
  channelName: string;
  channelType: ChannelType;
  itemTitle: string;
  itemLink: string;
  ok: boolean;
  error: string | null;
}

export interface RefreshResult {
  feedId: string;
  ok: boolean;
  newItems: number;
  delivered: number;
  failed: number;
  error?: string;
}
