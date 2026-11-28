"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, MoreHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MoreMenuItem = {
  label: string;
  group?: string;
  description?: string;
  onSelect: () => void;
  /** Shown last, after a separator, in the destructive colour. */
  destructive?: boolean;
  disabled?: boolean;
  /** Left out entirely, e.g. when the role can't use it. */
  hidden?: boolean;
  /** A toggle or a choice ("Show cancelled", a filter value): shown with a check when on. */
  checked?: boolean;
};

export type MoreMenuProps = {
  items: readonly MoreMenuItem[];
  /** Accessible name of the trigger. */
  label?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
};

const itemClass =
  "flex min-h-11 w-full cursor-default items-center rounded-md px-3 text-left text-sm font-medium outline-none select-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45";

/** The "⋯ More" overflow menu for rare actions. Renders nothing when every item is hidden. */
export function MoreMenu({ items, label = "More actions", disabled = false, align = "end", className }: MoreMenuProps) {
  // Inside a dialog or sheet the menu renders in it, so the dialog's focus trap and outside-click
  // handling treat it as part of the dialog.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useCallback((el: HTMLElement | null) => setContainer(el?.closest<HTMLElement>('[role="dialog"]') ?? null), []);
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  const regular = visible.filter((item) => !item.destructive);
  const groups = [...new Set(regular.map((item) => item.group))];
  const destructive = visible.filter((item) => item.destructive);

  const renderItem = (item: MoreMenuItem) => item.checked !== undefined ? (
    <Menu.CheckboxItem
      key={item.label}
      checked={item.checked}
      disabled={item.disabled}
      closeOnClick
      onCheckedChange={item.onSelect}
      className={cn(itemClass, "gap-2 ps-2")}
    >
      <span aria-hidden className="flex size-4 items-center justify-center">
        <Menu.CheckboxItemIndicator><Check className="size-4" /></Menu.CheckboxItemIndicator>
      </span>
      {item.label}
    </Menu.CheckboxItem>
  ) : (
    <Menu.Item
      key={item.label}
      disabled={item.disabled}
      onClick={item.onSelect}
      className={cn(
        itemClass,
        item.destructive && "text-destructive data-highlighted:bg-destructive/10 dark:data-highlighted:bg-destructive/20",
      )}
    >
      <span>{item.label}{item.description ? <span className="block text-xs font-normal text-muted-foreground">{item.description}</span> : null}</span>
    </Menu.Item>
  );

  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        aria-label={label}
        disabled={disabled}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11", className)}
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </Menu.Trigger>
      <Menu.Portal container={container ?? undefined}>
        <Menu.Positioner className="z-50 outline-none" align={align} sideOffset={6}>
          <Menu.Popup
            aria-label={label}
            className="max-h-(--available-height) min-w-[min(12rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none"
          >
            {groups.map((group, index) => {
              const entries = regular.filter((item) => item.group === group).map(renderItem);
              return group ? (
                <Menu.Group key={group}>
                  {index > 0 ? <Menu.Separator className="my-1 h-px bg-border" /> : null}
                  <Menu.GroupLabel className="px-3 pt-1 text-xs font-medium text-muted-foreground">{group}</Menu.GroupLabel>
                  {entries}
                </Menu.Group>
              ) : entries;
            })}
            {regular.length > 0 && destructive.length > 0 ? (
              <Menu.Separator className="my-1 h-px bg-border" />
            ) : null}
            {destructive.map(renderItem)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
