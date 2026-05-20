"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { getPublicBooking, type PublicBooking } from "@/lib/react/convex-api";
import { useOptionalConvex } from "@/lib/react/convex";

export function PayClient({
  bookingId = "demo",
  accessToken = "",
}: {
  bookingId?: string;
  accessToken?: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Booking");
  const convex = useOptionalConvex();
  const isDemo = bookingId === "demo";
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(Boolean(convex && !isDemo));
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadBooking() {
      if (isDemo) {
        setChecking(false);
        return;
      }
      if (!convex) {
        setError(t("liveVerificationUnavailable"));
        setChecking(false);
        return;
      }
      if (!accessToken) {
        setError(t("missingToken"));
        setChecking(false);
        return;
      }
      setChecking(true);
      try {
        const result = await getPublicBooking(convex, {
          id: bookingId,
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
    loadBooking();
    return () => {
      active = false;
    };
  }, [accessToken, bookingId, convex, isDemo, t]);

  async function confirmPayment() {
    setLoading(true);
    setError("");
    try {
      if (!isDemo) {
        throw new Error(t("secureCheckoutOnly"));
      }
      const tokenParam = accessToken ? `&token=${encodeURIComponent(accessToken)}` : "";
      router.push(
        localizeHref(`/booking/success?bookingId=${encodeURIComponent(bookingId)}${tokenParam}`, locale),
      );
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
          {isDemo ? t("confirmDemoPayment") : t("confirmPayment")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isDemo
            ? t("demoPaymentCopy")
            : t("livePaymentCopy")}
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-gold" />
          {t("bookingId", { bookingId })}
        </div>
        {booking ? (
          <div className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("bookingTotalStatus", {
              currency: booking.currency,
              total: booking.total.toLocaleString(),
              status: booking.paymentStatus,
            })}
          </div>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 grid gap-3">
          <Button
            onClick={confirmPayment}
            disabled={!isDemo || loading || checking || Boolean(error && !isDemo)}
          >
            {checking
              ? t("verifying")
              : loading
                ? t("confirming")
                : isDemo
                  ? t("confirmDemoPaymentCta")
                  : t("awaitSecureCheckout")}
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
