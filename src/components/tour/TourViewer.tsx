"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LeadCapture } from "@/components/tour/LeadCapture";
import { TourCanvas } from "@/components/tour/TourCanvas";
import { TourConclusion } from "@/components/tour/TourConclusion";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/data/properties";
import { rooms as allRooms } from "@/lib/data/rooms";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { localizeRooms } from "@/lib/i18n/public-content";
import { cn } from "@/lib/utils";

type Phase = "intro" | "tour" | "conclusion" | "leadCapture";

export function TourViewer({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const locale = useLocale();
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const localizedRooms = useMemo(() => localizeRooms(allRooms, locale), [locale]);
  const activeRooms = useMemo(
    () =>
      property.tourRoomIds
        .map((roomId) => localizedRooms.find((room) => room.id === roomId))
        .filter((room): room is (typeof localizedRooms)[number] => Boolean(room)),
    [localizedRooms, property.tourRoomIds],
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [currentRoomId, setCurrentRoomId] = useState(activeRooms[0]?.id ?? "");
  const [previousRoomId, setPreviousRoomId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const [minimumReached, setMinimumReached] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const activeRoomIds = useMemo(() => new Set(activeRooms.map((room) => room.id)), [activeRooms]);

  useBodyScrollLock(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumReached(true), 1100);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (phase === "leadCapture") setPhase("conclusion");
      else if (phase === "conclusion") setPhase("tour");
      else onClose();
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [onClose, phase]);

  useEffect(() => {
    if (texturesLoaded && minimumReached && phase === "intro") {
      const timer = window.setTimeout(() => setPhase("tour"), 400);
      return () => window.clearTimeout(timer);
    }
  }, [minimumReached, phase, texturesLoaded]);

  useEffect(() => {
    if (!currentRoomId) return;
    setVisited((items) => new Set(items).add(currentRoomId));
  }, [currentRoomId]);

  const handleLoaded = useCallback(() => setTexturesLoaded(true), []);
  const completeTransition = useCallback(() => {
    setTransitioning(false);
    setPreviousRoomId(null);
  }, []);

  function navigateTo(roomId: string) {
    if (!activeRoomIds.has(roomId)) return;
    if (transitioning || roomId === currentRoomId) return;
    setPreviousRoomId(currentRoomId);
    setCurrentRoomId(roomId);
    setTransitioning(true);
  }

  const allRoomsVisited =
    activeRooms.length > 0 && activeRooms.every((room) => visited.has(room.id));
  const currentRoomIndex = Math.max(
    0,
    activeRooms.findIndex((room) => room.id === currentRoomId),
  );
  const previousRoom = activeRooms[(currentRoomIndex - 1 + activeRooms.length) % activeRooms.length];
  const nextRoom = activeRooms[(currentRoomIndex + 1) % activeRooms.length];

  if (!activeRooms.length) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black" style={{ touchAction: "none" }}>
      <div
        className={cn(
          "absolute inset-0 transition-[filter,opacity] duration-700",
          phase === "intro" && "pointer-events-none opacity-0",
          (phase === "conclusion" || phase === "leadCapture") && "blur-md",
        )}
      >
        <TourCanvas
          rooms={activeRooms}
          currentRoomId={currentRoomId}
          previousRoomId={previousRoomId}
          transitioning={transitioning}
          onTransitionComplete={completeTransition}
          onLoaded={handleLoaded}
          onNavigate={navigateTo}
        />
      </div>

      {phase === "intro" ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black px-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white"
            aria-label={a11y("close")}
          >
            <X className="h-5 w-5" />
          </button>
          <p className="font-serif text-3xl font-semibold text-white md:text-4xl">
            {property.name}
          </p>
          <div className="mt-6 h-px w-32 overflow-hidden bg-white/10">
            <div
              className="h-full bg-gold transition-all duration-200"
              style={{ width: texturesLoaded && minimumReached ? "100%" : "62%" }}
            />
          </div>
          {!texturesLoaded ? <p className="mt-3 text-xs text-white/30">{tourT("loading")}</p> : null}
        </div>
      ) : null}

      {phase === "tour" ? (
        <>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 md:right-6 md:top-5"
            aria-label={a11y("closeTour")}
          >
            <X className="h-5 w-5" />
          </button>
          <TourOverlay
            visitedCount={visited.size}
            totalRooms={activeRooms.length}
            allRoomsVisited={allRoomsVisited}
            onFinish={() => setPhase("conclusion")}
          />
          {activeRooms.length > 1 ? (
            <>
              <div
                className="absolute bottom-4 left-3 z-30 md:bottom-6 md:left-6"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
              >
                <Button
                  type="button"
                  variant="glass"
                  className="inline-flex max-w-[42vw] items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-white/25 md:max-w-none md:px-4 md:text-sm"
                  onClick={() => navigateTo(previousRoom.id)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="truncate">{previousRoom.name}</span>
                </Button>
              </div>
              <div
                className="absolute bottom-4 right-3 z-30 md:bottom-6 md:right-6"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
              >
                <Button
                  type="button"
                  variant="outline"
                  className="inline-flex max-w-[42vw] items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-black shadow-lg shadow-black/20 transition hover:bg-white/90 md:max-w-none md:px-4 md:text-sm"
                  onClick={() => navigateTo(nextRoom.id)}
                >
                  <span className="truncate">{nextRoom.name}</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {phase === "conclusion" ? (
        <TourConclusion
          property={property}
          onClose={() => setPhase("tour")}
          onLead={() => setPhase("leadCapture")}
        />
      ) : null}

      {phase === "leadCapture" ? (
        <LeadCapture propertySlug={property.id} onClose={() => setPhase("conclusion")} />
      ) : null}
    </div>
  );
}
