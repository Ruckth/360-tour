"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function SwipeRail({
  label,
  children,
  className,
  viewportClassName,
  itemClassName,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  itemClassName?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewportRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const slides = useMemo(() => Children.toArray(children).filter(Boolean), [children]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const updateActiveIndex = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const distance = Math.abs(item.offsetLeft - viewport.scrollLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveIndex(closestIndex);
  }, []);

  function handleScroll() {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(updateActiveIndex);
  }

  function goTo(index: number) {
    const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
    itemRefs.current[nextIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
    setActiveIndex(nextIndex);
  }

  if (slides.length === 0) return null;

  return (
    <section
      aria-label={label}
      aria-roledescription="carousel"
      className={cn("relative", className)}
    >
      <ul
        ref={viewportRef}
        onScroll={handleScroll}
        className={cn(
          "-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          viewportClassName,
        )}
      >
        {slides.map((child, index) => (
          <li
            key={index}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            aria-label={`${index + 1} of ${slides.length}`}
            className={cn(
              "min-w-0 shrink-0 basis-[84%] snap-start scroll-ml-5 sm:basis-[58%]",
              itemClassName,
            )}
          >
            {child}
          </li>
        ))}
      </ul>

      {slides.length > 1 ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to ${label} slide ${index + 1}`}
                aria-current={activeIndex === index ? "true" : undefined}
                onClick={() => goTo(index)}
                className={cn(
                  "h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  activeIndex === index
                    ? "w-7 bg-gold"
                    : "w-2 bg-muted-foreground/35 hover:bg-muted-foreground/60",
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={`Previous ${label} slide`}
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Next ${label} slide`}
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === slides.length - 1}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
