"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Button } from "@/components/ui/button";
import { TimePicker } from "@/components/ui/time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breakText, type BreakBlock } from "@/lib/schedule-changes";
import { appointmentGuestLabel, WEEKDAYS_LONG, formatResortFullDate, formatResortTime, resortMidnight } from "@/lib/staff-bookings";

type Scope = "day" | "weekly";

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

  const weekday = WEEKDAYS_LONG[new Date(`${shown.date}T00:00:00Z`).getUTCDay()];
  const next = remove ? null : { start, end, label: label.trim() || "Break" };
  const timesValid = remove || (TIME.test(start) && TIME.test(end) && start < end);
  const unchanged = next !== null && next.start === original.start && next.end === original.end && next.label === original.label;
  const args = { staffId: shown.staffId, date: shown.date, scope, original, next, expectedPlan: shown.plan };
  const preview = useQuery(api.roster.previewBreakChange, timesValid && !unchanged ? args : "skip");
  const conflicts = preview?.conflicts ?? [];
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
          <p>An end time of 00:00 means midnight at the end of this date.</p>
          <p>Other shifts, breaks and notes stay as they are. The latest roster change can be undone in Roster.</p>
          {scope === "weekly" && preview?.previewThrough ? (
            <p>
              Next four weeks, through {formatResortFullDate(resortMidnight(preview.previewThrough))}: {preview.affectedDates.length
                ? `changes ${preview.affectedDates.map((date) => formatResortFullDate(resortMidnight(date))).join(", ")}.`
                : "all these dates keep their own plan."} The weekly default continues after that; dates with their own plan keep it.
            </p>
          ) : null}
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
        throw new Error("The break now conflicts with a booking. Review the updated preview and try again.");
      }}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="br-start">Start</Label>
          <TimePicker id="br-start" label="Break start" minuteStep={5} value={start} disabled={remove} onValueChange={setStart} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="br-end">End</Label>
          <TimePicker id="br-end" label="Break end" minuteStep={5} value={end === "24:00" ? "00:00" : end} disabled={remove} onValueChange={(value) => setEnd(value === "00:00" ? "24:00" : value)} />
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
              onChange={() => { setScope(value); }}
            />
            {scopeText(value)}
          </label>
        ))}
        {shown.override ? (
          <p className="text-xs text-muted-foreground">This date has its own roster plan, so the weekly default doesn&apos;t apply here.</p>
        ) : null}
      </fieldset>
      <div>
        <Button type="button" size="sm" variant="outline" aria-pressed={remove} onClick={() => { setRemove(!remove); }}>
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
                {appointmentGuestLabel(conflict)} · {conflict.serviceName} · {formatResortFullDate(conflict.start)}, {formatResortTime(conflict.start)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ChangeConfirmDialog>
  );
}
