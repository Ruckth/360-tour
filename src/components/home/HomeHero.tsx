"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resort } from "@/lib/data/resort-config";
import { cn } from "@/lib/utils";

const desktopImages = {
  left: "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=960&h=1080&fit=crop",
  right:
    "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=960&h=1080&fit=crop",
};

const mobileSlides = [
  {
    top: "https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=900&fit=crop",
    bottom:
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=900&fit=crop",
  },
  {
    top: "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=900&fit=crop",
    bottom:
      "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&h=900&fit=crop",
  },
  {
    top: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&h=900&fit=crop",
    bottom:
      "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&h=900&fit=crop",
  },
];

export function HomeHero() {
  const [loaded, setLoaded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopStep, setDesktopStep] = useState(0);
  const [mobileSlide, setMobileSlide] = useState(0);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const video0 = useRef<HTMLVideoElement>(null);
  const video1 = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    const loadTimer = window.setTimeout(() => setLoaded(true), 100);
    return () => {
      media.removeEventListener("change", update);
      window.clearTimeout(loadTimer);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    if (desktopStep === 0) video0.current?.play().catch(() => {});
    if (desktopStep === 2) video1.current?.play().catch(() => {});
    if (desktopStep !== 1) return;
    const timer = window.setTimeout(() => setDesktopStep(2), 6000);
    return () => window.clearTimeout(timer);
  }, [desktopStep, isDesktop]);

  useEffect(() => {
    if (isDesktop) return;
    const timer = window.setInterval(
      () => setMobileSlide((value) => (value + 1) % mobileSlides.length),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [isDesktop]);

  function completeSwipe(clientX: number) {
    if (dragStart === null) return;
    const delta = clientX - dragStart;
    if (Math.abs(delta) > 40) {
      setMobileSlide((value) =>
        delta > 0
          ? (value - 1 + mobileSlides.length) % mobileSlides.length
          : (value + 1) % mobileSlides.length,
      );
    }
    setDragStart(null);
  }

  return (
    <section className="relative h-screen overflow-hidden">
      <div className={cn("absolute inset-0 transition-opacity duration-1000", loaded ? "opacity-100" : "opacity-0")}>
        {isDesktop ? (
          <>
            <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 0 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
              <video
                ref={video0}
                muted
                playsInline
                preload="auto"
                poster={desktopImages.left}
                onEnded={() => setDesktopStep(1)}
                className="h-full w-full object-cover"
              >
                <source src="/videos/hero-left.mp4" type="video/mp4" />
              </video>
            </div>
            <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 1 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
              <div className="flex h-full w-full">
                <img src={desktopImages.left} alt="" className={cn("h-full w-1/2 object-cover", desktopStep === 1 && "hero-ken-burns")} />
                <img src={desktopImages.right} alt="" className={cn("h-full w-1/2 object-cover", desktopStep === 1 && "hero-ken-burns")} />
              </div>
            </div>
            <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 2 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
              <video
                ref={video1}
                muted
                playsInline
                preload="auto"
                poster={desktopImages.right}
                onEnded={() => setDesktopStep(0)}
                className="h-full w-full object-cover"
              >
                <source src="/videos/hero-right.mp4" type="video/mp4" />
              </video>
            </div>
          </>
        ) : (
          <div
            className="absolute inset-0 flex select-none flex-col"
            style={{ touchAction: "pan-y" }}
            onPointerDown={(event) => setDragStart(event.clientX)}
            onPointerUp={(event) => completeSwipe(event.clientX)}
            onPointerCancel={() => setDragStart(null)}
          >
            {["top", "bottom"].map((slot) => (
              <div key={slot} className="relative h-1/2 w-full overflow-hidden">
                {mobileSlides.map((slide, index) => (
                  <div
                    key={`${slot}-${index}`}
                    className={cn(
                      "absolute inset-0 transition-opacity duration-[2000ms]",
                      mobileSlide === index ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <img
                      src={slot === "top" ? slide.top : slide.bottom}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
                <div className={cn("absolute inset-0", slot === "top" ? "bg-gradient-to-b from-black/20 via-transparent to-black/30" : "bg-gradient-to-t from-black/40 via-transparent to-black/20")} />
              </div>
            ))}
            <div className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 gap-2">
              {mobileSlides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setMobileSlide(index)}
                  className={cn("h-2 rounded-full transition-all", mobileSlide === index ? "w-6 bg-white" : "w-2 bg-white/40")}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="absolute inset-0 z-[2] hidden bg-gradient-to-b from-black/25 via-transparent to-black/50 md:block" />
      <div className="hero-grain pointer-events-none absolute inset-0 z-[3] opacity-[0.035] dark:opacity-[0.06]" />

      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <Link
          href="/#villas"
          className="hero-card-reveal group flex items-center gap-3 bg-navy/80 px-4 py-2.5 shadow-lg backdrop-blur-sm transition-all hover:bg-navy/90 dark:bg-gold/80 dark:hover:bg-gold/90 sm:gap-4 sm:px-5 sm:py-3 md:gap-5 md:px-6 lg:gap-6 lg:px-8 lg:py-3.5"
        >
          <div>
            <p className="font-serif text-xs font-semibold text-white dark:text-navy sm:text-sm md:text-base lg:text-lg">
              {resort.name}
            </p>
            <p className="text-[8px] uppercase tracking-[0.15em] text-white/50 dark:text-navy/50 sm:text-[9px] md:text-[10px]">
              {resort.location}
            </p>
          </div>
          <div className="h-5 w-px bg-white/15 dark:bg-navy/15 sm:h-6" />
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium text-white/70 dark:text-navy/70 sm:text-[10px] md:text-xs">
              View Villas
            </span>
            <ArrowRight className="h-3 w-3 text-white/50 transition-transform group-hover:translate-x-0.5 dark:text-navy/50" />
          </div>
        </Link>
      </div>

      <Link
        href="#about"
        aria-label="Scroll down"
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 md:bottom-8"
      >
        <ArrowDown className="h-5 w-5 animate-bounce text-white/50 md:h-6 md:w-6" />
      </Link>
    </section>
  );
}
