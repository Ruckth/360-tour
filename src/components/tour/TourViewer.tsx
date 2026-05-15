"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LeadCapture } from "@/components/tour/LeadCapture";
import { TourCanvas } from "@/components/tour/TourCanvas";
import { TourConclusion } from "@/components/tour/TourConclusion";
import { TourOverlay } from "@/components/tour/TourOverlay";
import type { Property } from "@/lib/data/properties";
import { rooms as allRooms } from "@/lib/data/rooms";
import { cn } from "@/lib/utils";

type Phase = "intro" | "tour" | "conclusion" | "leadCapture";

export function TourViewer({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const activeRooms = useMemo(
    () =>
      property.tourRoomIds
        .map((roomId) => allRooms.find((room) => room.id === roomId))
        .filter((room): room is (typeof allRooms)[number] => Boolean(room)),
    [property.tourRoomIds],
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [currentRoomId, setCurrentRoomId] = useState(activeRooms[0]?.id ?? "");
  const [previousRoomId, setPreviousRoomId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const [minimumReached, setMinimumReached] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => setMinimumReached(true), 1100);
    return () => {
      document.body.style.overflow = "";
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
    if (transitioning || roomId === currentRoomId) return;
    setPreviousRoomId(currentRoomId);
    setCurrentRoomId(roomId);
    setTransitioning(true);
  }

  const allRoomsVisited =
    activeRooms.length > 0 && activeRooms.every((room) => visited.has(room.id));

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
            aria-label="Close"
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
          {!texturesLoaded ? <p className="mt-3 text-xs text-white/30">Loading...</p> : null}
        </div>
      ) : null}

      {phase === "tour" ? (
        <>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 md:right-6 md:top-5"
            aria-label="Close tour"
          >
            <X className="h-5 w-5" />
          </button>
          <TourOverlay
            visitedCount={visited.size}
            totalRooms={activeRooms.length}
            allRoomsVisited={allRoomsVisited}
            onFinish={() => setPhase("conclusion")}
          />
          <div className="absolute right-4 top-16 z-30 rounded-full bg-black/35 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm md:right-6">
            ฿{property.pricePerNight.toLocaleString()}/night
          </div>
          {activeRooms.length > 1 ? (
            <div
              className="absolute inset-x-3 bottom-4 z-30 flex justify-center gap-1.5 overflow-x-auto md:bottom-6 md:gap-2"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              {activeRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors md:px-4 md:py-2 md:text-sm",
                    currentRoomId === room.id
                      ? "bg-white text-black shadow-lg"
                      : "bg-white/15 text-white backdrop-blur-sm hover:bg-white/25",
                  )}
                  onClick={() => navigateTo(room.id)}
                >
                  {room.name}
                </button>
              ))}
            </div>
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
