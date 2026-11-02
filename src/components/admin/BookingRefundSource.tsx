"use client";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_ORIGIN_LABELS } from "./admin-bookings-shared";
import { formatMoney } from "./labels";

type Financials = NonNullable<FunctionReturnType<typeof api.adminBookings.bookingFinancials>>;
type RefundInput = FunctionArgs<typeof api.adminBookings.recordRefund>;
export type BookingRefundSource = {
  value: string; label: string; left: number; stripe: boolean;
  reference: Pick<RefundInput, "paymentId" | "billId" | "unitemised">;
};

/** Shared by standalone refunds and atomic cancellation/refund, including old receipt money. */
export function bookingRefundSources(data: Financials): BookingRefundSource[] {
  return [
    ...data.payments.filter(p => p.status === "recorded" && p.refundable > 0).map(p => ({
      value: `payment:${p._id}`, label: `${formatMoney(p.amount, p.currency)} · ${PAYMENT_ORIGIN_LABELS[p.origin]}${p.order ? ` (${p.order.title})` : ""}`,
      left: p.refundable, stripe: p.origin === "online", reference: { paymentId: p._id },
    })),
    ...data.legacyOrders.filter(o => o.refundable > 0).map(o => ({
      value: `order:${o._id}`, label: `${o.title} (before itemised payments)`, left: o.refundable, stripe: false, reference: { billId: o._id },
    })),
    ...(data.unitemisedRefundable > 0 ? [{ value: "unitemised", label: "Older unitemised payment", left: data.unitemisedRefundable, stripe: false, reference: { unitemised: true } }] : []),
  ];
}

export function BookingRefundSourcePicker({ id, sources, value, onChange }: { id: string; sources: BookingRefundSource[]; value: string; onChange: (value: string) => void }) {
  return <div className="grid gap-2">
    <Label htmlFor={id}>Refund from</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>{sources.map(source => <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
