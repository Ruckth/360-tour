"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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
  sizes = "100vw",
}: {
  src?: string;
  images?: string[];
  fallbackImages?: string[];
  alt: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const candidates = useMemo(
    () => Array.from(new Set([src, ...(images ?? []), ...fallbackImages, resort.heroImage].filter(Boolean) as string[])),
    [fallbackImages, images, src],
  );
  const candidateKey = candidates.join("\u0000");
  const [index, setIndex] = useState(0);
  const currentSrc = candidates[index];

  useEffect(() => {
    setIndex(0);
  }, [candidateKey]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
      {currentSrc ? (
        <Image
          src={currentSrc}
          alt={alt}
          fill
          priority={priority}
          quality={priority ? 82 : 72}
          sizes={sizes}
          className={cn(
            "object-cover",
            imgClassName,
          )}
          onError={() => setIndex((current) => Math.min(current + 1, candidates.length))}
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
