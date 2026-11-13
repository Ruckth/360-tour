"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { appointmentRevision } from "convex/shared/appointmentWindow";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { STATUS_LABELS } from "@/components/admin/labels";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { resortDateTime, resortIsoDate, resortTime24 } from "@/lib/staff-bookings";

type Appointment = Doc<"appointments">;
const STATUSES: Appointment["status"][] = ["booked", "arrived", "in_service", "completed", "cancelled", "no_show"];

/** Retains the reviewed revision and all input after a failed/pending save. */
export function AppointmentCorrectionDialog({ appointment, payment = false, onClose }: {
  appointment: Appointment;
  payment?: boolean;
  onClose: () => void;
}) {
  const [original] = useState(appointment);
  const [status, setStatus] = useState<Appointment["status"]>(original.status);
  const [reason, setReason] = useState("");
  const [openedAt] = useState(() => Date.now());
  const [date, setDate] = useState(resortIsoDate(openedAt));
  const [time, setTime] = useState(resortTime24(openedAt));
  const correct = useMutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus);
  const pay = useMutation(api.services.commands.markAppointmentPaid.markAppointmentPaid);
  const requiresReason = !payment && ["completed", "cancelled", "no_show", "in_service"].includes(original.status);

  async function save() {
    const effectiveAt = resortDateTime(date, time);
    if (payment) await pay({ appointmentId: original._id, expectedRevision: appointmentRevision(original), effectiveAt });
    else await correct({ appointmentId: original._id, expectedRevision: appointmentRevision(original), status, reason: reason.trim() || undefined, effectiveAt });
  }

  return (
    <ChangeConfirmDialog
      title={payment ? "Record payment" : "Correct recorded status"}
      description={payment ? "Record money already received at the desk, using the actual payment date and time. This does not charge the guest." : "Correct an entry made in error. Reopening checks staff availability. Payment and issued receipts stay unchanged."}
      rows={[{ label: payment ? "Payment" : "Status", before: payment ? STATUS_LABELS.payment[original.paymentStatus] : STATUS_LABELS.appointment[original.status], after: payment ? "Paid" : STATUS_LABELS.appointment[status] }]}
      confirmLabel={payment ? "Record paid" : "Save correction"}
      confirmDisabled={!date || !time || (!payment && status === original.status) || (requiresReason && !reason.trim())}
      onConfirm={save}
      onClose={onClose}
    >
      {!payment ? <div className="grid gap-2">
        <Label htmlFor="ac-status">Correct status</Label>
        <Select value={status} onValueChange={value => setStatus(value as Appointment["status"])}>
          <SelectTrigger id="ac-status"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(value => <SelectItem key={value} value={value}>{STATUS_LABELS.appointment[value]}</SelectItem>)}</SelectContent>
        </Select>
      </div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="ac-date">{payment ? "Payment date" : "Effective date"}</Label><DatePicker id="ac-date" required value={date} onValueChange={setDate} /></div>
        <div className="grid gap-2"><Label htmlFor="ac-time">Time (Bangkok)</Label><Input id="ac-time" type="time" required value={time} onChange={event => setTime(event.target.value)} /></div>
      </div>
      {!payment ? <div className="grid gap-2"><Label htmlFor="ac-reason">Reason{requiresReason ? " (required)" : " (optional)"}</Label><Textarea id="ac-reason" required={requiresReason} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></div> : null}
    </ChangeConfirmDialog>
  );
}
