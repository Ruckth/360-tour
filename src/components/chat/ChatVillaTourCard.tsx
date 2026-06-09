"use client";

import { useRouter } from "next/navigation";
import { ChevronsRight, ExternalLink, Globe2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  getChatVillaBackground,
  getDemoChatProperties,
  getLiveChatProperties,
} from "@/components/chat/chat-villa-data";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import type { BookingProperty } from "@/lib/booking/booking";
import { resort } from "@/lib/data/resort-config";
import { useOptionalConvex } from "@/lib/react/convex";
import { listLiveProperties } from "@/lib/react/convex-api";

export function ChatVillaTourCard({ propertySlug }: { propertySlug?: string }) {
  const chatT = useTranslations("Chat");
  const bookingT = useTranslations("Booking");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const router = useRouter();
  const fallbackProperties = useMemo(() => getDemoChatProperties(locale), [locale]);
  const convex = useOptionalConvex();
  const [properties, setProperties] = useState<BookingProperty[]>(() => fallbackProperties);

  useEffect(() => {
    if (!convex) {
      setProperties(fallbackProperties);
      return;
    }

    const client = convex;
    let active = true;

    async function loadProperties() {
      try {
        const rows = await listLiveProperties(client);
        if (!active) return;
        const liveProperties = getLiveChatProperties(rows, locale);
        setProperties(liveProperties.length > 0 ? liveProperties : fallbackProperties);
      } catch {
        if (active) setProperties(fallbackProperties);
      }
    }

    loadProperties();
    return () => {
      active = false;
    };
  }, [convex, fallbackProperties, locale]);

  const orderedProperties = useMemo(() => {
    if (!propertySlug) return properties;
    const selectedIndex = properties.findIndex(
      (item) => item.slug === propertySlug || item.id === propertySlug,
    );
    if (selectedIndex <= 0) return properties;
    const selected = properties[selectedIndex];
    return selected ? [selected, ...properties.filter((_, index) => index !== selectedIndex)] : properties;
  }, [properties, propertySlug]);

  return (
    <div
      data-testid="chat-tour-card"
      className="mt-2 w-full rounded-2xl border border-sky-400/30 bg-[linear-gradient(180deg,rgba(56,189,248,0.12),rgba(255,255,255,0)_44%)] p-3 shadow-sm shadow-black/5 dark:border-sky-300/25 dark:bg-[linear-gradient(180deg,rgba(56,189,248,0.14),rgba(15,23,42,0)_50%)]"
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-sky-500 dark:text-sky-300"
        >
          <Globe2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{chatT("tourCardTitle")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {chatT("tourCardHelper")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {chatT("tourCardVillaLabel")}
          </Label>
          <span
            data-testid="chat-tour-swipe-hint"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground sm:hidden"
          >
            {chatT("bookingCardSwipeHint")}
            <ChevronsRight className="h-3 w-3" aria-hidden="true" />
          </span>
        </div>
        <div
          data-testid="chat-tour-villa-selector"
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={chatT("tourCardVillaLabel")}
        >
          {orderedProperties.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`chat-tour-villa-option-${item.id}`}
              onClick={() => router.push(localizeHref(`/rooms/${item.slug || item.id}`, locale))}
              className="group min-w-[72%] snap-start rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-sky-300/25 sm:min-w-[32%]"
            >
              <Card className="pointer-events-none relative h-full min-h-[11.25rem] overflow-hidden rounded-xl border-white/15 bg-background/80 p-0 transition group-hover:border-sky-300/70">
                <PropertyImage
                  src={getChatVillaBackground(item)}
                  images={item.images}
                  fallbackImages={[resort.heroImage]}
                  alt=""
                  sizes="(min-width: 640px) 16rem, 72vw"
                  className="absolute inset-0 h-full w-full bg-slate-950"
                  imgClassName="scale-105 brightness-105 transition duration-700 group-hover:scale-110 group-hover:brightness-110"
                />
                <div
                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.12),rgba(2,6,23,0.36)_58%,rgba(2,6,23,0.68))]"
                  aria-hidden="true"
                />
                <div className="relative z-10 flex h-full min-h-[11.25rem] flex-col justify-between p-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm font-semibold leading-tight text-white">
                        {item.name}
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-sky-200" aria-hidden="true" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/75">
                      {item.tagline}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-col items-start gap-1.5">
                    <Badge className="rounded-full border border-white/10 bg-white/15 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {bookingT("upToGuests", { count: item.maxGuests })}
                    </Badge>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-300/90 px-2 py-1 text-[10px] font-bold text-slate-950 shadow-sm">
                      <Globe2 className="h-3 w-3" aria-hidden="true" />
                      {chatT("tourCardCta")}
                    </span>
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
