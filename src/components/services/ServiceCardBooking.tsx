"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { localizeHref, type Locale } from "@/i18n/routing";
import type { PublicMessages } from "@/lib/i18n/public-content";
import { durationList, priceFrom, serviceOption, serviceOptions, type ServiceOption } from "@/lib/service-options";
import { DurationChoice } from "./DurationChoice";

type CardService = { slug: string; name: string; durationMin: number; price: number; currency: string; options?: ServiceOption[] };

/**
 * A service card's length, price and "Ask" link. With several lengths, chips pick one: the price
 * follows it and the link carries it to chat (`&duration=90`).
 */
export function ServiceCardBooking({ service, locale, t }: { service: CardService; locale: Locale; t: PublicMessages["ServiceCatalog"] }) {
  const options = serviceOptions(service);
  const [durationMin, setDurationMin] = useState(() => serviceOption(service).durationMin);
  const chosen = serviceOption(service, durationMin);
  const money = (amount: number) =>
    `${service.currency} ${(amount / 100).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  const multiple = options.length > 1;
  return (
    <>
      <p className="text-sm">
        {durationList(service, t.minutes)}
        {multiple ? ` · ${priceFrom(service, money, (price) => t.fromPrice.replace("{price}", price))}` : null}
      </p>
      {multiple ? (
        <DurationChoice
          legend={t.chooseDuration}
          options={options}
          value={chosen.durationMin}
          onChange={setDurationMin}
          formatPrice={money}
          unit={t.minutes}
        />
      ) : null}
      <p className="text-lg font-semibold" aria-live={multiple ? "polite" : undefined}>
        {money(chosen.price)}
      </p>
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
