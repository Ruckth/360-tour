"use client";

import { parseMoneyInput } from '@/lib/money-input';

import { useRef, useState } from "react";
import type { Doc } from "convex/_generated/dataModel";
import { appointmentRevision } from "convex/lib/appointmentWindow";
import { CheckoutBackendProvider, newAttemptKey, useCheckoutBackend, type CheckoutActions, type OrderId } from "@/components/checkout/backend";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { orderPath, receiptPath } from "@/components/checkout/checkout-source";
import { InlineErrorBoundary } from "@/components/checkout/ErrorBoundary";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/staff-bookings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "./labels";

type Appointment = Pick<Doc<"appointments">, "_id" | "status" | "paymentStatus" | "price" | "currency" | "revision" | "start" | "confirmationCode">;
/** Mount in AppointmentSheet with its actual appointment document. Never uses the ordinary attachment path. */
export function AppointmentFeeAction({ appointment, onPendingChange }: { appointment: Appointment; onPendingChange?: (pending: boolean) => void }) {
  return <CheckoutBackendProvider backend={convexCheckoutBackend}><InlineErrorBoundary resetKey={appointment._id} message="Couldn't load appointment fees. Try again."><AppointmentFeeControls key={appointment._id} appointment={appointment} onPendingChange={onPendingChange} /></InlineErrorBoundary></CheckoutBackendProvider>;
}
/** Same controls run against the fixture provider in local behavioral tests. */
export function AppointmentFeeControls({ appointment, onPendingChange }: { appointment: Appointment; onPendingChange?: (pending: boolean) => void }) {
  const backend = useCheckoutBackend();
  const fees = backend.useAppointmentFees(appointment._id);
  const actions = backend.useActions();
  const [reviewed, setReviewed] = useState(appointment);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OrderId | null>(null);
  const sending = useRef(false);
  const [attempt, setAttempt] = useState<Parameters<CheckoutActions["addAppointmentFee"]>[0] | null>(null);
  const kind = reviewed.status === "no_show" ? "no_show" : "late_cancellation";
  const voidFee = fees?.find(f => f.order.state === "void");
  const voidView = backend.useOrder(voidFee?.order._id ?? null);
  const active = fees?.find(f => f.order.state === "unpaid" || f.order.state === "paid") ?? (voidFee && voidView && !voidView.paymentRecord.voidUnreceived ? voidFee : undefined);
  const checking = fees === undefined || Boolean(voidFee && voidView === undefined);
  const changed = appointmentRevision(appointment) !== appointmentRevision(reviewed) || appointment.status !== reviewed.status || appointment.price !== reviewed.price || appointment.paymentStatus !== reviewed.paymentStatus || appointment.currency !== reviewed.currency;
  const eligible = (reviewed.status === "no_show" || reviewed.status === "cancelled") && reviewed.paymentStatus === "unpaid" && reviewed.currency === "THB";
  const value = parseMoneyInput(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value > 0 && Number.isSafeInteger(value) && (reviewed.price <= 0 || value <= reviewed.price) && reason.trim().length > 0;
  async function add() {
    if (sending.current || (!attempt && (!valid || changed || !eligible || active))) return;
    // Preserve the reviewed revision and attempt key after a lost response.
    const args = attempt ?? { appointmentId: reviewed._id, kind, amount: value, reason: reason.trim(), expectedRevision: appointmentRevision(reviewed), idempotencyKey: newAttemptKey() };
    setAttempt(args); sending.current = true; setPending(true); onPendingChange?.(true); setError("");
    try { const out = await actions.addAppointmentFee(args); setResult(out.orderId); }
    catch (err) { setError(errorText(err, "Couldn't add the fee. Review existing fee orders before retrying.")); }
    finally { sending.current = false; setPending(false); onPendingChange?.(false); }
  }
  return <section aria-label="Appointment fee" className="grid gap-3">
    <h3 className="font-semibold">No-show or cancellation fee</h3>
    <p className="text-sm text-muted-foreground">Creates a clearly labelled fee in checkout. The appointment’s status, service price and payment stay unchanged.</p>
    {fees === undefined ? <p role="status">Loading fee orders…</p> : null}
    {fees?.map(f => <div key={f.lineId} className="grid gap-1 border-t border-border pt-2 text-sm"><p>{f.kind === "no_show" ? "No-show fee" : "Late cancellation fee"} · {formatMoney(f.amount, f.currency)} · {f.order.state}</p><p>{f.reason}</p><Link aria-disabled={pending} onClick={(e) => { if (pending) e.preventDefault(); }} className="underline underline-offset-2" href={f.order.state === "paid" || f.order.state === "void" ? receiptPath(f.order._id) : orderPath(f.order._id)}>{f.order.title}</Link></div>)}
    {result ? <Link className="underline underline-offset-2" href={orderPath(result)}>Open fee order in checkout</Link> : null}
    {active ? <p className="text-sm">A fee is already {active.order.state !== "unpaid" ? "charged" : "on an unpaid order"}. Open {active.order.title} above to continue; another fee cannot be collected.</p> : null}
    {error && active ? <p role="status" className="text-sm">The response may have been lost. An existing fee is shown above; open its order to continue.</p> : null}
    {!eligible ? <p className="text-sm text-muted-foreground">Fees require an unpaid no-show or cancelled appointment priced in THB. Review payment records for prepaid appointments.</p> : null}
    {eligible && !result && (!active || (attempt && pending)) ? <>
      <Label htmlFor={`fee-amount-${appointment._id}`}>Fee amount (THB){reviewed.price > 0 ? ` · maximum ${formatMoney(reviewed.price)}` : ""}</Label>
      <Input id={`fee-amount-${appointment._id}`} inputMode="decimal" value={amount} disabled={pending || Boolean(attempt)} onChange={e => setAmount(e.target.value)} />
      <Label htmlFor={`fee-reason-${appointment._id}`}>Reason for fee</Label><Textarea id={`fee-reason-${appointment._id}`} maxLength={500} value={reason} disabled={pending || Boolean(attempt)} onChange={e => setReason(e.target.value)} />
      {changed ? <p role="alert">Appointment changed. Review current details before adding a fee.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error} If the response was lost, use the existing order above. No second fee will be created.</p> : null}
      <Button disabled={pending || checking || (!attempt && (!valid || changed))} onClick={() => void add()}>{pending ? "Adding fee…" : attempt ? "Retry fee" : "Add fee to checkout"}</Button>
      {(changed || error) && !pending ? <Button variant="outline" onClick={() => { setAttempt(null); setReviewed(appointment); setError(""); }}>Review current appointment</Button> : null}
    </> : null}
  </section>;
}
