"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { STATUS_LABELS, formatMoney } from "@/components/admin/labels";
import { Skeleton } from "@/components/ui/skeleton";
import { formatResortDateTime } from "@/lib/staff-bookings";

type Change = Doc<"appointmentChanges">;
type Value = Change["changes"][number]["from"];

const KIND_LABELS: Record<Change["kind"], string> = {
  rescheduled: "Rescheduled",
  turnaround: "Turnaround changed",
  details: "Details edited",
  service: "Service changed",
  status: "Status changed",
  cancelled: "Cancelled",
  payment: "Payment updated",
  rebooked: "Booked again",
};

const FIELD_LABELS: Record<string, string> = {
  staffId: "Staff",
  serviceId: "Service",
  start: "Starts",
  end: "Service ends",
  blockedUntil: "Occupied until",
  price: "Price",
  currency: "Currency",
  status: "Status",
  paymentStatus: "Payment",
  guestName: "Guest name",
  guestPhone: "Phone",
  guestEmail: "Email",
  notes: "Notes",
  rebookedAs: "New appointment",
};

const TIME_FIELDS = new Set(["start", "end", "blockedUntil"]);
const appointmentLabels: Record<string, string> = STATUS_LABELS.appointment;
const paymentLabels: Record<string, string> = STATUS_LABELS.payment;

/** Who changed the appointment, when, and each old → new value. Newest first; the server caps the list. */
export function AppointmentHistory({
  appointmentId,
  staffName,
  serviceName,
}: {
  appointmentId: Id<"serviceAppointments">;
  staffName: (id: string) => string;
  serviceName: (id: string) => string;
}) {
  const history = useQuery(api.adminServices.listAppointmentHistory, { appointmentId });

  function show(field: string, value: Value, currency: string): string {
    if (value === null || value === "") return "—";
    if (typeof value === "number") {
      if (TIME_FIELDS.has(field)) return formatResortDateTime(value);
      if (field === "price") return formatMoney(value, currency);
      return String(value);
    }
    if (field === "staffId") return staffName(value);
    if (field === "serviceId") return serviceName(value);
    if (field === "status") return appointmentLabels[value] ?? value;
    if (field === "paymentStatus") return paymentLabels[value] ?? value;
    return value;
  }

  return (
    <section aria-labelledby="appointment-history" className="grid gap-2">
      <h3 id="appointment-history" className="admin-eyebrow">History</h3>
      {history === undefined ? (
        <Skeleton className="h-12" />
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes since it was booked.</p>
      ) : (
        <ol className="grid gap-3">
          {history.map((entry) => (
            <li key={entry._id} className="grid gap-1 border-s-2 border-border ps-3 text-sm">
              <p className="font-medium">
                {KIND_LABELS[entry.kind]}
                <span className="font-normal text-muted-foreground">
                  {" "}· {formatResortDateTime(entry.at)} · {entry.actor === "guest" ? "Guest, in chat" : entry.actor}
                </span>
              </p>
              {entry.reason ? <p className="text-muted-foreground">Reason: {entry.reason}</p> : null}
              <ul className="grid gap-0.5 text-xs text-muted-foreground">
                {entry.changes.map((change) => (
                  <li key={change.field}>
                    {FIELD_LABELS[change.field] ?? change.field}: {show(change.field, change.from, entry.currencyBefore)} → {show(change.field, change.to, entry.currencyAfter)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
