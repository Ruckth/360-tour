"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { dateToIso, todayIsoLocal } from "@/lib/booking/dates";
import { LiquidMetalBookButton } from "@/components/home/LiquidMetalBookButton";

const BookingRangePicker = dynamic(
  () => import("@/components/booking/BookingDatePicker").then((mod) => mod.BookingRangePicker),
  {
    ssr: false,
    loading: () => <QuickBookingDateSkeleton />,
  },
);

function QuickBookingDateSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="h-12 animate-pulse rounded-lg bg-muted" />
      <div className="h-12 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function HomeQuickBooking() {
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const router = useRouter();
  const today = todayIsoLocal();
  const bookingHref = localizeHref("/booking", locale);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [error, setError] = useState("");

  function prefetchBooking() {
    router.prefetch(bookingHref);
  }

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
    <section className="relative z-20 px-5 pb-0 pt-4 md:px-8 md:pb-0 md:pt-6">
      <form
        onSubmit={submitQuickBooking}
        onFocusCapture={prefetchBooking}
        onPointerEnter={prefetchBooking}
        data-testid="home-quick-booking-form"
        className="mx-auto grid max-w-5xl gap-3 md:grid-cols-[1fr_auto] md:items-end"
        aria-label={bookingT("directBooking")}
      >
        <BookingRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onChange={(range) => {
            setCheckIn(range.checkIn);
            setCheckOut(range.checkOut);
            setError("");
            prefetchBooking();
          }}
          isDateDisabled={(date) => dateToIso(date) < today}
          onRangeChange={() => setError("")}
        />

        <LiquidMetalBookButton type="submit">
          {navT("book")}
        </LiquidMetalBookButton>

        {error ? (
          <p className="text-sm font-medium text-destructive md:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
