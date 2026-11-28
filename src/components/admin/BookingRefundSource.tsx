"use client";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { staffDate } from "@/lib/staff-time";
import { PAYMENT_ORIGIN_LABELS } from "./admin-bookings-shared";
import { formatMoney } from "./labels";

type Financials = NonNullable<FunctionReturnType<typeof api.bookings.admin.bookingFinancials>>;
type RefundInput = FunctionArgs<typeof api.bookings.commands.recordRefund.recordRefund>;
export type BookingRefundSource = {
  value: string; label: string; left: number; stripe: boolean;
  reference: Pick<RefundInput, "paymentId" | "orderId">;
};

/** Shared by standalone refunds and atomic cancellation/refund, including old receipt money. */
/** Each option names the payment date and what is still refundable; a reference is added when those still collide. */
export function bookingRefundSources(data: Financials): BookingRefundSource[] {
  const rows = data.payments.filter(p => p.status === "recorded" && p.refundable > 0).map(p => ({
    p, base: `${formatMoney(p.amount, p.currency)} · ${PAYMENT_ORIGIN_LABELS[p.origin]}${p.order ? ` (${p.order.title})` : ""} · paid ${staffDate(p.effectiveAt)} · ${formatMoney(p.refundable, p.currency)} refundable`,
  }));
  const counts = new Map<string, number>();
  for (const { base } of rows) counts.set(base, (counts.get(base) ?? 0) + 1);
  return rows.map(({ p, base }) => ({
    value: `payment:${p._id}`,
    label: (counts.get(base) ?? 0) > 1 ? `${base} · ${p.method} ref …${p._id.slice(-6)}` : base,
    left: p.refundable, stripe: p.origin === "online", reference: { paymentId: p._id },
  }));
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
