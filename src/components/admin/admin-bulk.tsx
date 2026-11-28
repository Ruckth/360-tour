"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** Checkbox selection over the rows currently on screen. Keys that scroll out of view are dropped. */
export function useSelection(visibleKeys: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const visible = new Set(visibleKeys);
  const selectedKeys = visibleKeys.filter((key) => selected.has(key));
  const allSelected = visibleKeys.length > 0 && selectedKeys.length === visibleKeys.length;

  return {
    selectedKeys,
    isSelected: (key: string) => selected.has(key) && visible.has(key),
    allSelected,
    someSelected: selectedKeys.length > 0 && !allSelected,
    toggle: (key: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(visibleKeys)),
    clear: () => setSelected(new Set()),
  };
}

export function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="inline-flex size-11 cursor-pointer items-center justify-center rounded focus-within:ring-2 focus-within:ring-ring">
    <input
      ref={ref}
      type="checkbox"
      className="size-4 cursor-pointer accent-foreground pointer-coarse:size-5"
      checked={checked}
      onChange={onChange}
      aria-label={label}
    />
    </label>
  );
}

/** Sticky bar shown while rows are selected: "3 selected" + actions + clear. */
export function BulkActionBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  noun: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={`Actions for selected ${noun}`}
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-muted/80 px-4 py-2 backdrop-blur"
    >
      <span className="text-sm font-medium text-foreground">
        {count} {noun} selected
      </span>
      {children}
      <Button type="button" size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        <X className="h-4 w-4" />
        Clear
      </Button>
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Classes for a table that stacks into one card per row below `lg`, so it never scrolls
 * sideways on tablets. Give each body cell a `data-label` so stacked cards keep their headings.
 */
export const STACKED_TABLE = {
  table: "block w-full text-left text-sm lg:table",
  head: "admin-eyebrow hidden border-b border-border bg-muted/40 lg:table-header-group",
  th: "px-4 py-3",
  body: "block lg:table-row-group",
  row: "grid gap-x-3 gap-y-3 border-b border-border px-4 py-4 last:border-b-0 lg:table-row lg:p-0",
  /** Row with a leading checkbox cell: the checkbox sits beside the stacked cells. */
  selectableRow: "grid-cols-[auto_minmax(0,1fr)] [&>td:not(:first-child)]:col-start-2",
  cell: "block min-w-0 lg:table-cell lg:px-4 lg:py-3 lg:align-top",
  labelled:
    "before:mb-1 before:block before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] lg:before:content-none",
} as const;

/** Placeholder rows while a list loads; announced once to screen readers. */
export function SkeletonRows({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="divide-y divide-border">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid gap-2 px-4 py-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/** Empty list message for the active filter, with the one action that helps next. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-3 px-4 py-10 text-center">
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** Search field for list toolbars; grows to fill the space left of the filters. */
export function SearchBox({ value, onChange, label, placeholder = label, className = "", maxLength }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string; className?: string; maxLength?: number }) {
  return (
    <div className={`relative min-w-[14rem] flex-1 ${className}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 pl-9"
      />
    </div>
  );
}
