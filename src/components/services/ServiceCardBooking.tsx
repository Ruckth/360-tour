"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { localizeHref, type Locale } from "@/i18n/routing";
import type { PublicMessages } from "@/lib/i18n/public-content";
import { durationList, serviceOption, serviceOptions, type ServiceOption } from "@/lib/service-options";
import { currencyPrefix } from "@/lib/villas";
import { satangToBaht } from "convex/shared/money";
import { DurationChoice } from "./DurationChoice";

type CardService = { slug: string; name: string; durationMin: number; price: number; currency: string; options?: ServiceOption[] };

/**
 * A service card's length, price and "Ask" link. With several lengths, chips pick one and each chip
 * shows its own price once; the link carries the chosen length to chat (`&duration=90`).
 */
export function ServiceCardBooking({ service, locale, t }: { service: CardService; locale: Locale; t: PublicMessages["ServiceCatalog"] }) {
  const options = serviceOptions(service);
  const defaultDuration = serviceOption(service).durationMin;
  const [durationMin, setDurationMin] = useState(defaultDuration);
  const chosen = serviceOption(service, durationMin);
  const money = (amount: number) =>
    `${currencyPrefix(service.currency)}${satangToBaht(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  const multiple = options.length > 1;
  return (
    <>
      {multiple ? <p className="text-sm">{t.defaultDuration.replace("{duration}", `${defaultDuration} ${t.minutes}`)}</p> : null}
      {multiple ? (
        <DurationChoice
          legend={t.chooseDuration}
          options={options}
          value={chosen.durationMin}
          onChange={setDurationMin}
          formatPrice={money}
          unit={t.minutes}
        />
      ) : (
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span>{durationList(service, t.minutes)}</span>
          <span className="text-lg font-semibold tabular-nums">{money(chosen.price)}</span>
        </p>
      )}
      <ButtonLink
        href={localizeHref(
          `/chat?service=${encodeURIComponent(service.slug)}${multiple ? `&duration=${chosen.durationMin}` : ""}`,
          locale,
        )}
        variant="outline"
      >
        {t.ask}
      </ButtonLink>
    </>
  );
}
