"use client";

import { satangToBaht } from 'convex/shared/money';

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { formatReceiptNumber } from "convex/lib/orderMath";
import Link from "next/link";
import { useRef, useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { receiptPath } from "@/components/checkout/checkout-source";
import { formatResortDateTime } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { DisabledReason } from "./DisabledReason";
import { EffectiveTimeFields, MethodPicker, NotifyGuestField, useEffectiveTime } from "./BookingMoneyFields";
import { bookingRefundSources, BookingRefundSourcePicker } from "./BookingRefundSource";
import { formatMoney } from "./labels";
import {
  DESK_PAYMENT_METHODS,
  MONEY_METHOD_LABELS,
  PAYMENT_ORIGIN_LABELS,
  REFUND_METHODS,
  newAttemptKey,
  parseAmount,
  type DeskPaymentMethod,
  type RefundMethod,
} from "./admin-bookings-shared";

type BookingDetail = NonNullable<FunctionReturnType<typeof api.bookings.admin.getForAdmin>>;
type Financials = NonNullable<FunctionReturnType<typeof api.bookings.admin.bookingFinancials>>;
type Payment = Financials["payments"][number];

type Dialog =
  | { kind: "linkStripe"; refund: Financials["refunds"][number] }
  | { kind: "pay" }
  | { kind: "refund"; target?: string }
  | { kind: "amend"; payment: Payment }
  | { kind: "cancelEntry"; payment: Payment };

/**
 * The stay's money in the booking sheet: what was received (each payment with how and when),
 * what was refunded, and the corrections staff can make. Recording never moves money: refunds are
 * given back by staff, online payments stay the provider's record, and checkout payments are
 * corrected from their receipt.
 */
export function BookingFinancials({ booking }: { booking: BookingDetail }) {
  const data = useQuery(api.bookings.admin.bookingFinancials, { bookingId: booking._id });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");

  if (data === undefined) return <Skeleton className="h-20 w-full" aria-label="Loading payments" />;
  if (data === null) return null;
  const { money } = data;
  const cancelled = booking.status === "cancelled";
  const canPay = !cancelled && money.owed > 0 && booking.paymentStatus !== "failed";
  const close = (done?: string) => {
    setDialog(null);
    if (done) setNotice(done);
  };

  return (
    <section aria-labelledby="booking-payments" className="grid gap-3">
      <h3 id="booking-payments" className="admin-eyebrow">Payments and refunds</h3>
      <p className="text-sm">
        Paid {formatMoney(money.net, money.currency)}
        {money.refunded > 0 ? ` · Refunded ${formatMoney(money.refunded, money.currency)}` : ""}
        {" · "}
        <span className="font-medium">
          {money.owed > 0 && !cancelled
            ? `Balance due ${formatMoney(money.owed, money.currency)}`
            : money.credit > 0
              ? `Credit ${formatMoney(money.credit, money.currency)}`
              : cancelled && money.net > 0
                ? `${formatMoney(money.net, money.currency)} kept`
                : "Settled"}
        </span>
      </p>


      {data.payments.length ? (
        <ul className="grid gap-2">
          {data.payments.map((payment) => (
            <PaymentRow key={payment._id} payment={payment} refundable={money.refundable > 0} onAction={setDialog} />
          ))}
        </ul>
      ) : null}



      {data.refunds.length ? (
        <ul className="grid gap-1 text-sm" aria-label="Refunds">
          {data.refunds.map((refund) => (
            <li key={refund._id} className="grid gap-0.5">
              <p>
                Refunded {formatMoney(refund.amount, refund.currency)} · {MONEY_METHOD_LABELS[refund.method] ?? refund.method}
                <span className="text-muted-foreground"> · {formatResortDateTime(refund.effectiveAt)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {refund.reason}
                {refund.order ? ` · from ${refund.order.title}` : ""} · recorded by {refund.recordedBy}
              </p>
              {refund.providerRefundId ? <p className="break-all text-xs text-muted-foreground">Stripe refund {refund.providerRefundId}</p> : null}
              {refund.method === "stripe" && !refund.providerRefundId && !refund.providerEventId ? (
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setDialog({ kind: "linkStripe", refund })}>Link Stripe refund evidence</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canPay ? (
          <DisabledReason reason={booking.checkoutLive && "Wait for the guest's Stripe checkout to finish or expire."}>
            <Button size="sm" variant="secondary" disabled={booking.checkoutLive} onClick={() => setDialog({ kind: "pay" })}>
              Record payment
            </Button>
          </DisabledReason>
        ) : null}
        {money.refundable > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "refund" })}>
            Record refund
          </Button>
        ) : null}
      </div>
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}

      {dialog?.kind === "pay" ? <RecordPaymentDialog booking={booking} owed={money.owed} onClose={close} /> : null}
      {dialog?.kind === "linkStripe" ? <LinkStripeRefundDialog booking={booking} refund={dialog.refund} onClose={close} /> : null}
      {dialog?.kind === "refund" ? <RefundDialog booking={booking} data={data} initialTarget={dialog.target} onClose={close} /> : null}
      {dialog?.kind === "amend" ? <AmendPaymentDialog booking={booking} payment={dialog.payment} onClose={close} /> : null}
      {dialog?.kind === "cancelEntry" ? (
        <CancelEntryDialog
          booking={booking}
          owedAfter={money.owed + (dialog.payment.amount)}
          amount={dialog.payment.amount}
          paymentId={dialog.payment._id}
          onClose={close}
        />
      ) : null}
    </section>
  );
}

/** Closes with a confirmation line only when the save succeeded (ChangeConfirmDialog closes either way). */
function useDone(onClose: (done?: string) => void, message: string) {
  const saved = useRef(false);
  return {
    saved: () => { saved.current = true; },
    close: () => onClose(saved.current ? message : undefined),
  };
}

function PaymentRow({ payment, refundable, onAction }: { payment: Payment; refundable: boolean; onAction: (dialog: Dialog) => void }) {
  const cancelled = payment.status === "cancelled";
  const method = payment.origin === "pos" ? null : MONEY_METHOD_LABELS[payment.method] ?? payment.method;
  return (
    <li className="grid gap-1 text-sm">
      <p className={cn(cancelled && "text-muted-foreground line-through decoration-muted-foreground/50")}>
        {formatMoney(payment.amount, payment.currency)} · {PAYMENT_ORIGIN_LABELS[payment.origin]}
        {method ? ` · ${method}` : ""}
        {payment.order ? (
          <>
            {" · "}
            <Link className="underline-offset-2 hover:underline" href={receiptPath(payment.order._id)}>
              {payment.order.title}{payment.order.receiptNumber !== undefined ? ` · ${formatReceiptNumber(payment.order.receiptNumber)}` : ""}
            </Link>
          </>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        Received {formatResortDateTime(payment.effectiveAt)} · recorded {formatResortDateTime(payment.recordedAt)} by {payment.recordedBy}
        {payment.amendedBy ? ` · corrected by ${payment.amendedBy}` : ""}
        {payment.note ? ` · ${payment.note}` : ""}
      </p>
      {payment.refunded > 0 ? <p className="text-xs text-muted-foreground">{formatMoney(payment.refunded, payment.currency)} of it refunded</p> : null}
      {cancelled ? <p className="text-xs text-muted-foreground">Cancelled as recorded in error: {payment.cancelReason}</p> : null}
      {!cancelled ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {payment.amendBlocker === null ? (
            <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "amend", payment })}>Correct method or date</Button>
          ) : null}
          {payment.cancelBlocker === null ? (
            <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "cancelEntry", payment })}>Not received…</Button>
          ) : null}
          {refundable && payment.refundable > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => onAction({ kind: "refund", target: `payment:${payment._id}` })}>Refund from this</Button>
          ) : null}
          {payment.amendBlocker && payment.origin !== "manual" ? <span className="text-xs text-muted-foreground">{payment.amendBlocker}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

function LinkStripeRefundDialog({ booking, refund, onClose }: { booking: BookingDetail; refund: Financials["refunds"][number]; onClose: (done?: string) => void }) {
  const link = useMutation(api.bookings.payments.stripe.linkRecordedStripeRefund);
  const [revision] = useState(booking.revision);
  const [chargeId, setChargeId] = useState("");
  const [refundId, setRefundId] = useState("");
  const attempt = useRef<{ bookingId: Id<"bookings">; refundId: Id<"bookingRefunds">; expectedRevision: number; chargeId: string; providerRefundId: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const done = useDone(onClose, "Stripe refund evidence linked. Stripe can now retry reconciliation.");
  return <ChangeConfirmDialog
    title="Link Stripe refund evidence"
    description="Use the charge and refund IDs from Stripe for this recorded refund. Linking prevents the same returned money being counted twice; it does not send a refund."
    rows={[{ label: "Recorded refund", before: formatMoney(refund.amount, refund.currency), after: formatMoney(refund.amount, refund.currency) }]}
    confirmLabel={submitted ? "Retry linking" : "Link refund"}
    keepLabel="Close"
    confirmDisabled={!/^ch_[A-Za-z0-9]+$/.test(chargeId.trim()) || !/^re_[A-Za-z0-9]+$/.test(refundId.trim())}
    onConfirm={async () => {
      attempt.current ??= { bookingId: booking._id, refundId: refund._id, expectedRevision: revision, chargeId: chargeId.trim(), providerRefundId: refundId.trim() };
      setSubmitted(true);
      await link(attempt.current);
      done.saved();
    }}
    onClose={done.close}
  >
    <div className="grid gap-2"><Label htmlFor="stripe-charge-id">Stripe charge ID</Label><Input id="stripe-charge-id" value={chargeId} disabled={submitted} onChange={event => setChargeId(event.target.value)} placeholder="ch_…" /></div>
    <div className="grid gap-2"><Label htmlFor="stripe-refund-id">Stripe refund ID</Label><Input id="stripe-refund-id" value={refundId} disabled={submitted} onChange={event => setRefundId(event.target.value)} placeholder="re_…" /></div>
    {submitted ? <p className="text-xs text-muted-foreground">Retry uses the same reviewed IDs. Close and reopen to correct them.</p> : null}
  </ChangeConfirmDialog>;
}

function RecordPaymentDialog({ booking, owed, onClose }: { booking: BookingDetail; owed: number; onClose: (done?: string) => void }) {
  const recordPayment = useMutation(api.bookings.commands.recordPayment.recordPayment);
  const [reviewed] = useState(() => ({ revision: booking.revision, owed, key: newAttemptKey("pay") }));
  const [method, setMethod] = useState<DeskPaymentMethod>("cash");
  const [note, setNote] = useState("");
  const when = useEffectiveTime();
  const firstConfirmation = !booking.confirmationEmailed;
  const done = useDone(onClose, "Payment recorded.");
  const [notify, setNotify] = useState(booking.notifyByDefault);

  return (
    <ChangeConfirmDialog
      title="Record payment"
      description={`Record ${formatMoney(reviewed.owed, booking.currency)} the guest already paid at the desk, with the date it was received. This does not charge the guest.`}
      rows={[
        { label: "Paid", before: formatMoney(booking.money.net, booking.currency), after: formatMoney(booking.money.net + reviewed.owed, booking.currency) },
        { label: "Balance", before: formatMoney(reviewed.owed, booking.currency), after: formatMoney(0, booking.currency) },
      ]}
      confirmLabel={`Record ${formatMoney(reviewed.owed, booking.currency)}`}
      keepLabel="Close"
      confirmDisabled={when.at === null}
      onConfirm={async () => {
        await recordPayment({
          bookingId: booking._id, expectedRevision: reviewed.revision, expectedAmount: reviewed.owed, method,
          effectiveAt: when.at!, note: note.trim() || undefined, idempotencyKey: reviewed.key,
          ...(firstConfirmation ? { notifyGuest: notify } : { notifyGuest: false }),
        });
        done.saved();
      }}
      onClose={done.close}
    >
      <MethodPicker label="Paid by" methods={DESK_PAYMENT_METHODS} value={method} onChange={setMethod} />
      <EffectiveTimeFields id="pay-when" label="Received on" value={when} />
      <div className="grid gap-2">
        <Label htmlFor="pay-note">Note (optional)</Label>
        <Input id="pay-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Slip number, who took it…" />
      </div>
      {firstConfirmation ? (
        <NotifyGuestField id="pay-notify" guestEmail={booking.guestEmail} checked={notify} onChange={setNotify} action="the confirmed booking" />
      ) : null}
    </ChangeConfirmDialog>
  );
}

function RefundDialog({ booking, data, initialTarget, onClose }: { booking: BookingDetail; data: Financials; initialTarget?: string; onClose: (done?: string) => void }) {
  const recordRefund = useMutation(api.bookings.commands.recordRefund.recordRefund);
  const { money } = data;
  const [reviewed] = useState(() => ({ revision: data.revision, key: newAttemptKey("refund") }));
  const [attempt, setAttempt] = useState<Parameters<typeof recordRefund>[0] | null>(null);
  const targets = bookingRefundSources(data);
  const [target, setTarget] = useState(initialTarget ?? targets[0]?.value ?? "none");
  const chosen = targets.find((t) => t.value === target);
  const cap = Math.min(money.refundable, chosen?.left ?? money.refundable);
  const [amountText, setAmountText] = useState(String(satangToBaht(cap)));
  const [method, setMethod] = useState<RefundMethod>(chosen?.stripe ? "stripe" : "cash");
  const [reason, setReason] = useState("");
  const when = useEffectiveTime();
  const amount = parseAmount(amountText);
  const amountProblem = amount === null || amount <= 0 ? "Enter an amount, at most 2 decimals." : amount > cap ? `At most ${formatMoney(cap, money.currency)}.` : null;
  const after = amount !== null ? money.net - amount : money.net;
  const done = useDone(onClose, "Refund recorded. Remember: recording it does not return the money.");

  return (
    <ChangeConfirmDialog
      title="Record refund"
      description={
        money.refundContext === "credit"
          ? "Record money given back for what the guest paid above the price of the stay. Recording does not return money: give it back first (for Stripe payments, refund in the Stripe dashboard)."
          : "Record money given back on this cancelled stay. Recording does not return money: give it back first (for Stripe payments, refund in the Stripe dashboard). Any amount not refunded stays kept."
      }
      rows={[
        { label: "Paid", before: formatMoney(money.net, money.currency), after: formatMoney(after, money.currency) },
        { label: "Refunded", before: formatMoney(money.refunded, money.currency), after: formatMoney(money.refunded + (amount ?? 0), money.currency) },
      ]}
      confirmLabel="Record refund"
      keepLabel="Close"
      destructive
      confirmDisabled={!attempt && (Boolean(amountProblem) || !reason.trim() || when.at === null)}
      onConfirm={async () => {
        const args = attempt ?? {
          bookingId: booking._id, expectedRevision: reviewed.revision, amount: amount!, currency: money.currency, method,
          reason, effectiveAt: when.at!, idempotencyKey: reviewed.key,
          ...chosen?.reference,
        };
        setAttempt(args);
        await recordRefund(args);
        done.saved();
      }}
      onClose={done.close}
    >
      {attempt ? <p className="text-sm text-muted-foreground">Retry keeps the original amount, payment, reason and date. Close and reopen to review a different correction.</p> : null}
      <fieldset disabled={Boolean(attempt)} className="grid min-w-0 gap-3 disabled:opacity-70">
      {targets.length ? (
        <BookingRefundSourcePicker id="refund-from" sources={targets} value={target} onChange={setTarget} />
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="refund-amount">Amount ({money.currency})</Label>
        <Input id="refund-amount" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} aria-invalid={Boolean(amountProblem)} aria-describedby="refund-amount-hint" />
        <p id="refund-amount-hint" className={cn("text-xs", amountProblem ? "text-destructive" : "text-muted-foreground")}>
          {amountProblem ?? `Up to ${formatMoney(cap, money.currency)} can be refunded.`}
        </p>
      </div>
      <MethodPicker label="Given back by" methods={REFUND_METHODS} value={method} onChange={setMethod} />
      <EffectiveTimeFields id="refund-when" label="Refunded on" value={when} />
      <div className="grid gap-2">
        <Label htmlFor="refund-reason">Reason (required)</Label>
        <Textarea id="refund-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Left a night early, goodwill…" />
      </div>
      </fieldset>
    </ChangeConfirmDialog>
  );
}

function AmendPaymentDialog({ booking, payment, onClose }: { booking: BookingDetail; payment: Payment; onClose: (done?: string) => void }) {
  const amendPayment = useMutation(api.bookings.commands.amendPayment.amendPayment);
  const [revision] = useState(booking.revision);
  const initialMethod = (DESK_PAYMENT_METHODS as readonly string[]).includes(payment.method) ? (payment.method as DeskPaymentMethod) : "cash";
  const [method, setMethod] = useState<DeskPaymentMethod>(initialMethod);
  const when = useEffectiveTime(payment.effectiveAt);
  const [note, setNote] = useState(payment.note ?? "");
  const [reason, setReason] = useState("");
  const done = useDone(onClose, "Payment corrected.");
  const changed = method !== payment.method || when.at !== payment.effectiveAt || note.trim() !== (payment.note ?? "");

  return (
    <ChangeConfirmDialog
      title="Correct payment"
      description="Fix how or when this payment was received. The amount stays; if no money was received, use Not received instead."
      rows={[
        { label: "Method", before: MONEY_METHOD_LABELS[payment.method] ?? payment.method, after: MONEY_METHOD_LABELS[method] },
        { label: "Received", before: formatResortDateTime(payment.effectiveAt), after: when.at === null ? "—" : formatResortDateTime(when.at) },
      ]}
      confirmLabel="Save correction"
      confirmDisabled={!changed || !reason.trim() || when.at === null}
      onConfirm={async () => {
        await amendPayment({
          bookingId: booking._id, paymentId: payment._id, expectedRevision: revision,
          method, effectiveAt: when.at!, note: note.trim(), reason,
        });
        done.saved();
      }}
      onClose={done.close}
    >
      <MethodPicker label="Paid by" methods={DESK_PAYMENT_METHODS} value={method} onChange={setMethod} />
      <EffectiveTimeFields id="amend-when" label="Received on" value={when} />
      <div className="grid gap-2">
        <Label htmlFor="amend-note">Note</Label>
        <Input id="amend-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="amend-reason">Reason for the correction (required)</Label>
        <Textarea id="amend-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </ChangeConfirmDialog>
  );
}

function CancelEntryDialog({
  booking,
  amount,
  owedAfter,
  paymentId,
  onClose,
}: {
  booking: BookingDetail;
  amount: number;
  owedAfter: number;
  paymentId: Id<"bookingPayments">;
  onClose: (done?: string) => void;
}) {
  const cancelPayment = useMutation(api.bookings.commands.cancelPayment.cancelPayment);
  const [revision] = useState(booking.revision);
  const [reason, setReason] = useState("");
  const done = useDone(onClose, "Payment entry cancelled.");
  return (
    <ChangeConfirmDialog
      title="Payment not received?"
      description={`Use this only when ${formatMoney(amount, booking.currency)} was recorded by mistake and never received. Nothing is refunded; the entry stays in the history, marked cancelled.`}
      rows={[
        { label: "Paid", before: formatMoney(booking.money.net, booking.currency), after: formatMoney(booking.money.net - amount, booking.currency) },
        { label: "Balance", before: formatMoney(booking.money.owed, booking.currency), after: formatMoney(owedAfter, booking.currency) },
      ]}
      confirmLabel="Cancel this entry"
      keepLabel="Keep payment"
      destructive
      confirmDisabled={!reason.trim()}
      onConfirm={async () => {
        await cancelPayment({
          bookingId: booking._id, expectedRevision: revision, reason,
          paymentId,
        });
        done.saved();
      }}
      onClose={done.close}
    >
      <div className="grid gap-2">
        <Label htmlFor="cancel-entry-reason">Reason (required)</Label>
        <Textarea id="cancel-entry-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Entered on the wrong booking…" />
      </div>
    </ChangeConfirmDialog>
  );
}
