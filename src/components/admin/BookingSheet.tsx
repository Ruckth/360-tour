"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { calculateDirectQuote } from "convex/lib/pricing";
import { format } from "date-fns";
import { useState, type FormEvent, type ReactNode } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  addDaysIso,
  dateToIso,
  isDateInIsoList,
  nightsBetweenIso,
  rangeIntersectsDates,
  todayIsoLocal,
} from "@/lib/booking/dates";
import { errorText } from "@/lib/staff-bookings";
import { DisabledReason } from "./DisabledReason";
import { StatusBadge } from "./StatusBadge";
import { formatMoney, sourceLabel } from "./labels";
import {
  balanceText,
  canEditBooking,
  cancelConfirmOptions,
  displayDate,
  hotelStatus,
  isoNights,
  payLink,
  paymentText,
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
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(booking.adminNotes ?? "");

  const status = hotelStatus(statusKey(booking));
  const isPaid = booking.paymentStatus === "paid";
  const editable = canEditBooking(booking);
  const deletable =
    (booking.status === "pending" || booking.status === "cancelled") &&
    booking.paymentStatus !== "paid" &&
    booking.paymentStatus !== "refunded" &&
    !booking.paidAt &&
    !booking.hasStripePayment;
  const nightly = booking.nights > 0 ? Math.round(booking.subtotal / booking.nights) : 0;
  const balance = booking.amountPaid !== undefined ? balanceText(booking.total, booking.amountPaid, booking.currency) : null;
  const notesChanged = notes.trim() !== (booking.adminNotes ?? "");

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

  async function cancel() {
    if (!(await confirm(cancelConfirmOptions(booking)))) return;
    await act("cancel", () =>
      updateBooking({ bookingId: booking._id, action: "cancel", ...(isPaid ? { refundRecorded: true } : {}) }),
    );
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this booking?",
      description: "Use this for test or duplicate bookings. It is removed permanently and its dates are released.",
      confirmLabel: "Delete booking",
      destructive: true,
    });
    if (!ok) return;
    setPending("delete");
    setError("");
    try {
      await deleteBooking({ bookingId: booking._id });
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
        <Detail label="Villa">{booking.propertyName}</Detail>
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
          {booking.discountAmount > 0 ? (
            <span className="block text-muted-foreground">
              Direct discount −{formatMoney(booking.discountAmount, booking.currency)}
            </span>
          ) : null}
          <span className="block font-medium">Total {formatMoney(booking.total, booking.currency)}</span>
          {booking.amountPaid !== undefined ? (
            <span className="block text-muted-foreground">Paid {formatMoney(booking.amountPaid, booking.currency)}</span>
          ) : null}
          {balance ? <span className={`block font-medium ${balance.tone}`}>{balance.text}</span> : null}
        </Detail>
        <Detail label="Payment">
          {paymentText(booking)}
          {booking.paidAt ? (
            <span className="block text-muted-foreground">{format(new Date(booking.paidAt), "d MMM yyyy, HH:mm")}</span>
          ) : null}
          {booking.checkoutLive ? <span className="block text-muted-foreground">Guest has a Stripe checkout open</span> : null}
        </Detail>
        <Detail label="Phone">{booking.guestPhone}</Detail>
        <Detail label="Email">{booking.guestEmail ?? "—"}</Detail>
        <Detail label="Source">
          <Badge variant="outline">{sourceLabel(booking.source)}</Badge>
        </Detail>
        <Detail label="Created">{format(new Date(booking.createdAt), "d MMM yyyy, HH:mm")}</Detail>
      </dl>

      <div className="grid gap-2">
        <Label htmlFor="booking-notes">Notes (staff only)</Label>
        <Textarea
          id="booking-notes"
          value={notes}
          maxLength={2000}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Arrival time, special requests, deposit details…"
        />
        {notesChanged ? (
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={pending !== null}
            onClick={() => act("notes", () => updateNotes({ bookingId: booking._id, notes }), "Notes saved.")}
          >
            {pending === "notes" ? <Spinner className="text-current" /> : null}
            Save notes
          </Button>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {editable && booking.status === "pending" ? (
          <Button onClick={() => act("confirm", () => updateBooking({ bookingId: booking._id, action: "confirm" }))} disabled={pending !== null}>
            {pending === "confirm" ? <Spinner className="text-current" /> : null}
            Confirm
          </Button>
        ) : null}
        {editable && !isPaid ? (
          <Button variant="secondary" onClick={() => act("markPaid", () => updateBooking({ bookingId: booking._id, action: "markPaid" }))} disabled={pending !== null}>
            {pending === "markPaid" ? <Spinner className="text-current" /> : null}
            Mark paid
          </Button>
        ) : null}
        {editable ? (
          <DisabledReason reason={booking.checkoutLive && "Wait for the guest's Stripe checkout to finish or expire."}>
            <Button variant="outline" onClick={() => setEditing(true)} disabled={pending !== null || booking.checkoutLive}>
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
          <Button variant="outline" onClick={cancel} disabled={pending !== null}>
            {pending === "cancel" ? <Spinner className="text-current" /> : null}
            {isPaid ? "Cancel & record refund" : "Cancel booking"}
          </Button>
        ) : null}
        {deletable ? (
          <Button variant="ghost" className="text-destructive" onClick={remove} disabled={pending !== null}>
            {pending === "delete" ? <Spinner className="text-current" /> : null}
            Delete
          </Button>
        ) : null}
      </div>
      {!editable ? <p className="text-xs text-muted-foreground">Cancelled and refunded bookings are read-only.</p> : null}

      {editing ? (
        <EditBookingDialog booking={booking} properties={properties} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

function EditBookingDialog({
  booking,
  properties,
  onClose,
}: {
  booking: BookingDetail;
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const editBooking = useMutation(api.adminBookings.editBooking);
  const [propertyId, setPropertyId] = useState<string>(booking.propertyId);
  const [dates, setDates] = useState({ checkIn: booking.checkIn, checkOut: booking.checkOut });
  const [guests, setGuests] = useState(String(booking.guests));
  const [guestName, setGuestName] = useState(booking.guestName);
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone);
  const [guestEmail, setGuestEmail] = useState(booking.guestEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const today = todayIsoLocal();
  const villas = properties.filter((p) => p.status === "active" || p._id === booking.propertyId);
  const property = properties.find((p) => p._id === propertyId);
  const blockedDates =
    useQuery(
      api.availability.getBlockedDates,
      property ? { propertyId: property._id, startDate: today, endDate: addDaysIso(today, 365) } : "skip",
    ) ?? [];
  // This booking's own nights are not a conflict.
  const ownNights = new Set(propertyId === booking.propertyId ? isoNights(booking.checkIn, booking.checkOut) : []);
  const otherBlocked = blockedDates.filter((date) => !ownNights.has(date));
  const otherBlockedSet = new Set(otherBlocked);
  const conflicts = rangeIntersectsDates(otherBlocked, dates.checkIn, dates.checkOut);

  const stayChanged =
    propertyId !== booking.propertyId || dates.checkIn !== booking.checkIn || dates.checkOut !== booking.checkOut;
  const nights = nightsBetweenIso(dates.checkIn, dates.checkOut);
  const newTotal = stayChanged && property && nights > 0 ? calculateDirectQuote(property, nights).directTotal : booking.total;
  const difference = newTotal - booking.total;
  const balance = booking.amountPaid !== undefined ? balanceText(newTotal, booking.amountPaid, booking.currency) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await editBooking({
        bookingId: booking._id,
        propertyId: propertyId as Id<"properties">,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guests: Number(guests),
        guestName,
        guestPhone,
        guestEmail: guestEmail.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save the booking."));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            Changing the villa or dates recalculates the price. The guest is emailed about stay changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label>Villa</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger className="rounded-lg" aria-label="Villa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {villas.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <BookingRangePicker
            checkIn={dates.checkIn}
            checkOut={dates.checkOut}
            onChange={setDates}
            // An in-house guest keeps their past check-in date.
            isDateDisabled={(date) => {
              const iso = dateToIso(date);
              return (iso < today && iso !== booking.checkIn) || isDateInIsoList(date, otherBlockedSet);
            }}
            unavailableDates={otherBlocked}
          />
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

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {stayChanged && nights > 0 ? (
              <>
                <p className="font-medium">
                  New total {formatMoney(newTotal, booking.currency)}{" "}
                  <span className="font-normal text-muted-foreground">
                    (was {formatMoney(booking.total, booking.currency)},{" "}
                    {difference === 0 ? "no change" : `${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference), booking.currency)}`})
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {nights} {nights === 1 ? "night" : "nights"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Price unchanged: {formatMoney(booking.total, booking.currency)}</p>
            )}
            {booking.amountPaid !== undefined ? (
              <p className="mt-1 text-muted-foreground">
                Guest paid {formatMoney(booking.amountPaid, booking.currency)}.{" "}
                {balance ? <span className={`font-medium ${balance.tone}`}>{balance.text}</span> : "Fully paid."}
              </p>
            ) : null}
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !dates.checkIn || !dates.checkOut || conflicts}>
              {saving ? <Spinner className="text-current" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
