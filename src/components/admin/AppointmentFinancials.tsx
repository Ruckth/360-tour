"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { MANUAL_PAYMENT_METHODS, REFUND_METHODS } from "convex/lib/financeValidators";
import { Link } from "@/i18n/navigation";
import { receiptPath } from "@/components/checkout/checkout-source";
import { ChangeConfirmDialog } from "./ChangeConfirmDialog";
import { EffectiveTimeFields, MethodPicker, useEffectiveTime } from "./BookingMoneyFields";
import { formatMoney } from "./labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatResortDateTime } from "@/lib/staff-bookings";

type Appointment = Doc<"serviceAppointments">;
type Finance = FunctionReturnType<typeof api.adminServices.getAppointmentFinancials>;
type Dialog = { kind: "pay" } | { kind: "refund"; paymentId?: Id<"appointmentPayments">; billId?: Id<"bills">; max: number } | { kind: "amend" | "cancel"; payment: Doc<"appointmentPayments"> } | { kind: "legacyCancel"; legacyChangeId: Id<"appointmentChanges"> };

export function AppointmentFinancials({ appointment }: { appointment: Appointment }) {
  const data = useQuery(api.adminServices.getAppointmentFinancials, { appointmentId: appointment._id });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Loading payment records…</p>;
  const money = (n: number) => formatMoney(n, appointment.currency);
  return <section aria-label="Appointment payments" className="grid gap-3">
    <h3 className="font-semibold">Payments and refunds</h3>
    <p className="text-sm">Paid {money(data.money.net)} · Refunded {money(data.money.refunded)} · To collect {money(data.money.owed)}</p>
    {data.orders.map(order => <div key={order.billId} className="grid gap-2 border-t border-border pt-3 text-sm">
      <Link className="underline underline-offset-2" href={receiptPath(order.billId)}>Receipt {order.receiptNumber ?? "record"} · {money(order.charged)}</Link>
      <p className="text-muted-foreground">Correct the tender or payment date, or void a payment recorded in error, from this receipt.</p>
      {data.money.net > 0 && order.refundable > 0 ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", billId: order.billId, max: Math.min(order.refundable, data.money.net) })}>Refund from receipt</Button> : null}
    </div>)}
    {data.payments.map(payment => <div key={payment._id} className="grid gap-2 border-t border-border pt-3 text-sm">
      <p>{money(payment.amount)} · {payment.method} · {payment.status === "cancelled" ? "Cancelled: no money received" : "Recorded at the desk"}</p>
      <p className="text-muted-foreground">Received {formatResortDateTime(payment.effectiveAt)} · Recorded {formatResortDateTime(payment.recordedAt)} · {payment.recordedBy}</p>
      {payment.cancelReason ? <p>{payment.cancelReason}</p> : null}
      {payment.status === "recorded" ? <div className="flex flex-wrap gap-2">
        {!data.orders.length && (payment.method === "unrecorded" || MANUAL_PAYMENT_METHODS.some(method => method === payment.method)) ? <><Button size="sm" variant="outline" onClick={() => setDialog({ kind: "amend", payment })}>Correct method or date</Button><Button size="sm" variant="outline" disabled={data.money.refunded > 0} onClick={() => setDialog({ kind: "cancel", payment })}>Not received…</Button></> : null}
        {data.money.net > 0 && payment.amount > payment.refunded ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", paymentId: payment._id, max: Math.min(payment.amount - payment.refunded, data.money.net) })}>Refund from payment</Button> : null}
      </div> : null}
    </div>)}
    {data.unitemised > 0 && !data.orders.length ? <div className="grid gap-2 text-sm"><p>Earlier payment: {money(data.unitemised)}. Original method, actor and time were not itemised.</p>{data.legacyManualPayment ? <><p>The original change history identifies a manual Mark paid entry. Its original tender and received date remain unknown.</p><Button size="sm" variant="outline" onClick={() => setDialog({ kind: "legacyCancel", legacyChangeId: data.legacyManualPayment!.changeId })}>Not received…</Button></> : null}{data.money.net > 0 && !data.payments.some(p => p.status === "recorded") ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", max: data.money.net })}>Record refund</Button> : null}</div> : null}
    {data.refunds.map(refund => <div key={refund._id} className="border-t border-border pt-3 text-sm">
      <p>Refund {money(refund.amount)} · {refund.method}</p><p>{refund.reason}</p>
      <p className="text-muted-foreground">Returned {formatResortDateTime(refund.effectiveAt)} · Recorded {formatResortDateTime(refund.recordedAt)} · {refund.recordedBy}</p>
    </div>)}
    {appointment.paymentStatus === "refunded" && data.refunds.length === 0 ? <p className="text-sm text-muted-foreground">Legacy full refund. Its original amount, method and actor were not recorded separately.</p> : null}
    {appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" ? <Button variant="secondary" onClick={() => setDialog({ kind: "pay" })}>Record payment</Button> : null}
    {dialog ? <AppointmentMoneyDialog appointment={appointment} revision={data.revision} data={data} dialog={dialog} onClose={() => setDialog(null)} /> : null}
  </section>;
}

/** Captures the reviewed revision, attempt key and draft once, including ambiguous network retries. */
export function AppointmentMoneyDialog({ appointment, revision, dialog, onClose }: { appointment: Appointment; revision: number; data?: Finance; dialog: Dialog; onClose: () => void }) {
  const [original] = useState({ appointment, revision, dialog });
  const [key] = useState(() => crypto.randomUUID());
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState<Parameters<typeof refund>[0] | null>(null);
  const [amount, setAmount] = useState(dialog.kind === "refund" ? String(dialog.max) : String(appointment.price));
  const [method, setMethod] = useState<string>((dialog.kind === "amend" ? dialog.payment.method : "cash"));
  const [reason, setReason] = useState("");
  const effective = useEffectiveTime(dialog.kind === "amend" ? dialog.payment.effectiveAt : undefined);
  const pay = useMutation(api.adminServices.markAppointmentPaid);
  const refund = useMutation(api.adminServices.refundAppointment);
  const correct = useMutation(api.adminServices.correctAppointmentPaymentEntry);
  const isRefund = dialog.kind === "refund";
  const isCancel = dialog.kind === "cancel" || dialog.kind === "legacyCancel";
  const title = isRefund ? "Record refund" : dialog.kind === "pay" ? "Record payment" : isCancel ? "Cancel mistaken payment entry" : "Correct payment method or date";
  const validAmount = !isRefund || (Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= dialog.max && Math.round(Number(amount) * 100) / 100 === Number(amount));
  async function save() {
    if (retry.current) { await retry.current(); return; }
    const common = { appointmentId: original.appointment._id, expectedRevision: original.revision };
    if (dialog.kind === "refund") {
      // Freeze the submitted refund after an ambiguous error. Editing starts a fresh dialog/attempt.
      const input = attempt ?? { ...common, idempotencyKey: key, amount: Number(amount), currency: appointment.currency, method: method as typeof REFUND_METHODS[number], reason: reason.trim(), effectiveAt: effective.at!, ...(dialog.paymentId ? { paymentId: dialog.paymentId } : {}), ...(dialog.billId ? { billId: dialog.billId } : {}) };
      setAttempt(input);
      retry.current = () => refund(input);
    } else if (dialog.kind === "pay") {
      const input = { ...common, idempotencyKey: key, method: method as typeof MANUAL_PAYMENT_METHODS[number], effectiveAt: effective.at! };
      retry.current = () => pay(input);
    }
    else {
      const input = { ...common, idempotencyKey: key, ...(dialog.kind === "legacyCancel" ? { legacyChangeId: dialog.legacyChangeId } : { paymentId: dialog.payment._id }), action: isCancel ? "cancel" as const : "amend" as const, reason: reason.trim(), ...(dialog.kind === "amend" ? { ...(method !== "unrecorded" ? { method: method as typeof MANUAL_PAYMENT_METHODS[number] } : {}), effectiveAt: effective.at! } : {}) };
      retry.current = () => correct(input);
    }
    setSubmitted(true);
    await retry.current!();
  }
  return <ChangeConfirmDialog title={title} description={isRefund ? "Record money already returned to the guest. This does not send money or change the appointment’s service status." : isCancel ? "Use only when this manual entry was a mistake and no money was received. The appointment’s service status stays as recorded." : "Record the actual method and business date. This does not charge the guest."} rows={[{ label: "Amount", before: formatMoney(appointment.price, appointment.currency), after: isRefund ? formatMoney(Number(amount) || 0, appointment.currency) : isCancel ? "No money received" : formatMoney(appointment.price, appointment.currency) }]} confirmLabel={attempt ? "Retry same refund" : title} keepLabel="Close" confirmDisabled={!validAmount || (!isCancel && !effective.at) || (dialog.kind !== "pay" && !reason.trim())} onConfirm={save} onClose={onClose}>
    <fieldset disabled={submitted} className="grid gap-4">
      {isRefund ? <div className="grid gap-2"><Label htmlFor="af-amount">Refund amount (up to {formatMoney(dialog.max, appointment.currency)})</Label><Input id="af-amount" type="number" inputMode="decimal" min="0.01" max={dialog.max} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div> : null}
      {!isCancel ? <><MethodPicker label={isRefund ? "Refund method" : "Payment method"} methods={isRefund ? REFUND_METHODS : dialog.kind === "amend" && dialog.payment.method === "unrecorded" ? ["unrecorded", ...MANUAL_PAYMENT_METHODS] : MANUAL_PAYMENT_METHODS} value={method} onChange={setMethod} /><EffectiveTimeFields id="af" label={isRefund ? "Refund date" : "Payment date"} value={effective} /></> : null}
      {dialog.kind !== "pay" ? <div className="grid gap-2"><Label htmlFor="af-reason">Reason (required)</Label><Textarea id="af-reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></div> : null}
    </fieldset>
    {submitted ? <p className="text-sm text-muted-foreground">Retry sends the same details. Reopen this dialog to enter a different correction.</p> : null}
  </ChangeConfirmDialog>;
}
