"use client";
import { api } from 'convex/_generated/api';

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { BookingPriceSummary, PriceLines } from "@/components/booking/BookingPriceSummary";
import { CouponField, type CouponNotice, type CouponSource } from "@/components/booking/CouponField";
import { useCouponCopy } from "@/components/booking/coupon-copy";
import { useCouponPreview } from "@/components/booking/useCouponPreview";
import {
  DateStatus,
  GuestDetailsPanel,
  GuestCountsPanel,
  ReviewPanel,
} from "@/components/booking/BookingPanels";
import { BookingStepNav } from "@/components/booking/BookingStepNav";
import { VillaSelector } from "@/components/booking/VillaSelector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  bookingSteps,
  getHighestAllowedStepIndex,
  initialGuestCounts,
  isValidGuestInfo,
  type BookingProperty,
  type BookingStep,
} from "@/lib/booking/booking";
import { addDaysIso, dateToIso, isDateInIsoList, nightsBetweenIso, rangeIntersectsDates } from '@/lib/booking/dates';
import { resortTodayIso as todayIsoResort } from 'convex/shared/time';
import { calendarMonths, monthOf, stayMonths } from "convex/shared/calendar";
import {
  couponCodeToSend,
  couponFromParam,
  couponPhase,
  couponCoversWholeStay,
  couponUnavailableError,
  guestErrorText,
  stayPrice,
  summaryNote,
} from "@/lib/booking/coupon";
import { normalizeCouponCode } from "convex/shared/offers";
import { useStayBlockedDates, useVillaBlockedMonths } from "@/lib/booking/use-blocked-dates";
import { calculateDirectQuote } from "convex/shared/pricing";
import {
  localizePropertyLike,
} from "@/lib/i18n/public-content";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";

import { useConvex, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { localizeHref } from "@/i18n/routing";
import { arrivalCoupon, captureForBooking } from "@/lib/marketing/capture";

const BookingDatePicker = dynamic(
  () => import("@/components/booking/BookingDatePicker").then((mod) => mod.BookingDatePicker),
  {
    ssr: false,
    loading: () => <BookingDatePickerSkeleton />,
  },
);

function BookingDatePickerSkeleton() {
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
        <div className="h-12 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
    </div>
  );
}

