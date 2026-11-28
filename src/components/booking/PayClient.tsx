"use client";
import { api } from 'convex/_generated/api';

import { satangToBaht } from 'convex/shared/money';

import Link from "@/platform/link";
import { useRouter } from "@/platform/navigation";
import { CalendarDays, CreditCard, Home, ShieldCheck, Users } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import { useEffect, useState } from "react";
import { BookedPrice } from "@/components/booking/BookedPrice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { formatPickerDate } from "@/lib/dates/format";
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
  const chatT = useTranslations("Chat");
  const villaT = useTranslations("Villa");
  const convex = useConvex();
  const successHref = localizeHref(
    `/booking/success?bookingId=${encodeURIComponent(bookingId)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ""}`,
    locale,
  );
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(Boolean(accessToken));
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [checkRun, setCheckRun] = useState(0);
  const [error, setError] = useState(accessToken ? "" : t("missingToken"));
  // A different payment link never shows the previous stay while its own access is checked.
  const link = `${bookingId}:${accessToken}`;
  const [shownLink, setShownLink] = useState(link);
  if (shownLink !== link) {
    setShownLink(link);
    setBooking(null);
    setChecking(Boolean(accessToken));
    setNeedsStatusCheck(false);
    setError(accessToken ? "" : t("missingToken"));
  }

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    async function loadBooking() {
      try {
        const result = await convex.query(api.bookings.bookings.getById, { id: bookingId, accessToken });
        if (!active) return;
        setBooking(result);
        setNeedsStatusCheck(false);
        setError(result ? "" : t("bookingNotFound"));
      } catch {
        if (!active) return;
        // A refused token or an outage: either way nothing about the stay is shown.
        setBooking(null);
        setError(t("unableToVerify"));
      } finally {
        if (active) setChecking(false);
      }
    }
    // The effect owns cancellation; failures are handled inside the operation.
    void loadBooking();
    return () => {
      active = false;
    };
  }, [accessToken, bookingId, convex, t, checkRun]);

  useEffect(() => {
    router.prefetch(successHref);
  }, [router, successHref]);

  const payable = booking?.payState === "payable";
  const payStateNotice = booking && !payable
    ? t(booking.payState === "settled" ? "paySettled" : booking.payState === "expired" ? "payHoldExpired" : "payClosed")
    : "";

  async function confirmPayment() {
    // Checkout starts only for a verified stay with a balance still due online.
    if (!payable || loading || checking || needsStatusCheck) return;
    setLoading(true);
    setError("");
    try {
      const checkout = await convex.action(api.bookings.payments.stripe.createCheckout, { bookingId: booking._id, accessToken });
      window.location.assign(checkout.url);
    } catch {
      // The response can be lost after checkout starts. Read the booking before offering Pay again.
      setNeedsStatusCheck(true);
      setError(t("paymentCouldNotConfirm"));
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
        {payable ? (
          <p data-testid="pay-amount-due" className="mt-4 rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-sm font-semibold text-foreground">
            {t("amountDueNow", { amount: `${currencyPrefix(booking.currency)}${satangToBaht(booking.amountDue).toLocaleString()}` })}
          </p>
        ) : null}
        {booking ? (
          // Shown only after the access token is verified; the summary never carries guest identifiers.
          <ul data-testid="pay-stay-summary" aria-label={t("staySummary")} className="mt-5 space-y-2 rounded-xl border border-border p-4 text-sm">
            <li data-testid="pay-stay-villa" className="flex items-start gap-3 font-semibold text-foreground">
              <Home className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <span className="min-w-0 break-words">{booking.propertyName ?? t("villaFallback")}</span>
            </li>
            <li data-testid="pay-stay-dates" className="flex items-start gap-3 text-muted-foreground">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <span>
                {formatPickerDate(booking.checkIn, locale)} – {formatPickerDate(booking.checkOut, locale)} · {chatT("bookingCardNights", { count: booking.nights })}
              </span>
            </li>
            <li data-testid="pay-stay-guests" className="flex items-start gap-3 text-muted-foreground">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <span>{villaT("guests", { count: booking.guests })}</span>
            </li>
          </ul>
        ) : null}
        {booking?.confirmationCode ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
            {t("reference", { reference: booking.confirmationCode })}
          </div>
        ) : null}
        {booking ? <BookedPrice booking={booking} className="mt-3" /> : null}
        {payable && quotedTotal !== null && booking.total !== quotedTotal ? (
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
        {payStateNotice ? (
          <Alert data-testid="pay-state" data-state={booking?.payState} className="mt-4">
            <AlertDescription>{payStateNotice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 grid gap-3">
          {booking?.payState === "settled" ? (
            <Button asChild>
              <Link href={successHref}>{t("viewConfirmation")}</Link>
            </Button>
          ) : needsStatusCheck ? (
            <Button
              type="button"
              disabled={checking}
              onClick={() => {
                setChecking(true);
                setError("");
                setCheckRun((current) => current + 1);
              }}
            >
              {checking ? t("verifying") : t("checkAgain")}
            </Button>
          ) : booking && !payable ? null : (
            <Button
              onClick={confirmPayment}
              disabled={loading || checking || !payable}
            >
              {checking
                ? t("verifying")
                : loading
                  ? t("confirming")
                  : t("pay")}
            </Button>
          )}
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
