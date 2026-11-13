"use client";
import type { Id } from 'convex/_generated/dataModel';
import { api } from 'convex/_generated/api';

import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BookedPrice } from "@/components/booking/BookedPrice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { type PublicBooking } from '@/lib/booking/backend-types';

import { useConvex } from 'convex/react';

export function BookingSuccessClient({
  bookingId,
  accessToken,
}: {
  bookingId: string;
  accessToken: string;
}) {
  const locale = useLocale();
  const t = useTranslations("Booking");
  const convex = useConvex();
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function verifyBooking() {
      if (!accessToken) {
        setError(t("missingConfirmationToken"));
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Stripe can redirect before its webhook reaches Convex.
        for (let attempt = 0; attempt < 10 && active; attempt++) {
          const result = await convex.query(api.bookings.bookings.getById, { id: bookingId as Id<"bookings">, accessToken });
          if (!active) return;
          if (!result) { setError(t("bookingNotFound")); break; }
          setBooking(result);
          setError("");
          if (result.paymentStatus === "paid" || result.status === "cancelled") break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : t("unableToVerify"));
      } finally {
        if (active) setLoading(false);
      }
    }
    verifyBooking();
    return () => {
      active = false;
    };
  }, [accessToken, bookingId, convex, t]);

  const confirmed = (booking?.paymentStatus === "paid" && booking.status === "confirmed");

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
          {confirmed ? (
            <CheckCircle2 className="h-7 w-7 text-gold" />
          ) : (
            <CircleAlert className="h-7 w-7 text-gold" />
          )}
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold text-foreground">
          {loading ? t("verifyingBooking") : confirmed ? t("bookingConfirmed") : t("bookingNotConfirmed")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {confirmed
            ? t("confirmedCopy")
            : t("notConfirmedCopy")}
        </p>
        <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t("reference", { reference: booking?.confirmationCode ?? bookingId })}
        </p>
        {booking && !loading ? <BookedPrice booking={booking} showSaving={confirmed} className="mt-4" /> : null}
        {error ? (
          <Alert variant="destructive" className="mt-4 text-left">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 grid gap-3">
          <Button asChild>
            <Link href={localizeHref("/", locale)}>{t("returnHome")}</Link>
          </Button>
          <Link
            href={localizeHref("/#villas", locale)}
            className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            {t("exploreMoreVillas")}
          </Link>
        </div>
      </div>
    </div>
  );
}
