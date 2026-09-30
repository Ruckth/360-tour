"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
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
import { Spinner } from "@/components/ui/spinner";
import { addDaysIso, dateToIso, isDateInIsoList, rangeIntersectsDates, todayIsoLocal } from "@/lib/booking/dates";
import { errorText } from "@/lib/staff-bookings";
import { displayDate, type AdminProperty } from "./admin-bookings-shared";
import { formatMoney } from "./labels";

export type NewBookingPrefill = { propertyId?: string; checkIn?: string; checkOut?: string };

/** Debounced copy of a value, so typing doesn't fire a query per keystroke. */
function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function NewBookingDialog({
  properties,
  prefill,
  onClose,
  onCreated,
  onBlockInstead,
}: {
  properties: AdminProperty[];
  prefill?: NewBookingPrefill;
  onClose: () => void;
  onCreated: (id: Id<"bookings">) => void;
  onBlockInstead: (target: { propertyId: string; start: string; end: string }) => void;
}) {
  const createBooking = useMutation(api.adminBookings.createBooking);
  const initial = properties.find((p) => p._id === prefill?.propertyId) ?? properties[0];
  const [propertySlug, setPropertySlug] = useState(initial?.slug ?? "");
  const [dates, setDates] = useState({ checkIn: prefill?.checkIn ?? "", checkOut: prefill?.checkOut ?? "" });
  const [guest, setGuest] = useState({ name: "", phone: "", email: "" });
  const [guests, setGuests] = useState("2");
  const [pickedGuest, setPickedGuest] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Same date rules as the public booking flow: no past dates, no blocked nights.
  const today = todayIsoLocal();
  const property = properties.find((p) => p.slug === propertySlug);
  const blockedDates =
    useQuery(
      api.availability.getBlockedDates,
      property ? { propertyId: property._id, startDate: today, endDate: addDaysIso(today, 365) } : "skip",
    ) ?? [];
  const blockedDateSet = new Set(blockedDates);
  const conflicts = rangeIntersectsDates(blockedDates, dates.checkIn, dates.checkOut);

  // Returning guests: suggest previous bookings matching the phone or email typed so far.
  const phone = useDebounced(guest.phone.trim());
  const email = useDebounced(guest.email.trim());
  const searchable = phone.replace(/\D/g, "").length >= 4 || email.length >= 3;
  const suggestions =
    useQuery(api.adminBookings.findGuests, searchable ? { phone, email } : "skip")?.filter(
      (s) => `${s.guestPhone}|${s.guestEmail ?? ""}` !== pickedGuest,
    ) ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const id = await createBooking({
        propertySlug,
        guestName: guest.name.trim(),
        guestPhone: guest.phone.trim(),
        guestEmail: guest.email.trim() || undefined,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guests: Number(guests),
        confirmed,
      });
      onCreated(id);
    } catch (err) {
      setError(errorText(err, "Could not create the booking."));
    } finally {
      setSaving(false);
    }
  }

  const field = (name: keyof typeof guest) => ({
    value: guest[name],
    onChange: (event: { target: { value: string } }) => setGuest((current) => ({ ...current, [name]: event.target.value })),
  });

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>For phone or walk-in guests. Manual bookings never expire automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label>Villa</Label>
            <Select value={propertySlug} onValueChange={setPropertySlug}>
              <SelectTrigger className="rounded-lg" aria-label="Villa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p._id} value={p.slug}>
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
            isDateDisabled={(date) => dateToIso(date) < today || isDateInIsoList(date, blockedDateSet)}
            unavailableDates={blockedDates}
          />
          {conflicts ? (
            <p role="alert" className="text-sm text-destructive">These dates overlap an existing booking or block.</p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="nb-phone">Phone</Label>
            <Input id="nb-phone" type="tel" autoComplete="off" required {...field("phone")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nb-email">Email (optional)</Label>
            <Input id="nb-email" type="email" autoComplete="off" {...field("email")} />
          </div>
          {suggestions.length ? (
            <div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-1" aria-label="Previous guests">
              <p className="admin-eyebrow px-2 pt-1">Returning guest?</p>
              {suggestions.map((s) => (
                <button
                  key={`${s.guestPhone}|${s.guestEmail ?? ""}`}
                  type="button"
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background focus-visible:bg-background focus-visible:outline-none"
                  onClick={() => {
                    setGuest({ name: s.guestName, phone: s.guestPhone, email: s.guestEmail ?? "" });
                    setPickedGuest(`${s.guestPhone}|${s.guestEmail ?? ""}`);
                  }}
                >
                  <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block font-medium">{s.guestName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[s.guestPhone, s.guestEmail].filter(Boolean).join(" · ")} · {s.stays}{" "}
                      {s.stays === 1 ? "booking found" : "bookings found"}, last {displayDate(s.lastCheckIn)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="nb-name">Guest name</Label>
              <Input id="nb-name" required {...field("name")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nb-guests">Guests</Label>
              <Input
                id="nb-guests"
                type="number"
                min={1}
                max={property?.maxGuests}
                value={guests}
                onChange={(event) => setGuests(event.target.value)}
                required
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-foreground"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Create as confirmed
              <span className="block text-muted-foreground">
                Holds the dates now and emails the guest. Unticked, it stays pending and the dates stay open until you confirm.
              </span>
            </span>
          </label>
          {property && dates.checkIn && dates.checkOut && !conflicts ? (
            <p className="text-sm text-muted-foreground">
              {formatMoney(property.pricePerNight, property.currency)} per night
              {property.directDiscountPercent ? `, ${property.directDiscountPercent}% direct discount` : ""}
            </p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2">
            {property && dates.checkIn && dates.checkOut ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:me-auto"
                onClick={() => onBlockInstead({ propertyId: property._id, start: dates.checkIn, end: dates.checkOut })}
              >
                Block these dates instead
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !propertySlug || !dates.checkIn || !dates.checkOut || conflicts}>
              {saving ? <Spinner className="text-current" /> : null}
              Create booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
