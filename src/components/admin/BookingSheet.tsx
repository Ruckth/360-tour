"use client";

import { useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { format } from "date-fns";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { nightsBetweenIso } from "@/lib/booking/dates";
import { useAdminBookingDates } from "./useAdminBookingDates";
import { BookingAvailabilityNotice } from "./BookingAvailabilityNotice";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { BookingFinancials } from "./BookingFinancials";
import { BookingPromotionLine } from "./BookingPromotion";
import { bookingEditPrice, type BookingEditQuote, type BookingEditQuoteState } from "./booking-edit-price";
import { bookingPromotion, discountLines } from "@/lib/booking/coupon";
import { BookingHistory } from "./BookingHistory";
import { CancelStayDialog, ReopenBookingDialog } from "./BookingCorrectionDialogs";
import { NotifyGuestField } from "./BookingMoneyFields";
import { BookingOrders } from "./BookingOrders";
import { DisabledReason } from "./DisabledReason";
import { StatusBadge } from "./StatusBadge";
import { formatMoney, sourceLabel } from "./labels";
import {
  balanceText,
  canEditBooking,
  displayDate,
  hotelStatus,
  notifyDefault,
  parseAmount,
  payLink,
  paymentText,
  serverTodayIso,
  statusKey,
  type AdminProperty,
} from "./admin-bookings-shared";

type BookingDetail = NonNullable<FunctionReturnType<typeof api.adminBookings.getForAdmin>>;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

export function BookingSheet({
  bookingId,
  properties,
  onClose,
}: {
  bookingId: Id<"bookings"> | null;
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const booking = useQuery(api.adminBookings.getForAdmin, bookingId ? { bookingId } : "skip");

  return (
    <Sheet open={Boolean(bookingId)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {booking === undefined ? (
          <div role="status" aria-label="Loading booking" className="grid gap-5">
            <SheetTitle className="sr-only">Booking</SheetTitle>
            <div className="grid gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="grid gap-3 border-y border-border py-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ) : booking === null ? (
          <>
            <SheetTitle>Booking not found</SheetTitle>
            <SheetDescription>It may have been deleted.</SheetDescription>
          </>
        ) : (
          <BookingDetails key={booking._id} booking={booking} properties={properties} onDeleted={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

type OpenDialog = "edit" | "cancel" | "reopen" | null;

function BookingDetails({
  booking,
  properties,
  onDeleted,
}: {
  booking: BookingDetail;
  properties: AdminProperty[];
  onDeleted: () => void;
}) {
  const updateBooking = useMutation(api.adminBookings.updateBooking);
  const resendBookingEmails = useMutation(api.adminBookings.resendBookingEmails);
  const deleteBooking = useMutation(api.adminBookings.deleteBooking);
  const updateNotes = useMutation(api.adminBookings.updateNotes);
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [notes, setNotes] = useState(booking.adminNotes ?? "");
  /** The revision the notes edit started from, so another device's change isn't overwritten. */
  const [notesRevision, setNotesRevision] = useState<number | null>(null);
  const [notesError, setNotesError] = useState("");

  const status = hotelStatus(statusKey(booking));
  const editable = canEditBooking(booking);
  const cancelled = booking.status === "cancelled";
  const deletable =
    (booking.status === "pending" || booking.status === "cancelled") &&
    booking.paymentStatus !== "paid" &&
    booking.paymentStatus !== "refunded" &&
    !booking.paidAt &&
    !booking.hasStripePayment &&
    booking.money.gross === 0;
  const nightly = booking.nights > 0 ? Math.round(booking.subtotal / booking.nights) : 0;
  const balance = booking.amountPaid !== undefined ? balanceText(booking.total, booking.amountPaid, booking.currency) : null;
  const notesChanged = notes.trim() !== (booking.adminNotes ?? "");
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Another villa";
  // Release 2: getForAdmin may return the coupon the stay was priced with.
  const promotion = bookingPromotion(booking);

  async function act(name: string, run: () => Promise<unknown>, done = "") {
    setPending(name);
    setError("");
    setNotice("");
    try {
      await run();
      setNotice(done);
    } catch (err) {
      setError(errorText(err, "Could not update the booking."));
    } finally {
      setPending(null);
    }
  }

  async function saveNotes() {
    setPending("notes");
    setNotesError("");
    try {
      await updateNotes({ bookingId: booking._id, notes, expectedRevision: notesRevision ?? booking.revision });
      setNotesRevision(null);
      setNotice("Notes saved.");
    } catch (err) {
      setNotesError(errorText(err, "Could not save the notes."));
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this booking?",
      description: "Use this for test or duplicate bookings. It is removed and its dates are released. Its last details stay in the booking history.",
      confirmLabel: "Delete booking",
      destructive: true,
    });
    if (!ok) return;
    setPending("delete");
    setError("");
    try {
      await deleteBooking({ bookingId: booking._id, expectedRevision: booking.revision });
      onDeleted();
    } catch (err) {
      setError(errorText(err, "Could not delete the booking."));
      setPending(null);
    }
  }

  async function copyPayLink() {
    if (!booking.accessToken) return;
    const link = payLink(booking._id, booking.accessToken);
    await act("copy", () => navigator.clipboard.writeText(link), "Pay link copied.");
  }

  return (
    <div className="grid gap-5">
      <div>
        <SheetTitle className="pe-8">{booking.guestName}</SheetTitle>
        <SheetDescription className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge {...status} />
          {booking.confirmationCode ? <span className="font-mono text-xs">{booking.confirmationCode}</span> : null}
        </SheetDescription>
      </div>

      <dl className="divide-y divide-border border-y border-border">
        <Detail label="Villa">
          {booking.propertyName}
          {booking.propertyStatus !== "active" ? <span className="block text-muted-foreground">Villa is {booking.propertyStatus}</span> : null}
        </Detail>
        <Detail label="Stay">
          {displayDate(booking.checkIn)} → {displayDate(booking.checkOut)}
          <span className="block text-muted-foreground">
            {booking.nights} {booking.nights === 1 ? "night" : "nights"} · {booking.guests}{" "}
            {booking.guests === 1 ? "guest" : "guests"}
          </span>
        </Detail>
        <Detail label="Price">
          <span className="block text-muted-foreground">
            {formatMoney(nightly, booking.currency)} × {booking.nights} = {formatMoney(booking.subtotal, booking.currency)}
          </span>
          {discountLines(booking.discountAmount, promotion ? { code: promotion.code, amount: promotion.discount } : null).map((line) =>
            line.kind === "coupon" && promotion ? (
              <span key="coupon" className="block">
                <BookingPromotionLine promotion={promotion} currency={booking.currency} redemption={booking.redemption} />
              </span>
            ) : (
              <span key="direct" className="block text-muted-foreground">
                Direct discount −{formatMoney(line.amount, booking.currency)}
              </span>
            ),
          )}
          {booking.priceOverride ? (
            <span className="block text-muted-foreground">
              Custom price (villa rate {formatMoney(booking.priceOverride.quotedTotal, booking.currency)}): {booking.priceOverride.reason}
            </span>
          ) : null}
          <span className="block font-medium">Total {formatMoney(booking.total, booking.currency)}</span>
          {booking.amountPaid !== undefined ? (
            <span className="block text-muted-foreground">Paid {formatMoney(booking.amountPaid, booking.currency)}</span>
          ) : null}
          {balance && !cancelled ? <span className={`block font-medium ${balance.tone}`}>{balance.text}</span> : null}
        </Detail>
        <Detail label="Payment">
          {paymentText(booking)}
          {booking.paidAt ? (
            <span className="block text-muted-foreground">{format(new Date(booking.paidAt), "d MMM yyyy, HH:mm")}</span>
          ) : null}
          {booking.checkoutLive ? <span className="block text-muted-foreground">Guest has a Stripe checkout open</span> : null}
        </Detail>
        <Detail label="Orders">
          <BookingOrders
            source={{ bookingId: booking._id }}
            currency={booking.currency}
            closed={cancelled || booking.money.legacyRefund || booking.paymentStatus === "failed"}
          />
        </Detail>
        <Detail label="Phone">{booking.guestPhone}</Detail>
        <Detail label="Email">
          {booking.guestEmail ?? "—"}
          {booking.guestEmail && booking.guestEmailsOff ? <span className="block text-muted-foreground">Entered without guest emails</span> : null}
        </Detail>
        <Detail label="Source">
          <Badge variant="outline">{sourceLabel(booking.source)}</Badge>
        </Detail>
        <Detail label="Created">
          {format(new Date(booking.createdAt), "d MMM yyyy, HH:mm")}
          {booking.createdBy ? <span className="block text-muted-foreground">by {booking.createdBy}</span> : null}
        </Detail>
        {cancelled && booking.cancelledAt ? (
          <Detail label="Cancelled">
            {format(new Date(booking.cancelledAt), "d MMM yyyy, HH:mm")}
            <span className="block text-muted-foreground">
              {booking.cancelledBy ? `by ${booking.cancelledBy}` : ""}
              {booking.cancelReason ? ` · ${booking.cancelReason}` : ""}
            </span>
          </Detail>
        ) : null}
      </dl>

      <BookingFinancials booking={booking} />

      <div className="grid gap-2">
        <Label htmlFor="booking-notes">Notes (staff only)</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          maxLength={2000}
          onChange={(event) => {
            if (notesRevision === null) setNotesRevision(booking.revision);
            setNotes(event.target.value);
          }}
          placeholder="Arrival time, special requests, deposit details…"
        />
        {notesError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">{notesError}</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNotes(booking.adminNotes ?? "");
                setNotesRevision(null);
                setNotesError("");
              }}
            >
              Load the latest notes
            </Button>
          </div>
        ) : null}
        {notesChanged ? (
          <Button size="sm" variant="outline" className="justify-self-start" disabled={pending !== null} onClick={saveNotes}>
            {pending === "notes" ? <Spinner className="text-current" /> : null}
            Save notes
          </Button>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {editable && booking.status === "pending" ? (
          <Button
            onClick={() => act("confirm", () => updateBooking({ bookingId: booking._id, action: "confirm", expectedRevision: booking.revision }), booking.notifyByDefault && booking.guestEmail ? "Confirmed. The guest is emailed." : "Confirmed.")}
            disabled={pending !== null}
          >
            {pending === "confirm" ? <Spinner className="text-current" /> : null}
            Confirm
          </Button>
        ) : null}
        {editable ? (
          <DisabledReason reason={booking.checkoutLive && "Wait for the guest's Stripe checkout to finish or expire."}>
            <Button variant="outline" onClick={() => setDialog("edit")} disabled={pending !== null || booking.checkoutLive}>
              Edit
            </Button>
          </DisabledReason>
        ) : null}
        {booking.accessToken ? (
          <Button variant="outline" onClick={copyPayLink} disabled={pending !== null}>
            Copy pay link
          </Button>
        ) : null}
        {booking.status === "confirmed" ? (
          <Button
            variant="outline"
            onClick={() => act("resend", () => resendBookingEmails({ bookingId: booking._id }), "Confirmation emails queued.")}
            disabled={pending !== null}
          >
            {pending === "resend" ? <Spinner className="text-current" /> : null}
            Resend emails
          </Button>
        ) : null}
        {editable ? (
          <DisabledReason reason={booking.checkoutLive && "Wait for the guest's Stripe checkout to finish or expire."}>
            <Button variant="outline" onClick={() => setDialog("cancel")} disabled={pending !== null || booking.checkoutLive}>
              Cancel booking
            </Button>
          </DisabledReason>
        ) : null}
        {cancelled ? (
          <Button variant="outline" onClick={() => setDialog("reopen")} disabled={pending !== null}>
            Reopen
          </Button>
        ) : null}
        {deletable ? (
          <Button variant="ghost" className="text-destructive" onClick={remove} disabled={pending !== null}>
            {pending === "delete" ? <Spinner className="text-current" /> : null}
            Delete
          </Button>
        ) : null}
      </div>
      {booking.historical && booking.status !== "cancelled" && booking.guestEmail ? (
        <p className="text-xs text-muted-foreground">This stay started in the past: confirming, editing and cancelling don’t email the guest unless you choose to.</p>
      ) : null}
      {!editable ? <p className="text-xs text-muted-foreground">Cancelled bookings are read-only. Reopen one to change it.</p> : null}

      <BookingHistory bookingId={booking._id} currency={booking.currency} villaName={villaName} />

      {dialog === "edit" ? <EditBookingDialog booking={booking} properties={properties} onClose={() => setDialog(null)} /> : null}
      {dialog === "cancel" ? <CancelStayDialog booking={booking} onClose={() => setDialog(null)} /> : null}
      {dialog === "reopen" ? <ReopenBookingDialog booking={booking} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export function EditBookingDialog({
  booking,
  properties,
  onClose,
}: {
  booking: BookingDetail;
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const editBooking = useMutation(api.adminBookings.editBooking);
  /** The revision this edit was reviewed against; a change made meanwhile is refused, not overwritten. */
  const [revision] = useState(booking.revision);
  const [propertyId, setPropertyId] = useState<string>(booking.propertyId);
  const [dates, setDates] = useState({ checkIn: booking.checkIn, checkOut: booking.checkOut });
  const [guests, setGuests] = useState(String(booking.guests));
  const [guestName, setGuestName] = useState(booking.guestName);
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone);
  const [guestEmail, setGuestEmail] = useState(booking.guestEmail ?? "");
  const [custom, setCustom] = useState(Boolean(booking.priceOverride));
  const [customTotal, setCustomTotal] = useState(String(booking.priceOverride?.total ?? booking.total));
  const [customReason, setCustomReason] = useState(booking.priceOverride?.reason ?? "");
  const [villaReason, setVillaReason] = useState("");
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const historicalStay = dates.checkIn < serverTodayIso();
  // Archived villas are offered only to record a stay that started in the past.
  const villas = properties.filter((p) => p.status === "active" || p._id === booking.propertyId || (historicalStay && p.status === "archived"));
  const property = properties.find((p) => p._id === propertyId);
  const availability = useAdminBookingDates(property?._id, dates, booking._id);
  const { conflicts } = availability;

  const stayChanged =
    propertyId !== booking.propertyId || dates.checkIn !== booking.checkIn || dates.checkOut !== booking.checkOut;
  const nights = nightsBetweenIso(dates.checkIn, dates.checkOut);
  const guestCount = Number(guests);
  // The server prices the edit with the same policy editBooking saves (coupon version, direct
  // fallback). With a custom price on the stay it quotes the price once that's removed.
  const quote = useBookingEditQuote(
    property && nights > 0 && Number.isInteger(guestCount) && guestCount >= 1
      ? {
          bookingId: booking._id,
          propertySlug: property.slug,
          checkIn: dates.checkIn,
          checkOut: dates.checkOut,
          guests: guestCount,
          ...(booking.priceOverride ? { clearPriceOverride: true } : {}),
        }
      : null,
  );
  const customAmount = parseAmount(customTotal);
  const customProblem = custom && customAmount === null ? "Enter a price, at most 2 decimals." : custom && !customReason.trim() ? "Add the reason for the custom price." : null;
  const price = bookingEditPrice({
    current: { total: booking.total, currency: booking.currency, promotionCode: bookingPromotion(booking)?.code },
    custom: custom ? customAmount : undefined,
    quote,
  });
  const newTotal = price.kind === "changed" ? price.total : booking.total;
  const sameCurrency = price.kind !== "changed" || price.currency === booking.currency;
  /** Save waits for the quote: staff confirm the price editBooking will actually write. */
  const priceBlocked = !custom && (price.kind === "loading" || price.kind === "error");
  const balance = booking.amountPaid !== undefined && sameCurrency ? balanceText(newTotal, booking.amountPaid, booking.currency) : null;
  const archivedVilla = stayChanged && property?.status === "archived";
  const priceChanged = custom
    ? customAmount !== booking.priceOverride?.total || customReason.trim() !== (booking.priceOverride?.reason ?? "") || stayChanged
    : Boolean(booking.priceOverride);
  const guestFacing = stayChanged || Number(guests) !== booking.guests || newTotal !== booking.total;
  const notify = notifyChoice ?? notifyDefault({ checkIn: dates.checkIn, guestEmailsOff: booking.guestEmailsOff });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!availability.canSubmit || saving || customProblem || priceBlocked || (archivedVilla && !villaReason.trim())) return;
    setSaving(true);
    setError("");
    try {
      await editBooking({
        bookingId: booking._id,
        expectedRevision: revision,
        propertyId: propertyId as Id<"properties">,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guests: Number(guests),
        guestName,
        guestPhone,
        guestEmail: guestEmail.trim() || undefined,
        notifyGuest: notify,
        ...(priceChanged ? { priceOverride: custom ? { total: customAmount!, reason: customReason } : null } : {}),
        ...(archivedVilla ? { archivedVillaReason: villaReason } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save the booking."));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            Changing the villa or dates recalculates the price, with the booking’s coupon if it still applies, unless you set a custom price.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <div className="grid gap-2">
            <Label id="edit-villa-label" htmlFor="edit-villa">Villa</Label>
            <VillaPicker id="edit-villa" labelId="edit-villa-label" properties={villas} value={propertyId} onChange={setPropertyId} disabled={saving} />
          </div>
          {archivedVilla ? (
            <div className="grid gap-2">
              <Label htmlFor="eb-villa-reason">This villa is archived. Why record this past stay in it? (required)</Label>
              <Input id="eb-villa-reason" maxLength={500} value={villaReason} onChange={(e) => setVillaReason(e.target.value)} required />
            </div>
          ) : null}
          <BookingRangePicker
            checkIn={dates.checkIn}
            checkOut={dates.checkOut}
            onChange={setDates}
            isDateDisabled={availability.isDateDisabled}
            unavailableDates={availability.blockedDates}
            onMonthChange={availability.onMonthChange}
            markPastUnavailable
          />
          <BookingAvailabilityNotice {...availability} />
          {conflicts ? (
            <p className="text-sm text-destructive">These dates overlap another booking or block.</p>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="eb-name">Guest name</Label>
              <Input id="eb-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eb-guests">Guests</Label>
              <Input
                id="eb-guests"
                type="number"
                min={1}
                max={property?.maxGuests}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="eb-phone">Phone</Label>
            <Input id="eb-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="eb-email">Email (optional)</Label>
            <Input id="eb-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
          </div>

          <div className="grid gap-3 rounded-lg border border-border p-3">
            <label htmlFor="eb-custom" className="flex items-center gap-2 text-sm font-medium">
              <input id="eb-custom" type="checkbox" className="size-4 accent-foreground" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              Custom price
            </label>
            {custom ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="eb-custom-total">Stay total ({booking.currency})</Label>
                  <Input id="eb-custom-total" inputMode="decimal" value={customTotal} onChange={(e) => setCustomTotal(e.target.value)} aria-invalid={customAmount === null} />
                  <p className="text-xs text-muted-foreground">
                    {quote.status === "ready"
                      ? `Without a custom price: ${formatMoney(quote.quote.total, quote.quote.currency)}.`
                      : quote.status === "loading"
                        ? "Checking the price without a custom price…"
                        : null}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eb-custom-reason">Reason (required)</Label>
                  <Input id="eb-custom-reason" maxLength={500} value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Negotiated rate, long-stay discount…" />
                </div>
              </>
            ) : booking.priceOverride ? (
              <p className="text-xs text-muted-foreground">Saving returns this stay to the villa rate.</p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {price.kind === "changed" ? (
              <>
                <p className="font-medium">
                  New total {formatMoney(price.total, price.currency)}{" "}
                  <span className="font-normal text-muted-foreground">
                    (was {formatMoney(booking.total, booking.currency)}
                    {price.difference ? `, ${price.difference > 0 ? "+" : "−"}${formatMoney(Math.abs(price.difference), booking.currency)}` : ""})
                  </span>
                </p>
                {price.note ? <p data-testid="edit-price-coupon" className="text-muted-foreground">{price.note}</p> : null}
                <p className="text-muted-foreground">
                  {nights} {nights === 1 ? "night" : "nights"}
                </p>
              </>
            ) : price.kind === "loading" ? (
              <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
                <Spinner className="text-current" /> Checking the price…
              </p>
            ) : price.kind === "error" ? (
              <p role="alert" className="text-destructive">{price.message}</p>
            ) : price.kind === "idle" ? (
              <p className="text-muted-foreground">Choose the dates and guests to see the price.</p>
            ) : (
              <p className="text-muted-foreground">Price unchanged: {formatMoney(booking.total, booking.currency)}</p>
            )}
            {booking.amountPaid !== undefined && (custom || price.kind === "changed" || price.kind === "unchanged") && sameCurrency ? (
              <p className="mt-1 text-muted-foreground">
                Guest paid {formatMoney(booking.amountPaid, booking.currency)}.{" "}
                {balance ? <span className={`font-medium ${balance.tone}`}>{balance.text}</span> : "Fully paid."}
                {balance && newTotal < booking.amountPaid ? " Record the refund from Payments once you give it back." : ""}
              </p>
            ) : null}
          </div>

          {guestFacing && guestEmail.trim() ? (
            <NotifyGuestField id="eb-notify" guestEmail={guestEmail.trim()} checked={notify} onChange={setNotifyChoice} action="this change" />
          ) : null}

          {customProblem ? <p className={cn("text-sm text-destructive")}>{customProblem}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !availability.canSubmit || Boolean(customProblem) || priceBlocked || (archivedVilla && !villaReason.trim())}>
              {saving ? <Spinner className="text-current" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type EditQuoteArgs = {
  bookingId: Id<"bookings">;
  propertySlug: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  clearPriceOverride?: boolean;
};

/** adminBookings.quoteBookingEdit, live. A refusal (e.g. dates the villa can't take) comes back as an error state, not a throw. */
function useBookingEditQuote(args: EditQuoteArgs | null): BookingEditQuoteState {
  const key = args ? JSON.stringify(args) : "";
  const queries = useMemo(
    (): RequestForQueries => (key ? { quote: { query: api.adminBookings.quoteBookingEdit, args: JSON.parse(key) as EditQuoteArgs } } : {}),
    [key],
  );
  const result: unknown = useQueries(queries).quote;
  if (!key) return { status: "idle" };
  if (result === undefined) return { status: "loading" };
  if (result instanceof Error) return { status: "error", message: errorText(result, "Couldn’t price this change.") };
  return { status: "ready", quote: result as BookingEditQuote };
}
