"use client";

import { CustomShiftDialog, type Plan } from "./CustomShiftDialog";
import { CopyWeekDialog, type CopyResult } from "./RosterCopyWeekDialog";
import { cellKey, fullDay, plural, weekRange } from "./roster-format";
import { addDays } from 'convex/shared/dates';
import { RecordHistoryPanel } from "./RecordHistoryPanel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "@/platform/link";
import { useSearchParams } from "@/platform/navigation";
import { parseStaffRosterLink } from "@/lib/staff-links";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Moon,
  RotateCcw,
  Settings2,
  Sun,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { TONES } from "@/components/admin/status-tones";
import { Button, ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Toast, useToast } from "@/components/ui/toast";
import { appointmentGuestLabel, errorText, resortIsoDate } from "@/lib/staff-bookings";
import { staffDate, staffTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type Week = FunctionReturnType<typeof api.services.roster.getWeek>;
type Cell = Week["cells"][number];
type Conflict = Extract<FunctionReturnType<typeof api.services.roster.applyCells>, { ok: false }>["conflicts"][number];
type Pos = { row: number; col: number };
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

const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** The Monday of the week containing `iso`. */
function mondayOf(iso: string) {
  return addDays(iso, -((new Date(utcDay(iso)).getUTCDay() + 6) % 7));
}


export function StaffRosterView() {
  const [historyPerson, setHistoryPerson] = useState("");
  const [today] = useState(() => resortIsoDate(Date.now()));
  // A deep link (?date=&staff=) opens that week with that person's day selected.
  const searchParams = useSearchParams();
  const [link] = useState(() => parseStaffRosterLink(searchParams));
  const [weekStart, setWeekStart] = useState(() => mondayOf(link.date ?? today));
  const [selected, setSelected] = useState<Set<string>>(() => (link.date && link.staffId ? new Set([cellKey(link.staffId, link.date)]) : new Set()));
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos>({ row: 0, col: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Successes go to the toast; warnings about the change (time off, skipped cells) stay here.
  const [warnings, setWarnings] = useState<string[]>([]);
  const toast = useToast();
  const [conflicts, setConflicts] = useState<ConflictState | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);
  const drag = useRef<{ start: Pos; last: Pos; mode: "add" | "remove"; base: Set<string> } | null>(null);
  // The selection when the anchor was set: Shift extends from it, so the range can shrink as well as grow.
  const anchorBase = useRef<Set<string>>(new Set());
  const confirm = useConfirm();
  // Phones get one day at a time (no 56rem grid to pan); selection, presets and Custom… are the same.
  const phone = useIsMobile(640);
  const [showWeek, setShowWeek] = useState(false);
  const dayView = phone && !showWeek;
  const [dayCol, setDayCol] = useState(() => (new Date(utcDay(link.date ?? today)).getUTCDay() + 6) % 7);

  const data = useQuery(api.services.roster.getWeek, { weekStart });
  const historyStaff = useQuery(api.services.admin.listStaff, { includeArchived: true }) ?? [];
  const applyCells = useMutation(api.services.roster.applyCells);
  const resetCells = useMutation(api.services.roster.resetCells);
  const makeDefault = useMutation(api.services.roster.makeDefault);
  const undo = useMutation(api.services.roster.undo);

  const staff = useMemo(() => data?.staff ?? [], [data?.staff]);
  const dates = useMemo(() => data?.dates ?? [], [data?.dates]);
  const cells = useMemo(() => new Map((data?.cells ?? []).map((c) => [cellKey(c.staffId, c.date), c])), [data?.cells]);
  const allKeys = useMemo(() => staff.flatMap((s) => dates.map((date) => cellKey(s._id, date))), [staff, dates]);
  const selectedKeys = allKeys.filter((key) => selected.has(key));
  const allSelected = allKeys.length > 0 && selectedKeys.length === allKeys.length;
  // D24: each selected day's plan as the operator saw it when selecting it. Saves send this, not whatever the live query shows at Apply.
  const reviewed = useRef(new Map<string, Plan & { note?: string }>());
  useEffect(() => {
    for (const key of [...reviewed.current.keys()]) if (!selected.has(key)) reviewed.current.delete(key);
    for (const key of selected) {
      const cell = cells.get(key);
      if (cell && !reviewed.current.has(key)) reviewed.current.set(key, planOf(cell));
    }
  }, [selected, cells]);
  const selectedOnDate = (date: string | undefined) => selectedKeys.filter((key) => key.endsWith(`|${date}`)).length;
  // D24: on phones only one day is visible, so selections on the other days are named, not hidden.
  const shownDay = dates[dayCol];
  const selectedElsewhere = dayView ? selectedKeys.length - selectedOnDate(shownDay) : 0;
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

  const focusedLink = useRef(false);
  useEffect(() => {
    if (focusedLink.current || !link.staffId || !link.date) return;
    const row = staff.findIndex((person) => person._id === link.staffId);
    const col = dates.indexOf(link.date);
    const target = gridRef.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
    if (!target) return;
    focusedLink.current = true;
    setFocus({ row, col });
    target.focus();
  }, [staff, dates, link.staffId, link.date]);

  /** Starts a new Shift range at `pos`, on top of the current selection. */
  function placeAnchor(pos: Pos) {
    setAnchor(pos);
    anchorBase.current = new Set(selected);
  }

  /** Replaces the whole selection; the next Shift range starts fresh. */
  function replaceSelection(next: Set<string>) {
    setSelected(next);
    setAnchor(null);
    anchorBase.current = new Set();
  }

  /** The selection when the anchor was set, plus these keys. */
  function extendSelection(keys: string[]) {
    setSelected(new Set([...anchorBase.current, ...keys]));
  }

  async function goToWeek(next: string) {
    if (next === weekStart) return;
    // D24: a pending selection is never dropped silently; nothing in it has been saved.
    if (selectedKeys.length && !(await confirm({
      title: `Clear ${plural(selectedKeys.length, "selected cell")}?`,
      description: `Changing week clears the selection in ${weekRange(weekStart, weekEnd)}. Nothing has been changed yet.`,
      confirmLabel: "Clear and change week",
    }))) return;
    setWeekStart(next);
    replaceSelection(new Set());
    setWarnings([]);
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
      extendSelection(rect(anchor, pos));
      return;
    }
    placeAnchor(pos);
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
        if (!anchor) placeAnchor(pos);
        extendSelection(rect(anchor ?? pos, next));
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      placeAnchor(pos);
      toggleKeys([keyAt(pos)]);
    } else if (event.key === "Escape") {
      replaceSelection(new Set());
    } else if (event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      replaceSelection(new Set(allKeys));
    }
  }

  function selectionCells() {
    return selectedKeys.map((key) => {
      const [staffId, date] = key.split("|");
      // The day as reviewed: the server refuses it if someone saved a different plan since.
      const cell = cells.get(key);
      const expectedPlan = reviewed.current.get(key) ?? (cell ? planOf(cell) : undefined);
      return { staffId: staffId as Id<"staff">, date, ...(expectedPlan ? { expectedPlan } : {}) };
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
    if (!result) {
      // Refused (for example, changed by someone else): keep the selection and review what is shown now before retrying.
      for (const target of targets) {
        const cell = cells.get(cellKey(target.staffId, target.date));
        if (cell) reviewed.current.set(cellKey(target.staffId, target.date), planOf(cell));
      }
      return;
    }
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
    replaceSelection(new Set());
    const details = [
      ...result.warnings.map((w) => `${w.staffName} has time off on ${fullDay.format(w.date)} (${w.label}). Scheduled anyway.`),
      ...(result.skipped.length ? [`Skipped ${plural(new Set(result.skipped.map((c) => cellKey(c.staffId, c.date))).size, "cell")} with appointments.`] : []),
    ];
    setWarnings(details);
    toast.show(result.changed ? `${label}: ${plural(result.changed, "cell")} updated.` : "Nothing to change.");
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
    setWarnings([]);
    toast.show(result.staffUpdated ? `Default hours updated for ${plural(result.staffUpdated, "person")}.` : "This week already matches the default.");
  }

  async function onUndo(batchId: Id<"rosterBatches">) {
    const result = await run(() => undo({ batchId }), "Could not undo.");
    if (!result) return;
    if (!result.ok) {
      setConflicts({ title: "Undo would leave appointments booked since outside working hours", conflicts: result.conflicts });
      return;
    }
    setWarnings([]);
    toast.show(result.running ? "Undoing in the background…" : "Undone.");
  }

  function onCopied(result: CopyResult, weeks: number) {
    setCopyOpen(false);
    const parts = [`${result.created} added`, `${result.updated} replaced`];
    if (result.skippedCount) parts.push(`${result.skippedCount} skipped`);
    setWarnings([]);
    toast.show(`Copied to the next ${plural(weeks, "week")}: ${parts.join(", ")}.${result.running ? " Finishing in the background…" : ""}`);
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
          <DatePicker
            value={weekStart}
            onValueChange={(value) => goToWeek(mondayOf(value))}
            weekStartsOn={1}
            triggerLabel={weekRange(weekStart, weekEnd)}
            size="sm"
            variant="ghost"
            className="text-sm"
            aria-label={`Week of ${weekRange(weekStart, weekEnd)}. Choose another week`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
          {phone ? (
            <div role="group" aria-label="Roster view" className="flex rounded-lg border border-border p-0.5">
              <Button type="button" size="sm" variant={dayView ? "secondary" : "ghost"} aria-pressed={dayView} onClick={() => setShowWeek(false)}>Day</Button>
              <Button type="button" size="sm" variant={dayView ? "ghost" : "secondary"} aria-pressed={!dayView} onClick={() => setShowWeek(true)}>Week</Button>
            </div>
          ) : null}
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
        className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3"
      >
        <span className="min-w-24 text-sm font-medium" aria-live="polite">
          {selectedKeys.length ? `${plural(selectedKeys.length, "cell")} selected` : "Select cells"}
          {selectedElsewhere ? <span className={cn("block text-xs font-normal", TONES.warning.text)}>{selectedElsewhere} not on {shownDay ? fullDay.format(shownDay) : "this day"}</span> : null}
        </span>
        {selectedElsewhere ? (
          <Button size="sm" variant="ghost" onClick={() => replaceSelection(new Set(selectedKeys.filter((key) => key.endsWith(`|${shownDay}`))))}>
            Keep only this day
          </Button>
        ) : null}
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
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => replaceSelection(new Set())}>
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
      {warnings.length || lastBatch ? (
        <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-sm">
          <div className="min-w-0 flex-1">
            {lastBatch ? <p>Last change: {lastBatch.label}.</p> : null}
            {warnings.map((detail) => (
              <p key={detail} className={cn("text-xs", TONES.warning.text)}>
                {detail}
              </p>
            ))}
          </div>
          {lastBatch ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || lastBatch.running || lastBatch.undoing}
              title={lastBatch.label}
              onClick={() => onUndo(lastBatch.batchId)}
            >
              <Undo2 aria-hidden className="size-4" />
              {lastBatch.running ? "Copying…" : lastBatch.undoing ? "Undoing…" : "Undo"}
            </Button>
          ) : null}
          {warnings.length ? (
            <Button size="icon" variant="ghost" className="size-9" aria-label="Dismiss" onClick={() => setWarnings([])}>
              <X aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {dayView && data ? (
        <div className="grid gap-3 px-4 py-3">
          <div role="group" aria-label="Day to edit" className="grid grid-cols-7 gap-1">
            {dates.map((date, col) => {
              const count = selectedOnDate(date);
              return (
                <Button
                  key={date}
                  type="button"
                  size="sm"
                  variant={col === dayCol ? "default" : "outline"}
                  aria-pressed={col === dayCol}
                  aria-label={count ? `${fullDay.format(date)}, ${count} selected` : fullDay.format(date)}
                  className="relative h-12 min-w-0 flex-col gap-0 px-0"
                  onClick={() => setDayCol(col)}
                >
                  <span className="text-[11px] font-medium">{weekdayShort.format(utcDay(date))}</span>
                  <span className="text-sm font-semibold">{new Date(utcDay(date)).getUTCDate()}</span>
                  {count ? <span aria-hidden className="absolute -end-0.5 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground ring-2 ring-background">{count}</span> : null}
                </Button>
              );
            })}
          </div>
          <ul aria-label={`Roster for ${dates[dayCol] ? fullDay.format(dates[dayCol]) : ""}`} className="grid gap-2">
            {staff.map((person) => {
              const date = dates[dayCol];
              const key = cellKey(person._id, date);
              const cell = cells.get(key);
              if (!cell) return null;
              const isSelected = selected.has(key);
              return (
                <li key={person._id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={cellLabel(person.name, cell)}
                    onClick={() => toggleKeys([key])}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-3 rounded-lg border border-border px-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected && "bg-primary/10 shadow-[inset_0_0_0_2px_var(--color-primary)]",
                    )}
                  >
                    <StaffAvatar staff={person} className="size-8" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{person.name}</span>
                    <span className="relative w-32 shrink-0"><CellContent cell={cell} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table
          ref={gridRef}
          role="grid"
          aria-multiselectable="true"
          aria-busy={data === undefined}
          aria-label={`Roster for ${weekRange(weekStart, weekEnd)}`}
          className={cn("w-full min-w-[56rem] table-fixed border-collapse text-sm", dayView && data && "hidden")}
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
              <th scope="col" className="sticky start-0 z-10 border-b border-border bg-card p-0 text-start">
                <button
                  type="button"
                  className="flex h-12 w-full items-center px-4 text-xs font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => replaceSelection(allSelected ? new Set() : new Set(allKeys))}
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
                      aria-label={`Select ${fullDay.format(date)}`}
                      className={cn(
                        "flex h-12 w-full flex-col items-center justify-center text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        full && "bg-primary/10",
                      )}
                      onClick={(event) => {
                        if (event.shiftKey && anchor) {
                          const keys = rect({ row: 0, col: anchor.col }, { row: staff.length - 1, col });
                          extendSelection(keys);
                        } else {
                          placeAnchor({ row: 0, col });
                          toggleKeys(columnKeys);
                        }
                      }}
                    >
                      <span className="font-medium text-muted-foreground">{weekdayShort.format(utcDay(date))}</span>
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 items-center justify-center rounded-full text-sm font-semibold",
                          date === today && "bg-primary text-primary-foreground",
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
            {data === undefined
              ? Array.from({ length: 4 }, (_, row) => (
                  <tr key={row} aria-hidden>
                    <th scope="row" className="h-20 border-t border-border px-4">
                      <span className="flex items-center gap-2.5">
                        <Skeleton className="size-8 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </span>
                    </th>
                    {Array.from({ length: 7 }, (_, col) => (
                      <td key={col} className="border-t border-l border-border px-2.5 py-2 align-top">
                        <Skeleton className="h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {staff.map((person, row) => {
              const rowKeys = dates.map((date) => cellKey(person._id, date));
              const full = rowKeys.every((key) => selected.has(key));
              return (
                <tr key={person._id}>
                  <th scope="row" className="sticky start-0 z-10 border-t border-border bg-card p-0 text-start font-normal">
                    <button
                      type="button"
                      aria-pressed={full}
                      aria-label={`Select ${person.name}'s week`}
                      className={cn(
                        "flex h-20 w-full items-center gap-2.5 px-4 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        full && "bg-primary/10",
                      )}
                      onClick={(event) => {
                        if (event.shiftKey && anchor) {
                          const keys = rect({ row: anchor.row, col: 0 }, { row, col: dates.length - 1 });
                          extendSelection(keys);
                        } else {
                          placeAnchor({ row, col: 0 });
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
                          isSelected && "bg-primary/10 shadow-[inset_0_0_0_2px_var(--color-primary)]",
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
          <div className="grid justify-items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No active staff yet. Add the people who work shifts first.</p>
            <ButtonLink href={adminStaffTabPath("staff")} size="sm">
              Add staff
            </ButtonLink>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-gold-text" />
          Changed from the weekly default
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-border" />
          Weekly default
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("rounded px-1", TONES.warning.bg, TONES.warning.text)}>
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

      {data?.cells.some(cell => !cell.patternHistoryKnown) ? <p className="text-xs text-muted-foreground">Some earlier weekly defaults are unknown. Those cells show the earliest observed pattern, not a verified historical schedule.</p> : null}
      {historyStaff.length ? <div className="space-y-3 border-t border-border pt-4">
        <label htmlFor="roster-history-person" className="block text-sm font-medium">Roster history for</label>
        <select id="roster-history-person" className="min-h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={historyPerson || historyStaff[0]._id} onChange={event => setHistoryPerson(event.target.value)}>
          {historyStaff.map(person => <option key={person._id} value={person._id}>{person.name}{person.status === "archived" ? " (archived)" : ""}</option>)}
        </select>
        <RecordHistoryPanel key={historyPerson || historyStaff[0]._id} entityType="roster" entityId={historyPerson || historyStaff[0]._id} title="Roster change history" />
      </div> : null}
      {customOpen ? (
        <CustomShiftDialog
          selectionLabel={plural(selectedKeys.length, "selected cell")}
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
      <Toast {...toast} />
    </section>
  );
}

function planOf(cell: Cell): Plan & { note?: string } {
  return { shifts: cell.shifts, breaks: cell.breaks, ...(cell.note ? { note: cell.note } : {}) };
}

function cellLabel(name: string, cell: Cell) {
  const hours = cell.shifts.length ? cell.shifts.map((s) => `${s.start} to ${s.end}`).join(" and ") : "off";
  return [
    `${name}, ${fullDay.format(cell.date)}: ${hours}`,
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
        className={cn("absolute inset-y-1.5 start-0 w-1 rounded-e-full", cell.override ? "bg-gold-text" : "bg-transparent")}
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
        <span className="truncate text-muted-foreground tabular-nums">
          {cell.breaks[0].label} {cell.breaks[0].start}–{cell.breaks[0].end}
          {cell.breaks.length > 1 ? ` +${cell.breaks.length - 1}` : ""}
        </span>
      ) : null}
      <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1">
        {cell.timeOff.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className={cn("max-w-full truncate rounded px-1", TONES.warning.bg, TONES.warning.text)}
          >
            {label}
          </span>
        ))}
        {cell.appointments ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 font-medium text-foreground">
            <CalendarDays aria-hidden className="size-3" />
            {cell.appointments}
          </span>
        ) : null}
      </span>
    </div>
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
                {staffDate(c.start, { weekday: true })}, {staffTime(c.start)}–{staffTime(c.end)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {appointmentGuestLabel(c)} · {c.serviceName}
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
