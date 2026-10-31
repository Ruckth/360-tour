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
 * A photo URL to show, or undefined when there is none or it failed to load. A failure is
 * remembered for that URL only, so a changed URL (an updated catalog photo) is tried again.
 */
export function useLoadablePhoto(src: string | undefined) {
  const [failed, setFailed] = useState<string>();
  return { src: src && failed !== src ? src : undefined, onError: () => setFailed(src) };
}

/**
 * A catalog photo (service photo or a villa's first image), cropped to fill its box. Without a
 * photo, or once it fails to load, the item's kind icon on a quiet tile takes its place.
 * Decorative: the name beside it says what it is.
 */
export function CheckoutPhoto({ src, kind, className }: { src?: string; kind: PhotoKind; className?: string }) {
  const photo = useLoadablePhoto(src);
  if (photo.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- any host (Convex storage, Unsplash, /public); thumbnails only
      <img
        src={photo.src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={photo.onError}
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
