"use client";

import { BedDouble, CalendarDays, Package, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { OrderLine } from "./backend";

export type PhotoKind = OrderLine["kind"];

/** The icon a row or tile shows when it has no photo, or its photo fails to load. */
export const KIND_ICONS: Record<PhotoKind, LucideIcon> = {
  service: Sparkles,
  appointment: Sparkles,
  room: BedDouble,
  booking: CalendarDays,
  extra: Package,
};

/**
 * A catalog photo (service photo or a villa's first image), cropped to fill its box. Without a
 * photo, or once it fails to load, the item's kind icon on a quiet tile takes its place.
 * Decorative: the name beside it says what it is.
 */
export function CheckoutPhoto({ src, kind, className }: { src?: string; kind: PhotoKind; className?: string }) {
  const [failed, setFailed] = useState<string>();
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- any host (Convex storage, Unsplash, /public); thumbnails only
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(src)}
        className={cn("shrink-0 rounded-lg bg-muted object-cover", className)}
      />
    );
  }
  const Icon = KIND_ICONS[kind];
  return (
    <span
      aria-hidden
      data-photo-fallback=""
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-muted to-card text-gold-text ring-1 ring-inset ring-border",
        className,
      )}
    >
      <Icon className="size-[38%] max-h-7 max-w-7 min-h-4 min-w-4" strokeWidth={1.5} />
    </span>
  );
}
