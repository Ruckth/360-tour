"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VillaPicker } from "@/components/admin/VillaPicker";
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
import { Spinner } from "@/components/ui/spinner";
import { PhoneInput } from "@/components/reui/phone-input";
import { isPossiblePhoneNumber } from "libphonenumber-js/min";
import { normalizeGuestPhone } from "@/lib/booking/phone";
import { useAdminBookingDates } from "./useAdminBookingDates";
import { BookingAvailabilityNotice } from "./BookingAvailabilityNotice";
import { errorText } from "@/lib/staff-bookings";
import { displayDate, newAttemptKey, notifyDefault, parseAmount, serverTodayIso, type AdminProperty } from "./admin-bookings-shared";
import { NotifyGuestField } from "./BookingMoneyFields";
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
  const [creationKey] = useState(() => newAttemptKey("booking"));
  const pending = useRef(false);
  // A prefilled archived villa is kept only for a past stay (the calendar filtered to that villa).
  const prefillCheckIn = prefill?.checkIn ?? "";
  const prefillPast = prefillCheckIn !== "" && prefillCheckIn < serverTodayIso();
  const initial =
    properties.find((p) => p._id === prefill?.propertyId && (p.status === "active" || (p.status === "archived" && prefillPast))) ??
    properties.find((p) => p.status === "active");
  const [propertySlug, setPropertySlug] = useState(initial?.slug ?? "");
  const [dates, setDates] = useState({ checkIn: prefill?.checkIn ?? "", checkOut: prefill?.checkOut ?? "" });
  const [guest, setGuest] = useState({ name: "", phone: "", email: "" });
  const [guests, setGuests] = useState("2");
  const [pickedGuest, setPickedGuest] = useState("");
  const [phoneToCheck, setPhoneToCheck] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  // null = follow the default for the dates (no email for a past stay); set once staff choose.
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [custom, setCustom] = useState(false);
  const [customTotal, setCustomTotal] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [villaReason, setVillaReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A stay that started before today is a record of the past: archived villas may be used for it.
  const historical = Boolean(dates.checkIn) && dates.checkIn < serverTodayIso();
  const villas = properties.filter((p) => p.status === "active" || (p.status === "archived" && (historical || p.slug === propertySlug)));
  const property = properties.find((p) => p.slug === propertySlug);
  const archivedVilla = property?.status === "archived";
  const availability = useAdminBookingDates(property?._id, dates);
  const { conflicts } = availability;
  const notify = notifyChoice ?? notifyDefault({ checkIn: dates.checkIn || serverTodayIso() });
  const customAmount = parseAmount(customTotal);
  const problem =
    archivedVilla && !historical
      ? "This villa is archived. It can only be used to record a stay that started in the past."
      : archivedVilla && !villaReason.trim()
        ? "Give the reason for recording this stay in an archived villa."
        : custom && customAmount === null
          ? "Enter the stay total, at most 2 decimals."
          : custom && !customReason.trim()
            ? "Add the reason for the custom price."
            : "";

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
    if (!availability.canSubmit || pending.current || problem) return;
    if (!isPossiblePhoneNumber(guest.phone)) {
      setError("Enter a complete phone number for the selected country.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const id = await createBooking({
        idempotencyKey: creationKey,
        propertySlug,
        guestName: guest.name.trim(),
        guestPhone: guest.phone.trim(),
        guestEmail: guest.email.trim() || undefined,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guests: Number(guests),
        confirmed,
        // Always explicit, so the server never picks a different email choice than the one shown.
        notifyGuest: notify,
        ...(custom && customAmount !== null ? { priceOverride: { total: customAmount, reason: customReason.trim() } } : {}),
        ...(archivedVilla ? { archivedVillaReason: villaReason.trim() } : {}),
      });
      onCreated(id);
    } catch (err) {
      // Everything entered stays, so Create booking can simply be pressed again.
      setError(errorText(err, "Could not create the booking."));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const field = (name: keyof typeof guest) => ({
    value: guest[name],
    onChange: (event: { target: { value: string } }) => setGuest((current) => ({ ...current, [name]: event.target.value })),
  });

  return (
    <Dialog open onOpenChange={(next) => (next || saving ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>For phone or walk-in guests. Manual bookings never expire automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <div className="grid gap-2">
            <Label id="nb-villa-label" htmlFor="nb-villa">Villa</Label>
            <VillaPicker
              id="nb-villa"
              labelId="nb-villa-label"
              properties={villas}
              value={property?._id}
              onChange={(id) => {
                const next = properties.find((p) => p._id === id);
                if (next) setPropertySlug(next.slug);
              }}
              disabled={saving}
            />
            {historical && properties.some((p) => p.status === "archived") ? (
              <p className="text-xs text-muted-foreground">Past stay: archived villas are listed too, to record where the guest stayed.</p>
            ) : null}
          </div>
          {archivedVilla ? (
            <div className="grid gap-2">
              <Label htmlFor="nb-villa-reason">This villa is archived. Why record this past stay in it? (required)</Label>
              <Input
                id="nb-villa-reason"
                maxLength={500}
                value={villaReason}
                onChange={(event) => setVillaReason(event.target.value)}
                disabled={saving}
              />
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
            <p role="alert" className="text-sm text-destructive">These dates overlap an existing booking or block.</p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="nb-phone">Phone</Label>
            <PhoneInput
              id="nb-phone"
              defaultCountry="TH"
              autoComplete="off"
              required
              value={guest.phone}
              onChange={(phone) => setGuest((current) => ({ ...current, phone: phone ?? "" }))}
            />
            {phoneToCheck ? (
              <p className="text-sm text-muted-foreground">
                Saved phone: {phoneToCheck}. Select the country and re-enter this number before booking.
              </p>
            ) : null}
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
                    const e164 = normalizeGuestPhone(s.guestPhone);
                    // Ambiguous saved numbers are shown verbatim for the host to re-enter.
                    setPhoneToCheck(e164 ? "" : s.guestPhone);
                    setGuest({ name: s.guestName, phone: e164 ?? "", email: s.guestEmail ?? "" });
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
                Holds the dates now. Unticked, it stays pending and the dates stay open until you confirm.
              </span>
            </span>
          </label>
          <NotifyGuestField
            id="nb-notify"
            guestEmail={guest.email.trim()}
            checked={notify}
            onChange={setNotifyChoice}
            action="this booking"
          />
          {historical && notifyChoice === null ? (
            <p className="-mt-2 text-xs text-muted-foreground">Past stays don’t email the guest unless you tick this.</p>
          ) : null}
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <label htmlFor="nb-custom" className="flex items-center gap-2 text-sm font-medium">
              <input
                id="nb-custom"
                type="checkbox"
                className="size-4 accent-foreground"
                checked={custom}
                onChange={(event) => setCustom(event.target.checked)}
                disabled={saving}
              />
              Custom price
            </label>
            {custom ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="nb-custom-total">Stay total ({property?.currency ?? "THB"})</Label>
                  <Input
                    id="nb-custom-total"
                    inputMode="decimal"
                    value={customTotal}
                    onChange={(event) => setCustomTotal(event.target.value)}
                    aria-invalid={customAmount === null}
                    disabled={saving}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nb-custom-reason">Reason (required)</Label>
                  <Input
                    id="nb-custom-reason"
                    maxLength={500}
                    value={customReason}
                    onChange={(event) => setCustomReason(event.target.value)}
                    placeholder="Negotiated rate, long-stay discount…"
                    disabled={saving}
                  />
                </div>
              </>
            ) : property && dates.checkIn && dates.checkOut && !conflicts ? (
              <p className="text-sm text-muted-foreground">
                Villa rate: {formatMoney(property.pricePerNight, property.currency)} per night
                {property.directDiscountPercent ? `, ${property.directDiscountPercent}% direct discount` : ""}
              </p>
            ) : null}
          </div>
          {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2 sm:flex-wrap">
            {property && dates.checkIn && dates.checkOut ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:basis-full sm:justify-start"
                onClick={() => onBlockInstead({ propertyId: property._id, start: dates.checkIn, end: dates.checkOut })}
              >
                Block these dates instead
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !availability.canSubmit || Boolean(problem)}>
              {saving ? <Spinner className="text-current" /> : null}
              Create booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
