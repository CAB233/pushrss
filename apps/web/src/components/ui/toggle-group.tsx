import type * as React from "react";
import { ToggleGroup as Primitive } from "radix-ui";
import { cn } from "../../lib/utils.ts";
export function ToggleGroup(
  { className, variant: _variant, size: _size, ...props }:
    & React.ComponentProps<typeof Primitive.Root>
    & { variant?: "outline"; size?: "sm" },
) {
  return (
    <Primitive.Root
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}
export function ToggleGroupItem(
  { className, ...props }: React.ComponentProps<typeof Primitive.Item>,
) {
  return (
    <Primitive.Item
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md border border-input bg-transparent px-2.5 text-sm font-medium shadow-xs hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
