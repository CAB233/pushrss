import { cn } from "../../lib/utils.ts";
import type { FeedStatus } from "../../lib/types.ts";

const STYLES: Record<FeedStatus, { dot: string; label: string }> = {
  ok: { dot: "bg-foreground", label: "正常" },
  error: { dot: "bg-destructive", label: "异常" },
  pending: { dot: "bg-muted-foreground/40", label: "待抓取" },
};

export function StatusDot(
  { status, className }: { status: FeedStatus; className?: string },
) {
  const style = STYLES[status];
  return (
    <span
      className={cn("relative inline-flex size-2.5 shrink-0", className)}
      title={style.label}
    >
      <span
        className={cn("relative inline-flex size-2.5 rounded-full", style.dot)}
      />
      <span className="sr-only">{style.label}</span>
    </span>
  );
}
