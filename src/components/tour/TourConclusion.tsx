"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { getConclusionForProperty } from "@/lib/data/tourflow";
import { resort } from "@/lib/data/resort-config";
import type { Property } from "@/lib/data/properties";

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
  const conclusion = getConclusionForProperty(property.id);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(Math.min(2, property.maxGuests));
  if (!conclusion) return null;

  function book() {
    const params = new URLSearchParams({ unit: property.id });
    if (checkIn) params.set("checkin", checkIn);
    if (checkOut) params.set("checkout", checkOut);
    if (guests > 1) params.set("guests", String(guests));
    router.push(`/booking?${params.toString()}`);
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 px-5 py-10 backdrop-blur-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white md:right-6 md:top-6"
        aria-label="Back to tour"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="mx-auto w-full max-w-lg">
        <div className="relative overflow-hidden rounded-2xl">
          <Image
            src={property.images[0]}
            alt={property.name}
            width={900}
            height={560}
            className="aspect-[16/10] w-full object-cover"
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
        <div className="mt-6 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-white md:text-3xl">
            {resort.currencySymbol}
            {property.pricePerNight.toLocaleString()}
          </span>
          <span className="text-sm text-white/50">/night</span>
        </div>
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium uppercase tracking-wider text-white/50">
              Check-in
              <input
                type="date"
                value={checkIn}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setCheckIn(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wider text-white/50">
              Check-out
              <input
                type="date"
                value={checkOut}
                min={checkIn || new Date().toISOString().slice(0, 10)}
                onChange={(event) => setCheckOut(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-white/50">Guests</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setGuests(Math.max(1, guests - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-sm font-medium text-white">
                {guests} guest{guests > 1 ? "s" : ""}
              </span>
              <button
                type="button"
                onClick={() => setGuests(Math.min(property.maxGuests, guests + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <Button variant="gold" className="mt-6 w-full rounded-2xl py-3.5" onClick={book}>
          Book
        </Button>
        <div className="mt-3 text-center">
          <button
            type="button"
            className="text-sm text-white/50 transition hover:text-white/80"
            onClick={onLead}
          >
            Save This Dream
          </button>
        </div>
        <p className="mt-6 text-center font-serif text-sm italic text-white/40">
          {conclusion.closingLine}
        </p>
      </div>
    </div>
  );
}
