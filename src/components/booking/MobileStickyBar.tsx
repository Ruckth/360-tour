"use client";

import { satangToBaht } from "convex/shared/money";
import { calculateDirectQuote } from "convex/shared/pricing";
import Link from "@/platform/link";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "@/platform/intl";
import { usePathname, useSearchParams } from "@/platform/navigation";
import { useOtaComparison } from "@/components/pricing/OtaRateComparison";
import { localizeHref } from "@/i18n/routing";
import { buildChatHref } from "@/lib/chat/navigation";
import { registerGuestBottomControl } from "@/lib/guest-bottom-inset";
import { currencyPrefix } from "@/lib/villas";

export function MobileStickyBar({
  propertyId,
  pricePerNight,
  directDiscountPercent = 0,
  currency = "THB",
}: {
  propertyId: string;
  pricePerNight?: number;
  directDiscountPercent?: number;
  currency?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("Nav");
  const villaT = useTranslations("Villa");
  const chatT = useTranslations("Chat");
  const comparison = useOtaComparison(propertyId);
  const effectivePrice = comparison?.pricePerNight ?? pricePerNight;
  const effectiveDiscount = comparison?.directDiscountPercent ?? directDiscountPercent;
  const effectiveCurrency = comparison?.currency ?? currency;
  const directRate =
    effectivePrice !== undefined
      ? calculateDirectQuote(
          {
            pricePerNight: effectivePrice,
            directDiscountPercent: effectiveDiscount,
            currency: effectiveCurrency,
          },
          1,
        ).directTotal
      : null;

  const chatHref = buildChatHref({
    locale,
    pathname,
    propertySlug: propertyId,
    search: searchParams,
  });

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    return registerGuestBottomControl("mobile-sticky-bar", el, { fallbackPx: 88 });
  }, []);

  return (
    <div
      ref={barRef}
      className="fixed inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-40 md:hidden"
    >
      <div className="mx-auto flex max-w-sm translate-y-1 items-center gap-2 rounded-full border border-border/80 bg-background/90 p-2 shadow-2xl shadow-black/25 backdrop-blur-xl transition-transform duration-300 focus-within:translate-y-0 hover:translate-y-0 dark:bg-card/90">
        {directRate !== null ? (
          <div
            data-testid="mobile-sticky-rate"
            className="shrink-0 pl-2 pr-1 text-left leading-tight"
          >
            <p className="text-sm font-bold tabular-nums text-foreground">
              {currencyPrefix(effectiveCurrency)}
              {satangToBaht(directRate).toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground">{villaT("perNight")}</p>
          </div>
        ) : null}
        <Link
          href={localizeHref(`/booking?unit=${propertyId}`, locale)}
          className="flex h-12 min-w-0 flex-1 items-center justify-center truncate rounded-full bg-gold px-4 text-sm font-semibold text-navy shadow-lg shadow-gold/20 transition hover:bg-gold-light"
        >
          <span className="truncate">{t("book")}</span>
        </Link>
        <Link
          href={chatHref}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={chatT("open")}
        >
          <MessageCircle className="h-5 w-5" />
        </Link>
      </div>
    </div>
  );
}
