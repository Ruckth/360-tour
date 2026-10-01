"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import {
  TURNAROUND_STEP_MIN,
  appointmentRevision,
  turnaroundMinutes,
  turnaroundProblem,
  withTurnaround,
} from "convex/lib/appointmentWindow";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeRange } from "@/lib/schedule-changes";
import { formatResortTime } from "@/lib/staff-bookings";

/** This appointment's cleanup/travel time after the service; it stays attached to the service end. */
export function TurnaroundDialog({
  appointment,
  serviceDefaultMin,
  initialMin,
  onClose,
}: {
  appointment: Doc<"serviceAppointments">;
  serviceDefaultMin?: number;
  /** From resizing the turnaround on the calendar. */
  initialMin?: number;
  onClose: () => void;
}) {
  const update = useMutation(api.adminServices.updateAppointmentTurnaround);
  const [original] = useState(appointment);
  const current = turnaroundMinutes(original);
  const [value, setValue] = useState(String(initialMin ?? current));
  const minutes = Number(value);
  const problem = value.trim() === "" ? "Enter the turnaround in minutes." : turnaroundProblem(minutes, (original.end - original.start) / 60_000);
  const after = withTurnaround(original, problem ? current : minutes);

  return (
    <ChangeConfirmDialog
      title={`Change turnaround for ${original.guestName}?`}
      description="This appointment only. The turnaround starts when the service ends and moves with it."
      rows={[
        { label: "Service", before: timeRange(original.start, original.end), after: timeRange(original.start, original.end) },
        { label: "Turnaround", before: `${current} min`, after: `${problem ? current : minutes} min` },
        { label: "Available again", before: formatResortTime(original.blockedUntil), after: formatResortTime(after.blockedUntil) },
      ]}
      footnote={
        <p>
          {serviceDefaultMin === undefined ? "" : `The service default (${serviceDefaultMin} min) stays as it is for new bookings. `}
          A longer turnaround is checked against the next booking, breaks, time off and the end of the shift.
        </p>
      }
      confirmLabel="Save turnaround"
      confirmDisabled={problem !== null || minutes === current}
      onConfirm={async () => {
        await update({ appointmentId: original._id, expectedRevision: appointmentRevision(original), turnaroundMin: minutes });
      }}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="ta-minutes">Turnaround (minutes)</Label>
        <Input
          id="ta-minutes"
          type="number"
          inputMode="numeric"
          min={0}
          step={TURNAROUND_STEP_MIN}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={problem ? "ta-problem" : undefined}
          className="max-w-32"
        />
        {problem ? <p id="ta-problem" className="text-sm text-destructive">{problem}</p> : null}
      </div>
    </ChangeConfirmDialog>
  );
}
