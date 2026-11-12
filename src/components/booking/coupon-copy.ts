"use client";

import { satangToBaht } from 'convex/shared/money';

import type { CouponProblem } from "convex/lib/offers";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { couponProblemMessage, type CouponFormatters, type CouponMessage } from "@/lib/booking/coupon";
import { currencyPrefix } from "@/lib/villas";

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Guest coupon copy in the active locale: money, dates and the translated problem sentences. */
export function useCouponCopy(currency: string) {
  const locale = useLocale();
  const t = useTranslations("Coupon");
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const format: CouponFormatters = {
      money: (amount) => `${currencyPrefix(currency)}${satangToBaht(amount).toLocaleString()}`,
      date: (iso) => day.format(toDate(iso)),
      range: (from, to) =>
        typeof day.formatRange === "function" ? day.formatRange(toDate(from), toDate(to)) : `${day.format(toDate(from))} – ${day.format(toDate(to))}`,
    };
    const text = (message: CouponMessage) => t(message.key, message.values);
    return {
      format,
      text,
      problemText: (problem: CouponProblem) => text(couponProblemMessage(problem, format)),
    };
  }, [currency, locale, t]);
}
