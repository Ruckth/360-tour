"use client";

import Image from "@/platform/image";
import { ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const RESORT_MAP_COORDS = "9.499354,99.997034";
export const RESORT_DIRECTIONS_URL = `https://www.google.com/maps/search/?api=1&query=${RESORT_MAP_COORDS}`;
const RESORT_MAP_EMBED_URL = `https://www.google.com/maps?q=${RESORT_MAP_COORDS}&z=15&output=embed`;

export function LocationMapPreview({
  resortName,
  location,
  address,
  imageAlt,
  openInMapsLabel,
  showInteractiveMapLabel,
}: {
  resortName: string;
  location: string;
  address: string;
  imageAlt: string;
  openInMapsLabel: string;
  showInteractiveMapLabel: string;
}) {
  const [interactive, setInteractive] = useState(false);

  return (
    <div className="space-y-3">
      <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
        {interactive ? (
          <iframe
            title={`${resortName} Google Map, ${location}`}
            src={RESORT_MAP_EMBED_URL}
            className="h-[320px] w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <>
            <Image
              src="https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=600&fit=crop"
              alt={imageAlt}
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
            <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-start gap-2 text-white">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <div className="text-xs leading-snug">
                  <p className="font-semibold">{resortName}</p>
                  <p className="text-white/80">{address}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setInteractive(true)}
                className="min-h-11 rounded-full bg-background/90 text-foreground backdrop-blur-sm hover:bg-background"
              >
                {showInteractiveMapLabel}
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={RESORT_DIRECTIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="location-directions-link"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <MapPin className="h-4 w-4 text-gold" aria-hidden="true" />
          <span>{openInMapsLabel}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
