"use client";
import type { Id } from 'convex/_generated/dataModel';
import { api } from 'convex/_generated/api';

import { satangToBaht } from 'convex/shared/money';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BookedPrice } from "@/components/booking/BookedPrice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { type PublicBooking } from '@/lib/booking/backend-types';

import { useConvex } from 'convex/react';
import { currencyPrefix } from "@/lib/villas";

export function PayClient({
  bookingId = "",
  accessToken = "",
  quotedTotal = null,
}: {
  bookingId?: string;
  accessToken?: string;
  /** The total the funnel showed before creating the booking (`?quoted=`). */
  quotedTotal?: number | null;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Booking");
  const couponT = useTranslations("Coupon");
  const convex = useConvex();
  const successHref = localizeHref(
    `/booking/success?bookingId=${encodeURIComponent(bookingId)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ""}`,
    locale,
  );
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadBooking() {
      if (!accessToken) {
        setError(t("missingToken"));
        setChecking(false);
        return;
      }
      setChecking(true);
      try {
        const result = await convex.query(api.bookings.bookings.getById, {
          id: bookingId as Id<"bookings">,
          accessToken,
        });
        if (!active) return;
        if (!result) {
          setError(t("bookingNotFound"));
        } else {
          setBooking(result);
          setError("");
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : t("unableToVerify"));
      } finally {
        if (active) setChecking(false);
      }
    }
    // The effect owns cancellation; failures are handled inside the operation.
    void loadBooking();
    return () => {
      active = false;
    };
  }, [accessToken, bookingId, convex, t]);

  useEffect(() => {
    router.prefetch(successHref);
  }, [router, successHref]);

  async function confirmPayment() {
    setLoading(true);
    setError("");
    try {
      const checkout = await convex.action(api.bookings.payments.stripe.createCheckout, { bookingId: bookingId as Id<'bookings'>, accessToken });
      window.location.assign(checkout.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("paymentCouldNotConfirm"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
          <CreditCard className="h-6 w-6 text-gold" />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold text-foreground">
          {t("confirmPayment")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("livePaymentCopy")}
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-gold" />
          {t("bookingId", { bookingId })}
        </div>
        {booking && booking.subtotal !== undefined ? (
          <BookedPrice booking={booking} className="mt-3" />
        ) : booking ? (
          <div className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("bookingTotalStatus", {
              currency: booking.currency,
              total: satangToBaht(booking.total).toLocaleString(),
              status: booking.paymentStatus,
            })}
          </div>
        ) : null}
        {booking && quotedTotal !== null && booking.total !== quotedTotal ? (
          <Alert variant="warning" className="mt-3">
            <AlertDescription>
              {couponT("totalChanged", { total: `${currencyPrefix(booking.currency)}${satangToBaht(booking.total).toLocaleString()}` })}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 grid gap-3">
          <Button
            onClick={confirmPayment}
            disabled={loading || checking || !booking}
          >
            {checking
              ? t("verifying")
              : loading
                ? t("confirming")
                : t("pay")}
          </Button>
          <Link
            href={localizeHref("/booking", locale)}
            className="text-center text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            {t("backToBooking")}
          </Link>
        </div>
      </div>
    </div>
  );
}
