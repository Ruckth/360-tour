"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { format } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Moon,
  RotateCcw,
  Settings2,
  Sun,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText, formatResortDate, formatResortTime, resortIsoDate } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

type Week = FunctionReturnType<typeof api.roster.getWeek>;
type Cell = Week["cells"][number];
type Conflict = Extract<FunctionReturnType<typeof api.roster.applyCells>, { ok: false }>["conflicts"][number];
type CopyResult = FunctionReturnType<typeof api.roster.copyWeek>;
type Plan = { shifts: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string; label: string }> };
type Pos = { row: number; col: number };
type Notice = { text: string; details?: string[] };
type ConflictState = { title: string; conflicts: Conflict[]; retry?: () => void };

/** Shift presets; client-side for now. */
const PRESETS: Array<Plan & { id: string; label: string; hint: string; icon: LucideIcon }> = [
  {
    id: "morning",
    label: "Morning",
    hint: "09:00–17:00, lunch 12:00–13:00",
    icon: Sun,
    shifts: [{ start: "09:00", end: "17:00" }],
    breaks: [{ start: "12:00", end: "13:00", label: "Lunch" }],
  },
  {
    id: "evening",
    label: "Evening",
    hint: "14:00–22:00, break 18:00–19:00",
    icon: Moon,
    shifts: [{ start: "14:00", end: "22:00" }],
    breaks: [{ start: "18:00", end: "19:00", label: "Break" }],
  },
];
const WEEK_CHOICES = ["4", "10", "20", "custom"] as const;

const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const fullDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-09-28" → local Date at midnight, for the day picker. */
function isoToLocalDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The Monday of the week containing `iso`. */
function mondayOf(iso: string) {
  return addDays(iso, -((new Date(utcDay(iso)).getUTCDay() + 6) % 7));
}

function weekRange(start: string, end: string) {
  const year = new Date(utcDay(end)).getUTCFullYear();
  return `${monthDay.format(utcDay(start))} – ${monthDay.format(utcDay(end))}, ${year}`;
}