type FunnelProps = {
  initialCheckIn?: string; initialCheckOut?: string; initialNights?: string;
  initialGuests?: string; initialAdults?: string; initialChildren?: string;
  initialProperty?: string; initialCoupon?: string;
};
export function BookingFunnel(props: FunnelProps) {
  const rows = useQuery(api.catalog.properties.list, {});
  const t = useTranslations("Booking");
  if (rows === undefined) return <div role="status" className="p-24">{t("loadingInventory")}</div>;
  if (rows.length === 0) return <div role="alert" className="p-24">{t("liveBookingUnavailable")}</div>;
  return <LiveBookingFunnel {...props} rows={rows} />;
}
function LiveBookingFunnel({
  initialCheckIn = "",
  initialCheckOut = "",
  initialNights = "",
  initialGuests = "1",
  initialAdults = "",
  initialChildren = "",
  initialProperty = "garden-suite",
  initialCoupon = "",
  rows,
}: FunnelProps & { rows: FunctionReturnType<typeof api.catalog.properties.list> }) {
  const router = useRouter();
  const locale = useLocale();
  const messages = usePublicMessages();
  const t = useTranslations("Booking");
  const couponT = useTranslations("Coupon");
  const villaT = useTranslations("Villa");
  const convex = useConvex();
  const todayIso = todayIsoResort();
  const parsedInitialNights = Number(initialNights);
  const derivedInitialCheckOut =
    initialCheckOut ||
    (initialCheckIn && Number.isFinite(parsedInitialNights) && parsedInitialNights > 0
      ? addDaysIso(initialCheckIn, Math.floor(parsedInitialNights))
      : "");
  const { adults: startingAdults, children: startingChildren } = initialGuestCounts({
    guests: initialGuests,
    adults: initialAdults,
    children: initialChildren,
  });

  const [step, setStep] = useState<BookingStep>("select");
  const propertyList = useMemo(() => rows.map(row => localizePropertyLike({ ...row, id: row.slug, source: "live" as const }, messages, locale)), [rows, messages, locale]);
  const [selectedId, setSelectedId] = useState(initialProperty);
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(derivedInitialCheckOut);
  const [adults, setAdults] = useState(startingAdults);
  const [children, setChildren] = useState(startingChildren);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() =>
    monthOf(derivedInitialCheckOut || initialCheckIn || todayIso),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dateWarning, setDateWarning] = useState("");
  // The attached coupon code (null = none), where it came from, and the entry under "Have a code?".
  const [couponCode, setCouponCode] = useState<string | null>(() => couponFromParam(initialCoupon) || null);
  const [couponSource, setCouponSource] = useState<CouponSource>(() => (couponFromParam(initialCoupon) ? "link" : "typed"));
  const [couponDraft, setCouponDraft] = useState(() => couponFromParam(initialCoupon));
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponEntryError, setCouponEntryError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<CouponNotice | null>(null);

  // Release 3a: with no `?coupon=` here, the coupon of the link this tab arrived through still counts as a link coupon.
  useEffect(() => {
    if (couponFromParam(initialCoupon)) return;
    const carried = couponFromParam(arrivalCoupon());
    if (!carried) return;
    setCouponCode(carried);
    setCouponSource("link");
    setCouponDraft(carried);
  }, [initialCoupon]);

  const property = propertyList.find((item) => item.slug === selectedId) ?? propertyList[0];
  const liveClient = convex;
  const livePropertyIds = useMemo(
    () => propertyList.flatMap((item) => (item.source === "live" && item._id ? [item._id] : [])),
    [propertyList],
  );
  const requestedMonths = calendarMonths({ visibleMonth, checkIn, checkOut, today: todayIso });
  const {
    blockedDates: propertyBlockedDates,
    pendingMonths,
    failedMonths,
    retry: retryBlockedMonths,
  } = useVillaBlockedMonths(
    liveClient,
    property.source === "live" ? property._id : undefined,
    requestedMonths,
  );
  const stayBlockedByProperty = useStayBlockedDates(liveClient, livePropertyIds, checkIn, checkOut);
  // Months still loading or that failed to load are unknown, so their days can't be picked.
  const unknownMonths = useMemo(() => new Set([...pendingMonths, ...failedMonths]), [pendingMonths, failedMonths]);
  const stayDatesUnknown = stayMonths(checkIn, checkOut).some((month) => unknownMonths.has(month));
  const blockedDateSet = useMemo(() => new Set(propertyBlockedDates), [propertyBlockedDates]);
  const nights = nightsBetweenIso(checkIn, checkOut);
  const guests = adults + children;
  const quote = calculateDirectQuote({ pricePerNight: property.pricePerNight, directDiscountPercent: property.directDiscountPercent, currency: property.currency }, nights);
  const conflicts = rangeIntersectsDates(propertyBlockedDates, checkIn, checkOut);
  const activeCouponCode = couponCode;
  const couponStay =
    property.source === "live" && nights > 0
      ? { propertySlug: property.slug, checkIn, checkOut }
      : null;
  const { preview: couponPreview, retry: retryCoupon, reportRefusal } = useCouponPreview(liveClient, activeCouponCode, couponStay);
  const phase = couponPhase(activeCouponCode, couponPreview);
  const price = stayPrice({
    subtotal: quote.subtotal,
    directDiscount: quote.discountAmount,
    code: activeCouponCode,
    offer: phase.kind === "applied" ? phase.result : null,
  });
  const couponCopy = useCouponCopy(property.currency);
  const couponNoteMessage = summaryNote(activeCouponCode, phase, couponCopy.problemText);
  const couponNote = couponNoteMessage ? couponCopy.text(couponNoteMessage) : null;
  const couponChecking = phase.kind === "checking";
  const infoValid = isValidGuestInfo(guestName, guestEmail, guestPhone);
  const invalidRange = Boolean(checkIn && checkOut && nights <= 0);
  const selectedStepIndex = bookingSteps.findIndex((item) => item.key === step);
  const selectValid = Boolean(
    property && checkIn && checkOut && nights > 0 && !invalidRange && !conflicts && !stayDatesUnknown,
  );
  const guestsValid = adults >= 1 && children >= 0 && guests >= 1 && guests <= property.maxGuests;
  const highestAllowedStepIndex = getHighestAllowedStepIndex({
    selectValid,
    guestsValid,
    infoValid,
  });
  const nightHelperText =
    !checkIn
      ? t("chooseDates")
      : !checkOut
        ? t("selectCheckout")
        : nights > 0
          ? t("nightsSelected", { count: nights })
          : t("checkoutAfterCheckin");

  useEffect(() => {
    if (selectedStepIndex > highestAllowedStepIndex) {
      setStep(bookingSteps[highestAllowedStepIndex].key);
    }
  }, [highestAllowedStepIndex, selectedStepIndex]);

  const availablePropertyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of propertyList) {
      // Unknown (still loading or failed) counts as available; the booking is re-checked on the server.
      const blocked = item._id ? stayBlockedByProperty?.[item._id] ?? [] : [];
      if (!checkIn || !checkOut || !rangeIntersectsDates(blocked, checkIn, checkOut)) {
        ids.add(item.slug);
      }
    }
    return ids;
  }, [stayBlockedByProperty, checkIn, checkOut, propertyList]);

  function isStayDateDisabled(date: Date) {
    const iso = dateToIso(date);
    return iso < todayIso || unknownMonths.has(monthOf(iso)) || isDateInIsoList(date, blockedDateSet);
  }

  function selectProperty(item: BookingProperty) {
    setError("");
    if (!availablePropertyIds.has(item.slug)) {
      setDateWarning(t("notAvailableShort", { propertyName: item.name }));
      return;
    }
    setSelectedId(item.slug);
    const nextTotal = Math.min(Math.max(1, guests), item.maxGuests);
    const nextChildren = Math.min(children, Math.max(0, nextTotal - 1));
    setChildren(nextChildren);
    setAdults(Math.max(1, nextTotal - nextChildren));
    setDateWarning("");
  }

  function updateDateRange(range: { checkIn: string; checkOut: string }) {
    setError("");
    setCheckIn(range.checkIn);
    setCheckOut(range.checkOut);
    setDateWarning("");
  }

  function applyCoupon() {
    const code = normalizeCouponCode(couponDraft);
    setCouponDraft(code);
    setCouponNotice(null);
    setError("");
    if (!code) {
      setCouponEntryError(couponT("enterCode"));
      return;
    }
    setCouponEntryError(null);
    setCouponCode(code);
    setCouponSource("typed");
    setCouponOpen(false);
  }

  function changeCouponDraft(value: string) {
    setCouponDraft(value);
    setCouponEntryError(null);
    // Editing a refused code starts a new entry.
    if (phase.kind === "rejected") {
      setCouponCode(null);
      setCouponOpen(true);
    }
  }

  function removeCoupon() {
    if (!couponCode) return;
    setCouponNotice({ kind: "removed", code: couponCode, source: couponSource });
    setCouponCode(null);
    setCouponDraft("");
    setCouponOpen(false);
    setCouponEntryError(null);
  }

  function undoRemoveCoupon() {
    if (couponNotice?.kind !== "removed") return;
    setCouponCode(couponNotice.code);
    setCouponSource(couponNotice.source);
    setCouponDraft(couponNotice.code);
    setCouponNotice(null);
  }

  /** Extends checkout by `extra` nights when every added night is loaded and free. */
  function extendedCheckOut(extra: number) {
    if (!checkIn || !checkOut) return null;
    const next = addDaysIso(checkOut, extra);
    const months = stayMonths(checkIn, next);
    const known = months.every((month) => requestedMonths.includes(month) && !unknownMonths.has(month));
    return known && !rangeIntersectsDates(propertyBlockedDates, checkIn, next) ? next : null;
  }

  function currentStepValid() {
    if (step === "select") return selectValid;
    if (step === "guests") return guestsValid;
    if (step === "info") return infoValid;
    return selectValid && guestsValid && infoValid;
  }

  function next() {
    if (!currentStepValid()) return;
    setError("");
    setStep(bookingSteps[Math.min(bookingSteps.length - 1, selectedStepIndex + 1)].key);
  }

  function previous() {
    setError("");
    setStep(bookingSteps[Math.max(0, selectedStepIndex - 1)].key);
  }

  async function submitBooking() {
    setError("");
    if (!selectValid || !guestsValid || !infoValid) {
      setError(t("completeBeforePayment"));
      return;
    }

    setSubmitting(true);
    let couponSent: string | undefined;
    try {
      if (!property._id || property.source !== "live") {
        throw new Error(t("liveBookingUnavailable"));
      }

      const available = await convex.query(api.bookings.calendar.availability.isAvailable, {
        propertyId: property._id,
        checkIn,
        checkOut,
      });
      if (!available) {
        throw new Error(t("datesNoLongerAvailable"));
      }

      couponSent = couponCodeToSend(activeCouponCode, phase);
      const result = await convex.mutation(api.bookings.bookings.create, {
        propertySlug: property.slug,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim(),
        checkIn,
        checkOut,
        guests,
        couponCode: couponSent,
        marketing: captureForBooking(),
      });

      // `quoted` lets the pay page say so if the booked total isn't the one shown here.
      router.push(
        localizeHref(
          `/booking/pay?bookingId=${encodeURIComponent(result.bookingId)}&token=${encodeURIComponent(result.accessToken)}&quoted=${price.total}`,
          locale,
        ),
      );
    } catch (err) {
      const refused = couponSent ? couponUnavailableError(err) : null;
      if (refused && couponSent) {
        reportRefusal(couponSent, refused.problem?.code);
        // Nothing was booked. Drop the code so the summary re-quotes at the direct price, and
        // let the guest see the new total before continuing.
        const detail = couponCoversWholeStay(refused)
          ? couponT("coversWholeStay")
          : refused.problem
            ? couponCopy.problemText(refused.problem)
            : refused.message ?? couponT("unavailableFallback");
        setCouponNotice({ kind: "ran_out", code: couponSent, detail: detail.replace(/[.。]\s*$/, "") });
        setCouponCode(null);
        setCouponDraft("");
        setCouponOpen(false);
        return;
      }
      setError(guestErrorText(err, t("unableToCreate")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
          {t("directBooking")}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
          {t("reserveTitle")}
        </h1>

      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <Card className="min-w-0 p-5 md:p-7">
          <BookingStepNav
            currentStep={step}
            highestAllowedStepIndex={highestAllowedStepIndex}
            onSelectStep={setStep}
          />

          {step === "select" ? (
            <div className="space-y-5">
              <VillaSelector
                properties={propertyList}
                selectedId={selectedId}
                availablePropertyIds={availablePropertyIds}
                onSelect={selectProperty}
              />

              <div className="grid gap-4">
                <BookingDatePicker
                  checkIn={checkIn}
                  checkOut={checkOut}
                  onChange={updateDateRange}
                  isDateDisabled={isStayDateDisabled}
                  unavailableDates={propertyBlockedDates}
                  helperText={invalidRange ? t("checkoutAfterCheckin") : nightHelperText}
                  onMonthChange={(month) => setVisibleMonth(monthOf(dateToIso(month)))}
                />
                {failedMonths.length > 0 ? (
                  <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                    <span>{t("availabilityLoadFailed")}</span>
                    <Button type="button" size="sm" variant="outline" onClick={retryBlockedMonths}>
                      {t("retryAvailability")}
                    </Button>
                  </div>
                ) : null}
              </div>

              <DateStatus
                dateWarning={dateWarning}
                conflicts={conflicts}
                propertyName={property.name}
              />
            </div>
          ) : null}

          {step === "guests" ? (
            <GuestCountsPanel
              property={property}
              adults={adults}
              childCount={children}
              onChangeAdults={setAdults}
              onChangeChildren={setChildren}
            />
          ) : null}

          {step === "info" ? (
            <GuestDetailsPanel
              guestName={guestName}
              guestEmail={guestEmail}
              guestPhone={guestPhone}
              onGuestNameChange={setGuestName}
              onGuestEmailChange={setGuestEmail}
              onGuestPhoneChange={setGuestPhone}
            />
          ) : null}

          {step === "review" ? (
            <ReviewPanel
              property={property}
              guests={guests}
              nights={nights}
              checkIn={checkIn}
              checkOut={checkOut}
              price={
                <PriceLines
                  currency={property.currency}
                  priceLabel={`${couponCopy.format.money(property.pricePerNight)} ${villaT("perNight")} x ${nights || 0}`}
                  subtotal={price.subtotal}
                  lines={price.lines}
                  total={price.total}
                />
              }
              coupon={
                (
                  <CouponField
                    code={activeCouponCode}
                    source={couponSource}
                    phase={phase}
                    draft={couponDraft}
                    open={couponOpen}
                    entryError={couponEntryError}
                    notice={couponNotice}
                    currency={property.currency}
                    disabled={submitting}
                    onDraftChange={changeCouponDraft}
                    onOpenChange={setCouponOpen}
                    onApply={applyCoupon}
                    onRemove={removeCoupon}
                    onUndo={undoRemoveCoupon}
                    onRetry={retryCoupon}
                    onAddNights={
                      phase.kind === "not_used" && phase.problem.code === "min_nights" && extendedCheckOut(Math.max(1, phase.problem.missingNights))
                        ? (extra) => {
                            const next = extendedCheckOut(extra);
                            if (next) updateDateRange({ checkIn, checkOut: next });
                          }
                        : undefined
                    }
                    onChangeStay={() => setStep("select")}
                  />
                )
              }
            />
          ) : null}

          {error ? (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-8 flex justify-between gap-3">
            <Button variant="outline" onClick={previous} disabled={step === "select"}>
              <ArrowLeft className="h-4 w-4" />
              {t("back")}
            </Button>
            {step === "review" ? (
              <Button onClick={submitBooking} disabled={submitting || couponChecking || highestAllowedStepIndex < 3}>
                <CreditCard className="h-4 w-4" />
                {submitting || couponChecking ? t("checking") : t("continueToPay")}
              </Button>
            ) : (
              <Button onClick={next} disabled={!currentStepValid()}>
                {t("continue")}
              </Button>
            )}
          </div>
        </Card>

        <BookingPriceSummary
          property={property}
          nights={nights}
          subtotal={price.subtotal}
          lines={price.lines}
          total={price.total}
          note={couponNote}
        />
      </div>
    </div>
  );
}
