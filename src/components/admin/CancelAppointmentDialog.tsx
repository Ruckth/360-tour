"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { appointmentRevision } from "convex/lib/appointmentWindow";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { formatMoney } from "@/components/admin/labels";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { timeRange } from "@/lib/schedule-changes";
import { PAYMENT_LABELS, appointmentStatus, formatResortFullDate } from "@/lib/staff-bookings";

const REASON_MAX = 500;

function paymentConsequence(appointment: Doc<"serviceAppointments">) {
  const amount = formatMoney(appointment.price, appointment.currency);
  if (appointment.paymentStatus === "paid") {
    return `${amount} was paid. Cancelling doesn't refund it: if you return the money at the desk, record the refund afterwards.`;
  }
  if (appointment.paymentStatus === "refunded") return "The payment was already refunded.";
  return "Nothing was paid, so there is nothing to refund.";
}

/** Cancels with an optional reason. The record, its payment state and its history stay; the time is freed. */
export function CancelAppointmentDialog({
  appointment,
  serviceName,
  staffName,
  onClose,
}: {
  appointment: Doc<"serviceAppointments">;
  serviceName: string;
  staffName: string;
  onClose: () => void;
}) {
  const cancel = useMutation(api.adminServices.cancelAppointment);
  const [original] = useState(appointment);
  const [reason, setReason] = useState("");
  const same = (label: string, value: string) => ({ label, before: value, after: value });
  const payment = PAYMENT_LABELS[original.paymentStatus];

  return (
    <ChangeConfirmDialog
      title={`Cancel ${original.guestName}'s ${serviceName}?`}
      description={`${staffName}'s time is freed for other bookings. The appointment, its payment state and history are kept. ${paymentConsequence(original)}`}
      rows={[
        same("Service", serviceName),
        same("When", `${formatResortFullDate(original.start)}, ${timeRange(original.start, original.end)}`),
        same("Staff", staffName),
        { label: "Status", before: appointmentStatus(original.status).label, after: appointmentStatus("cancelled").label },
        same("Payment", payment),
      ]}
      footnote={<p>The guest isn&apos;t notified automatically.</p>}
      confirmLabel="Cancel appointment"
      keepLabel="Keep appointment"
      destructive
      onConfirm={async () => {
        await cancel({ appointmentId: original._id, expectedRevision: appointmentRevision(original), reason: reason.trim() || undefined });
      }}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="cancel-reason">Reason (optional)</Label>
        <Textarea
          id="cancel-reason"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Guest unwell, changed plans…"
        />
      </div>
    </ChangeConfirmDialog>
  );
}
