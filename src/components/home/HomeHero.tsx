"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { getLocalizedResort } from "@/lib/i18n/public-content";
import { cn } from "@/lib/utils";

const desktopImages = {
  left: "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=960&h=1080&fit=crop",
  right:
    "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=960&h=1080&fit=crop",
};

export function HomeHero() {
  const t = useTranslations("Home");
  const a11y = useTranslations("A11y");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const resort = getLocalizedResort(locale);
  const [loaded, setLoaded] = useState(false);
  const [desktopStep, setDesktopStep] = useState(0);
  const [videosEnabled, setVideosEnabled] = useState(false);
  const video0 = useRef<HTMLVideoElement>(null);
  const video1 = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => setLoaded(true), 100);
    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setVideosEnabled(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!videosEnabled) return;
    if (desktopStep === 0) video0.current?.play().catch(() => {});
    if (desktopStep === 2) video1.current?.play().catch(() => {});
    if (desktopStep !== 1) return;
    const timer = window.setTimeout(() => setDesktopStep(2), 6000);
    return () => window.clearTimeout(timer);
  }, [desktopStep, videosEnabled]);

  return (
    <section className="relative h-[100svh] overflow-hidden md:h-screen md:min-h-[520px]">
      <div className={cn("absolute inset-0 transition-opacity duration-1000", loaded ? "opacity-100" : "opacity-0")}>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 0 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <video
            ref={video0}
            muted
            playsInline
            preload={videosEnabled ? "metadata" : "none"}
            poster={desktopImages.left}
            onEnded={() => setDesktopStep(1)}
            className="h-full w-full object-cover"
          >
            {videosEnabled ? <source src="/videos/hero-left.mp4" type="video/mp4" /> : null}
          </video>
        </div>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 1 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <div className="flex h-full w-full flex-col md:flex-row">
            <div className="relative h-1/2 w-full overflow-hidden md:h-full md:w-1/2">
              <Image
                src={desktopImages.left}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className={cn("object-cover", desktopStep === 1 && "hero-ken-burns")}
              />
            </div>
            <div className="relative h-1/2 w-full overflow-hidden md:h-full md:w-1/2">
              <Image
                src={desktopImages.right}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className={cn("object-cover", desktopStep === 1 && "hero-ken-burns")}
              />
            </div>
          </div>
        </div>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms]", desktopStep === 2 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <video
            ref={video1}
            muted
            playsInline
            preload={videosEnabled ? "metadata" : "none"}
            poster={desktopImages.right}
            onEnded={() => setDesktopStep(0)}
            className="h-full w-full object-cover"
          >
            {videosEnabled ? <source src="/videos/hero-right.mp4" type="video/mp4" /> : null}
          </video>
        </div>
      </div>

      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/25 via-transparent to-black/50" />
      <div className="hero-grain pointer-events-none absolute inset-0 z-[3] opacity-[0.035] dark:opacity-[0.06]" />

      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <Link
          href={localizeHref("/#villas", locale)}
          className="hero-card-reveal pointer-events-auto group flex items-center gap-3 bg-navy/80 px-4 py-2.5 shadow-lg backdrop-blur-sm transition-all hover:bg-navy/90 dark:bg-gold/80 dark:hover:bg-gold/90 sm:gap-4 sm:px-5 sm:py-3 md:gap-5 md:px-6 lg:gap-6 lg:px-8 lg:py-3.5"
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
              {t("viewVillas")}
            </span>
            <ArrowRight className="h-3 w-3 text-white/50 transition-transform group-hover:translate-x-0.5 dark:text-navy/50" />
          </div>
        </Link>
      </div>

      <Link
        href="#about"
        aria-label={a11y("scrollDown")}
        className="absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-1.5 md:bottom-8 md:flex"
      >
        <ArrowDown className="h-5 w-5 animate-bounce text-white/50 md:h-6 md:w-6" />
      </Link>
    </section>
  );
}
