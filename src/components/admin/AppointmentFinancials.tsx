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
import { EffectiveTimeFields, MethodPicker, ReceivedAtField, useEffectiveTime } from "./BookingMoneyFields";
import { formatMoney } from "./labels";
import { MONEY_METHOD_LABELS, staffLabel } from "./admin-bookings-shared";
import { Button, ButtonLink } from "@/components/ui/button";
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
  const records = data.orders.length + data.payments.length + data.refunds.length + (data.unitemised > 0 ? 1 : 0);
  if (records === 0 && appointment.paymentStatus !== "refunded" && !dialog) return null;
  return <details aria-label="Appointment payments" className="grid gap-3 text-sm">
    <summary className="min-h-9 cursor-pointer py-2 font-medium">Payments and refunds ({records})</summary>
    <div className="grid gap-3 pb-2">
    <p className="text-sm">Paid {money(data.money.net)} · Refunded {money(data.money.refunded)}</p>
    {data.orders.map(order => <div key={order.billId} className="grid gap-2 border-t border-border pt-3 text-sm">
      <Link className="underline underline-offset-2" href={receiptPath(order.billId)}>Receipt {order.receiptNumber ?? "record"} · {money(order.charged)}</Link>
      <p className="text-muted-foreground">Correct the tender or payment date, or void a payment recorded in error, from this receipt.</p>
      {data.money.net > 0 && order.refundable > 0 ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", billId: order.billId, max: Math.min(order.refundable, data.money.net) })}>Refund from receipt</Button> : null}
    </div>)}
    {data.payments.map(payment => <div key={payment._id} className="grid gap-2 border-t border-border pt-3 text-sm">
      <p>{money(payment.amount)} · {MONEY_METHOD_LABELS[payment.method] ?? payment.method} · {payment.status === "cancelled" ? "Voided: entered by mistake" : "Recorded at the desk"}</p>
      <p className="text-muted-foreground">Received {formatResortDateTime(payment.effectiveAt)} · Recorded {formatResortDateTime(payment.recordedAt)} · {staffLabel(payment.recordedBy)}</p>
      {payment.cancelReason ? <p>{payment.cancelReason}</p> : null}
      {payment.status === "recorded" ? <div className="flex flex-wrap gap-2">
        {!data.orders.length && (payment.method === "unrecorded" || MANUAL_PAYMENT_METHODS.some(method => method === payment.method)) ? <><Button size="sm" variant="outline" onClick={() => setDialog({ kind: "amend", payment })}>Correct…</Button><Button size="sm" variant="outline" disabled={data.money.refunded > 0} onClick={() => setDialog({ kind: "cancel", payment })}>Entered by mistake…</Button></> : null}
        {data.money.net > 0 && payment.amount > payment.refunded ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", paymentId: payment._id, max: Math.min(payment.amount - payment.refunded, data.money.net) })}>Refund from payment</Button> : null}
      </div> : null}
    </div>)}
    {data.unitemised > 0 && !data.orders.length ? <div className="grid gap-2 text-sm"><p>Earlier payment: {money(data.unitemised)}. Original method, actor and time were not itemised.</p>{data.legacyManualPayment ? <><p>The original change history identifies a manual Mark paid entry. Its original tender and received date remain unknown.</p><Button size="sm" variant="outline" onClick={() => setDialog({ kind: "legacyCancel", legacyChangeId: data.legacyManualPayment!.changeId })}>Entered by mistake…</Button></> : null}{data.money.net > 0 && !data.payments.some(p => p.status === "recorded") ? <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund", max: data.money.net })}>Record refund</Button> : null}</div> : null}
    {data.refunds.map(refund => <div key={refund._id} className="border-t border-border pt-3 text-sm">
      <p>Refund {money(refund.amount)} · {MONEY_METHOD_LABELS[refund.method] ?? refund.method}</p><p>{refund.reason}</p>
      <p className="text-muted-foreground">Returned {formatResortDateTime(refund.effectiveAt)} · Recorded {formatResortDateTime(refund.recordedAt)} · {staffLabel(refund.recordedBy)}</p>
    </div>)}
    {appointment.paymentStatus === "refunded" && data.refunds.length === 0 ? <p className="text-sm text-muted-foreground">Legacy full refund. Its original amount, method and actor were not recorded separately.</p> : null}
    </div>
    {dialog ? <AppointmentMoneyDialog appointment={appointment} revision={data.revision} data={data} dialog={dialog} onClose={() => setDialog(null)} /> : null}
  </details>;
}

/**
 * The money at the top of the appointment sheet: what is due, Take payment (checkout for this
 * appointment, on its stay's order when it has one) and Already paid… (records a desk payment).
 */
/** What is still due on the appointment (0 while loading), and its financial record. */
export function useAppointmentOwed(appointment: Appointment) {
  const data = useQuery(api.adminServices.getAppointmentFinancials, { appointmentId: appointment._id });
  const chargeable = appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" && appointment.status !== "no_show";
  return { data, owed: data && chargeable ? data.money.owed : 0 };
}

export function AppointmentMoneyBlock({ appointment, disabled }: { appointment: Appointment; disabled?: boolean }) {
  const { data, owed } = useAppointmentOwed(appointment);
  const [paying, setPaying] = useState(false);
  const headline = owed > 0 ? { label: "Balance due", amount: owed } : data && data.money.net > 0 ? { label: "Paid", amount: data.money.net } : { label: "Nothing due", amount: 0 };
  return <section aria-labelledby={`appointment-money-${appointment._id}`} className="grid gap-2 rounded-xl border border-border bg-muted/40 p-3">
    <div data-sentence-budget="ignore">
      <h3 id={`appointment-money-${appointment._id}`} className="text-sm font-medium text-muted-foreground">{data ? headline.label : "Balance due"}</h3>
      <p className="font-serif text-3xl font-semibold tabular-nums">{data ? formatMoney(headline.amount, appointment.currency) : "…"}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {owed > 0 ? <ButtonLink href={`/admin/checkout?appointment=${appointment._id}`} aria-disabled={disabled || undefined} className={disabled ? "pointer-events-none opacity-50" : undefined}>Take payment</ButtonLink> : null}
      {data && appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" ? (
        <Button variant="link" className="min-h-10 px-1" disabled={disabled} onClick={() => setPaying(true)}>Already paid…</Button>
      ) : null}
    </div>
    {paying && data ? <AppointmentMoneyDialog appointment={appointment} revision={data.revision} data={data} dialog={{ kind: "pay" }} onClose={() => setPaying(false)} /> : null}
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
  const title = isRefund ? "Record refund" : dialog.kind === "pay" ? "Already paid" : isCancel ? "Entered by mistake" : "Correct payment";
  const confirmLabel = attempt ? "Retry same refund" : isRefund ? `Record refund ${formatMoney(Number(amount) || 0, appointment.currency)}` : dialog.kind === "pay" ? `Record ${formatMoney(appointment.price, appointment.currency)}` : isCancel ? "Void entry" : "Save correction";
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
  return <ChangeConfirmDialog title={title} description={isRefund ? "Record money already given back to the guest." : isCancel ? "Void this entry; no money was received." : dialog.kind === "pay" ? `Record ${formatMoney(appointment.price, appointment.currency)} the guest already paid.` : "The amount stays as recorded."} rows={[{ label: "Amount", before: formatMoney(appointment.price, appointment.currency), after: isRefund ? formatMoney(Number(amount) || 0, appointment.currency) : isCancel ? "No money received" : formatMoney(appointment.price, appointment.currency) }]} confirmLabel={confirmLabel} keepLabel={isCancel ? "Keep payment" : null} destructive={isCancel} confirmDisabled={!validAmount || (!isCancel && !effective.at) || (dialog.kind !== "pay" && !reason.trim())} onConfirm={save} onClose={onClose}>
    <fieldset disabled={submitted} className="grid gap-4">
      {isRefund ? <div className="grid gap-2"><Label htmlFor="af-amount">Refund amount (up to {formatMoney(dialog.max, appointment.currency)})</Label><Input id="af-amount" type="number" inputMode="decimal" min="0.01" max={dialog.max} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div> : null}
      {!isCancel ? <><MethodPicker label={isRefund ? "Refund method" : "Payment method"} methods={isRefund ? REFUND_METHODS : dialog.kind === "amend" && dialog.payment.method === "unrecorded" ? ["unrecorded", ...MANUAL_PAYMENT_METHODS] : MANUAL_PAYMENT_METHODS} value={method} onChange={setMethod} />{dialog.kind === "pay" ? <ReceivedAtField id="af" label="Payment date" value={effective} /> : <EffectiveTimeFields id="af" label={isRefund ? "Refund date" : "Payment date"} value={effective} />}</> : null}
      {dialog.kind !== "pay" ? <div className="grid gap-2"><Label htmlFor="af-reason">Reason (required)</Label><Textarea id="af-reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></div> : null}
    </fieldset>
    {submitted ? <p className="text-sm text-muted-foreground">Retry sends the same details. Reopen this dialog to enter a different correction.</p> : null}
  </ChangeConfirmDialog>;
}
