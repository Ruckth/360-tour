"use client";

import { CalendarCheck, CheckCircle2, ChevronsRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import type { BookingProperty } from "@/lib/booking/booking";
import { calendarMonths, monthOf, stayMonths } from "@/lib/booking/blocked-months";
import {
  dateToIso,
  isDateInIsoList,
  rangeIntersectsDates,
  todayIsoLocal,
} from "@/lib/booking/dates";
import { useVillaBlockedMonths } from "@/lib/booking/use-blocked-dates";
import { calculateBookingQuote } from "@/lib/booking/quote";
import type { ChatBookingContext } from "@/lib/chat/booking-intent";
import {
  getChatVillaBackground,
  getDemoChatProperties,
  getLiveChatProperties,
} from "@/components/chat/chat-villa-data";
import { resort } from "@/lib/data/resort-config";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { useOptionalConvex } from "@/lib/react/convex";
import { listLiveProperties } from "@/lib/react/convex-api";
import { cn } from "@/lib/utils";

export function ChatBookingCard({ context }: { context: ChatBookingContext }) {
  const chatT = useTranslations("Chat");
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const villaT = useTranslations("Villa");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const messages = usePublicMessages();
  const fallbackProperties = useMemo(() => getDemoChatProperties(messages, locale), [messages, locale]);
  const convex = useOptionalConvex();
  const today = todayIsoLocal();
  const [properties, setProperties] = useState<BookingProperty[]>(() => fallbackProperties);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [selectedPropertySlug, setSelectedPropertySlug] = useState(context.propertySlug ?? "");
  const [checkIn, setCheckIn] = useState(context.checkIn);
  const [checkOut, setCheckOut] = useState(context.checkOut);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(context.checkOut || context.checkIn || today));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!convex) {
      setProperties(fallbackProperties);
      setPropertiesLoading(false);
      return;
    }

    const client = convex;
    let active = true;

    // Only the villa list here; blocked nights load for the selected villa, a month at a time.
    async function loadProperties() {
      setPropertiesLoading(true);
      try {
        const rows = await listLiveProperties(client);
        if (!active) return;

        const liveProperties = getLiveChatProperties(rows, messages, locale);
        setProperties(liveProperties.length > 0 ? liveProperties : fallbackProperties);
      } catch {
        if (!active) return;
        setProperties(fallbackProperties);
      } finally {
        if (active) setPropertiesLoading(false);
      }
    }

    loadProperties();
    return () => {
      active = false;
    };
  }, [convex, fallbackProperties, locale, messages]);

  useEffect(() => {
    setSelectedPropertySlug(context.propertySlug ?? "");
    setCheckIn(context.checkIn);
    setCheckOut(context.checkOut);
    if (context.checkIn || context.checkOut) setVisibleMonth(monthOf(context.checkOut || context.checkIn));
    setError("");
  }, [context.checkIn, context.checkOut, context.propertySlug]);

  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: resort.currency,
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const bookingHref = useMemo(() => {
    const params = new URLSearchParams();
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (selectedPropertySlug) params.set("unit", selectedPropertySlug);
    if (context.guests) params.set("guests", String(context.guests));

    const query = params.toString();
    return localizeHref(`/booking${query ? `?${query}` : ""}`, locale);
  }, [checkIn, checkOut, context.guests, locale, selectedPropertySlug]);
  const selectedProperty = useMemo(
    () =>
      properties.find(
        (item) => item.slug === selectedPropertySlug || item.id === selectedPropertySlug,
      ),
    [properties, selectedPropertySlug],
  );
  const {
    blockedDates: selectedBlockedDates,
    pendingMonths,
    failedMonths,
    retry: retryBlockedMonths,
  } = useVillaBlockedMonths(
    convex,
    selectedProperty?.source === "live" ? selectedProperty._id : undefined,
    calendarMonths({ visibleMonth, checkIn, checkOut, today }),
  );
  const stayMonthsFailed = stayMonths(checkIn, checkOut).some((month) => failedMonths.includes(month));
  const availabilityLoading =
    propertiesLoading || stayMonths(checkIn, checkOut).some((month) => pendingMonths.includes(month));
  const selectedBlockedDateSet = useMemo(
    () => new Set(selectedBlockedDates),
    [selectedBlockedDates],
  );
  const hasDateConflict = rangeIntersectsDates(selectedBlockedDates, checkIn, checkOut);

  function updateDateRange(range: { checkIn: string; checkOut: string }) {
    setCheckIn(range.checkIn);
    setCheckOut(range.checkOut);
    setError("");
  }

  function openBooking() {
    if (!selectedPropertySlug) {
      setError(chatT("bookingCardMissingVilla"));
      return;
    }

    if (!checkIn || !checkOut) {
      setError(bookingT("chooseDates"));
      return;
    }

    if (checkOut <= checkIn) {
      setError(bookingT("checkoutAfterCheckin"));
      return;
    }

    if (availabilityLoading) {
      setError(bookingT("checkingAvailability"));
      return;
    }

    if (stayMonthsFailed) {
      setError(bookingT("availabilityLoadFailed"));
      return;
    }

    if (hasDateConflict) {
      setError(bookingT("datesNoLongerAvailable"));
      return;
    }

    window.location.assign(bookingHref);
  }

  return (
    <div
      data-testid="chat-booking-card"
      className="mt-2 w-full rounded-2xl border border-gold/35 bg-[linear-gradient(180deg,rgba(196,161,82,0.10),rgba(255,255,255,0)_42%)] p-3 shadow-sm shadow-black/5 dark:border-gold/30 dark:bg-[linear-gradient(180deg,rgba(196,161,82,0.12),rgba(15,23,42,0)_48%)]"
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"
        >
          <CalendarCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{chatT("bookingCardTitle")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {chatT("bookingCardHelper")}
          </p>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {chatT("bookingCardVillaLabel")}
          </Label>
          <span
            data-testid="chat-villa-swipe-hint"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground sm:hidden"
          >
            {chatT("bookingCardSwipeHint")}
            <ChevronsRight className="h-3 w-3" aria-hidden="true" />
          </span>
        </div>
        <div
          data-testid="chat-villa-selector"
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={chatT("bookingCardVillaLabel")}
        >
          {properties.map((item) => {
            const isSelected = item.slug === selectedPropertySlug || item.id === selectedPropertySlug;
            const oneNightQuote = calculateBookingQuote({
              pricePerNight: item.pricePerNight,
              nights: 1,
              discountPercent: 15,
              currency: resort.currency,
            });

            return (
              <button
                key={item.id}
                type="button"
                data-testid={`chat-villa-option-${item.id}`}
                data-blocked-count={isSelected ? selectedBlockedDates.length : undefined}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedPropertySlug(item.slug);
                  setError("");
                }}
                className="group min-w-[72%] snap-start text-left outline-none sm:min-w-[32%]"
              >
                <Card
                  className={cn(
                    "relative h-full min-h-[11.25rem] overflow-hidden rounded-xl p-0 transition focus-within:ring-3 focus-within:ring-gold/25",
                    isSelected
                      ? "border-gold shadow-sm shadow-gold/20 ring-1 ring-gold/50"
                      : "border-white/15 bg-background/80 hover:border-gold/60",
                  )}
                >
                  <PropertyImage
                    src={getChatVillaBackground(item)}
                    images={item.images}
                    fallbackImages={[resort.heroImage]}
                    alt=""
                    sizes="(min-width: 640px) 16rem, 72vw"
                    className="absolute inset-0 h-full w-full bg-slate-950"
                    imgClassName={cn(
                      "scale-105 brightness-105 transition duration-700",
                      isSelected ? "blur-[1px] brightness-110" : "group-hover:scale-110",
                    )}
                  />
                  <div
                    className={
                      isSelected
                        ? "absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.06),rgba(2,6,23,0.22)_58%,rgba(2,6,23,0.48))]"
                        : "absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.14),rgba(2,6,23,0.38)_58%,rgba(2,6,23,0.66))]"
                    }
                    aria-hidden="true"
                  />
                  <div className="relative z-10 flex h-full min-h-[11.25rem] flex-col justify-between p-3">
                    <div className={cn(isSelected && "-m-2 rounded-lg bg-slate-950/32 p-2 backdrop-blur-sm")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-semibold leading-tight text-white">
                          {item.name}
                        </span>
                        {isSelected ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/75">
                        {item.tagline}
                      </p>
                    </div>
                    <div className={cn("mt-3 flex flex-col items-start gap-1.5", isSelected && "-mx-2 -mb-2 rounded-lg bg-slate-950/32 p-2 backdrop-blur-sm")}>
                      <Badge
                        variant={isSelected ? "gold" : "muted"}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px]",
                          !isSelected && "border border-white/10 bg-white/15 text-white backdrop-blur-sm",
                        )}
                      >
                        {bookingT("upToGuests", { count: item.maxGuests })}
                      </Badge>
                      <span
                        data-testid={`chat-villa-price-${item.id}`}
                        className="whitespace-nowrap text-[11px] font-bold text-gold"
                      >
                        {moneyFormatter.format(oneNightQuote.directTotal)}
                        <span className="font-medium text-white/70"> {villaT("perNightWords")}</span>
                      </span>
                    </div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <BookingRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={updateDateRange}
          isDateDisabled={(date) => {
            const iso = dateToIso(date);
            // Months still loading or that failed to load are unknown, so their days can't be picked.
            const month = monthOf(iso);
            return (
              iso < today ||
              pendingMonths.includes(month) ||
              failedMonths.includes(month) ||
              isDateInIsoList(date, selectedBlockedDateSet)
            );
          }}
          unavailableDates={selectedBlockedDates}
          compact
          onRangeChange={() => setError("")}
          onMonthChange={(month) => setVisibleMonth(monthOf(dateToIso(month)))}
        />

        <Button
          type="button"
          variant="gold"
          onClick={openBooking}
          disabled={availabilityLoading}
          className="h-10 rounded-xl px-5"
        >
          {navT("book")}
        </Button>
      </div>

      {failedMonths.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-destructive" role="alert">
          <span>{bookingT("availabilityLoadFailed")}</span>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={retryBlockedMonths}>
            {bookingT("retryAvailability")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
