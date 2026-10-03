"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { defaultLocale, isLocale, localizeHref } from "@/i18n/routing";
import { getLocalizedResort } from "@/lib/i18n/public-content";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { shouldLoadHeroVideo } from "@/components/home/hero-video";
import { cn } from "@/lib/utils";

const desktopImages = {
  left: "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=960&h=1080&fit=crop",
  right:
    "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=960&h=1080&fit=crop",
};

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Read the client's reduced-motion / Save-Data / effective-connection signals. */
function readHeroMediaPreferences(reducedMotion: boolean): {
  videoAllowed: boolean;
  reducedMotion: boolean;
} {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return {
    reducedMotion,
    videoAllowed: shouldLoadHeroVideo({
      reducedMotion,
      saveData: connection?.saveData ?? false,
      effectiveType: connection?.effectiveType ?? null,
    }),
  };
}

/** Stop a video and drop its loaded media so it neither plays nor keeps buffering. */
function unloadVideo(video: HTMLVideoElement | null) {
  if (!video || !video.currentSrc) return;
  video.pause();
  // The <source> child is already gone; load() resets the element to its empty, poster-only state.
  video.load();
}

export function HomeHero() {
  const t = useTranslations("Home");
  const a11y = useTranslations("A11y");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const resort = getLocalizedResort(usePublicMessages());
  const [loaded, setLoaded] = useState(false);
  const [desktopStep, setDesktopStep] = useState(0);
  const [videosEnabled, setVideosEnabled] = useState(false);
  // False for reduced-motion, Save-Data, or a slow connection → poster only. Reduced motion is
  // tracked live; Save-Data / connection are read with it. Save-Data alone still cycles posters
  // (it limits data, not motion), while reduced motion holds the first poster still.
  const [videoAllowed, setVideoAllowed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [onscreen, setOnscreen] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const video0 = useRef<HTMLVideoElement>(null);
  const video1 = useRef<HTMLVideoElement>(null);

  // The active video only gets a real source; the inactive one stays at preload="none".
  const playVideo = videoAllowed && videosEnabled;
  const video0Active = playVideo && desktopStep === 0;
  const video1Active = playVideo && desktopStep === 2;

  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const apply = () => {
      const preferences = readHeroMediaPreferences(query?.matches ?? false);
      setVideoAllowed(preferences.videoAllowed);
      setReducedMotion(preferences.reducedMotion);
      // Reduced motion: return to (and hold) the first poster.
      if (preferences.reducedMotion) setDesktopStep(0);
    };
    apply();
    query?.addEventListener?.("change", apply);
    return () => query?.removeEventListener?.("change", apply);
  }, []);

  // When a clip stops being the active one (cycle advanced, or video was turned off live), stop it
  // and release its media instead of leaving a paused, buffered element behind.
  useEffect(() => {
    if (!video0Active) unloadVideo(video0.current);
  }, [video0Active]);
  useEffect(() => {
    if (!video1Active) unloadVideo(video1.current);
  }, [video1Active]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => setLoaded(true), 100);
    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setVideosEnabled(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  // Pause the hero videos when the section scrolls offscreen (cheap, best-effort).
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnscreen(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Drive the step cycle. With video, each clip's `onEnded` advances it; the step-1 image pause
  // uses a timer. Without video (poster only), timers advance through the poster frames so the
  // hero still animates its cross-fades without downloading ~8.48 MiB of video.
  useEffect(() => {
    if (playVideo) {
      const active = desktopStep === 0 ? video0.current : desktopStep === 2 ? video1.current : null;
      if (active) {
        if (onscreen) active.play().catch(() => {});
        else active.pause();
      }
    }

    if (playVideo && desktopStep !== 1) return;
    // Reduced motion: keep the first poster still instead of cycling cross-fades.
    if (reducedMotion) return;

    // Timed advance: step 1 (image Ken Burns) always; steps 0/2 only in poster-only mode.
    const nextStep = desktopStep === 0 ? 1 : desktopStep === 1 ? 2 : 0;
    const delay = desktopStep === 1 ? 6000 : 7000;
    const timer = window.setTimeout(() => setDesktopStep(nextStep), delay);
    return () => window.clearTimeout(timer);
  }, [desktopStep, playVideo, onscreen, reducedMotion]);

  return (
    <section
      ref={sectionRef}
      data-testid="home-hero"
      data-hero-step={desktopStep}
      data-hero-motion={reducedMotion ? "reduced" : "full"}
      className="relative h-[100svh] overflow-hidden md:h-screen md:min-h-[520px]"
    >
      <div className={cn("absolute inset-0 transition-opacity duration-1000 motion-reduce:transition-none", loaded ? "opacity-100" : "opacity-0")}>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms] motion-reduce:transition-none", desktopStep === 0 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <video
            ref={video0}
            muted
            playsInline
            preload={video0Active ? "metadata" : "none"}
            poster={desktopImages.left}
            onEnded={() => setDesktopStep(1)}
            className="h-full w-full object-cover"
          >
            {video0Active ? <source src="/videos/hero-left.mp4" type="video/mp4" /> : null}
          </video>
        </div>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms] motion-reduce:transition-none", desktopStep === 1 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <div className="flex h-full w-full flex-col md:flex-row">
            <div className="relative h-1/2 w-full overflow-hidden md:h-full md:w-1/2">
              <Image
                src={desktopImages.left}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className={cn("object-cover", desktopStep === 1 && !reducedMotion && "hero-ken-burns")}
              />
            </div>
            <div className="relative h-1/2 w-full overflow-hidden md:h-full md:w-1/2">
              <Image
                src={desktopImages.right}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className={cn("object-cover", desktopStep === 1 && !reducedMotion && "hero-ken-burns")}
              />
            </div>
          </div>
        </div>
        <div className={cn("absolute inset-0 transition-opacity duration-[2000ms] motion-reduce:transition-none", desktopStep === 2 ? "z-[1] opacity-100" : "z-0 opacity-0")}>
          <video
            ref={video1}
            muted
            playsInline
            preload={video1Active ? "metadata" : "none"}
            poster={desktopImages.right}
            onEnded={() => setDesktopStep(0)}
            className="h-full w-full object-cover"
          >
            {video1Active ? <source src="/videos/hero-right.mp4" type="video/mp4" /> : null}
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
        <ArrowDown className="h-5 w-5 text-white/50 motion-safe:animate-bounce md:h-6 md:w-6" />
      </Link>
    </section>
  );
}
