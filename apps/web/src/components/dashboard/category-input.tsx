import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.tsx";

interface CategoryInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  categories: readonly string[];
}

export function CategoryInput({
  id,
  value,
  onChange,
  categories,
}: CategoryInputProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState({
    width: undefined as number | undefined,
    alignOffset: 0,
    sideOffset: 4,
  });

  useLayoutEffect(() => {
    const group = groupRef.current;
    const trigger = triggerRef.current;
    if (!open || !group || !trigger) return;

    const updateLayout = () => {
      const fieldBounds = group.getBoundingClientRect();
      const triggerBounds = trigger.getBoundingClientRect();
      setMenuLayout({
        width: fieldBounds.width,
        alignOffset: triggerBounds.right - fieldBounds.right,
        sideOffset: fieldBounds.bottom - triggerBounds.bottom + 4,
      });
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(group);
    return () => observer.disconnect();
  }, [open]);

  return (
    <InputGroup ref={groupRef} className="min-w-0">
      <InputGroupInput
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入或选择分类"
      />
      <InputGroupAddon align="inline-end">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <InputGroupButton
              ref={triggerRef}
              size="icon-xs"
              aria-label="选择已有分类"
              disabled={categories.length === 0}
            >
              <ChevronDown aria-hidden="true" />
            </InputGroupButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            alignOffset={menuLayout.alignOffset}
            sideOffset={menuLayout.sideOffset}
            style={{ width: menuLayout.width }}
            className="max-h-60 min-w-0"
          >
            <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
              {categories.map((category) => (
                <DropdownMenuRadioItem key={category} value={category}>
                  <span className="truncate">{category}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
    </InputGroup>
  );
}
