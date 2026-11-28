"use client";

import { Star } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import { cn } from "@/lib/utils";

export function StarRating({
  rating,
  reviewCount,
  size = "sm",
  showValue = false,
}: {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  showValue?: boolean;
}) {
  const a11y = useTranslations("A11y");
  const iconClass = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const locale = useLocale();
  const formattedRating = rating.toLocaleString(locale, {
    minimumFractionDigits: showValue ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const label = a11y("ratingOutOfFive", { rating: formattedRating });

  return (
    <div
      className="flex items-center gap-2"
      role={!showValue ? "img" : undefined}
      aria-label={!showValue ? label : undefined}
    >
      <div className="flex items-center gap-0.5 text-gold" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={index}
            aria-hidden="true"
            className={cn(iconClass, index < Math.round(rating) && "fill-current")}
          />
        ))}
      </div>
      {showValue ? (
        <span className="text-xs font-medium text-muted-foreground md:text-sm">
          <span className="sr-only">{label}</span>
          <span aria-hidden="true">{formattedRating}</span>
          {reviewCount ? ` (${reviewCount})` : ""}
        </span>
      ) : null}
    </div>
  );
}
