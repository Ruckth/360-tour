"use client";
import { api } from 'convex/_generated/api';

import type { ConvexReactClient } from "convex/react";
import type { OfferResult } from "convex/shared/offers";
import { useCallback, useEffect, useState } from "react";
import { useCouponRefusalReporter } from '@/lib/booking/coupon-refusals';

export type CouponStay = { propertySlug: string; checkIn: string; checkOut: string };

export type CouponPreview =
  /** No code, or no live stay to price it on yet. */
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error" }
  | { status: "ready"; result: OfferResult };

type Answer = { key: string; result?: OfferResult; failed?: boolean };

/**
 * Live guest quote for `code` on `stay` (marketing.previewCoupon). It re-asks whenever the code,
 * villa or dates change, and an answer for anything else is never shown, so the price can't
 * come from an older stay.
 */
export function useCouponPreview(
  client: ConvexReactClient,
  code: string | null,
  stay: CouponStay | null,
): { preview: CouponPreview; retry: () => void; /** For a refusal that only shows when booking; shares this hook's once-per-page count. */ reportRefusal: (code: string, problem: unknown) => void } {
  const reportRefusal = useCouponRefusalReporter("booking");
  const key = code && stay ? JSON.stringify([code, stay.propertySlug, stay.checkIn, stay.checkOut]) : "";
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key || !code || !stay) return;
    let active = true;
    // A short pause so stepping through dates doesn't send a query per click.
    const timer = setTimeout(() => {
      client.query(api.marketing.public.previewCoupon, { code, propertySlug: stay.propertySlug, checkIn: stay.checkIn, checkOut: stay.checkOut })
        .then((result) => {
          if (active) {
            setAnswer({ key, result });
            reportRefusal(code, result.problem?.code ?? (result.couponStatus === "coupon_worse" ? "coupon_worse" : undefined));
          }
        })
        .catch(() => {
          if (active) setAnswer({ key, failed: true });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `key` covers code and stay; `attempt` re-runs a failed check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client, attempt, reportRefusal]);

  const retry = useCallback(() => {
    setAnswer(null);
    setAttempt((current) => current + 1);
  }, []);

  if (!key) return { preview: { status: "idle" }, retry, reportRefusal };
  if (!answer || answer.key !== key) return { preview: { status: "checking" }, retry, reportRefusal };
  if (answer.failed || !answer.result) return { preview: { status: "error" }, retry, reportRefusal };
  return { preview: { status: "ready", result: answer.result }, retry, reportRefusal };
}
