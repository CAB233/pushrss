import useSWR from "swr";
import {
  Bell,
  Building2,
  Feather,
  Gamepad2,
  Hash,
  type LucideIcon,
  Send,
  Webhook,
} from "lucide-react";
import type { Channel, ChannelType, DeliveryLog, Feed } from "./types.ts";

export async function api<T = unknown>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  if (url === "/api/stats") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    url += `?start=${start.getTime()}&end=${end.getTime()}`;
  }
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    globalThis.dispatchEvent(new Event("session-expired"));
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ?? `请求失败 (${res.status})`,
    );
  }
  return data as T;
}

const fetcher = <T>(url: string) => api<T>(url);

export const useFeeds = () =>
  useSWR<Feed[]>("/api/feeds", fetcher, { refreshInterval: 3000 });
export const useChannels = () =>
  useSWR<Channel[]>("/api/channels", fetcher, { refreshInterval: 5000 });
export const useLogs = () =>
  useSWR<DeliveryLog[]>("/api/logs", fetcher, { refreshInterval: 15000 });
export const useStats = () =>
  useSWR<{ sentToday: number }>("/api/stats", fetcher, {
    refreshInterval: 5000,
  });

export interface ChannelMeta {
  label: string;
  icon: LucideIcon;
  targetLabel: string;
  placeholder: string;
}

export const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  serverchan: {
    label: "Server酱³",
    icon: Bell,
    targetLabel: "SendKey",
    placeholder: "sctp…",
  },
  webhook: {
    label: "通用 Webhook",
    icon: Webhook,
    targetLabel: "Webhook 地址",
    placeholder: "https://example.com/hooks/rss",
  },
  feishu: {
    label: "飞书机器人",
    icon: Feather,
    targetLabel: "Webhook 地址",
    placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
  },
  dingtalk: {
    label: "钉钉机器人",
    icon: Bell,
    targetLabel: "Webhook 地址",
    placeholder: "https://oapi.dingtalk.com/robot/send?access_token=…",
  },
  wecom: {
    label: "企业微信机器人",
    icon: Building2,
    targetLabel: "Webhook 地址",
    placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
  },
  telegram: {
    label: "Telegram",
    icon: Send,
    targetLabel: "Chat ID",
    placeholder: "-1001234567890 或 @channel_name",
  },
  slack: {
    label: "Slack",
    icon: Hash,
    targetLabel: "Incoming Webhook",
    placeholder: "https://hooks.slack.com/services/…",
  },
  discord: {
    label: "Discord",
    icon: Gamepad2,
    targetLabel: "Webhook 地址",
    placeholder: "https://discord.com/api/webhooks/…",
  },
};

export function relativeTime(iso: string | null): string {
  if (!iso) return "从未";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function parseKeywords(input: string): string[] {
  return input
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}
