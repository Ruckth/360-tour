"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { StatusBadge } from "./StatusBadge";
import { DisabledReason } from "./DisabledReason";
import { formatMoney } from "./labels";
import { useStayCheckout, useStaySpa } from "./stay-spa";
import {
  canEditBooking,
  cancelConfirmOptions,
  displayDate,
  hotelStatus,
  payLink,
  serverTodayIso,
  statusKey,
} from "./admin-bookings-shared";

export type QuickTarget = { booking: AdminBooking; rect: { left: number; top: number; width: number; height: number } };
type BookingDetail = NonNullable<FunctionReturnType<typeof api.adminBookings.getForAdmin>>;

/** Each popover button finishes its job: its own dialog, checkout, or the new appointment. */
export type QuickAction =
  | { kind: "pay"; booking: BookingDetail }
  | { kind: "cancel"; booking: BookingDetail }
  | { kind: "bookSpa"; booking: AdminBooking };

const CHECKOUT_LIVE = "Wait for the guest's Stripe checkout to finish or expire.";

/**
 * Popover on a calendar booking chip. Checkout takes the stay's balance with its unpaid spa;
 * Book spa, Record payment and Cancel open their own dialogs. Results are reported through
 * `onNotice` because the popover closes before the action runs.
 */
export function BookingQuickActions({
  target,
  villaName,
  onClose,
  onOpenDetails,
  onAction,
  onNotice,
}: {
  target: QuickTarget;
  villaName: string;
  onClose: () => void;
  onOpenDetails: () => void;
  onAction: (action: QuickAction) => void;
  onNotice: (notice: { text: string; error?: boolean }) => void;
}) {
  const { booking, rect } = target;
  const detail = useQuery(api.adminBookings.getForAdmin, { bookingId: booking._id });
  const updateBooking = useMutation(api.adminBookings.updateBooking);
  const confirm = useConfirm();
  const editable = canEditBooking(booking);
  const spa = useStaySpa(editable ? booking : null);
  const openCheckout = useStayCheckout();
  const [opening, setOpening] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const status = hotelStatus(statusKey(booking));
  const checkoutLive = Boolean(detail?.checkoutLive);
  const owed = detail && editable && !detail.money.legacyRefund && detail.paymentStatus !== "failed" ? detail.money.owed : 0;
  const canPay = owed > 0;
  const due = owed + (spa?.total ?? 0);
  const canBookSpa = editable && booking.checkOut >= serverTodayIso();

  async function run(work: () => Promise<unknown>, done: string) {
    onClose();
    try {
      await work();
      onNotice({ text: done });
    } catch (err) {
      onNotice({ text: errorText(err, "Could not update the booking."), error: true });
    }
  }

  async function checkout() {
    if (!spa || opening) return;
    setOpening(true);
    setProblems([]);
    try {
      const found = await openCheckout(booking._id, spa.appointments);
      if (found.length) setProblems(found);
    } catch (err) {
      setProblems([errorText(err, "Couldn't open checkout for this stay.")]);
    } finally {
      setOpening(false);
    }
  }

  /** A stay holding money opens the cancel dialog, which asks whether to keep it or record a refund. */
  async function cancel() {
    if (!detail || checkoutLive) return;
    onClose();
    if (detail.money.net > 0) {
      onAction({ kind: "cancel", booking: detail });
      return;
    }
    if (!(await confirm(cancelConfirmOptions(detail)))) return;
    await run(
      () => updateBooking({ bookingId: booking._id, action: "cancel", expectedRevision: detail.revision }),
      `${booking.guestName}: cancelled.`,
    );
  }

  return (
    <Popover open onOpenChange={(open) => (open || opening ? undefined : onClose())}>
      <PopoverAnchor asChild>
        <span aria-hidden className="pointer-events-none fixed" style={rect} />
      </PopoverAnchor>
      <PopoverContent align="start" className="grid w-80 gap-3 p-3" aria-label={`Booking for ${booking.guestName}`}>
        <div>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {booking.guestName}
            <StatusBadge {...status} />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {villaName} · {displayDate(booking.checkIn)} → {displayDate(booking.checkOut)} · {booking.nights}{" "}
            {booking.nights === 1 ? "night" : "nights"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {editable && booking.status === "pending" ? (
            <Button
              size="sm"
              onClick={() =>
                run(() => updateBooking({ bookingId: booking._id, action: "confirm", expectedRevision: booking.revision }), `${booking.guestName}: confirmed.`)
              }
            >
              Confirm
            </Button>
          ) : null}
          {editable && (due > 0 || detail === undefined || spa === undefined) ? (
            <DisabledReason reason={checkoutLive && CHECKOUT_LIVE}>
              <Button size="sm" disabled={!detail || !spa || checkoutLive || opening} onClick={() => void checkout()}>
                {opening || !detail || !spa ? <Spinner className="text-current" /> : null}
                {detail && spa ? `Checkout ${formatMoney(due, booking.currency)}` : "Checkout"}
              </Button>
            </DisabledReason>
          ) : null}
          {canBookSpa ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onClose();
                onAction({ kind: "bookSpa", booking });
              }}
            >
              Book spa
            </Button>
          ) : null}
          {canPay && detail ? (
            <DisabledReason reason={checkoutLive && CHECKOUT_LIVE}>
              <Button
                size="sm"
                variant="outline"
                disabled={checkoutLive}
                onClick={() => {
                  onClose();
                  onAction({ kind: "pay", booking: detail });
                }}
              >
                Record payment
              </Button>
            </DisabledReason>
          ) : null}
          {detail?.accessToken ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => navigator.clipboard.writeText(payLink(booking._id, detail.accessToken!)), "Pay link copied.")}
            >
              Copy pay link
            </Button>
          ) : null}
          {editable ? (
            <DisabledReason reason={checkoutLive && CHECKOUT_LIVE}>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={cancel} disabled={!detail || checkoutLive}>
                {detail ? null : <Spinner className="text-current" />}
                Cancel stay
              </Button>
            </DisabledReason>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onClose();
              onOpenDetails();
            }}
          >
            Details
          </Button>
        </div>
        {problems.length ? (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            {problems.map((problem) => <p key={problem}>{problem}</p>)}
            <Button size="sm" variant="outline" className="justify-self-start" onClick={() => { onClose(); onOpenDetails(); }}>
              Open the stay
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
