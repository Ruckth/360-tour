"use client";

import { ChevronRight } from "lucide-react";
import {
  useEffect,
  useState,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type SegmentedTab<T extends string> = { value: T; label: ReactNode };

/** Ids that tie a tab to the panel it shows: spread `tabPanelProps(id, value)` on the panel. */
export function tabPanelProps(id: string, value: string) {
  return {
    role: "tabpanel",
    id: `${id}-panel-${value}`,
    "aria-labelledby": `${id}-tab-${value}`,
  } as const;
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

  const [overflow, setOverflow] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      // Reserve a separate button column instead of painting over a clipped tab label.
      setScrollable(list.scrollWidth > (list.parentElement?.clientWidth ?? list.clientWidth) + 2);
      setOverflow(list.scrollWidth - list.clientWidth - list.scrollLeft > 2);
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [tabs.length]);
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    // Move only the tab strip. scrollIntoView also moves the page when a below-fold
    // tab list (such as the dashboard breakdown) mounts.
    const row = list.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < row.left) list.scrollLeft += tab.left - row.left;
    else if (tab.right > row.right) list.scrollLeft += tab.right - row.right;
  }, [value]);

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
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <div className="flex min-w-0">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        // The baseline is an inset shadow, not a border, so the selected tab's underline sits on it
        // without overflowing the scroll box (which would clip the tab's touch area).
        className={cn(
          "flex min-w-0 max-w-full flex-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]",
          fill ? "w-full" : "gap-6",
          className,
        )}
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
                "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-medium pointer-coarse:min-h-11 pointer-coarse:min-w-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      {scrollable ? (
        <button type="button" aria-label="More tabs" disabled={!overflow} onClick={() => listRef.current?.scrollBy({ left: Math.max(160, listRef.current.clientWidth - 80), behavior: "smooth" })} className="flex min-h-11 w-11 shrink-0 items-center justify-center border-b border-border bg-background text-muted-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight aria-hidden className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
