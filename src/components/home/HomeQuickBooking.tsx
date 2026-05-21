"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { todayIsoLocal } from "@/lib/booking/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function HomeQuickBooking() {
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const router = useRouter();
  const today = todayIsoLocal();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [error, setError] = useState("");

  function submitQuickBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!checkIn || !checkOut) {
      setError(bookingT("chooseDates"));
      return;
    }

    if (checkOut <= checkIn) {
      setError(bookingT("checkoutAfterCheckin"));
      return;
    }

    const params = new URLSearchParams({ checkin: checkIn, checkout: checkOut });
    router.push(localizeHref(`/booking?${params.toString()}`, locale));
  }

  return (
    <section className="relative z-20 bg-background px-5 pb-8 pt-4 md:px-8 md:py-8">
      <form
        onSubmit={submitQuickBooking}
        className="mx-auto grid max-w-5xl gap-3 rounded-2xl border border-border bg-card p-4 shadow-xl shadow-black/10 md:grid-cols-[1fr_1fr_auto] md:items-end md:rounded-xl md:p-5"
        aria-label={bookingT("directBooking")}
      >
        <div className="space-y-2">
          <Label htmlFor="home-check-in" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {bookingT("checkIn")}
          </Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="home-check-in"
              type="date"
              min={today}
              value={checkIn}
              onChange={(event) => {
                setCheckIn(event.target.value);
                setError("");
              }}
              className="h-12 rounded-xl pl-10 text-base md:h-11 md:text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="home-check-out" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {bookingT("checkOut")}
          </Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="home-check-out"
              type="date"
              min={checkIn || today}
              value={checkOut}
              onChange={(event) => {
                setCheckOut(event.target.value);
                setError("");
              }}
              className="h-12 rounded-xl pl-10 text-base md:h-11 md:text-sm"
            />
          </div>
        </div>

        <Button type="submit" variant="gold" className="h-12 rounded-xl px-8 md:h-11">
          {navT("book")}
        </Button>

        {error ? (
          <p className="text-sm font-medium text-destructive md:col-span-3" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
