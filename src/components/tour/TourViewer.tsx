"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { api } from "convex/_generated/api";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LeadCapture } from "@/components/tour/LeadCapture";
import { TourCanvas } from "@/components/tour/TourCanvas";
import { TourConclusion } from "@/components/tour/TourConclusion";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/data/properties";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { useConvexQuery } from "@/lib/react/convex";
import { resolveTourRooms, type DbTourRooms } from "@/lib/tour/rooms";
import { cn } from "@/lib/utils";

type Phase = "intro" | "tour" | "conclusion" | "leadCapture";
const tourRoomsQuery = api.properties.getTourRooms;
const ROOMS_TIMEOUT_MS = 3_000;

export function TourViewer({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const messages = usePublicMessages();
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const liveRooms = useConvexQuery<DbTourRooms>(tourRoomsQuery, { slug: property.id }, null);
  const [timedOut, setTimedOut] = useState(false);
  // Wait for the DB rooms so the tour never starts on bundled rooms and then swaps;
  // if Convex does not answer in time, fall back to the bundled rooms.
  const roomsReady = !liveRooms.loading || timedOut;
  const activeRooms = useMemo(
    () => (roomsReady ? resolveTourRooms(property.tourRoomIds, liveRooms.data, messages) : []),
    [liveRooms.data, messages, property.tourRoomIds, roomsReady],
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // The first room in tour order until the guest moves (or the selected room disappears).
  const currentRoomId =
    activeRooms.find((room) => room.id === selectedRoomId)?.id ?? activeRooms[0]?.id ?? "";
  const [previousRoomId, setPreviousRoomId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const activeRoomIds = useMemo(() => new Set(activeRooms.map((room) => room.id)), [activeRooms]);

  useBodyScrollLock(true);

  useEffect(() => {
    // The DB-rooms fallback is still time-bounded; the intro no longer waits a fixed minimum —
    // it advances as soon as the current room's texture is ready (see the effect below).
    const roomsTimer = window.setTimeout(() => setTimedOut(true), ROOMS_TIMEOUT_MS);
    return () => window.clearTimeout(roomsTimer);
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
    // Readiness-driven: enter the tour the moment the current room's texture is ready, with no
    // fixed minimum intro and no artificial transition delay. The intro-overlay opacity transition
    // (CSS, reduced-motion aware) is the only visual easing.
    if (texturesLoaded && phase === "intro") setPhase("tour");
  }, [phase, texturesLoaded]);

  useEffect(() => {
    if (!currentRoomId) return;
    setVisited((items) => new Set(items).add(currentRoomId));
  }, [currentRoomId]);

  const handleLoaded = useCallback(() => {
    setTexturesLoaded(true);
    setLoadFailed(false);
  }, []);
  const handleLoadError = useCallback((failed: boolean) => setLoadFailed(failed), []);
  const handleRetry = useCallback(() => {
    setLoadFailed(false);
    setRetryNonce((nonce) => nonce + 1);
  }, []);
  const completeTransition = useCallback(() => {
    setTransitioning(false);
    setPreviousRoomId(null);
  }, []);

  function navigateTo(roomId: string) {
    if (!activeRoomIds.has(roomId)) return;
    if (transitioning || roomId === currentRoomId) return;
    setPreviousRoomId(currentRoomId);
    setSelectedRoomId(roomId);
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

  if (roomsReady && !activeRooms.length) return null;

  const viewer = (
    <div data-testid="tour-viewer" className="fixed inset-0 z-[70] bg-black" style={{ touchAction: "none" }}>
      {/* Keeps the villa identity available to assistive tech once the intro gives way to the tour. */}
      <h2 className="sr-only">{property.name}</h2>
      <div
        className={cn(
          "absolute inset-0 transition-[filter,opacity] duration-700",
          phase === "intro" && "pointer-events-none opacity-0",
          (phase === "conclusion" || phase === "leadCapture") && "blur-md",
        )}
      >
        {activeRooms.length ? (
          <TourCanvas
            rooms={activeRooms}
            currentRoomId={currentRoomId}
            previousRoomId={previousRoomId}
            transitioning={transitioning}
            onTransitionComplete={completeTransition}
            onLoaded={handleLoaded}
            onLoadError={handleLoadError}
            onNavigate={navigateTo}
            retrySignal={retryNonce}
          />
        ) : null}
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
              style={{ width: texturesLoaded ? "100%" : "62%" }}
            />
          </div>
          {!texturesLoaded && !loadFailed ? (
            <p className="mt-3 text-xs text-white/30">{tourT("loading")}</p>
          ) : null}
        </div>
      ) : null}

      {loadFailed ? (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center"
        >
          <p className="font-serif text-xl font-semibold text-white md:text-2xl">
            {tourT("loadFailed")}
          </p>
          <Button
            type="button"
            variant="gold"
            onClick={handleRetry}
            className="rounded-full px-6 shadow-lg shadow-black/30"
          >
            {tourT("retry")}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-white/50 underline-offset-4 hover:text-white hover:underline"
          >
            {a11y("close")}
          </button>
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

  return createPortal(viewer, document.body);
}
