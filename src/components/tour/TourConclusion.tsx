"use client";

import { useRouter } from "next/navigation";
import { Check, Minus, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BookingDatePicker } from "@/components/booking/BookingDatePicker";
import { PropertyImage } from "@/components/property/PropertyImage";
import { Button } from "@/components/ui/button";
import { getConclusionForProperty } from "@/lib/data/tourflow";
import { dateToIso, nightsBetweenIso, todayIsoLocal } from "@/lib/booking/dates";
import type { Property } from "@/lib/data/properties";
import { localizeHref } from "@/i18n/routing";

export function TourConclusion({
  property,
  onClose,
  onLead,
}: {
  property: Property;
  onClose: () => void;
  onLead: () => void;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Booking");
  const navT = useTranslations("Nav");
  const conclusion = getConclusionForProperty(property.id);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(Math.min(2, property.maxGuests));
  const [children, setChildren] = useState(0);
  const totalGuests = adults + children;
  const nights = nightsBetweenIso(checkIn, checkOut);
  if (!conclusion) return null;

  function book() {
    const params = new URLSearchParams({ unit: property.id });
    if (checkIn && checkOut && nights > 0) {
      params.set("checkin", checkIn);
      params.set("checkout", checkOut);
      params.set("nights", String(nights));
    }
    params.set("adults", String(adults));
    if (children > 0) params.set("children", String(children));
    params.set("guests", String(totalGuests));
    router.push(localizeHref(`/booking?${params.toString()}`, locale));
  }

  function isArrivalDisabled(date: Date) {
    const iso = dateToIso(date);
    return iso < todayIsoLocal();
  }

  function updateAdults(value: number) {
    const nextAdults = Math.max(1, Math.min(property.maxGuests, value));
    const maxChildren = Math.max(0, property.maxGuests - nextAdults);
    setAdults(nextAdults);
    if (children > maxChildren) setChildren(maxChildren);
  }

  function updateChildren(value: number) {
    setChildren(Math.max(0, Math.min(property.maxGuests - adults, value)));
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 px-5 py-10 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="fixed right-4 top-4 z-40 h-11 w-11 rounded-full bg-white/15 text-white shadow-lg shadow-black/30 backdrop-blur-md hover:bg-white/25 hover:text-white md:right-6 md:top-6"
        aria-label={t("backToTour")}
      >
        <X className="h-5 w-5" />
      </Button>
      <div className="mx-auto w-full max-w-lg">
        <div className="relative overflow-hidden rounded-2xl">
          <PropertyImage
            images={property.images}
            alt={property.name}
            className="aspect-[16/10]"
            sizes="(min-width: 768px) 560px, 100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
            <p className="text-xs font-medium uppercase tracking-widest text-white/60">
              {property.name}
            </p>
            <h2 className="mt-1 font-serif text-3xl font-semibold text-white md:text-4xl">
              {conclusion.headline}
            </h2>
          </div>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-white/80 md:text-base">
          {conclusion.summary}
        </p>
        <ul className="mt-5 space-y-2.5">
          {conclusion.highlights.map((highlight) => (
            <li key={highlight} className="flex items-start gap-3 text-sm text-white/90 md:text-base">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
              {highlight}
            </li>
          ))}
        </ul>
        <div className="mt-5 space-y-3">
          <div>
            <div className="[&_button]:border-white/15 [&_button]:bg-white/10 [&_button]:text-white [&_label]:text-xs [&_label]:font-medium [&_label]:uppercase [&_label]:tracking-wider [&_label]:text-white/50">
              <BookingDatePicker
                checkIn={checkIn}
                checkOut={checkOut}
                onChange={(range) => {
                  setCheckIn(range.checkIn);
                  setCheckOut(range.checkOut);
                }}
                isDateDisabled={isArrivalDisabled}
                helperText={
                  checkIn && !checkOut
                    ? t("selectCheckout")
                    : nights > 0
                      ? t("nightsSelected", { count: nights })
                      : undefined
                }
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/50">
              {t("guests")}
            </p>
            <div className="space-y-2">
              {[
                { label: t("adults"), value: adults, min: 1, update: updateAdults },
                { label: t("children"), value: children, min: 0, update: updateChildren },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => item.update(item.value - 1)}
                      disabled={item.value <= item.min}
                      className="h-9 w-9 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/15"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-7 text-center text-sm font-semibold text-white">{item.value}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => item.update(item.value + 1)}
                      disabled={totalGuests >= property.maxGuests}
                      className="h-9 w-9 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/15"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <Button
          variant="gold"
          className="mt-6 w-full rounded-2xl py-3.5"
          onClick={book}
          disabled={Boolean(checkIn && !checkOut)}
        >
          {navT("book")}
        </Button>
        <div className="mt-3 text-center">
          <button
            type="button"
            className="text-sm text-white/50 transition hover:text-white/80"
            onClick={onLead}
          >
            {t("saveThisDream")}
          </button>
        </div>
        <p className="mt-6 text-center font-serif text-sm italic text-white/40">
          {conclusion.closingLine}
        </p>
      </div>
    </div>
  );
}
