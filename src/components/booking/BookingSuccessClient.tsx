"use client";
import { api } from 'convex/_generated/api';
import { ConvexError } from 'convex/values';

import Link from "@/platform/link";
import { CheckCircle2, CircleAlert, Clock, Loader2, RotateCw } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import { useEffect, useState } from "react";
import { BookedPrice } from "@/components/booking/BookedPrice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { type PublicBooking } from '@/lib/booking/backend-types';
import { resort } from "@/lib/data/resort-config";
import { formatPickerDate } from "@/lib/dates/format";

import { useConvex } from 'convex/react';

/** How long one verification run polls before handing control back to the guest. */
export const SUCCESS_POLL_ATTEMPTS = 10;
export const SUCCESS_POLL_INTERVAL_MS = 2000;

/**
 * verifying: polling for the Stripe webhook. confirmed/cancelled: terminal booking states.
 * pending: polling ran out while payment is still unconfirmed, so the guest may Check again.
 * invalid: the link cannot be verified at all (missing/wrong token, unknown booking).
 */
type Phase = "verifying" | "confirmed" | "cancelled" | "pending" | "invalid";

/** `getById` refuses a wrong token with this ConvexError; older backends sent a plain Error. */
function accessDenied(err: unknown) {
  if (err instanceof ConvexError) return err.data === "Booking access denied";
  return err instanceof Error && /access denied/i.test(err.message);
}

export function BookingSuccessClient({
  bookingId,
  accessToken,
}: {
  bookingId: string;
  accessToken: string;
}) {
  const locale = useLocale();
  const t = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const convex = useConvex();
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [phase, setPhase] = useState<Phase>(accessToken ? "verifying" : "invalid");
  const [error, setError] = useState(accessToken ? "" : t("missingConfirmationToken"));
  // Each Check again starts one new polling run; the previous run is cancelled by its cleanup.
  const [run, setRun] = useState(0);
  // A different confirmation link starts over from its own verification.
  const link = `${bookingId}:${accessToken}`;
  const [shownLink, setShownLink] = useState(link);
  if (shownLink !== link) {
    setShownLink(link);
    setBooking(null);
    setPhase(accessToken ? "verifying" : "invalid");
    setError(accessToken ? "" : t("missingConfirmationToken"));
  }

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => new Promise<void>((resolve) => { timer = setTimeout(resolve, SUCCESS_POLL_INTERVAL_MS); });
    async function verifyBooking() {
      try {
        // Stripe can redirect before its webhook reaches Convex. Read only: never starts a payment.
        for (let attempt = 0; attempt < SUCCESS_POLL_ATTEMPTS; attempt++) {
          const result = await convex.query(api.bookings.bookings.getById, { id: bookingId, accessToken });
          if (!active) return;
          if (!result) {
            setError(t("bookingNotFound"));
            setPhase("invalid");
            return;
          }
          setBooking(result);
          setError("");
          if (result.status === "cancelled" || result.paymentStatus === "failed" || result.paymentStatus === "refunded") return setPhase("cancelled");
          if (result.paymentStatus === "paid" && result.status === "confirmed") return setPhase("confirmed");
          if (attempt < SUCCESS_POLL_ATTEMPTS - 1) await wait();
          if (!active) return;
        }
        setPhase("pending");
      } catch (err) {
        if (!active) return;
        const denied = accessDenied(err);
        setError(t("unableToVerify"));
        // A refused token is final; a network or server failure can be retried.
        setPhase(denied ? "invalid" : "pending");
      }
    }
    // The effect owns cancellation; failures are handled inside the operation.
    void verifyBooking();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessToken, bookingId, convex, t, run]);

  function checkAgain() {
    if (phase !== "pending") return;
    // The previous run's transient failure does not stay on screen while verifying again.
    setError("");
    setPhase("verifying");
    setRun((current) => current + 1);
  }

  const confirmed = phase === "confirmed";
  const verifying = phase === "verifying";
  const title = verifying
    ? t("verifyingBooking")
    : confirmed
      ? t("bookingConfirmed")
      : phase === "pending"
        ? t("paymentPendingTitle")
        : t("bookingNotConfirmed");
  const copy = verifying
    ? t("verifyingCopy")
    : confirmed
      ? t("confirmedCopy")
      : phase === "pending"
        ? t("paymentPendingCopy")
        : t("notConfirmedCopy");

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div data-testid="booking-success" data-phase={phase} className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
          {verifying ? (
            <Loader2 className="h-7 w-7 animate-spin text-gold motion-reduce:animate-none" aria-hidden="true" />
          ) : confirmed ? (
            <CheckCircle2 className="h-7 w-7 text-gold" aria-hidden="true" />
          ) : phase === "pending" ? (
            <Clock className="h-7 w-7 text-gold" aria-hidden="true" />
          ) : (
            <CircleAlert className="h-7 w-7 text-gold" aria-hidden="true" />
          )}
        </div>
        <div role="status" aria-live="polite">
          <h1 className="mt-5 font-serif text-3xl font-semibold text-foreground">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy}</p>
        </div>
        {booking && !verifying ? (
          <div className="mt-4 space-y-1 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            <p>{t("reference", { reference: booking.confirmationCode ?? bookingId })}</p>
            {booking.propertyName ? <p className="font-semibold text-foreground">{booking.propertyName}</p> : null}
            <p>{formatPickerDate(booking.checkIn, locale)} – {formatPickerDate(booking.checkOut, locale)}</p>
          </div>
        ) : null}
        {booking && !verifying ? <BookedPrice booking={booking} showSaving={confirmed} className="mt-4" /> : null}
        {error ? (
          <Alert variant="destructive" className="mt-4 text-left">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 grid gap-3">
          {phase === "pending" ? (
            <Button type="button" onClick={checkAgain}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t("checkAgain")}
            </Button>
          ) : null}
          <Button asChild variant={phase === "pending" ? "outline" : undefined}>
            <Link href={localizeHref("/", locale)}>{t("returnHome")}</Link>
          </Button>
          {booking && !verifying ? (
            <Button asChild variant="ghost" className="min-h-11">
              <a href={`mailto:${resort.contactEmail}`}>{navT("contact")}</a>
            </Button>
          ) : null}
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
