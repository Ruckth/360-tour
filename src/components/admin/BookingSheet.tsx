"use client";
import { satangToBaht } from "convex/shared/money";


import { Pencil, X } from "lucide-react";
import { staffDateTime } from "@/lib/staff-time";
import { useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Card } from "@/components/ui/card";
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
import { Sheet, SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DeskSheetContent as SheetContent } from "./DeskSheetContent";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { nightsBetweenIso } from "@/lib/booking/dates";
import { useAdminBookingDates } from "./useAdminBookingDates";
import { BookingAvailabilityNotice } from "./BookingAvailabilityNotice";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { BookingFinancials } from "./BookingFinancials";
import { BookingMarketingSource } from "./BookingMarketingSource";
import { bookingEditPrice, reviewedPrice, type BookingEditQuote, type BookingEditQuoteState } from "./booking-edit-price";
import { bookingPromotion } from "@/lib/booking/coupon";
import { CancelStayDialog, ReopenBookingDialog } from "./BookingCorrectionDialogs";
import { NotifyGuestField } from "./BookingMoneyFields";
import { BookingOrders } from "./BookingOrders";
import { DisabledReason } from "./DisabledReason";
import { StatusBadge } from "./StatusBadge";
import { MoreMenu } from "@/components/ui/more-menu";
import { formatMoney, sourceLabel } from "./labels";
import {
  balanceText,
  paidForPreview,
  canBookStaySpa,
  canEditBooking,
  displayDate,
  hotelStatus,
  notifyDefault,
  parseAmount,
  payLink,
  serverTodayIso,
  staffLabel,
  statusKey,
  type AdminProperty,
} from "./admin-bookings-shared";

const CHECKOUT_LIVE = "Wait for the guest's Stripe checkout to finish or expire.";
type BookingDetail = NonNullable<FunctionReturnType<typeof api.bookings.admin.getForAdmin>>;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-12 grid-cols-[96px_minmax(0,1fr)] items-start gap-3 py-3 text-sm">
      <dt className="pt-px text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

export type BookingSheetAction = "pay" | "cancel";

