import type * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "../../lib/utils.ts";

export function Tabs(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>,
) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-5", className)}
      {...props}
    />
  );
}
export function TabsList(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>,
) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>,
) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-full shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>,
) {
  return (
    <TabsPrimitive.Content
      className={cn("min-w-0 outline-none", className)}
      {...props}
    />
  );
}
