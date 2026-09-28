"use client";

import { Loader2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
            {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Undo
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7"
          aria-label="Dismiss"
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
