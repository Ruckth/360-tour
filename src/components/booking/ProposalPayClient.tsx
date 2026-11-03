"use client";

import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { localizeHref } from "@/i18n/routing";
import { formatPickerDate } from "@/lib/dates/format";
import { useOptionalConvex } from "@/lib/react/convex";

type Summary = NonNullable<
  FunctionReturnType<typeof api.bookings.getConfirmProposal>
>;

export function ProposalPayClient({ token }: { token: string }) {
  const convex = useOptionalConvex();
  const locale = useLocale();
  const t = useTranslations("Booking");
  const submitting = useRef(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setChecking(true);
    setSummary(null);
    setExpired(false);
    setError("");
    async function load() {
      try {
        if (!convex) throw new Error("unavailable");
        // Read only: unfurlers, reloads and opening the page never create a booking.
        const result = await convex.query(api.bookings.getConfirmProposal, {
          token,
        });
        if (!active) return;
        setSummary(result);
        setExpired(!result);
      } catch {
        if (active) setError(t("liveVerificationUnavailable"));
      } finally {
        if (active) setChecking(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [convex, token, t]);

  async function confirmAndPay() {
    if (!convex || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      const booking = await convex.mutation(api.bookings.confirmProposal, {
        token,
      });
      const checkout = await convex.action(api.payments.createCheckout, {
        bookingId: booking.bookingId,
        accessToken: booking.accessToken,
      });
      window.location.assign(checkout.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("summary has expired")) setExpired(true);
      else
        setError(
          t(
            message.includes("price changed")
              ? "summaryPriceChanged"
              : "paymentCouldNotConfirm",
          ),
        );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-xl">
        <CreditCard className="h-8 w-8 text-gold" />
        <h1 className="mt-5 font-serif text-3xl font-semibold">
          {t("confirmAndPay")}
        </h1>
        {checking ? (
          <p className="mt-4" role="status">
            {t("verifying")}
          </p>
        ) : expired ? (
          <p className="mt-4" role="status">
            {t("summaryExpired")}
          </p>
        ) : summary ? (
          <div className="mt-5 space-y-4">
            <h2 className="text-xl font-semibold">{summary.property}</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>{t("checkIn")}</dt>
              <dd>{formatPickerDate(summary.checkIn, locale)}</dd>
              <dt>{t("checkOut")}</dt>
              <dd>{formatPickerDate(summary.checkOut, locale)}</dd>
              <dt>{t("guests")}</dt>
              <dd>{summary.guests}</dd>
              <dt>{t("total")}</dt>
              <dd>
                {summary.currency} {summary.total.toLocaleString(locale)}
              </dd>
            </dl>
            {summary.cancellationPolicy ? (
              <div className="text-sm">
                <h3 className="font-semibold">{t("cancellationPolicy")}</h3>
                <p className="whitespace-pre-line">
                  {summary.cancellationPolicy}
                </p>
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {summary.holdExpiresAt
                ? t("holdUntil", { time: new Date(summary.holdExpiresAt).toLocaleString(locale) })
                : t("holdAfterConfirm", { minutes: summary.unpaidHoldMinutes })}
            </p>
            <Button
              className="w-full"
              disabled={loading}
              onClick={confirmAndPay}
            >
              {t(loading ? "confirming" : "confirmAndPay")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Link
          className="mt-5 block text-center text-sm text-muted-foreground"
          href={localizeHref("/booking", locale)}
        >
          {t("backToBooking")}
        </Link>
      </div>
    </div>
  );
}
