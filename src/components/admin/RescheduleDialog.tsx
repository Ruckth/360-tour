"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { appointmentRevision, movedWindow } from "convex/lib/appointmentWindow";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { moveProposal, scheduleRows, type ScheduleProposal } from "@/lib/schedule-changes";
import {
  errorText,
  formatResortTime,
  resortDateTime,
  resortIsoDate,
  resortTime24,
  useNow,
} from "@/lib/staff-bookings";

type Appointment = Doc<"serviceAppointments">;

/**
 * Date, time and qualified staff for an upcoming booked appointment, with the before → after
 * comparison. Opened from the details panel or by a calendar drag (`initial`). The length,
 * turnaround and price stay as booked. With `onFailed`, a failed save closes the dialog
 * (so the calendar shows the saved position again) and reports why.
 */
export function RescheduleDialog({
  appointment,
  serviceName,
  staffById,
  initial,
  onClose,
  onFailed,
}: {
  appointment: Appointment;
  serviceName: string;
  staffById: ReadonlyMap<string, Doc<"staff">>;
  initial?: ScheduleProposal;
  onClose: () => void;
  onFailed?: (message: string) => void;
}) {
  const reschedule = useMutation(api.adminServices.rescheduleAppointment);
  // The comparison and the stale check use the appointment as it was when this opened.
  const [original] = useState(appointment);
  const [staffId, setStaffId] = useState<Id<"staff">>(initial?.staffId ?? original.staffId);
  const [start, setStart] = useState(initial?.start ?? original.start);
  const [date, setDate] = useState(resortIsoDate(start));
  const today = resortIsoDate(useNow());
  const options = useQuery(api.adminServices.rescheduleOptions, date >= today ? { appointmentId: original._id, date } : "skip");

  const staffName = (id: Id<"staff">) => staffById.get(id)?.name ?? options?.staff.find((s) => s._id === id)?.name ?? "Staff";
  const staffChoices = options?.staff ?? [];
  const times = (options?.slots ?? []).filter((slot) => slot.staffIds.includes(staffId)).map((slot) => slot.start);
  const open = times.includes(start);
  const proposal = moveProposal(original, { start, staffId });
  const after = movedWindow(original, start);

  const problem =
    date < today
      ? "Pick today or a future date."
      : options === undefined
        ? null
        : !staffChoices.some((s) => s._id === staffId)
          ? `${staffName(staffId)} doesn't perform ${serviceName}.`
          : !proposal
            ? "Choose a different date, time or staff member."
            : !open
              ? `${staffName(staffId)} isn't free at ${formatResortTime(start)} for the full service and turnaround. Pick an open time.`
              : null;

  function changeDate(next: string) {
    if (!next) return;
    setDate(next);
    // Keep the time of day on the new date.
    setStart(resortDateTime(next, resortTime24(start)));
  }

  async function confirm() {
    if (!proposal) return false;
    try {
      await reschedule({ appointmentId: original._id, expectedRevision: appointmentRevision(original), ...proposal });
    } catch (err) {
      if (!onFailed) throw err;
      onFailed(errorText(err, "Could not reschedule the appointment."));
    }
  }

  return (
    <ChangeConfirmDialog
      title={`Reschedule ${original.guestName} — ${serviceName}?`}
      description="Same service length, turnaround and price. Available times are checked again when you confirm."
      rows={scheduleRows({ ...original, staffName: staffName(original.staffId) }, { ...after, staffName: staffName(staffId) })}
      footnote={<p>The guest isn&apos;t notified automatically. Let them know about the new time.</p>}
      confirmLabel="Confirm reschedule"
      confirmDisabled={!proposal || options === undefined || problem !== null}
      onConfirm={confirm}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="rs-date">Date</Label>
          <Input id="rs-date" type="date" min={today} value={date} onChange={(event) => changeDate(event.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rs-staff">Staff</Label>
          <Select value={staffId} onValueChange={(value) => setStaffId(value as Id<"staff">)}>
            <SelectTrigger id="rs-staff" className="rounded-lg">
              <SelectValue placeholder="Staff" />
            </SelectTrigger>
            <SelectContent>
              {(staffChoices.some((s) => s._id === staffId) ? staffChoices : [...staffChoices, { _id: staffId, name: staffName(staffId) }]).map((person) => (
                <SelectItem key={person._id} value={person._id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rs-time">Time</Label>
          <Select value={String(start)} onValueChange={(value) => setStart(Number(value))}>
            <SelectTrigger id="rs-time" className="rounded-lg">
              <SelectValue placeholder="Time" />
            </SelectTrigger>
            <SelectContent>
              {(open ? times : [start, ...times].sort((a, b) => a - b)).map((time) => (
                <SelectItem key={time} value={String(time)}>
                  {formatResortTime(time)}
                  {time === start && !open ? " (not open)" : time === original.start && staffId === original.staffId ? " (current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
    </ChangeConfirmDialog>
  );
}
