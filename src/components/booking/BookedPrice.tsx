"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { PriceLines } from "@/components/booking/BookingPriceSummary";
import { bookedPriceView } from "@/lib/booking/coupon";
import type { PublicBooking } from "@/lib/react/convex-api";
import { cn } from "@/lib/utils";
import { currencyPrefix } from "@/lib/villas";

/**
 * A booked stay's price on the pay and success pages, from the booking record itself: the stay
 * price, the coupon line when it was priced with one (otherwise the direct discount) and the total.
 * A custom price shows only the stay price and the agreed price.
 */
export function BookedPrice({ booking, showSaving = false, className }: { booking: PublicBooking; showSaving?: boolean; className?: string }) {
  const t = useTranslations("Coupon");
  if (booking.subtotal === undefined) return null;
  const view = bookedPriceView(booking);
  const money = (amount: number) => `${currencyPrefix(booking.currency)}${amount.toLocaleString()}`;
  return (
    <div className={cn("grid gap-3", className)}>
      <div data-testid="booked-price" className="rounded-xl border border-border p-4 text-left text-sm text-muted-foreground">
        <PriceLines
          currency={booking.currency}
          priceLabel={t("stayPrice")}
          subtotal={booking.subtotal}
          lines={view.lines}
          total={booking.total}
          totalLabel={view.totalLabel === "agreedPrice" ? t("agreedPrice") : undefined}
        />
      </div>
      {showSaving && view.saving ? (
        <p className="flex items-center gap-2 rounded-xl bg-gold/10 px-3 py-2.5 text-left text-sm font-semibold text-foreground">
          <Sparkles aria-hidden className="size-4 shrink-0 text-gold-text" />
          {t("youSaved", { amount: money(view.saving.amount), code: view.saving.code })}
        </p>
      ) : null}
    </div>
  );
}
