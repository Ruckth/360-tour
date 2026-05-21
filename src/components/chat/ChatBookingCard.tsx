"use client";

import { CalendarCheck, CalendarDays, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { nightsBetweenIso, todayIsoLocal } from "@/lib/booking/dates";
import { calculateBookingQuote } from "@/lib/booking/quote";
import type { ChatBookingContext } from "@/lib/chat/booking-intent";
import { properties } from "@/lib/data/properties";
import { resort } from "@/lib/data/resort-config";

export function ChatBookingCard({ context }: { context: ChatBookingContext }) {
  const chatT = useTranslations("Chat");
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const villaT = useTranslations("Villa");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const today = todayIsoLocal();
  const [checkIn, setCheckIn] = useState(context.checkIn);
  const [checkOut, setCheckOut] = useState(context.checkOut);
  const [error, setError] = useState("");

  useEffect(() => {
    setCheckIn(context.checkIn);
    setCheckOut(context.checkOut);
    setError("");
  }, [context.checkIn, context.checkOut]);

  const checkoutMin = useMemo(() => checkIn || today, [checkIn, today]);
  const property = useMemo(
    () => properties.find((item) => item.id === context.propertySlug),
    [context.propertySlug],
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
  const staySummary = useMemo(() => {
    if (!property || nights <= 0) return "";
    const parts = [
      property.name,
      context.guests ? villaT("guests", { count: context.guests }) : "",
      chatT("bookingCardNights", { count: nights }),
    ].filter(Boolean);
    return parts.join(" · ");
  }, [chatT, context.guests, nights, property, villaT]);
  const bookingHref = useMemo(() => {
    const params = new URLSearchParams();
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (context.propertySlug) params.set("unit", context.propertySlug);
    if (context.guests) params.set("guests", String(context.guests));

    const query = params.toString();
    return localizeHref(`/booking${query ? `?${query}` : ""}`, locale);
  }, [checkIn, checkOut, context.guests, context.propertySlug, locale]);

  function openBooking() {
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

      {staySummary && quote ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/20 bg-gold/10 px-3 py-2 text-xs text-slate-800 dark:text-slate-100">
          <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-gold" />
            <span className="truncate">{staySummary}</span>
          </span>
          <span className="font-bold text-navy dark:text-gold">
            {chatT("bookingCardDirectTotal", {
              total: moneyFormatter.format(quote.directTotal),
            })}
          </span>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="chat-booking-check-in" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {bookingT("checkIn")}
          </Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="chat-booking-check-in"
              type="date"
              min={today}
              value={checkIn}
              onChange={(event) => {
                setCheckIn(event.target.value);
                setError("");
              }}
              className="h-10 rounded-xl pl-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="chat-booking-check-out" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {bookingT("checkOut")}
          </Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="chat-booking-check-out"
              type="date"
              min={checkoutMin}
              value={checkOut}
              onChange={(event) => {
                setCheckOut(event.target.value);
                setError("");
              }}
              className="h-10 rounded-xl pl-9 text-sm"
            />
          </div>
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
