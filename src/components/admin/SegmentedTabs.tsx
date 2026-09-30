"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedTab<T extends string> = { value: T; label: ReactNode };

/** Ids that tie a tab to the panel it shows: spread `tabPanelProps(id, value)` on the panel. */
export function tabPanelProps(id: string, value: string) {
  return { role: "tabpanel", id: `${id}-panel-${value}`, "aria-labelledby": `${id}-tab-${value}` } as const;
}

/**
 * The one admin sub-navigation: an underlined row of tabs (`role="tablist"`, same look as the
 * staff section tabs) for view switches and status filters. Arrow keys, Home and End move
 * between tabs and select them. Pass `id` to link each tab to its panel (see `tabPanelProps`).
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  id,
  controls,
  fill = false,
  className,
}: {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  id?: string;
  /** Id of one shared panel (e.g. a filtered list), when the tabs filter instead of switching panels. */
  controls?: string;
  /** Stretch the tabs to fill the row. */
  fill?: boolean;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.value === value);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next === -1) return;
    event.preventDefault();
    onValueChange(tabs[next].value);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex max-w-full overflow-x-auto border-b border-border", fill ? "w-full" : "gap-6", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={id ? `${id}-tab-${tab.value}` : undefined}
            aria-selected={selected}
            aria-controls={id ? `${id}-panel-${tab.value}` : controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              fill && "flex-1 pt-1",
              selected
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
