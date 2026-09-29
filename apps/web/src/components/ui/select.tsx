import type * as React from "react";
import { Select as Primitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils.ts";
export const Select = Primitive.Root;
export const SelectValue = Primitive.Value;
export const SelectGroup = Primitive.Group;
export function SelectTrigger(
  { className, children, ...props }: React.ComponentProps<
    typeof Primitive.Trigger
  >,
) {
  return (
    <Primitive.Trigger
      className={cn(
        "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.Icon>
        <ChevronDown />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}
export function SelectContent(
  { className, children, ...props }: React.ComponentProps<
    typeof Primitive.Content
  >,
) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position="popper"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md",
          className,
        )}
        {...props}
      >
        <Primitive.ScrollUpButton className="flex justify-center py-1">
          <ChevronUp className="size-4" />
        </Primitive.ScrollUpButton>
        <Primitive.Viewport className="min-w-(--radix-select-trigger-width) p-1">
          {children}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="flex justify-center py-1">
          <ChevronDown className="size-4" />
        </Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
export function SelectItem(
  { className, children, ...props }: React.ComponentProps<
    typeof Primitive.Item
  >,
) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-4" />
        </Primitive.ItemIndicator>
      </span>
      <Primitive.ItemText>
        <span className="inline-flex items-center gap-2">{children}</span>
      </Primitive.ItemText>
    </Primitive.Item>
  );
}
