import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Field, FieldGroup, FieldLabel } from "../ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { api, CHANNEL_META } from "../../lib/client.ts";
import type { Channel, ChannelType } from "../../lib/types.ts";

const TYPE_ITEMS = (Object.keys(CHANNEL_META) as ChannelType[]).map((
  value,
) => ({ value, label: CHANNEL_META[value].label }));

export function ChannelDialog(
  { open, onOpenChange, channel }: {
    channel?: Channel;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <ChannelForm
            key={channel?.id ?? "new"}
            channel={channel}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChannelForm(
  { onDone, channel }: { onDone: () => void; channel?: Channel },
) {
  const [type, setType] = useState<ChannelType>(channel?.type ?? "feishu");
  const [name, setName] = useState(channel?.name ?? "");
  const [target, setTarget] = useState(
    channel?.type === "telegram" ? channel.targetPreview : "",
  );
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = CHANNEL_META[type];
  const preserving = channel?.type === type;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(channel ? `/api/channels/${channel.id}` : "/api/channels", {
        method: channel ? "PATCH" : "POST",
        body: {
          type,
          name,
          ...(target.trim() ? { target: target.trim() } : {}),
          ...(type === "telegram" && token.trim()
            ? { token: token.trim() }
            : {}),
        },
      });
      toast.success(channel ? "推送渠道已更新" : "推送渠道已添加");
      await mutate("/api/channels");
      mutate("/api/logs");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{channel ? "编辑推送渠道" : "添加推送渠道"}</DialogTitle>
        <DialogDescription>
          {channel
            ? "凭据留空时保留原配置，切换渠道类型后填写新配置。"
            : "凭据仅保存在服务端，列表中只显示脱敏后的地址。"}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-5">
        <Field className="gap-2">
          <FieldLabel htmlFor="channel-type">渠道类型</FieldLabel>
          <Select
            value={type}
            onValueChange={(v) => {
              if (!v || v === type) return;
              setType(v as ChannelType);
              setTarget(
                v === channel?.type && v === "telegram"
                  ? channel.targetPreview
                  : "",
              );
              setToken("");
            }}
          >
            <SelectTrigger id="channel-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TYPE_ITEMS.map((item) => {
                  const Icon = CHANNEL_META[item.value].icon;
                  return (
                    <SelectItem key={item.value} value={item.value}>
                      <Icon aria-hidden="true" />
                      {item.label}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="channel-name">名称</FieldLabel>
          <Input
            id="channel-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：技术组飞书群"
          />
        </Field>

        {type === "telegram" && (
          <Field className="gap-2">
            <FieldLabel htmlFor="channel-token">Bot Token</FieldLabel>
            <Input
              id="channel-token"
              type="password"
              required={!preserving}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={preserving
                ? "留空保留当前 Bot Token"
                : "123456789:AA…"}
              className="font-mono text-sm"
            />
          </Field>
        )}

        <Field className="gap-2">
          <FieldLabel htmlFor="channel-target">{meta.targetLabel}</FieldLabel>
          <Input
            id="channel-target"
            required={!preserving}
            autoComplete="off"
            type={type === "serverchan"
              ? "password"
              : type === "telegram"
              ? "text"
              : "url"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={preserving
              ? `留空保留当前${meta.targetLabel}`
              : meta.placeholder}
            className="font-mono text-sm"
          />
        </Field>
      </FieldGroup>
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
          {channel ? "保存" : "添加渠道"}
        </Button>
      </DialogFooter>
    </form>
  );
}
