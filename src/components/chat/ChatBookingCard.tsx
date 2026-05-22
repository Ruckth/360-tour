"use client";

import { CalendarCheck, CalendarDays, CheckCircle2, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { dateToIso, isoToDate, nightsBetweenIso, todayIsoLocal } from "@/lib/booking/dates";
import { calculateBookingQuote } from "@/lib/booking/quote";
import type { ChatBookingContext } from "@/lib/chat/booking-intent";
import { resort } from "@/lib/data/resort-config";
import { getLocalizedProperties } from "@/lib/i18n/public-content";
import { cn } from "@/lib/utils";

export function ChatBookingCard({ context }: { context: ChatBookingContext }) {
  const chatT = useTranslations("Chat");
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const villaT = useTranslations("Villa");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const properties = useMemo(() => getLocalizedProperties(locale), [locale]);
  const today = todayIsoLocal();
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const [selectedPropertySlug, setSelectedPropertySlug] = useState(context.propertySlug ?? "");
  const [checkIn, setCheckIn] = useState(context.checkIn);
  const [checkOut, setCheckOut] = useState(context.checkOut);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedPropertySlug(context.propertySlug ?? "");
    setCheckIn(context.checkIn);
    setCheckOut(context.checkOut);
    setError("");
  }, [context.checkIn, context.checkOut, context.propertySlug]);

  const property = useMemo(
    () => properties.find((item) => item.id === selectedPropertySlug),
    [properties, selectedPropertySlug],
  );
  const nights = useMemo(() => nightsBetweenIso(checkIn, checkOut), [checkIn, checkOut]);
  const quote = useMemo(() => {
    if (!property || nights <= 0) return null;
    return calculateBookingQuote({
      pricePerNight: property.pricePerNight,
      nights,
      discountPercent: 15,
      currency: resort.currency,
    });
  }, [nights, property]);
  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: resort.currency,
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [locale],
  );
  const staySummary = useMemo(() => {
    if (!property) return "";
    const parts = [
      property.name,
      context.guests ? villaT("guests", { count: context.guests }) : "",
      nights > 0 ? chatT("bookingCardNights", { count: nights }) : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }, [chatT, context.guests, nights, property, villaT]);
  const bookingHref = useMemo(() => {
    const params = new URLSearchParams();
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (selectedPropertySlug) params.set("unit", selectedPropertySlug);
    if (context.guests) params.set("guests", String(context.guests));

    const query = params.toString();
    return localizeHref(`/booking${query ? `?${query}` : ""}`, locale);
  }, [checkIn, checkOut, context.guests, locale, selectedPropertySlug]);

  function formatDate(value: string) {
    const date = isoToDate(value);
    return date ? dateFormatter.format(date) : "";
  }

  function selectCheckIn(date: Date | undefined) {
    const nextCheckIn = dateToIso(date);
    setCheckIn(nextCheckIn);
    if (nextCheckIn && checkOut && checkOut <= nextCheckIn) setCheckOut("");
    setError("");
    setCheckInOpen(false);
  }

  function selectCheckOut(date: Date | undefined) {
    setCheckOut(dateToIso(date));
    setError("");
    setCheckOutOpen(false);
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

    window.location.assign(bookingHref);
  }

  return (
    <div
      data-testid="chat-booking-card"
      className="mt-2 rounded-2xl border border-gold/35 bg-[linear-gradient(180deg,rgba(196,161,82,0.10),rgba(255,255,255,0)_42%)] p-3 shadow-sm shadow-black/5 dark:border-gold/30 dark:bg-[linear-gradient(180deg,rgba(196,161,82,0.12),rgba(15,23,42,0)_48%)]"
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
        <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {chatT("bookingCardVillaLabel")}
        </Label>
        <div
          data-testid="chat-villa-selector"
          className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={chatT("bookingCardVillaLabel")}
        >
          {properties.map((item) => {
            const isSelected = item.id === selectedPropertySlug;
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
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedPropertySlug(item.id);
                  setError("");
                }}
                className="min-w-[72%] snap-start text-left outline-none sm:min-w-[32%]"
              >
                <Card
                  className={cn(
                    "h-full rounded-xl p-3 transition hover:border-gold/60 hover:bg-gold/5 focus-within:ring-3 focus-within:ring-gold/25",
                    isSelected
                      ? "border-gold bg-gold/10 shadow-sm shadow-gold/15 ring-1 ring-gold/40"
                      : "bg-background/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-semibold leading-tight text-foreground">
                      {item.name}
                    </span>
                    {isSelected ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {item.tagline}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge variant={isSelected ? "gold" : "muted"} className="rounded-full px-2 py-0.5 text-[10px]">
                      {bookingT("upToGuests", { count: item.maxGuests })}
                    </Badge>
                    <span className="whitespace-nowrap text-[11px] font-bold text-navy dark:text-gold">
                      {moneyFormatter.format(oneNightQuote.directTotal)}
                      <span className="font-medium text-muted-foreground"> {villaT("perNightWords")}</span>
                    </span>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {staySummary ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/20 bg-gold/10 px-3 py-2 text-xs text-slate-800 dark:text-slate-100">
          <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-gold" />
            <span className="truncate">
              {chatT("bookingCardSelectedVilla", { summary: staySummary })}
            </span>
          </span>
          {quote ? (
            <span className="font-bold text-navy dark:text-gold">
              {chatT("bookingCardDirectTotal", {
                total: moneyFormatter.format(quote.directTotal),
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {bookingT("checkIn")}
          </Label>
          <Popover open={checkInOpen} onOpenChange={setCheckInOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                data-testid="chat-booking-check-in"
                data-selected-date={checkIn}
                aria-label={bookingT("checkIn")}
                className={cn(
                  "h-10 w-full justify-start rounded-xl px-3 text-left text-sm font-medium",
                  !checkIn && "text-muted-foreground",
                )}
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">{checkIn ? formatDate(checkIn) : bookingT("checkIn")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="z-[80] w-auto max-w-[calc(100vw-2rem)] p-3">
              <Calendar
                mode="single"
                selected={isoToDate(checkIn)}
                onSelect={selectCheckIn}
                disabled={(date) => (todayDate ? date < todayDate : false)}
                defaultMonth={isoToDate(checkIn) ?? todayDate}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {bookingT("checkOut")}
          </Label>
          <Popover open={checkOutOpen} onOpenChange={setCheckOutOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                data-testid="chat-booking-check-out"
                data-selected-date={checkOut}
                aria-label={bookingT("checkOut")}
                className={cn(
                  "h-10 w-full justify-start rounded-xl px-3 text-left text-sm font-medium",
                  !checkOut && "text-muted-foreground",
                )}
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 truncate">{checkOut ? formatDate(checkOut) : bookingT("checkOut")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="z-[80] w-auto max-w-[calc(100vw-2rem)] p-3">
              <Calendar
                mode="single"
                selected={isoToDate(checkOut)}
                onSelect={selectCheckOut}
                disabled={(date) => {
                  const iso = dateToIso(date);
                  if (checkIn) return iso <= checkIn;
                  return today ? iso < today : false;
                }}
                defaultMonth={isoToDate(checkOut) ?? isoToDate(checkIn) ?? todayDate}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <Button type="button" variant="gold" onClick={openBooking} className="h-10 rounded-xl px-5">
          {navT("book")}
        </Button>
      </div>

      {error ? (
        <p className="mt-2 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
