"use client";

import { Search, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

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
    <input
      ref={ref}
      type="checkbox"
      className="size-4 cursor-pointer accent-foreground"
      checked={checked}
      onChange={onChange}
      aria-label={label}
    />
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

type UndoState = { message: string; undo?: () => Promise<unknown>; id: number };
const UNDO_TIMEOUT_MS = 8000;

/** "Done · Undo" notice for reversible bulk actions, shown instead of a confirm dialog. */
export function useUndoNotice() {
  const [state, setState] = useState<UndoState | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!state) return;
    const timeout = window.setTimeout(() => setState((current) => (current?.id === state.id ? null : current)), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const show = useCallback((message: string, undo?: () => Promise<unknown>) => {
    setError("");
    setState({ message, undo, id: Date.now() });
  }, []);

  async function runUndo() {
    if (!state?.undo) return;
    setUndoing(true);
    try {
      await state.undo();
      setState(null);
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : "Unable to undo.");
    } finally {
      setUndoing(false);
    }
  }

  const element =
    state || error ? (
      <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border bg-gold/10 px-4 py-2 text-sm">
        <span className="text-foreground">{error || state?.message}</span>
        {state?.undo && !error ? (
          <Button type="button" size="sm" variant="outline" disabled={undoing} onClick={() => void runUndo()}>
            {undoing ? <Spinner label="Undoing" className="text-current" /> : <Undo2 className="h-4 w-4" />}
            Undo
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7"
          aria-label="Dismiss notice"
          onClick={() => {
            setState(null);
            setError("");
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    ) : null;

  return { show, element };
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
export function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative min-w-[14rem] flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-9 pl-9"
      />
    </div>
  );
}
