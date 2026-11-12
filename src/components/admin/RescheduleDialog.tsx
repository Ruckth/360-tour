"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { appointmentRevision, movedWindow } from "convex/lib/appointmentWindow";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { moveProposal, scheduleRows, type ScheduleProposal } from "@/lib/schedule-changes";
import {
  appointmentGuestLabel,
  errorText,
  formatResortTime,
  resortDateTime,
  resortIsoDate,
  resortTime24,
  useNow,
} from "@/lib/staff-bookings";

type Appointment = Doc<"appointments">;

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
  const reschedule = useMutation(api.services.commands.rescheduleAppointment.rescheduleAppointment);
  // The comparison and the stale check use the appointment as it was when this opened.
  const [original] = useState(appointment);
  const [staffId, setStaffId] = useState<Id<"staff">>(initial?.staffId ?? original.staffId);
  const [start, setStart] = useState(initial?.start ?? original.start);
  const [date, setDate] = useState(resortIsoDate(start));
  const now = useNow();
  const options = useQuery(api.services.admin.rescheduleOptions, { appointmentId: original._id, date });

  const staffName = (id: Id<"staff">) => staffById.get(id)?.name ?? options?.staff.find((s) => s._id === id)?.name ?? "Staff";
  const staffChoices = options?.staff ?? [];
  const times = (options?.slots ?? []).filter((slot) => slot.staffIds.includes(staffId)).map((slot) => slot.start);
  const historical = start + original.blockedUntil - original.start <= now;
  const open = historical || times.includes(start);
  const proposal = moveProposal(original, { start, staffId });
  const after = movedWindow(original, start);

  const [reason, setReason] = useState("");
  const review = useQuery(api.services.admin.previewAppointmentTime, { appointmentId: original._id, serviceId: original.serviceId, staffId, start });
  const problem = review?.problem ?? (options === undefined
        ? null
        : !staffChoices.some((s) => s._id === staffId)
          ? `${staffName(staffId)} doesn't perform ${serviceName}.`
          : !proposal
            ? null
            : !open
              ? `${staffName(staffId)} isn't free at ${formatResortTime(start)} for the full service and turnaround. Pick an open time.`
              : null);

  function changeDate(next: string) {
    if (!next) return;
    setDate(next);
    // Keep the time of day on the new date.
    setStart(resortDateTime(next, resortTime24(start)));
  }

  async function confirm() {
    if (!proposal) return false;
    try {
      await reschedule({ appointmentId: original._id, expectedRevision: appointmentRevision(original), ...proposal, historicalReason: reason.trim() || undefined });
    } catch (err) {
      if (!onFailed) throw err;
      onFailed(errorText(err, "Could not reschedule the appointment."));
    }
  }

  return (
    <ChangeConfirmDialog
      title={`Reschedule ${appointmentGuestLabel(original)} — ${serviceName}?`}
      description="Correct the service time or staff. Booked duration, price, payment and issued receipts stay unchanged. Current and future availability is checked again when you confirm."
      rows={scheduleRows({ ...original, staffName: staffName(original.staffId) }, { ...after, staffName: staffName(staffId) })}
      footnote={<p>The guest isn&apos;t notified automatically. Let them know about the new time.</p>}
      confirmLabel="Confirm reschedule"
      confirmDisabled={!proposal || options === undefined || review === undefined || problem !== null || Boolean(review.needsReason && !reason.trim())}
      onConfirm={confirm}
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="rs-date">Date</Label>
          <DatePicker id="rs-date" value={date} onValueChange={changeDate} required />
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
          {historical ? <Input id="rs-time" type="time" step={60} value={resortTime24(start)} onChange={event => { if (event.target.value) setStart(resortDateTime(date, event.target.value)); }} /> : <Select value={String(start)} onValueChange={(value) => setStart(Number(value))}>
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
          </Select>}
        </div>
      </div>
      {review?.warnings.map(warning => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
      {review?.needsReason ? <div className="grid gap-2"><Label htmlFor="rs-reason">Reason for the historical overlap</Label><Input id="rs-reason" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></div> : null}
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      {!proposal && !problem ? <p className="text-sm text-muted-foreground">Choose a different date, time or staff member.</p> : null}
    </ChangeConfirmDialog>
  );
}
