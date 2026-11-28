"use client";

import { useHydrated } from "@/platform/hydration";
import dynamic from "@/platform/dynamic";
import { MessageCircle } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import { usePathname, useRouter, useSearchParams } from "@/platform/navigation";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import type { BookingRangePickerHandle } from "@/components/booking/BookingDatePicker";
import { dateToIso } from '@/lib/booking/dates';
import { resortTodayIso as todayIsoResort } from 'convex/shared/time';
import { finishGuestPerformanceClock, startGuestPerformanceClock } from "@/lib/marketing/analytics";
import { HomeSolidBookButton } from "@/components/home/HomeSolidBookButton";
import { AnalyticsConsentChoice } from "@/components/global/AnalyticsConsent";
import { ButtonLink } from "@/components/ui/button";
import { buildChatHref } from "@/lib/chat/navigation";

const BookingRangePicker = dynamic(
  () => import("@/components/booking/LazyBookingRangePicker"),
  {
    ssr: false,
    loading: () => <QuickBookingDateSkeleton />,
  },
);

function QuickBookingDateSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="h-12 animate-pulse rounded-lg bg-muted" />
      <div className="h-12 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function HomeQuickBooking() {
  const hydrated = useHydrated();
  const bookingT = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const chatT = useTranslations("Chat");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const today = todayIsoResort();
  const bookingHref = localizeHref("/booking", locale);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [error, setError] = useState("");
  const pickerRef = useRef<BookingRangePickerHandle | null>(null);
  const bookRef = useRef<HTMLButtonElement>(null);
  const pendingOpenCheckIn = useRef(false);
  const calendarOpening = useRef<{
    clock: ReturnType<typeof startGuestPerformanceClock>;
    trigger: "check_in" | "check_out";
  } | null>(null);

  const handlePickerReady = useCallback(() => {
    if (!pendingOpenCheckIn.current || !pickerRef.current) return;
    pendingOpenCheckIn.current = false;
    pickerRef.current.openCheckIn();
  }, []);

  function prefetchBooking() {
    router.prefetch(bookingHref);
  }

  function submitQuickBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!checkIn && !checkOut) {
      setError("");
      if (pickerRef.current) {
        pickerRef.current.openCheckIn();
      } else {
        pendingOpenCheckIn.current = true;
      }
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
          joined
          pickerRef={pickerRef}
          onReady={handlePickerReady}
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
          onCalendarOpening={(field) => {
            calendarOpening.current = {
              clock: startGuestPerformanceClock(),
              trigger: field === "checkIn" ? "check_in" : "check_out",
            };
          }}
          onCalendarOpened={() => {
            const opening = calendarOpening.current;
            calendarOpening.current = null;
            if (opening) finishGuestPerformanceClock(opening.clock, { metric: "home_calendar_open", trigger: opening.trigger });
          }}
        />

        <div className="flex gap-2">
          <HomeSolidBookButton ref={bookRef} type="submit" disabled={!hydrated} className="min-w-0 flex-1">
            {navT("book")}
          </HomeSolidBookButton>
          <ButtonLink
            href={buildChatHref({ locale, pathname, search })}
            data-testid="chat-launcher-link"
            aria-label={chatT("open")}
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-xl md:hidden"
          >
            <MessageCircle className="size-5" aria-hidden="true" />
          </ButtonLink>
        </div>

        {error ? (
          <p className="text-sm font-medium text-destructive md:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <AnalyticsConsentChoice inline className="mx-auto mt-3 max-w-5xl" onDecision={() => bookRef.current?.focus()} />
    </section>
  );
}