export function BookingSheet({
  bookingId,
  initialAction,
  properties,
  onClose,
  onBookSpa,
}: {
  bookingId: string | null;
  initialAction?: BookingSheetAction;
  properties: AdminProperty[];
  onClose: () => void;
  onBookSpa?: (booking: BookingDetail) => void;
}) {
  const booking = useQuery(api.bookings.admin.getForAdmin, bookingId ? { bookingId } : "skip");
  const currentBooking = useRef(booking);
  useEffect(() => {
    currentBooking.current = booking;
    return () => { currentBooking.current = undefined; };
  }, [booking]);
  const [dirty, setDirty] = useState(false);
  const { confirmDiscard } = useUnsavedGuard(dirty);
  const close = async () => { if (await confirmDiscard()) onClose(); };

  async function bookSpa() {
    if (!(await confirmDiscard())) return;
    const latest = currentBooking.current;
    if (latest && latest._id === bookingId && canBookStaySpa(latest)) onBookSpa?.(latest);
  }

  return (
    <Sheet open={Boolean(bookingId)} onOpenChange={(open) => { if (!open) void close(); }}>
      <SheetContent showCloseButton={false} className="w-full max-w-full overflow-y-auto bg-background p-5 sm:max-w-[30rem]">
        {booking === undefined || booking === null ? <SheetClose asChild><Button size="icon" variant="ghost" aria-label="Close" className="absolute right-3 top-3"><X aria-hidden className="size-4" /></Button></SheetClose> : null}
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
          <BookingDetails
            key={booking._id}
            booking={booking}
            initialAction={initialAction}
            properties={properties}
            onDeleted={onClose}
            onDirtyChange={setDirty}
            beforeLeave={confirmDiscard}
            onBookSpa={onBookSpa && canBookStaySpa(booking) ? bookSpa : undefined}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type OpenDialog = "edit" | "cancel" | "reopen" | null;

function BookingDetails({
  booking,
  initialAction,
  properties,
  onDeleted,
  onDirtyChange,
  beforeLeave,
  onBookSpa,
}: {
  booking: BookingDetail;
  initialAction?: BookingSheetAction;
  properties: AdminProperty[];
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
  beforeLeave: () => Promise<boolean>;
  onBookSpa?: () => Promise<void>;
}) {
  const recordStayStatus = useMutation(api.bookings.commands.updateBooking.recordStayStatus);
  const [stayReason, setStayReason] = useState("");
  const updateBooking = useMutation(api.bookings.commands.updateBooking.updateBooking);
  const resendBookingEmails = useMutation(api.bookings.commands.resendBookingEmails.resendBookingEmails);
  const deleteBooking = useMutation(api.bookings.commands.deleteBooking.deleteBooking);
  const updateNotes = useMutation(api.bookings.commands.updateNotes.updateNotes);
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // This details instance mounts only after the booking loads. Consume a shortcut once,
  // so later live updates or closing a form never reopen it.
  const [dialog, setDialog] = useState<OpenDialog>(() =>
    initialAction === "cancel" && canEditBooking(booking) && !booking.checkoutLive ? "cancel" : null,
  );
  const [paymentShortcut] = useState<"pay" | undefined>(() =>
    initialAction === "pay" && canEditBooking(booking) && !booking.checkoutLive ? "pay" : undefined,
  );
  const [notes, setNotes] = useState(booking.adminNotes ?? "");
  /** The revision the notes edit started from, so another device's change isn't overwritten. */
  const [notesRevision, setNotesRevision] = useState<number | null>(null);
  const [notesError, setNotesError] = useState("");
  const [notesNotice, setNotesNotice] = useState("");

  const status = hotelStatus(statusKey(booking));
  const editable = canEditBooking(booking);
  const cancelled = booking.status === "cancelled";
  const deletable =
    !booking.stayStatus && (booking.status === "pending" || booking.status === "cancelled") &&
    booking.paymentStatus !== "paid" &&
    booking.paymentStatus !== "refunded" &&
    !booking.paidAt &&
    !booking.hasStripePayment &&
    booking.money.gross === 0;
  const notesChanged = notes.trim() !== (booking.adminNotes ?? "");
  useEffect(() => { onDirtyChange(notesChanged); return () => onDirtyChange(false); }, [notesChanged, onDirtyChange]);
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? (id === booking.propertyId ? booking.propertyName : "Another villa");

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
    setNotesNotice("");
    try {
      await updateNotes({ bookingId: booking._id, notes, expectedRevision: notesRevision ?? booking.revision });
      setNotesRevision(null);
      setNotesNotice("Notes saved.");
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
      cancelLabel: "Keep stay",
      destructive: true,
    });
    if (!ok || !(await beforeLeave())) return;
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

  async function copyReference() {
    if (!booking.confirmationCode) return;
    const code = booking.confirmationCode;
    await act("reference", () => navigator.clipboard.writeText(code), `Copied ${code}.`);
  }

  async function copyPayLink() {
    if (!booking.accessToken) return;
    const link = payLink(booking._id, booking.accessToken);
    await act("copy", () => navigator.clipboard.writeText(link), "Pay link copied.");
  }

  return (
    <div className="grid gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">Villa stay</p>
          <SheetTitle className="text-balance font-serif text-2xl font-semibold">{booking.guestName}</SheetTitle>
          <SheetDescription className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge {...status} /></SheetDescription>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {editable ? (
            <DisabledReason reason={booking.checkoutLive && CHECKOUT_LIVE}>
              <Button variant="ghost" size="icon" aria-label="Edit stay" onClick={() => setDialog("edit")} disabled={pending !== null || booking.checkoutLive}>
                <Pencil aria-hidden className="size-4" />
              </Button>
            </DisabledReason>
          ) : null}
          <MoreMenu
            label="More booking actions"
            disabled={pending !== null}
            items={[
              { label: "Copy pay link", onSelect: () => void copyPayLink(), hidden: !booking.accessToken },
              { label: "Copy reference", onSelect: () => void copyReference(), hidden: !booking.confirmationCode },
              {
                label: "Resend emails",
                onSelect: () => void act("resend", () => resendBookingEmails({ bookingId: booking._id }), "Confirmation emails queued."),
                hidden: booking.status !== "confirmed",
              },
              { label: "Cancel stay", onSelect: () => setDialog("cancel"), destructive: true, hidden: !editable, disabled: booking.checkoutLive },
              { label: "Delete booking", onSelect: () => void remove(), destructive: true, hidden: !deletable },
            ]}
          />
          <SheetClose asChild><Button size="icon" variant="ghost" aria-label="Close"><X aria-hidden className="size-4" /></Button></SheetClose>
        </div>
      </header>
      <section className="grid gap-2 rounded-lg border p-3" aria-label="Guest stay status">
        <p className="text-sm font-medium">{booking.stayStatus === "checked_in" ? "Checked in" : booking.stayStatus === "checked_out" ? "Checked out" : "Scheduled · attendance unrecorded"}</p>
        {booking.stayAttendanceEnabled && booking.status === "confirmed" ? (
          <>
            <label className="grid gap-1 text-xs">
              Reason for early, late or out-of-order changes
              <input className="rounded-md border bg-background px-2 py-1.5 text-sm" maxLength={500} value={stayReason} onChange={(event) => setStayReason(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              {booking.stayStatus !== "checked_in" ? <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void act("checkin", () => recordStayStatus({ bookingId: booking._id, expectedRevision: booking.revision, status: "checked_in", reason: stayReason }), "Check-in recorded.")}>{booking.stayStatus === "checked_out" ? "Correct to checked in" : "Record check-in"}</Button> : null}
              {booking.stayStatus !== "checked_out" ? <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void act("checkout", () => recordStayStatus({ bookingId: booking._id, expectedRevision: booking.revision, status: "checked_out", reason: stayReason }), "Check-out recorded.")}>Record check-out</Button> : null}
            </div>
          </>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {editable && booking.status === "pending" ? (
          <Button
            variant="outline"
            onClick={() => act("confirm", () => updateBooking({ bookingId: booking._id, action: "confirm", expectedRevision: booking.revision }), booking.notifyByDefault && booking.guestEmail ? "Confirmed. The guest is emailed." : "Confirmed.")}
            disabled={pending !== null}
          >
            {pending === "confirm" ? <Spinner className="text-current" /> : null}
            Confirm
          </Button>
        ) : null}
        {cancelled ? (
          <Button variant="outline" onClick={() => setDialog("reopen")} disabled={pending !== null}>
            Reopen
          </Button>
        ) : null}
        {pending === "resend" || pending === "delete" || pending === "copy" || pending === "reference" ? <Spinner label="Working" /> : null}

      </div>

      <BookingFinancials
        booking={booking}
        initialAction={paymentShortcut}
        villaName={villaName}
        beforeTakePayment={beforeLeave}
        orders={
          <BookingOrders
            source={{ bookingId: booking._id }}
            currency={booking.currency}
            closed={cancelled || booking.paymentStatus === "failed"}
            history
          />
        }
      >
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      {editable && booking.status === "pending" && booking.historical && booking.guestEmail ? (
        <p className="text-xs text-muted-foreground">
          {booking.notifyByDefault ? "Confirming emails the guest." : "Confirming this past stay won’t email the guest."}
        </p>
      ) : null}
      {!editable ? <p className="text-xs text-muted-foreground">Reopen a cancelled booking to change it.</p> : null}

      <Card className="p-4 shadow-none"><dl className="divide-y divide-border">
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
          {onBookSpa ? (
            <Button size="sm" variant="outline" className="mt-2" disabled={pending !== null} onClick={() => void onBookSpa()}>
              Book spa
            </Button>
          ) : null}
        </Detail>
        <Detail label="Phone"><a className="-my-3 inline-flex min-h-11 items-center rounded underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring" href={`tel:${booking.guestPhone}`}>{booking.guestPhone}</a></Detail>
        <Detail label="Email">
          {booking.guestEmail ? <a className="-my-3 inline-flex min-h-11 items-center rounded underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring" href={`mailto:${booking.guestEmail}`}>{booking.guestEmail}</a> : "—"}
          {booking.guestEmail && booking.guestEmailsOff ? <span className="block text-muted-foreground">Entered without guest emails</span> : null}
        </Detail>
        <Detail label="Source">
          {sourceLabel(booking.source)}
          <BookingMarketingSource attribution={booking.marketingAttribution} />
        </Detail>
        <Detail label="Created">
          {staffDateTime(booking.createdAt)}
          {booking.createdBy ? <span className="block text-muted-foreground">by {staffLabel(booking.createdBy)}</span> : null}
        </Detail>
        {cancelled && booking.cancelledAt ? (
          <Detail label="Cancelled">
            {staffDateTime(booking.cancelledAt)}
            <span className="block text-muted-foreground">
              {booking.cancelledBy ? `by ${staffLabel(booking.cancelledBy)}` : ""}
              {booking.cancelReason ? ` · ${booking.cancelReason}` : ""}
            </span>
          </Detail>
        ) : null}
      </dl></Card>

      <Card className="grid gap-2 p-4 shadow-none">
        <Label className="text-[13px] text-muted-foreground" htmlFor="booking-notes">Notes (staff only)</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          maxLength={2000}
          onChange={(event) => {
            if (notesRevision === null) setNotesRevision(booking.revision);
            setNotes(event.target.value);
            setNotesNotice("");
          }}
          placeholder="Arrival time, requests…"
          className="min-h-20 field-sizing-content border-0 bg-muted/40 shadow-none"
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
          <Button size="sm" variant="outline" className="justify-self-start text-[13px] pointer-coarse:text-sm" disabled={pending !== null} onClick={saveNotes}>
            {pending === "notes" ? <Spinner className="text-current" /> : null}
            Save notes
          </Button>
        ) : null}
        {notesNotice ? <p role="status" className="text-sm text-muted-foreground">{notesNotice}</p> : null}
      </Card>
      </BookingFinancials>

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
  const editBooking = useMutation(api.bookings.commands.editBooking.editBooking);
  /** The revision this edit was reviewed against; a change made meanwhile is refused, not overwritten. */
  const [original] = useState(booking);
  const [revision] = useState(booking.revision);
  const [propertyId, setPropertyId] = useState<string>(booking.propertyId);
  const [dates, setDates] = useState({ checkIn: booking.checkIn, checkOut: booking.checkOut });
  const [guests, setGuests] = useState(String(booking.guests));
  const [guestName, setGuestName] = useState(booking.guestName);
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone);
  const [guestEmail, setGuestEmail] = useState(booking.guestEmail ?? "");
  const [custom, setCustom] = useState(Boolean(booking.priceOverride));
  const [customTotal, setCustomTotal] = useState(String(satangToBaht(booking.priceOverride?.total ?? booking.total)));
  const [customReason, setCustomReason] = useState(booking.priceOverride?.reason ?? "");
  const [villaReason, setVillaReason] = useState("");
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = propertyId !== original.propertyId || dates.checkIn !== original.checkIn || dates.checkOut !== original.checkOut || guests !== String(original.guests) || guestName !== original.guestName || guestPhone !== original.guestPhone || guestEmail !== (original.guestEmail ?? "") || custom !== Boolean(original.priceOverride) || customTotal !== String(satangToBaht(original.priceOverride?.total ?? original.total)) || customReason !== (original.priceOverride?.reason ?? "") || Boolean(villaReason) || notifyChoice !== null;
  const { confirmDiscard } = useUnsavedGuard(dirty);
  const close = async () => { if (!saving && await confirmDiscard()) onClose(); };

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
  /** Save waits for the quote: staff confirm the price editBooking will actually write, and it refuses any other. */
  const expectedPrice = reviewedPrice(price);
  const priceBlocked = !expectedPrice;
  const paid = paidForPreview(booking);
  const balance = paid !== undefined && sameCurrency ? balanceText(newTotal, booking, booking.currency) : null;
  const archivedVilla = stayChanged && property?.status === "archived";
  const priceChanged = custom
    ? customAmount !== booking.priceOverride?.total || customReason.trim() !== (booking.priceOverride?.reason ?? "") || stayChanged
    : Boolean(booking.priceOverride);
  const guestFacing = stayChanged || Number(guests) !== booking.guests || newTotal !== booking.total;
  const notify = notifyChoice ?? notifyDefault({ checkIn: dates.checkIn, guestEmailsOff: booking.guestEmailsOff });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!availability.canSubmit || saving || customProblem || !expectedPrice || (archivedVilla && !villaReason.trim())) return;
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
        expectedPrice,
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
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : void close())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-semibold">Edit booking</DialogTitle>
          <DialogDescription>
            Changing the villa or dates recalculates the price, with the booking’s coupon if it still applies, unless you set a custom price.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <fieldset disabled={saving} className="m-0 grid min-w-0 gap-4 border-0 p-0">
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
            clearable={false}
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
            <button id="eb-custom" type="button" role="switch" aria-checked={custom} disabled={saving} onClick={() => setCustom(!custom)} className="flex min-h-12 items-center justify-between rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
              Custom price
              <span aria-hidden className={`flex h-6 w-10 items-center rounded-full p-0.5 ${custom ? "bg-foreground justify-end" : "bg-muted-foreground/70 justify-start"}`}><span className="size-5 rounded-full bg-background shadow-sm" /></span>
            </button>
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
            {paid !== undefined && (custom || price.kind === "changed" || price.kind === "unchanged") && sameCurrency ? (
              <p className="mt-1 text-muted-foreground">
                Guest paid {formatMoney(paid, booking.currency)}.{" "}
                {balance ? <span className={`font-medium ${balance.tone}`}>{balance.text}</span> : "Fully paid."}
                {balance && newTotal < (paid ?? 0) ? " Record the refund once you give it back." : ""}
              </p>
            ) : null}
          </div>

          {guestFacing && guestEmail.trim() ? (
            <NotifyGuestField id="eb-notify" guestEmail={guestEmail.trim()} checked={notify} onChange={setNotifyChoice} action="this change" />
          ) : null}

          {customProblem ? <p className={cn("text-sm text-destructive")}>{customProblem}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={saving || !availability.canSubmit || Boolean(customProblem) || priceBlocked || (archivedVilla && !villaReason.trim())}>
              {saving ? <Spinner className="text-current" /> : null}
              Save changes
            </Button>
          </DialogFooter>
          </fieldset>
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
  revision?: number;
  refreshKey?: string;
};

/** adminBookings.quoteBookingEdit, live. A refusal (e.g. dates the villa can't take) comes back as an error state, not a throw. */
export function useBookingEditQuote(args: EditQuoteArgs | null): BookingEditQuoteState {
  const key = args ? JSON.stringify(args) : "";
  const queries = useMemo(
    (): RequestForQueries => (key ? { quote: { query: api.bookings.admin.quoteBookingEdit, args: JSON.parse(key) as EditQuoteArgs } } : {}),
    [key],
  );
  const result: unknown = useQueries(queries).quote;
  if (!key) return { status: "idle" };
  if (result === undefined) return { status: "loading" };
  if (result instanceof Error) return { status: "error", message: errorText(result, "Couldn’t price this change.") };
  return { status: "ready", quote: result as BookingEditQuote };
}
