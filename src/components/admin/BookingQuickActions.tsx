"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import { Loader2 } from "lucide-react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { errorText, money } from "@/lib/staff-bookings";
import {
  STATUS,
  canEditBooking,
  cancelConfirmOptions,
  displayDate,
  payLink,
  paymentText,
  statusKey,
} from "./admin-bookings-shared";

export type QuickTarget = { booking: AdminBooking; rect: { left: number; top: number; width: number; height: number } };

/**
 * Compact popover on a calendar booking chip: the common one-click actions without opening the full sheet.
 * Results are reported through `onNotice` because the popover closes before the action runs.
 */
export function BookingQuickActions({
  target,
  villaName,
  onClose,
  onOpenDetails,
  onNotice,
}: {
  target: QuickTarget;
  villaName: string;
  onClose: () => void;
  onOpenDetails: () => void;
  onNotice: (notice: { text: string; error?: boolean }) => void;
}) {
  const { booking, rect } = target;
  const detail = useQuery(api.adminBookings.getForAdmin, { bookingId: booking._id });
  const updateBooking = useMutation(api.adminBookings.updateBooking);
  const confirm = useConfirm();
  const status = STATUS[statusKey(booking)];
  const editable = canEditBooking(booking);
  const isPaid = booking.paymentStatus === "paid";

  async function run(work: () => Promise<unknown>, done: string) {
    onClose();
    try {
      await work();
      onNotice({ text: done });
    } catch (err) {
      onNotice({ text: errorText(err, "Could not update the booking."), error: true });
    }
  }

  async function cancel() {
    if (!detail) return;
    onClose();
    if (!(await confirm(cancelConfirmOptions(detail)))) return;
    await run(
      () => updateBooking({ bookingId: booking._id, action: "cancel", ...(isPaid ? { refundRecorded: true } : {}) }),
      `${booking.guestName}: cancelled.`,
    );
  }

  return (
    <Popover open onOpenChange={(open) => (open ? undefined : onClose())}>
      <PopoverAnchor asChild>
        <span aria-hidden className="pointer-events-none fixed" style={rect} />
      </PopoverAnchor>
      <PopoverContent align="start" className="grid w-80 gap-3 p-3" aria-label={`Booking for ${booking.guestName}`}>
        <div>
          <p className="font-medium text-foreground">{booking.guestName}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
            {status.label} · {paymentText(booking)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {villaName} · {displayDate(booking.checkIn)} → {displayDate(booking.checkOut)}
          </p>
          <p className="text-sm text-muted-foreground">
            {booking.nights} {booking.nights === 1 ? "night" : "nights"} · {money(booking.total, booking.currency)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {editable && booking.status === "pending" ? (
            <Button
              size="sm"
              onClick={() =>
                run(() => updateBooking({ bookingId: booking._id, action: "confirm" }), `${booking.guestName}: confirmed.`)
              }
            >
              Confirm
            </Button>
          ) : null}
          {editable && !isPaid ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                run(() => updateBooking({ bookingId: booking._id, action: "markPaid" }), `${booking.guestName}: marked paid.`)
              }
            >
              Mark paid
            </Button>
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
            <Button size="sm" variant="outline" onClick={cancel} disabled={!detail}>
              {detail ? null : <Loader2 className="size-3.5 animate-spin" />}
              {isPaid ? "Cancel & refund" : "Cancel"}
            </Button>
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
      </PopoverContent>
    </Popover>
  );
}
