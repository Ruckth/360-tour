"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breakText, type BreakBlock } from "@/lib/schedule-changes";
import { WEEKDAYS_LONG, formatResortFullDate, formatResortTime, resortMidnight } from "@/lib/staff-bookings";

type Scope = "day" | "weekly";
type Conflicts = FunctionReturnType<typeof api.roster.previewBreakChange>["conflicts"];

const TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/**
 * Move, resize, rename or remove one roster break. "This day only" saves a roster override that keeps
 * the rest of the day's plan; the weekly default leaves dates with their own plan alone. The server
 * checks shifts, other breaks and bookings (with their turnaround) both in the preview and on save.
 */
export function BreakEditDialog({
  block,
  staffName,
  initial,
  onClose,
}: {
  block: BreakBlock;
  staffName: string;
  /** Times from dragging or resizing the break on the calendar. */
  initial?: { start: string; end: string };
  onClose: () => void;
}) {
  const editBreak = useMutation(api.roster.editBreak);
  // The day as shown when this opened; the server refuses the edit if it has changed since.
  const [shown] = useState(block);
  const { original } = shown;
  const [start, setStart] = useState(initial?.start ?? original.start);
  const [end, setEnd] = useState(initial?.end ?? original.end);
  const [label, setLabel] = useState(original.label);
  const [scope, setScope] = useState<Scope>("day");
  const [remove, setRemove] = useState(false);
  const [saveConflicts, setSaveConflicts] = useState<Conflicts | null>(null);

  const weekday = WEEKDAYS_LONG[new Date(`${shown.date}T00:00:00Z`).getUTCDay()];
  const next = remove ? null : { start, end, label: label.trim() || "Break" };
  const timesValid = remove || (TIME.test(start) && TIME.test(end) && start < end);
  const unchanged = next !== null && next.start === original.start && next.end === original.end && next.label === original.label;
  const args = { staffId: shown.staffId, date: shown.date, scope, original, next, expectedPlan: shown.plan };
  const preview = useQuery(api.roster.previewBreakChange, timesValid && !unchanged ? args : "skip");
  const conflicts = saveConflicts ?? preview?.conflicts ?? [];
  const problem = !timesValid ? "Enter a start before the end, as HH:mm." : unchanged ? "Change the time or label, or remove the break." : preview?.problem;
  const scopeText = (value: Scope) => (value === "day" ? "This day only" : `Every ${weekday} (weekly default)`);

  return (
    <ChangeConfirmDialog
      title={`${remove ? "Remove" : "Change"} ${staffName}'s ${original.label.toLowerCase()}?`}
      description={`${staffName} · ${formatResortFullDate(resortMidnight(shown.date))}`}
      rows={[
        { label: "Break", before: breakText(original), after: next ? breakText(next) : "Removed" },
        { label: "Applies to", before: shown.override ? "This day's own plan" : scopeText("weekly"), after: scopeText(scope) },
      ]}
      footnote={
        <>
          <p>Other shifts, breaks and notes stay as they are. The latest roster change can be undone in Roster.</p>
          {scope === "weekly" && preview?.keptDates.length ? (
            <p>These {weekday}s keep their own plan: {preview.keptDates.map((date) => formatResortFullDate(resortMidnight(date))).join(", ")}.</p>
          ) : null}
        </>
      }
      confirmLabel={remove ? "Remove break" : "Save break"}
      confirmDisabled={Boolean(problem) || preview === undefined || conflicts.length > 0}
      onConfirm={async () => {
        const result = await editBreak(args);
        if (result.ok) return true;
        setSaveConflicts(result.conflicts);
        return false;
      }}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="br-start">Start</Label>
          <Input id="br-start" type="time" step={300} value={start} disabled={remove} onChange={(event) => { setStart(event.target.value); setSaveConflicts(null); }} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="br-end">End</Label>
          <Input id="br-end" type="time" step={300} value={end} disabled={remove} onChange={(event) => { setEnd(event.target.value); setSaveConflicts(null); }} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="br-label">Label</Label>
          <Input id="br-label" value={label} maxLength={40} disabled={remove} onChange={(event) => setLabel(event.target.value)} />
        </div>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Apply to</legend>
        {(["day", "weekly"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm has-[:disabled]:opacity-60">
            <input
              type="radio"
              name="break-scope"
              className="size-4 accent-foreground"
              checked={scope === value}
              disabled={value === "weekly" && shown.override}
              onChange={() => { setScope(value); setSaveConflicts(null); }}
            />
            {scopeText(value)}
          </label>
        ))}
        {shown.override ? (
          <p className="text-xs text-muted-foreground">This date has its own roster plan, so the weekly default doesn&apos;t apply here.</p>
        ) : null}
      </fieldset>
      <div>
        <Button type="button" size="sm" variant="outline" aria-pressed={remove} onClick={() => { setRemove(!remove); setSaveConflicts(null); }}>
          {remove ? "Keep this break" : "Remove this break"}
        </Button>
      </div>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      {conflicts.length ? (
        <div role="alert" className="grid gap-1 text-sm text-destructive">
          <p>Reschedule or cancel these bookings first; the break would overlap them or their turnaround:</p>
          <ul className="list-disc ps-5">
            {conflicts.map((conflict) => (
              <li key={`${conflict.appointmentId}-${conflict.date}`}>
                {conflict.guestName} · {conflict.serviceName} · {formatResortFullDate(conflict.start)}, {formatResortTime(conflict.start)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ChangeConfirmDialog>
  );
}
