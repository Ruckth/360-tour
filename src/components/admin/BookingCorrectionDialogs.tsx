"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { ChangeConfirmDialog } from "@/components/admin/ChangeConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EffectiveTimeFields, MethodPicker, NotifyGuestField, useEffectiveTime } from "./BookingMoneyFields";
import { bookingRefundSources, BookingRefundSourcePicker } from "./BookingRefundSource";
import { formatMoney, STATUS_LABELS } from "./labels";
import { REFUND_METHODS, newAttemptKey, parseAmount, type RefundMethod } from "./admin-bookings-shared";

type BookingDetail = NonNullable<FunctionReturnType<typeof api.bookings.admin.getForAdmin>>;
const hotelLabels: Record<string, string> = STATUS_LABELS.hotelBooking;

/**
 * Cancels a stay. A paid stay keeps its payment unless staff record a refund of any part of it
 * here, in the same save. The guest email choice is explicit and defaults to no for past stays.
 */
export function CancelStayDialog({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const cancelStay = useMutation(api.bookings.commands.cancelStay.cancelStay);
  const { money } = booking;
  const [reviewed] = useState(() => ({ revision: booking.revision, key: newAttemptKey("cancel-refund") }));
  const [choice, setChoice] = useState<"keep" | "refund">("keep");
  const data = useQuery(api.bookings.admin.bookingFinancials, choice === "refund" ? { bookingId: booking._id } : "skip");
  const sources = data ? bookingRefundSources(data) : [];
  const [target, setTarget] = useState<string | null>(null);
  const selected = target ?? sources[0]?.value ?? "";
  const source = sources.find(s => s.value === selected);
  const [attempt, setAttempt] = useState<Parameters<typeof cancelStay>[0] | null>(null);
  const [amountText, setAmountText] = useState(String(money.net));
  const [method, setMethod] = useState<RefundMethod>(booking.hasStripePayment ? "stripe" : "cash");
  const [refundReason, setRefundReason] = useState("");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(booking.notifyByDefault);
  const when = useEffectiveTime();
  const paid = money.net > 0;
  const refunding = paid && choice === "refund";
  const amount = parseAmount(amountText);
  const cap = Math.min(money.net, source?.left ?? 0);
  const amountProblem = !refunding ? null : amount === null || amount <= 0 ? "Enter an amount, at most 2 decimals." : amount > cap ? `At most ${formatMoney(cap, money.currency)} from this payment. Record other refunds separately.` : null;
  const kept = refunding && amount !== null ? money.net - amount : money.net;

  return (
    <ChangeConfirmDialog
      title="Cancel this booking?"
      description={
        paid
          ? "The booking is cancelled and its nights released. Cancelling does not refund anything: keep the payment, or record the refund you are giving back."
          : "The booking is cancelled and its nights released."
      }
      rows={[
        { label: "Status", before: hotelLabels[booking.status] ?? booking.status, after: "Cancelled" },
        ...(paid ? [{ label: "Kept", before: formatMoney(money.net, money.currency), after: formatMoney(kept, money.currency) }] : []),
      ]}
      confirmLabel={refunding ? "Cancel & record refund" : "Cancel booking"}
      keepLabel="Keep booking"
      destructive
      confirmDisabled={!attempt && (when.at === null || Boolean(amountProblem) || (refunding && (!refundReason.trim() || !source || !data?.complete)))}
      footnote={refunding ? "Recording does not return money. For Stripe payments, refund in the Stripe dashboard first." : undefined}
      onConfirm={async () => {
        const args = attempt ?? {
          bookingId: booking._id, expectedRevision: reviewed.revision, reason: reason.trim() || undefined, effectiveAt: when.at!, notifyGuest: notify,
          ...(refunding ? { refund: { amount: amount!, currency: money.currency, method, reason: refundReason, effectiveAt: when.at!, idempotencyKey: reviewed.key, ...source!.reference } } : {}),
        };
        if (refunding) setAttempt(args);
        await cancelStay(args);
      }}
      onClose={onClose}
    >
      {attempt ? <p className="text-sm text-muted-foreground">Retry sends the same cancellation and refund details. Reopen to review a different correction.</p> : null}
      <fieldset disabled={Boolean(attempt)} className="grid min-w-0 gap-4 disabled:opacity-70">
      {paid ? (
        <div className="grid gap-2">
          <span id="cancel-money" className="text-sm font-medium">The guest paid {formatMoney(money.net, money.currency)}</span>
          <ToggleGroup value={choice} onValueChange={setChoice} aria-labelledby="cancel-money">
            <ToggleGroupItem value="keep" className="min-h-9 flex-1">Keep the payment</ToggleGroupItem>
            <ToggleGroupItem value="refund" className="min-h-9 flex-1">Record a refund</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      {refunding ? (
        <>
          {data === undefined ? <p role="status">Loading refundable payments…</p> : !data?.complete ? <p role="alert">Review the complete payment history before recording a refund. You can still cancel and keep the payment.</p> : <BookingRefundSourcePicker id="cancel-refund-source" sources={sources} value={selected} onChange={setTarget} />}
          <div className="grid gap-2">
            <Label htmlFor="cancel-refund-amount">Refund amount ({money.currency})</Label>
            <Input id="cancel-refund-amount" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} aria-invalid={Boolean(amountProblem)} aria-describedby="cancel-refund-hint" />
            <p id="cancel-refund-hint" className={cn("text-xs", amountProblem ? "text-destructive" : "text-muted-foreground")}>
              {amountProblem ?? (kept > 0 ? `${formatMoney(kept, money.currency)} stays kept (for example a cancellation fee).` : "The whole payment is refunded.")}
            </p>
          </div>
          <MethodPicker label="Given back by" methods={REFUND_METHODS} value={method} onChange={setMethod} />
          <div className="grid gap-2">
            <Label htmlFor="cancel-refund-reason">Refund reason (required)</Label>
            <Textarea id="cancel-refund-reason" required maxLength={500} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} />
          </div>
        </>
      ) : null}
      <EffectiveTimeFields id="cancel-when" label={refunding ? "Cancelled and refunded on" : "Cancelled on"} value={when} />
      <div className="grid gap-2">
        <Label htmlFor="cancel-reason">Cancellation reason (optional)</Label>
        <Input id="cancel-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <NotifyGuestField id="cancel-notify" guestEmail={booking.guestEmail} checked={notify} onChange={setNotify} action="the cancellation" />
      </fieldset>
    </ChangeConfirmDialog>
  );
}

/**
 * Reopens a cancelled, expired or refunded stay. Payments and refunds stay as recorded; a stay
 * still holding money comes back paid and confirmed. The nights are checked again on save.
 */
export function ReopenBookingDialog({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const reopen = useMutation(api.bookings.commands.reopenBooking.reopenBooking);
  const [revision] = useState(booking.revision);
  const paid = booking.money.net > 0;
  const pendingAllowed = !paid && booking.source === "admin";
  const [confirmed, setConfirmed] = useState(true);
  const holds = confirmed || !pendingAllowed;
  const [reason, setReason] = useState("");
  const [villaReason, setVillaReason] = useState("");
  const [notify, setNotify] = useState(booking.notifyByDefault);
  const archived = booking.propertyStatus !== "active";

  return (
    <ChangeConfirmDialog
      title="Reopen this booking?"
      description="Its payments and refunds stay as recorded. The nights are checked again and held if it is confirmed."
      rows={[
        { label: "Status", before: "Cancelled", after: holds ? "Confirmed" : "Pending" },
        { label: "Payment", before: formatMoney(booking.money.net, booking.currency) + " kept", after: paid ? "Paid " + formatMoney(booking.money.net, booking.currency) : `Unpaid, ${formatMoney(booking.total, booking.currency)} due` },
      ]}
      confirmLabel="Reopen booking"
      keepLabel="Keep cancelled"
      confirmDisabled={!reason.trim() || (archived && !villaReason.trim())}
      onConfirm={async () => {
        await reopen({
          bookingId: booking._id, expectedRevision: revision, confirmed: holds, reason, notifyGuest: holds && notify,
          ...(archived ? { archivedVillaReason: villaReason } : {}),
        });
      }}
      onClose={onClose}
    >
      {pendingAllowed ? (
        <div className="grid gap-2">
          <span id="reopen-status" className="text-sm font-medium">Reopen as</span>
          <ToggleGroup value={confirmed ? "confirmed" : "pending"} onValueChange={(value) => setConfirmed(value === "confirmed")} aria-labelledby="reopen-status">
            <ToggleGroupItem value="confirmed" className="min-h-9 flex-1">Confirmed (holds nights)</ToggleGroupItem>
            <ToggleGroupItem value="pending" className="min-h-9 flex-1">Pending</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {paid ? "Money is still kept on it, so it reopens paid and confirmed." : "Online bookings reopen confirmed: pending ones expire automatically."}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor="reopen-reason">Reason (required)</Label>
        <Textarea id="reopen-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cancelled by mistake, guest arrived after all…" />
      </div>
      {archived ? (
        <div className="grid gap-2">
          <Label htmlFor="reopen-villa">This villa is archived. Why record this stay in it? (required)</Label>
          <Input id="reopen-villa" maxLength={500} value={villaReason} onChange={(event) => setVillaReason(event.target.value)} />
          <p className="text-xs text-muted-foreground">Allowed only for stays that started in the past.</p>
        </div>
      ) : null}
      {holds ? <NotifyGuestField id="reopen-notify" guestEmail={booking.guestEmail} checked={notify} onChange={setNotify} action="the confirmed booking" /> : null}
    </ChangeConfirmDialog>
  );
}
