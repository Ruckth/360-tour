"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatResortDateTime } from "@/lib/staff-bookings";
import { MONEY_METHOD_LABELS, PAYMENT_ORIGIN_LABELS } from "./admin-bookings-shared";
import { STATUS_LABELS, formatMoney } from "./labels";

const PAGE = 10;

const KIND_LABELS: Record<string, string> = {
  created: "Booking created",
  edited: "Booking edited",
  notes: "Notes changed",
  confirmed: "Confirmed",
  price_set: "Custom price set",
  payment_recorded: "Payment recorded",
  payment_amended: "Payment corrected",
  payment_cancelled: "Payment cancelled (not received)",
  order_payment_amended: "Checkout receipt corrected",
  order_voided: "Checkout order voided, payment kept",
  refund_recorded: "Refund recorded",
  cancelled: "Cancelled",
  reopened: "Reopened",
  deleted: "Deleted",
};

const FIELD_LABELS: Record<string, string> = {
  propertyId: "Villa", checkIn: "Check-in", checkOut: "Check-out", guests: "Guests", nights: "Nights",
  guestName: "Guest name", guestPhone: "Phone", guestEmail: "Email", subtotal: "Villa rate", discountAmount: "Direct discount",
  total: "Total", currency: "Currency", priceOverride: "Custom price", status: "Status", paymentStatus: "Payment",
  paymentMethod: "First payment by", amountPaid: "Received (gross)", amountRefunded: "Refunded", paidAt: "Paid on",
  refundedAt: "Refunded on", adminNotes: "Notes", cancelledAt: "Cancelled on", cancelledBy: "Cancelled by",
  cancelReason: "Cancellation reason", confirmationCode: "Reference", guestEmailsOff: "Guest emails off",
  providerRefundWaived: "Provider refund waived", amount: "Amount", method: "Method", origin: "Source", context: "Refund of", notifiedGuest: "Guest emailed",
  keptPaid: "Payment kept", archivedVillaReason: "Archived villa reason", legacy: "Recorded before itemised payments",
  effectiveAt: "Received on", note: "Note", paymentKept: "Payment kept", receiptNumber: "Receipt",
};

const MONEY_FIELDS = new Set(["subtotal", "discountAmount", "total", "amountPaid", "amountRefunded", "amount", "keptPaid", "providerRefundWaived"]);
const TIME_FIELDS = new Set(["paidAt", "refundedAt", "cancelledAt", "effectiveAt"]);
/** Shown elsewhere (snapshots) or ids that mean nothing to staff. */
const HIDDEN = new Set(["paymentId", "refundId", "orderId", "sequence", "before", "after", "tendersChanged", "customerChanged", "revision", "unlinkedAppointments", "createdAt", "createdBy", "source", "hasStripePayment", "villaStatus"]);
const hotelLabels: Record<string, string> = STATUS_LABELS.hotelBooking;
const paymentLabels: Record<string, string> = STATUS_LABELS.payment;

function show(field: string, value: unknown, currency: string, villaName: (id: string) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) return formatMoney(value, currency);
    if (TIME_FIELDS.has(field)) return formatResortDateTime(value);
    return String(value);
  }
  if (typeof value === "string") {
    if (field === "propertyId") return villaName(value);
    if (field === "status") return hotelLabels[value] ?? value;
    if (field === "paymentStatus") return paymentLabels[value] ?? value;
    if (field === "method") return MONEY_METHOD_LABELS[value] ?? value;
    if (field === "origin") return PAYMENT_ORIGIN_LABELS[value] ?? value;
    if (field === "context") return value === "credit" ? "Credit on a live stay" : "Cancelled stay";
    return value;
  }
  if (field === "priceOverride" && typeof value === "object" && "total" in value) {
    return formatMoney(Number((value as { total: number }).total), currency);
  }
  return JSON.stringify(value);
}

type Row = { field: string; before: unknown; after: unknown; changed: boolean };

/** before/after as rows: changed fields, then facts that only exist after (amounts, methods). */
function rows(kind: string, before: unknown, after: unknown): Row[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  if (kind === "created" || kind === "deleted") {
    const snapshot = kind === "created" ? a : b;
    return ["checkIn", "checkOut", "guests", "guestName", "total", "status", "paymentStatus"]
      .filter((field) => field in snapshot)
      .map((field) => ({ field, before: null, after: snapshot[field], changed: false }));
  }
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((field) => !HIDDEN.has(field));
  const own = fields.map((field) => ({ field, before: b[field], after: a[field], changed: field in b }));
  // A corrected payment carries its own before/after (method, date received, note).
  const nestedBefore = a.before && typeof a.before === "object" ? (a.before as Record<string, unknown>) : null;
  const nestedAfter = a.after && typeof a.after === "object" ? (a.after as Record<string, unknown>) : null;
  const nested = nestedBefore && nestedAfter
    ? Object.keys(nestedAfter)
      .filter((field) => JSON.stringify(nestedBefore[field] ?? null) !== JSON.stringify(nestedAfter[field] ?? null))
      .map((field) => ({ field, before: nestedBefore[field], after: nestedAfter[field], changed: true }))
    : [];
  return [...own, ...nested];
}

/**
 * The booking's change history, newest first, paginated. History starts when it shipped: older
 * changes were not recorded, and nothing is reconstructed.
 */
export function BookingHistory({
  bookingId,
  currency,
  villaName,
}: {
  bookingId: Id<"bookings">;
  currency: string;
  villaName: (id: string) => string;
}) {
  const { results, status, loadMore } = usePaginatedQuery(api.adminBookings.bookingHistory, { bookingId }, { initialNumItems: PAGE });

  return (
    <section aria-labelledby="booking-history" className="grid gap-2">
      <h3 id="booking-history" className="admin-eyebrow">History</h3>
      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-12" aria-label="Loading history" />
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded yet. Changes made before booking history was added were not recorded.</p>
      ) : (
        <ol className="grid gap-3">
          {results.map((entry) => {
            const details = rows(entry.kind, entry.before, entry.after);
            return (
              <li key={entry._id} className="grid gap-1 border-s-2 border-border ps-3 text-sm">
                <p className="font-medium">
                  {KIND_LABELS[entry.kind] ?? entry.kind}
                  <span className="font-normal text-muted-foreground">
                    {" "}· {formatResortDateTime(entry.recordedAt)} · {entry.actor}
                  </span>
                </p>
                {Math.abs(entry.effectiveAt - entry.recordedAt) > 60_000 ? (
                  <p className="text-xs text-muted-foreground">Effective {formatResortDateTime(entry.effectiveAt)}</p>
                ) : null}
                {entry.reason ? <p className="text-muted-foreground">Reason: {entry.reason}</p> : null}
                {details.length ? (
                  <ul className="grid gap-0.5 text-xs text-muted-foreground">
                    {details.map((row) => (
                      <li key={row.field}>
                        {FIELD_LABELS[row.field] ?? row.field}:{" "}
                        {row.changed ? `${show(row.field, row.before, currency, villaName)} → ` : ""}
                        {show(row.field, row.after, currency, villaName)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button variant="outline" size="sm" className="justify-self-start" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE)}>
          {status === "LoadingMore" ? "Loading history…" : "Load earlier history"}
        </Button>
      ) : null}
    </section>
  );
}
