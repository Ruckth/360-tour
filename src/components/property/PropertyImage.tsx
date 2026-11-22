"use client";

import Image from "@/platform/image";
import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { resort } from "@/lib/data/resort-config";
import { cn } from "@/lib/utils";

export function PropertyImage({
  src,
  images,
  fallbackImages = [],
  alt,
  className,
  imgClassName,
  priority,
  occluded,
  sizes = "100vw",
}: {
  src?: string;
  images?: string[];
  fallbackImages?: string[];
  alt: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  /** Covered by an overlay at first paint (a direct `?tour=1` open): keep the priority image's exact URL and
   * quality, but drop its high-priority preload so the overlay's own assets go first. */
  occluded?: boolean;
  sizes?: string;
}) {
  const candidates = useMemo(
    () => Array.from(new Set([src, ...(images ?? []), ...fallbackImages, resort.heroImage].filter(Boolean) as string[])),
    [fallbackImages, images, src],
  );
  const candidateKey = candidates.join("\u0000");
  // Failed images are skipped; a new candidate list starts again from its first image.
  const [failed, setFailed] = useState({ candidateKey, index: 0 });
  const index = failed.candidateKey === candidateKey ? failed.index : 0;
  const currentSrc = candidates[index];

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
      {currentSrc ? (
        <Image
          src={currentSrc}
          alt={alt}
          fill
          priority={priority && !occluded}
          quality={priority ? 82 : 72}
          loading={priority ? "eager" : undefined}
          fetchPriority={priority && occluded ? "low" : undefined}
          sizes={sizes}
          className={cn(
            "object-cover",
            imgClassName,
          )}
          onError={() =>
            setFailed((current) => ({
              candidateKey,
              index: Math.min((current.candidateKey === candidateKey ? current.index : 0) + 1, candidates.length),
            }))
          }
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
          <ImageOff className="h-6 w-6" />
          <span className="text-xs font-medium">{alt}</span>
        </div>
      )}
    </div>
  );
}