const cellKey = (staffId: string, date: string) => `${staffId}|${date}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function StaffRosterView() {
  const [today] = useState(() => resortIsoDate(Date.now()));
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos>({ row: 0, col: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflicts, setConflicts] = useState<ConflictState | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);
  const drag = useRef<{ start: Pos; last: Pos; mode: "add" | "remove"; base: Set<string> } | null>(null);
  const confirm = useConfirm();

  const data = useQuery(api.roster.getWeek, { weekStart });
  const applyCells = useMutation(api.roster.applyCells);
  const resetCells = useMutation(api.roster.resetCells);
  const makeDefault = useMutation(api.roster.makeDefault);
  const undo = useMutation(api.roster.undo);

  const staff = useMemo(() => data?.staff ?? [], [data?.staff]);
  const dates = useMemo(() => data?.dates ?? [], [data?.dates]);
  const cells = useMemo(() => new Map((data?.cells ?? []).map((c) => [cellKey(c.staffId, c.date), c])), [data?.cells]);
  const allKeys = useMemo(() => staff.flatMap((s) => dates.map((date) => cellKey(s._id, date))), [staff, dates]);
  const selectedKeys = allKeys.filter((key) => selected.has(key));
  const allSelected = allKeys.length > 0 && selectedKeys.length === allKeys.length;
  const weekEnd = addDays(weekStart, 6);

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  function goToWeek(next: string) {
    setWeekStart(next);
    setSelected(new Set());
    setAnchor(null);
    setNotice(null);
    setError("");
  }

  const keyAt = (pos: Pos) => cellKey(staff[pos.row]._id, dates[pos.col]);

  function rect(a: Pos, b: Pos) {
    const keys: string[] = [];
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
      for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) keys.push(keyAt({ row, col }));
    }
    return keys;
  }

  /** Adds the keys, or removes them all when every one is already selected. */
  function toggleKeys(keys: string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const remove = keys.every((key) => current.has(key));
      for (const key of keys) {
        if (remove) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function paint(to: Pos) {
    const state = drag.current;
    if (!state) return;
    state.last = to;
    const next = new Set(state.base);
    for (const key of rect(state.start, to)) {
      if (state.mode === "add") next.add(key);
      else next.delete(key);
    }
    setSelected(next);
  }

  function onCellPointerDown(event: PointerEvent<HTMLTableCellElement>, pos: Pos) {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection while painting
    event.currentTarget.focus();
    // Touch pointers are captured by the first cell; release so the drag can reach other cells.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setFocus(pos);
    if (event.shiftKey && anchor) {
      const keys = rect(anchor, pos);
      setSelected((current) => new Set([...current, ...keys]));
      return;
    }
    setAnchor(pos);
    drag.current = { start: pos, last: pos, mode: selected.has(keyAt(pos)) ? "remove" : "add", base: new Set(selected) };
    paint(pos);
  }

  function onGridPointerMove(event: PointerEvent<HTMLTableElement>) {
    const state = drag.current;
    if (!state) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-row]");
    if (!target) return;
    const pos = { row: Number(target.dataset.row), col: Number(target.dataset.col) };
    if (pos.row !== state.last.row || pos.col !== state.last.col) paint(pos);
  }

  function moveFocus(pos: Pos) {
    setFocus(pos);
    gridRef.current?.querySelector<HTMLElement>(`[data-row="${pos.row}"][data-col="${pos.col}"]`)?.focus();
  }

  function onCellKeyDown(event: KeyboardEvent<HTMLTableCellElement>, pos: Pos) {
    const moves: Record<string, Pos> = {
      ArrowUp: { row: Math.max(0, pos.row - 1), col: pos.col },
      ArrowDown: { row: Math.min(staff.length - 1, pos.row + 1), col: pos.col },
      ArrowLeft: { row: pos.row, col: Math.max(0, pos.col - 1) },
      ArrowRight: { row: pos.row, col: Math.min(dates.length - 1, pos.col + 1) },
    };
    const next = moves[event.key];
    if (next) {
      event.preventDefault();
      moveFocus(next);
      if (event.shiftKey) {
        const from = anchor ?? pos;
        if (!anchor) setAnchor(pos);
        const keys = rect(from, next);
        setSelected((current) => new Set([...current, ...keys]));
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setAnchor(pos);
      toggleKeys([keyAt(pos)]);
    } else if (event.key === "Escape") {
      setSelected(new Set());
    } else if (event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelected(new Set(allKeys));
    }
  }

  function selectionCells() {
    return selectedKeys.map((key) => {
      const [staffId, date] = key.split("|");
      return { staffId: staffId as Id<"staff">, date };
    });
  }

  async function run<T>(task: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await task();
    } catch (err) {
      setError(errorText(err, fallback));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan(plan: Plan | "reset", label: string, skipConflicts = false, targets = selectionCells()) {
    if (!targets.length) return;
    const result = await run(
      () =>
        plan === "reset"
          ? resetCells({ cells: targets, skipConflicts })
          : applyCells({ cells: targets, ...plan, skipConflicts }),
      "Could not update the roster.",
    );
    if (!result) return;
    if (!result.ok) {
      const blocked = new Set(result.conflicts.map((c) => cellKey(c.staffId, c.date)));
      const others = targets.filter((c) => !blocked.has(cellKey(c.staffId, c.date)));
      setConflicts({
        title: `${label} would leave ${plural(result.conflicts.length, "appointment")} outside working hours`,
        conflicts: result.conflicts,
        retry: others.length ? () => void applyPlan(plan, label, true, targets) : undefined,
      });
      return;
    }
    setConflicts(null);
    setSelected(new Set());
    const details = [
      ...result.warnings.map((w) => `${w.staffName} has time off on ${fullDay.format(utcDay(w.date))} (${w.label}). Scheduled anyway.`),
      ...(result.skipped.length ? [`Skipped ${plural(new Set(result.skipped.map((c) => cellKey(c.staffId, c.date))).size, "cell")} with appointments.`] : []),
    ];
    setNotice({ text: result.changed ? `${label}: ${plural(result.changed, "cell")} updated.` : "Nothing to change.", details });
  }

  async function onMakeDefault() {
    const ok = await confirm({
      title: "Make this week the default?",
      description: `Each person's weekly default hours become what's shown for ${weekRange(weekStart, weekEnd)}. Days you changed individually in other weeks keep their changes.`,
      confirmLabel: "Make default",
    });
    if (!ok) return;
    const result = await run(() => makeDefault({ weekStart }), "Could not update the default hours.");
    if (!result) return;
    if (!result.ok) {
      setConflicts({ title: "The new default hours would leave appointments outside working hours", conflicts: result.conflicts });
      return;
    }
    setNotice({ text: result.staffUpdated ? `Default hours updated for ${plural(result.staffUpdated, "person")}.` : "This week already matches the default." });
  }

  async function onUndo(batchId: Id<"rosterBatches">) {
    const result = await run(() => undo({ batchId }), "Could not undo.");
    if (!result) return;
    if (!result.ok) {
      setConflicts({ title: "Undo would leave appointments booked since outside working hours", conflicts: result.conflicts });
      return;
    }
    setNotice({ text: "Undone." });
  }

  function onCopied(result: CopyResult, weeks: number) {
    setCopyOpen(false);
    const parts = [`${result.created} added`, `${result.updated} replaced`];
    if (result.skippedCount) parts.push(`${result.skippedCount} skipped`);
    setNotice({
      text: `Copied to the next ${plural(weeks, "week")}: ${parts.join(", ")}.${result.running ? " Finishing in the background…" : ""}`,
    });
  }

  const lastBatch = data?.lastBatch ?? null;
  const focusPos = { row: Math.min(focus.row, Math.max(0, staff.length - 1)), col: Math.min(focus.col, 6) };

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="size-9" aria-label="Previous week" onClick={() => goToWeek(addDays(weekStart, -7))}>
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => goToWeek(mondayOf(today))} disabled={weekStart === mondayOf(today)}>
            Today
          </Button>
          <Button size="icon" variant="ghost" className="size-9" aria-label="Next week" onClick={() => goToWeek(addDays(weekStart, 7))}>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="text-sm" aria-label={`Week of ${weekRange(weekStart, weekEnd)}. Choose another week`}>
                <CalendarDays aria-hidden className="size-4" />
                {weekRange(weekStart, weekEnd)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <Calendar
                mode="single"
                weekStartsOn={1}
                selected={isoToLocalDate(weekStart)}
                defaultMonth={isoToLocalDate(weekStart)}
                onSelect={(day) => {
                  if (!day) return;
                  goToWeek(mondayOf(format(day, "yyyy-MM-dd")));
                  setPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {data === undefined ? <Loader2 aria-label="Loading" className="size-4 animate-spin text-gold" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
          <Button size="sm" variant="outline" disabled={!data || busy || !staff.length} onClick={onMakeDefault}>
            Make this week the default
          </Button>
          <Button size="sm" disabled={!data || busy || !staff.length} onClick={() => setCopyOpen(true)}>
            <Copy aria-hidden className="size-4" />
            Copy this week →
          </Button>
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="Change selected cells"
        className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5"
      >
        <span className="min-w-24 text-sm font-medium" aria-live="polite">
          {selectedKeys.length ? `${plural(selectedKeys.length, "cell")} selected` : "Select cells"}
        </span>
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            size="sm"
            variant="outline"
            title={preset.hint}
            disabled={!selectedKeys.length || busy}
            onClick={() => applyPlan(preset, preset.label)}
          >
            <preset.icon aria-hidden className="size-4" />
            {preset.label}
            <span className="font-normal text-muted-foreground">{preset.shifts[0].start}–{preset.shifts[0].end}</span>
          </Button>
        ))}
        <Button size="sm" variant="outline" disabled={!selectedKeys.length || busy} onClick={() => setCustomOpen(true)}>
          <Settings2 aria-hidden className="size-4" />
          Custom…
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedKeys.length || busy}
          onClick={() => applyPlan({ shifts: [], breaks: [] }, "Off")}
        >
          Off
        </Button>
        <Button size="sm" variant="ghost" disabled={!selectedKeys.length || busy} onClick={() => applyPlan("reset", "Reset to default")}>
          <RotateCcw aria-hidden className="size-4" />
          Reset to default
        </Button>
        {selectedKeys.length ? (
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setSelected(new Set())}>
            <X aria-hidden className="size-4" />
            Clear selection
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice || lastBatch ? (
        <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p>{notice?.text ?? `Last change: ${lastBatch?.label}.`}</p>
            {notice?.details?.map((detail) => (
              <p key={detail} className="text-xs text-amber-700 dark:text-amber-400">
                {detail}
              </p>
            ))}
          </div>
          {lastBatch ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || lastBatch.running}
              title={lastBatch.label}
              onClick={() => onUndo(lastBatch.batchId)}
            >
              <Undo2 aria-hidden className="size-4" />
              {lastBatch.running ? "Copying…" : "Undo"}
            </Button>
          ) : null}
          {notice ? (
            <Button size="icon" variant="ghost" className="size-9" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table
          ref={gridRef}
          role="grid"
          aria-multiselectable="true"
          aria-label={`Roster for ${weekRange(weekStart, weekEnd)}`}
          className="w-full min-w-[56rem] table-fixed border-collapse text-sm"
          onPointerMove={onGridPointerMove}
        >
          <colgroup>
            <col className="w-52" />
            {dates.map((date) => (
              <col key={date} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border p-0 text-start">
                <button
                  type="button"
                  className="flex h-12 w-full items-center px-4 text-xs font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(allKeys))}
                >
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              </th>
              {dates.map((date, col) => {
                const columnKeys = staff.map((s) => cellKey(s._id, date));
                const full = columnKeys.length > 0 && columnKeys.every((key) => selected.has(key));
                return (
                  <th key={date} scope="col" className="border-b border-l border-border p-0">
                    <button
                      type="button"
                      aria-pressed={full}
                      aria-label={`Select ${fullDay.format(utcDay(date))}`}
                      className={cn(
                        "flex h-12 w-full flex-col items-center justify-center text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        full && "bg-navy/10",
                      )}
                      onClick={(event) => {
                        if (event.shiftKey && anchor) {
                          const keys = rect({ row: 0, col: anchor.col }, { row: staff.length - 1, col });
                          setSelected((current) => new Set([...current, ...keys]));
                        } else {
                          setAnchor({ row: 0, col });
                          toggleKeys(columnKeys);
                        }
                      }}
                    >
                      <span className="font-medium text-muted-foreground">{weekdayShort.format(utcDay(date))}</span>
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 items-center justify-center rounded-full text-sm font-semibold",
                          date === today && "bg-navy text-white",
                        )}
                      >
                        {new Date(utcDay(date)).getUTCDate()}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map((person, row) => {
              const rowKeys = dates.map((date) => cellKey(person._id, date));
              const full = rowKeys.every((key) => selected.has(key));
              return (
                <tr key={person._id}>
                  <th scope="row" className="border-t border-border p-0 text-start font-normal">
                    <button
                      type="button"
                      aria-pressed={full}
                      aria-label={`Select ${person.name}'s week`}
                      className={cn(
                        "flex h-20 w-full items-center gap-2.5 px-4 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        full && "bg-navy/10",
                      )}
                      onClick={(event) => {
                        if (event.shiftKey && anchor) {
                          const keys = rect({ row: anchor.row, col: 0 }, { row, col: dates.length - 1 });
                          setSelected((current) => new Set([...current, ...keys]));
                        } else {
                          setAnchor({ row, col: 0 });
                          toggleKeys(rowKeys);
                        }
                      }}
                    >
                      <StaffAvatar staff={person} className="size-8" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{person.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{person.role}</span>
                      </span>
                    </button>
                  </th>
                  {dates.map((date, col) => {
                    const cell = cells.get(cellKey(person._id, date));
                    if (!cell) return <td key={date} className="border-t border-l border-border" />;
                    const isSelected = selected.has(cellKey(person._id, date));
                    const isFocus = focusPos.row === row && focusPos.col === col;
                    return (
                      <td
                        key={date}
                        role="gridcell"
                        data-row={row}
                        data-col={col}
                        tabIndex={isFocus ? 0 : -1}
                        aria-selected={isSelected}
                        aria-label={cellLabel(person.name, cell)}
                        onPointerDown={(event) => onCellPointerDown(event, { row, col })}
                        onKeyDown={(event) => onCellKeyDown(event, { row, col })}
                        onFocus={() => setFocus({ row, col })}
                        className={cn(
                          "relative h-20 cursor-pointer border-t border-l border-border p-0 align-top select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          date === today && "bg-muted/40",
                          isSelected && "bg-navy/10 shadow-[inset_0_0_0_2px_var(--color-navy)]",
                        )}
                      >
                        <CellContent cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !staff.length ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No active staff yet. Add people on the{" "}
            <Link href={adminStaffTabPath("staff")} className="underline underline-offset-4">
              Staff
            </Link>{" "}
            tab.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-gold" />
          Changed from the weekly default
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-border" />
          Weekly default
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-400/15 dark:text-amber-300">
            Leave
          </span>
          Time off
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarDays aria-hidden className="size-3" />
          Appointments
        </span>
        <span className="ms-auto hidden lg:inline">
          Click or drag to select. Shift-click for a range. Click a name or day to select the whole row or column.
        </span>
      </div>

      {customOpen ? (
        <CustomShiftDialog
          count={selectedKeys.length}
          onClose={() => setCustomOpen(false)}
          onApply={(plan) => {
            setCustomOpen(false);
            void applyPlan(plan, `${plan.shifts[0].start}–${plan.shifts[0].end}`);
          }}
        />
      ) : null}
      {copyOpen ? (
        <CopyWeekDialog weekStart={weekStart} onClose={() => setCopyOpen(false)} onDone={onCopied} />
      ) : null}
      <ConflictsDialog state={conflicts} busy={busy} onClose={() => setConflicts(null)} />
    </section>
  );
}

function cellLabel(name: string, cell: Cell) {
  const hours = cell.shifts.length ? cell.shifts.map((s) => `${s.start} to ${s.end}`).join(" and ") : "off";
  return [
    `${name}, ${fullDay.format(utcDay(cell.date))}: ${hours}`,
    cell.override ? "changed from default" : "",
    cell.timeOff.length ? `time off: ${cell.timeOff.join(", ")}` : "",
    cell.appointments ? plural(cell.appointments, "appointment") : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function CellContent({ cell }: { cell: Cell }) {
  return (
    <div className="flex h-full flex-col gap-0.5 px-2.5 py-2 text-xs">
      <span
        aria-hidden
        className={cn("absolute inset-y-1.5 start-0 w-1 rounded-e-full", cell.override ? "bg-gold" : "bg-transparent")}
      />
      {cell.shifts.length ? (
        cell.shifts.map((shift) => (
          <span key={shift.start} className="font-semibold text-foreground tabular-nums">
            {shift.start}–{shift.end}
          </span>
        ))
      ) : (
        <span className="font-medium text-muted-foreground">Off</span>
      )}
      {cell.breaks.length ? (
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
          {cell.breaks[0].label} {cell.breaks[0].start}–{cell.breaks[0].end}
          {cell.breaks.length > 1 ? ` +${cell.breaks.length - 1}` : ""}
        </span>
      ) : null}
      <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1">
        {cell.timeOff.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="max-w-full truncate rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-400/15 dark:text-amber-300"
          >
            {label}
          </span>
        ))}
        {cell.appointments ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[11px] font-medium text-foreground">
            <CalendarDays aria-hidden className="size-3" />
            {cell.appointments}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function CustomShiftDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (plan: Plan) => void }) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const [start, end, breakStart, breakEnd] = ["start", "end", "breakStart", "breakEnd"].map(text);
    if (!start || !end || start >= end) return setError("Start must be before end.");
    if (Boolean(breakStart) !== Boolean(breakEnd)) return setError("Give the break a start and an end, or leave both empty.");
    if (breakStart && (breakStart >= breakEnd || breakStart < start || breakEnd > end)) {
      return setError("The break must fit inside the shift.");
    }
    onApply({
      shifts: [{ start, end }],
      breaks: breakStart ? [{ start: breakStart, end: breakEnd, label: text("breakLabel") || "Break" }] : [],
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Custom hours</DialogTitle>
            <DialogDescription>Applies to {plural(count, "selected cell")}. Times are resort time.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <TimeField name="start" label="Start" defaultValue="10:00" required />
            <TimeField name="end" label="End" defaultValue="18:00" required />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Break (optional)</legend>
            <div className="grid grid-cols-3 gap-3">
              <TimeField name="breakStart" label="From" />
              <TimeField name="breakEnd" label="To" />
              <div className="space-y-1.5">
                <Label htmlFor="roster-break-label" className="text-xs text-muted-foreground">
                  Label
                </Label>
                <Input id="roster-break-label" name="breakLabel" placeholder="Lunch" />
              </div>
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({ name, label, defaultValue, required }: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  const id = `roster-${name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} name={name} type="time" step={900} defaultValue={defaultValue} required={required} />
    </div>
  );
}

function CopyWeekDialog({
  weekStart,
  onClose,
  onDone,
}: {
  weekStart: string;
  onClose: () => void;
  onDone: (result: CopyResult, weeks: number) => void;
}) {
  const copyWeek = useMutation(api.roster.copyWeek);
  const [choice, setChoice] = useState<(typeof WEEK_CHOICES)[number]>("10");
  const [custom, setCustom] = useState("12");
  const [conflict, setConflict] = useState<"skip" | "overwrite">("skip");
  const [preview, setPreview] = useState<{ key: string; result?: CopyResult; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const weeks = choice === "custom" ? Number(custom) : Number(choice);
  const valid = Number.isInteger(weeks) && weeks >= 1 && weeks <= 52;
  const key = `${weekStart}|${weeks}|${conflict}`;
  const current = preview?.key === key ? preview : null;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      copyWeek({ sourceWeekStart: weekStart, weeks, conflict, dryRun: true })
        .then((result) => !cancelled && setPreview({ key, result }))
        .catch((err: unknown) => !cancelled && setPreview({ key, error: errorText(err, "Could not preview the copy.") }));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [copyWeek, weekStart, weeks, conflict, valid, key]);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      onDone(await copyWeek({ sourceWeekStart: weekStart, weeks, conflict }), weeks);
    } catch (err) {
      setError(errorText(err, "Could not copy the week."));
    } finally {
      setSaving(false);
    }
  }

  const result = current?.result;
  const firstTarget = addDays(weekStart, 7);
  const lastTarget = addDays(weekStart, 7 * (valid ? weeks : 1) + 6);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy this week forward</DialogTitle>
          <DialogDescription>
            Repeats {weekRange(weekStart, addDays(weekStart, 6))} for the weeks after it
            {valid ? ` (${weekRange(firstTarget, lastTarget)})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">How many weeks</p>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup value={choice} onValueChange={setChoice} aria-label="Number of weeks">
                {WEEK_CHOICES.map((value) => (
                  <ToggleGroupItem key={value} value={value}>
                    {value === "custom" ? "Custom" : `${value} weeks`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {choice === "custom" ? (
                <Input
                  aria-label="Weeks (1–52)"
                  type="number"
                  min={1}
                  max={52}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  className="w-24"
                />
              ) : null}
            </div>
            {!valid ? <p className="text-xs text-destructive">Choose 1–52 weeks.</p> : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Days already changed in those weeks</p>
            <ToggleGroup value={conflict} onValueChange={setConflict} aria-label="Days already changed">
              <ToggleGroupItem value="skip">Keep them</ToggleGroupItem>
              <ToggleGroupItem value="overwrite">Overwrite</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div aria-live="polite" className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
            {!valid ? (
              <span className="text-muted-foreground">—</span>
            ) : current?.error ? (
              <span className="text-destructive">{current.error}</span>
            ) : !result ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Checking…
              </span>
            ) : (
              <>
                <p className="font-medium">
                  Adds {result.created}, replaces {result.updated}, skips {result.skippedCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.unchanged} already match. Days that follow the weekly default stay on the default.
                </p>
                {result.skipped.length ? (
                  <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                    {result.skipped.map((cell) => (
                      <li key={cellKey(cell.staffId, cell.date)} className="flex gap-2">
                        <span className="w-32 shrink-0 font-medium">{fullDay.format(utcDay(cell.date))}</span>
                        <span className="min-w-0 truncate">
                          {cell.staffName} —{" "}
                          {cell.reason === "override"
                            ? "already changed"
                            : `${plural(cell.appointments, "appointment")} would fall outside`}
                        </span>
                      </li>
                    ))}
                    {result.skippedCount > result.skipped.length ? (
                      <li className="text-muted-foreground">and {result.skippedCount - result.skipped.length} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid || saving || !result} onClick={submit}>
            {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Copy aria-hidden className="size-4" />}
            Copy to {valid ? plural(weeks, "week") : "weeks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConflictsDialog({ state, busy, onClose }: { state: ConflictState | null; busy: boolean; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>
            Nothing was changed. Move or cancel these appointments on the calendar first
            {state?.retry ? ", or apply the change to the other cells only" : ""}.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
          {state?.conflicts.map((c) => (
            <li key={`${c.appointmentId}-${c.date}`} className="flex flex-wrap gap-x-3 px-3 py-2">
              <span className="font-medium">{c.staffName}</span>
              <span className="text-muted-foreground">
                {formatResortDate(c.start)}, {formatResortTime(c.start)}–{formatResortTime(c.end)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {c.guestName} · {c.serviceName}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link href={adminStaffTabPath("calendar")}>Open calendar</Link>
          </Button>
          {state?.retry ? (
            <Button type="button" disabled={busy} onClick={state.retry}>
              Apply to the other cells
            </Button>
          ) : (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
