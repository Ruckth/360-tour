"use client";

import { useCouponRefusalReporter } from "@/lib/react/convex-api";
import { couponRefusalDetails } from "@/lib/booking/coupon-refusals";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { normalizeCouponCode, type OfferResult } from "convex/lib/offers";
import { calculateDirectQuote } from "convex/lib/pricing";
import { nightsBetweenIso } from "@/lib/booking/dates";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { DeskPhoneCountrySelect } from "./DeskPhoneCountrySelect";
import { Ban, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { DeskBookingRangePicker as BookingRangePicker } from "./DeskBookingRangePicker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { couponCoversWholeStay, couponUnavailableError } from "@/lib/booking/coupon";
import { marketingErrorText } from "./marketing/marketing-format";
import { QuoteVerdictBox } from "./marketing/TestQuotePanel";
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
  const reportRefusal = useCouponRefusalReporter(useConvex(), "admin_booking");
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
  const [phoneError, setPhoneError] = useState("");
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
  const [couponInput, setCouponInput] = useState("");
  /** createBooking refused the code (e.g. its last use went meanwhile). */
  const [couponError, setCouponError] = useState("");

  const [opening] = useState(() => ({ slug: initial?.slug ?? "", checkIn: prefill?.checkIn ?? "", checkOut: prefill?.checkOut ?? "" }));
  const dirty = propertySlug !== opening.slug || dates.checkIn !== opening.checkIn || dates.checkOut !== opening.checkOut || Object.values(guest).some(Boolean) || guests !== "2" || !confirmed || notifyChoice !== null || custom || Boolean(customTotal || customReason || villaReason || couponInput);
  const { confirmDiscard } = useUnsavedGuard(dirty);
  const close = async () => { if (!saving && await confirmDiscard()) onClose(); };


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

  // Coupon: priced live with the guest quote (marketing.previewCoupon) for the villa and dates.
  const couponTyped = normalizeCouponCode(couponInput);
  const couponDebounced = normalizeCouponCode(useDebounced(couponInput, 300));
  const couponLive = Boolean(couponTyped) && !custom;
  const couponArgs =
    couponLive && couponDebounced === couponTyped && property && dates.checkIn && dates.checkOut > dates.checkIn
      ? { code: couponTyped, propertySlug: property.slug, checkIn: dates.checkIn, checkOut: dates.checkOut }
      : null;
  const coupon = useCouponQuote(couponArgs);
  const couponWaiting = couponLive && Boolean(property && dates.checkIn && dates.checkOut) && (couponDebounced !== couponTyped || coupon.status === "checking");
  const couponInvalid = couponLive && coupon.status === "ready" && coupon.result.couponStatus === "invalid";
  // Only a code the quote applies is sent; when the quote couldn't run (e.g. an archived villa), the server decides.
  const couponToSend = couponLive && (coupon.status === "error" || (coupon.status === "ready" && coupon.result.couponStatus === "applied")) ? couponTyped : undefined;
  const couponProblem = couponInvalid ? "Clear the coupon code or use one that applies to this stay." : "";

  // What the guest pays, as shown before Create: the custom price, the code's quote, or the villa rate.
  const nights = dates.checkIn && dates.checkOut > dates.checkIn ? nightsBetweenIso(dates.checkIn, dates.checkOut) : 0;
  const total =
    custom ? customAmount
    : couponLive && coupon.status === "ready" && couponArgs ? coupon.result.total
    : property && nights > 0 && !couponLive ? calculateDirectQuote(property, nights).directTotal
    : null;

  const previewProblem = couponLive && coupon.status === "ready" ? coupon.result.problem?.code ?? (coupon.result.couponStatus === "coupon_worse" ? "coupon_worse" : undefined) : undefined;
  useEffect(() => { reportRefusal(couponTyped, previewProblem); }, [couponTyped, previewProblem, reportRefusal]);

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
    if (!availability.canSubmit || pending.current || problem || couponProblem || couponWaiting) return;
    if (!isPossiblePhoneNumber(guest.phone)) {
      setPhoneError("Enter a complete phone number for the selected country.");
      document.getElementById("nb-phone")?.focus();
      return;
    }
    setPhoneError("");
    pending.current = true;
    setSaving(true);
    setError("");
    setCouponError("");
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
        ...(couponToSend ? { couponCode: couponToSend } : {}),
      });
      onCreated(id);
    } catch (err) {
      // Everything entered stays, so Create booking can simply be pressed again.
      const refused = couponToSend ? couponUnavailableError(err) : null;
      if (couponToSend && refused) {
        reportRefusal(couponToSend, couponRefusalDetails(err)?.problem);
        setCouponError(
          couponCoversWholeStay(refused)
            ? `${couponToSend} covers the whole stay, so it can’t be used on a booking. Clear it, or set a custom price.`
            : marketingErrorText(err, "This code can’t be used now. Clear it to book at the villa rate."),
        );
        coupon.refresh();
      } else {
        setError(marketingErrorText(err, "Could not create the booking."));
      }
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const blockingReason = error || couponError || availability.dateError || problem || couponProblem || (
    couponWaiting ? "Checking the coupon…"
      : !property ? "Choose a villa."
      : !nights ? "Choose check-in and check-out dates."
      : conflicts ? "These dates overlap an existing booking or block."
      : availability.failed ? "Could not load availability. Unchecked dates cannot be booked."
      : !availability.canSubmit ? "Checking availability…"
      : !guest.name.trim() ? "Enter the guest’s name and phone number."
      : !guest.phone ? "Enter the guest’s phone number." : ""
  );

  const footerError = Boolean(error || couponError || availability.failed || availability.dateError || conflicts || problem || couponProblem);

  const field = (name: keyof typeof guest) => ({
    value: guest[name],
    onChange: (event: { target: { value: string } }) => setGuest((current) => ({ ...current, [name]: event.target.value })),
  });

  return (
    <Dialog open onOpenChange={(next) => (next || saving ? undefined : void close())}>
      <DialogContent className="h-auto max-h-[calc(100dvh-1rem)] max-sm:h-dvh max-sm:max-h-dvh grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-5 pb-0 max-md:pb-0 sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-semibold">{historical ? "Record past stay" : "New booking"}</DialogTitle>
          <DialogDescription className="sr-only">Villa, dates and guest</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex h-full min-h-0 min-w-0 flex-col gap-0 overflow-hidden">
          <fieldset disabled={saving} className="-mx-5 grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-5 pb-5 [&_label:not(:has(input))]:text-xs [&_label:not(:has(input))]:text-muted-foreground [&_input]:placeholder:text-muted-foreground">
            <section aria-labelledby="nb-stay-title" className="grid gap-4">
              <div className="flex items-center justify-between gap-3"><h3 id="nb-stay-title" className="text-base font-semibold">Stay</h3>
              <ToggleGroup variant="segmented" tone="subtle" className="w-fit p-0.5" value={confirmed ? "confirmed" : "pending"} onValueChange={value => setConfirmed(value === "confirmed")} aria-label="Booking status" disabled={saving}>
                <ToggleGroupItem className="h-9! pointer-coarse:h-11! data-[state=on]:bg-background! data-[state=on]:text-foreground!" value="confirmed">Confirmed</ToggleGroupItem><ToggleGroupItem className="h-9! pointer-coarse:h-11! data-[state=on]:bg-background! data-[state=on]:text-foreground!" value="pending">Pending</ToggleGroupItem>
              </ToggleGroup>
              </div>
              <div className="grid content-start gap-1.5">
                <Label id="nb-villa-label" htmlFor="nb-villa">Villa</Label>
                <VillaPicker
                  id="nb-villa"
                  className="[&>button]:font-normal"
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
                <div className="grid content-start gap-1.5">
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
              />

              {property && dates.checkIn && dates.checkOut ? (
                <Button type="button" variant="ghost" className="-ms-2 w-fit justify-start px-2 text-sm text-muted-foreground" disabled={saving}
                  onClick={async () => { if (await confirmDiscard()) onBlockInstead({ propertyId: property._id, start: dates.checkIn, end: dates.checkOut }); }}>
                  <Ban aria-hidden className="size-4" />
                  Block these dates instead
                </Button>
              ) : null}
              {!confirmed ? <p className="text-xs text-muted-foreground">Pending holds the dates without emailing the guest.</p> : null}

            </section>
            <section aria-labelledby="nb-guest-title" className="grid gap-4">
              <h3 id="nb-guest-title" className="text-base font-semibold">Guest</h3>
              <div className="grid grid-cols-[minmax(0,1fr)_96px] items-start gap-4">
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="nb-name">Guest name</Label>
                  <Input id="nb-name" required {...field("name")} />
                </div>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="nb-guests">Guests{property ? ` (max ${property.maxGuests})` : ""}</Label>
                  <Input
                    id="nb-guests"
                    type="number"
                    min={1}
                    max={property?.maxGuests}
                    value={guests}
                    onChange={(event) => setGuests(event.target.value)}
                    required
                    aria-describedby="nb-guests-hint"
                  />
                  {property ? <p id="nb-guests-hint" className="sr-only">Max {property.maxGuests}</p> : null}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="nb-phone">Phone</Label>
                <PhoneInput
                  id="nb-phone"
                  defaultCountry="TH"
                  disabled={saving}
                  countrySelectComponent={DeskPhoneCountrySelect}
                  autoComplete="off"
                  required
                  value={guest.phone}
                  onChange={(phone) => { setGuest((current) => ({ ...current, phone: phone ?? "" })); setPhoneError(""); }}
                  aria-invalid={Boolean(phoneError)}
                  aria-describedby={phoneError ? "nb-phone-error" : undefined}
                  className="[&_input]:placeholder:text-muted-foreground"
                />
                {phoneError ? <p id="nb-phone-error" role="alert" className="text-sm text-destructive">{phoneError}</p> : null}
                {phoneToCheck ? (
                  <p className="text-sm text-muted-foreground">
                    Saved phone: {phoneToCheck}. Select the country and re-enter this number before booking.
                  </p>
                ) : null}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="nb-email">Email (optional)</Label>
                <Input id="nb-email" type="email" autoComplete="off" {...field("email")} />
              </div>
              </div>
              {suggestions.length ? (
                <div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-1" aria-label="Previous guests">
                  <p className="admin-eyebrow px-2 pt-1">Returning guest?</p>
                  {suggestions.map((s) => (
                    <button
                      key={`${s.guestPhone}|${s.guestEmail ?? ""}`}
                      type="button"
                      className="flex min-h-11 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background focus-visible:bg-background focus-visible:outline-none"
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
              {/* The email choice only matters once there is an email to send to. */}
              {confirmed && guest.email.trim() ? (
                <NotifyGuestField
                  id="nb-notify"
                  guestEmail={guest.email.trim()}
                  checked={notify}
                  onChange={setNotifyChoice}
                  action="this booking"
                />
              ) : null}
              {historical && guest.email.trim() && notifyChoice === null ? (
                <p className="-mt-2 text-xs text-muted-foreground">Past stay · Email off by default</p>
              ) : null}
            </section>
            <section aria-labelledby="nb-price-title" className="grid gap-4 sm:grid-cols-2 sm:items-start">
              <h3 id="nb-price-title" className="text-base font-semibold sm:col-span-2">Price</h3>
              <div className="grid gap-2 rounded-xl border border-border bg-card px-3">
                <button id="nb-custom" type="button" role="switch" aria-labelledby="nb-custom-label" aria-checked={custom} disabled={saving} onClick={() => setCustom(!custom)} className="flex h-12 shrink-0 items-center justify-between rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="grid min-w-0 gap-0.5 text-left font-normal">
                    <span id="nb-custom-label">Custom price</span>
                    {!custom && property && dates.checkIn && dates.checkOut && !conflicts ? <span className="font-sans text-xs tabular-nums text-muted-foreground">{formatMoney(property.pricePerNight, property.currency)}/night{property.directDiscountPercent ? ` · direct −${property.directDiscountPercent}%` : ""}</span> : null}
                  </span>
                  <span aria-hidden className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${custom ? "bg-foreground justify-end" : "bg-muted-foreground/70 justify-start"}`}><span className="size-5 rounded-full bg-background shadow-sm" /></span>
                </button>
                {custom ? (
                  <>
                    <div className="grid gap-1.5 pb-3">
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
                    <div className="grid gap-1.5 pb-3">
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
                ) : null}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="nb-coupon">
                  Coupon code <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="nb-coupon"
                  value={couponInput}
                  onChange={(event) => {
                    setCouponInput(event.target.value);
                    setCouponError("");
                  }}
                  placeholder="e.g. SUMMER15"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  disabled={saving || custom}
                  aria-invalid={couponInvalid || couponError ? true : undefined}
                  aria-describedby="nb-coupon-status"
                  className="font-mono font-semibold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                />
                <div id="nb-coupon-status" aria-live="polite" className="grid content-start gap-1.5">
                  {custom && couponTyped ? (
                    <p className="text-xs text-muted-foreground">A custom price replaces the villa rate, so the code isn’t used.</p>
                  ) : !couponLive ? null : !property || !dates.checkIn || !dates.checkOut ? (
                    <p className="text-xs text-muted-foreground">Choose the villa and dates to check the code.</p>
                  ) : couponWaiting ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner label="Checking the code" className="size-3.5" />
                      Checking {couponTyped}…
                    </p>
                  ) : coupon.status === "error" ? (
                    <p className="text-xs text-muted-foreground">{coupon.message} The code is checked again when you create the booking.</p>
                  ) : coupon.status === "ready" ? (
                    <QuoteVerdictBox result={coupon.result}>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Total {formatMoney(coupon.result.total, property.currency)}
                        {coupon.result.couponStatus === "applied" ? ` with ${couponTyped}` : coupon.result.couponStatus === "coupon_worse" ? " at the direct rate. The code isn’t sent." : ""}
                      </p>
                    </QuoteVerdictBox>
                  ) : null}

                </div>
              </div>
            </section>

          </fieldset>
          {/* Separate from the scroller: the footer never covers a field. */}
          <DialogFooter className="-mx-5 shrink-0 flex-col gap-2 border-t border-border bg-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-col sm:items-stretch">
            <div className="flex w-full items-center justify-between gap-3">
              <p className="min-w-0 text-xs" aria-live="polite" data-sentence-budget="ignore">
                <span className="block font-sans text-lg font-semibold tabular-nums">Total {total !== null ? formatMoney(total, property?.currency ?? "THB") : "—"}</span>{" "}
                {nights > 0 ? <span className="text-muted-foreground">{nights} {nights === 1 ? "night" : "nights"}</span> : null}
              </p>
              <Button type="submit" className="shrink-0 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={saving || !availability.canSubmit || Boolean(problem) || Boolean(couponProblem) || couponWaiting || !guest.name.trim() || !guest.phone.trim()}>
                {saving ? <Spinner className="text-current" /> : null}
                Create booking
              </Button>
            </div>
            {blockingReason ? <p className={`text-pretty text-xs ${footerError ? "text-destructive" : "text-muted-foreground"}`} role={footerError ? "alert" : (availability.loading && !availability.canSubmit) || couponWaiting ? "status" : undefined} aria-live="polite">{blockingReason}</p> : null}
            {availability.failed ? <Button type="button" variant="outline" size="sm" className="self-start" disabled={saving} onClick={availability.retry}>Retry availability</Button> : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CouponQuote =
  | { status: "idle" | "checking" }
  | { status: "error"; message: string }
  | { status: "ready"; result: OfferResult };

/**
 * One-off guest quote for the code on this stay. Answers for older inputs are dropped, and
 * `refresh` asks again (after createBooking refused the code).
 */
function useCouponQuote(args: { code: string; propertySlug: string; checkIn: string; checkOut: string } | null) {
  const convex = useConvex();
  const [nonce, setNonce] = useState(0);
  const key = args ? `${JSON.stringify(args)}#${nonce}` : "";
  const [answer, setAnswer] = useState<{ key: string; quote: CouponQuote } | null>(null);
  useEffect(() => {
    if (!args) return;
    let active = true;
    convex
      .query(api.marketing.previewCoupon, args)
      .then((result) => {
        if (active) setAnswer({ key, quote: { status: "ready", result } });
      })
      .catch((err: unknown) => {
        if (active) setAnswer({ key, quote: { status: "error", message: marketingErrorText(err, "Couldn’t check the code.") } });
      });
    return () => {
      active = false;
    };
    // `key` covers the args and the refresh nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, convex]);
  const quote: CouponQuote = !args ? { status: "idle" } : answer?.key === key ? answer.quote : { status: "checking" };
  return { ...quote, refresh: () => setNonce((current) => current + 1) } as CouponQuote & { refresh: () => void };
}
