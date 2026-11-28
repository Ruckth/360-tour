"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/platform/auth";
import { useTranslations } from "@/platform/intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { PropertyImage } from "@/components/property/PropertyImage";
import { LeadCapture } from "@/components/tour/LeadCapture";
import type { TourCanvas, TourSceneStatus } from "@/components/tour/TourCanvas";
import { TourConclusion } from "@/components/tour/TourConclusion";
import { TourIntro } from "@/components/tour/TourIntro";
import { TourOverlay } from "@/components/tour/TourOverlay";
import type { PanoramaDetailRequest, PanoramaDetailStatus } from "@/components/tour/useTourTextures";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/data/properties";
import { usePublicMessages } from "@/lib/i18n/use-public-messages";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { useModalFocusTrap } from "@/lib/interaction/use-modal-focus";
import { markTourBench } from "@/lib/tour/bench";
import { resolveTourRooms } from "@/lib/tour/rooms";
import type { TourRenderer } from "@/lib/tour/renderer";
import { useLiveTourRooms } from "@/lib/tour/use-live-tour-rooms";
import { cn } from "@/lib/utils";

type Phase = "intro" | "tour" | "conclusion" | "leadCapture";
const ROOMS_TIMEOUT_MS = 3_000;

export type TourViewerProps = {
  property: Property;
  onClose: () => void;
  onFirstSceneDrawn?: () => void;
  onReady?: (renderer: TourRenderer) => void;
  standardTourHref?: string;
};
type CanvasProps = ComponentProps<typeof TourCanvas>;
type ViewerContentProps = TourViewerProps & {
  Canvas: ComponentType<CanvasProps & { onFallback: () => void }>;
  loadFallbackCanvas?: () => Promise<ComponentType<CanvasProps>>;
};

/** A different villa or signed-in identity starts a new viewer: no scene or selection carries over. */
export function TourViewerContent(props: ViewerContentProps) {
  const { userId } = useAuth();
  return <LiveTourViewer key={`${props.property.id}\n${userId ?? ""}`} {...props} />;
}

function LiveTourViewer({ property, onClose, onFirstSceneDrawn, onReady, standardTourHref, Canvas, loadFallbackCanvas }: ViewerContentProps) {
  const messages = usePublicMessages();
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const { rooms: liveRooms, fresh } = useLiveTourRooms(property.id);
  const [timedOut, setTimedOut] = useState(false);
  // Wait for actual DB rooms; a timeout shows the unavailable state without inventing rooms.
  const roomsReady = liveRooms !== undefined || timedOut;
  const activeRooms = useMemo(
    () => (roomsReady ? resolveTourRooms(property.tourRoomIds, liveRooms, messages) : []),
    [liveRooms, messages, property.tourRoomIds, roomsReady],
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [fallback, setFallback] = useState<"loading" | "failed" | { Canvas: ComponentType<CanvasProps> } | null>(null);
  const reportedReady = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const renderer: TourRenderer = loadFallbackCanvas && fallback === null ? "pannellum" : "three";
  const ActiveCanvas = fallback === null ? Canvas : typeof fallback === "object" ? fallback.Canvas : null;
  // An explicit choice made by navigating; null follows the first room in the current tour order.
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const currentRoom = activeRooms.find((room) => room.id === selectedRoomId) ?? activeRooms[0];
  const currentRoomId = currentRoom?.id ?? "";
  const [previousRoomId, setPreviousRoomId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [sceneStatus, setSceneStatus] = useState<TourSceneStatus>("loading");
  const [detailRequest, setDetailRequest] = useState<PanoramaDetailRequest | null>(null);
  const [detailStatus, setDetailStatus] = useState<PanoramaDetailStatus>(null);
  const [shownRoomId, setShownRoomId] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const activeRoomIds = useMemo(() => new Set(activeRooms.map((room) => room.id)), [activeRooms]);
  // A removed choice falls back to the first room for good, even if that room returns later.
  if (selectedRoomId && liveRooms !== undefined && !activeRoomIds.has(selectedRoomId)) setSelectedRoomId(null);

  useBodyScrollLock(true);
  const emptyState = roomsReady && !activeRooms.length;
  const failed = loadFailed || fallback === "failed";
  useModalFocusTrap(dialogRef, true, emptyState ? "empty" : failed ? "failed" : phase);

  useEffect(() => {
    markTourBench("viewer_mounted");
  }, []);

  useEffect(() => {
    if (fallback !== "loading" || !loadFallbackCanvas) return;
    let active = true;
    void loadFallbackCanvas().then(
      (canvas) => { if (active) setFallback({ Canvas: canvas }); },
      () => { if (active) setFallback("failed"); },
    );
    return () => { active = false; };
  }, [fallback, loadFallbackCanvas]);

  useEffect(() => {
    if (!timedOut || liveRooms !== undefined) return;
    markTourBench("rooms_timeout");
  }, [liveRooms, timedOut]);

  useEffect(() => {
    // Bound the loading state; the intro advances as soon as the current texture is ready.
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

  // The opaque intro covers the canvas through the first panorama draw.
  if (texturesLoaded && phase === "intro") setPhase("tour");

  // A room counts as explored once its panorama is actually on screen, not merely requested.
  if (sceneStatus === "ready" && shownRoomId && shownRoomId === currentRoomId && !visited.has(shownRoomId)) {
    setVisited(new Set(visited).add(shownRoomId));
  }

  const handleLoaded = useCallback(() => {
    setTexturesLoaded(true);
    setLoadFailed(false);
    onFirstSceneDrawn?.();
  }, [onFirstSceneDrawn]);
  const handleLoadError = useCallback((failed: boolean) => setLoadFailed(failed), []);
  function handleRetry() {
    if (fallback === "failed") {
      // A failed module fetch may be cached for this document. Retry the standard tour from a fresh page.
      if (standardTourHref) window.location.replace(standardTourHref);
      else window.location.reload();
      return;
    }
    setLoadFailed(false);
    setRetryNonce((nonce) => nonce + 1);
  }
  const handleStatusChange = useCallback((status: TourSceneStatus, roomId: string | null) => {
    setSceneStatus(status);
    setShownRoomId(roomId);
  }, []);
  const completeTransition = useCallback(() => {
    setTransitioning(false);
    setPreviousRoomId(null);
  }, []);

  // Locked while a room is loading, crossfading or failed, and until the live rooms are confirmed.
  const navigationLocked = transitioning || failed || sceneStatus !== "ready" || !fresh;
  // Neighbors may prefetch only after the intro clears and the confirmed scene accepts input.
  const prefetchNeighborsAllowed = phase === "tour" && !navigationLocked && shownRoomId === currentRoomId;

  useEffect(() => {
    if (!onReady || !prefetchNeighborsAllowed || reportedReady.current) return;
    reportedReady.current = true;
    onReady(renderer);
  }, [onReady, prefetchNeighborsAllowed, renderer]);

  const activateFallback = useCallback(() => {
    setFallback("loading");
    setSceneStatus("loading");
    setShownRoomId(null);
    setLoadFailed(false);
    setTexturesLoaded(false);
    setDetailStatus(null);
    setPreviousRoomId(null);
    setTransitioning(false);
    setPhase((current) => current === "tour" ? "intro" : current);
  }, []);

  function navigateTo(roomId: string) {
    if (!activeRoomIds.has(roomId)) return;
    if (navigationLocked || roomId === currentRoomId) return;
    setPreviousRoomId(currentRoomId);
    setSelectedRoomId(roomId);
    setTransitioning(true);
    setDetailRequest(null);
  }

  const currentRoomIndex = Math.max(
    0,
    activeRooms.findIndex((room) => room.id === currentRoomId),
  );
  const previousRoom = activeRooms[(currentRoomIndex - 1 + activeRooms.length) % activeRooms.length];
  const nextRoom = activeRooms[(currentRoomIndex + 1) % activeRooms.length];

  // A villa without tour rooms still gets a visible, closable screen: the scroll lock above
  // must never outlive what the guest can see and dismiss.
  if (emptyState) {
    return createPortal(
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="tour-viewer"
        data-scene-status="empty"
        role="dialog"
        aria-modal="true"
        aria-label={tourT("viewerLabel", { propertyName: property.name })}
        className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-900 to-black px-6 text-center focus:outline-none"
      >
        <p className="font-serif text-3xl font-semibold text-white md:text-4xl">{property.name}</p>
        <p className="max-w-sm text-sm text-white/60">{tourT("unavailable")}</p>
        <Button
          type="button"
          variant="gold"
          autoFocus
          onClick={onClose}
          className="mt-2 rounded-full px-6 shadow-lg shadow-black/30"
        >
          {a11y("close")}
        </Button>
      </div>,
      document.body,
    );
  }

  const canvas = ActiveCanvas && (!roomsReady || activeRooms.length) ? (
    <ActiveCanvas
      onFallback={activateFallback}
      rooms={activeRooms}
      currentRoomId={currentRoomId}
      previousRoomId={previousRoomId}
      transitioning={transitioning}
      onTransitionComplete={completeTransition}
      onLoaded={handleLoaded}
      onLoadError={handleLoadError}
      onStatusChange={handleStatusChange}
      onNavigate={navigateTo}
      retrySignal={retryNonce}
      detailRequest={detailRequest}
      onDetailStatusChange={setDetailStatus}
      inputLocked={!fresh}
      initialTextureConfirmed={fresh}
      prefetchAllowed={prefetchNeighborsAllowed}
    />
  ) : null;

  const viewer = (
    <div
      ref={dialogRef}
      tabIndex={-1}
      data-testid="tour-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={tourT("viewerLabel", { propertyName: property.name })}
      // Observable scene state (requested vs. on-screen room) for assistive tech and browser tests.
      data-scene-status={fallback === "failed" ? "failed" : sceneStatus}
      data-tour-renderer={renderer}
      data-requested-room={currentRoomId}
      data-shown-room={shownRoomId ?? ""}
      data-live={fresh ? "confirmed" : "unconfirmed"}
      aria-busy={navigationLocked}
      className="fixed inset-0 z-[70] bg-black focus:outline-none"
      style={{ touchAction: "none" }}
    >
      {/* Keeps the villa identity available to assistive tech once the intro gives way to the tour. */}
      <h2 className="sr-only">{property.name}</h2>
      <div
        inert={phase !== "tour" || failed}
        className={cn(
          "absolute inset-0 transition-[filter] duration-700",
          phase === "intro" && "pointer-events-none",
          (phase === "conclusion" || phase === "leadCapture") && "blur-md",
        )}
      >
        {canvas}
      </div>

      {!failed && phase === "intro" ? (
        <TourIntro
          name={property.name}
          closeLabel={a11y("close")}
          loadingLabel={!texturesLoaded && !failed ? tourT("loading") : undefined}
          loaded={texturesLoaded}
          onClose={onClose}
        />
      ) : null}

      {failed ? (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 overflow-hidden bg-black px-6 text-center"
        >
          <PropertyImage images={property.images} alt="" sizes="100vw" imgClassName="opacity-25" />
          <p className="relative font-serif text-xl font-semibold text-white md:text-2xl">
            {tourT("loadFailed")}
          </p>
          <Button
            type="button"
            variant="gold"
            onClick={handleRetry}
            className="relative min-h-11 rounded-full px-6 shadow-lg shadow-black/30"
          >
            {tourT("retry")}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="relative min-h-11 text-sm text-white/80 underline-offset-4 hover:text-white hover:underline"
          >
            {a11y("close")}
          </button>
        </div>
      ) : null}

      {!failed && phase === "tour" ? (
        <>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-30 flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white md:right-6 md:top-5"
            aria-label={a11y("closeTour")}
          >
            <X className="h-5 w-5" />
          </button>
          <TourOverlay
            visitedCount={visited.size}
            rooms={activeRooms}
            currentRoomId={currentRoomId}
            navigationLocked={navigationLocked}
            onSelectRoom={navigateTo}
            onFinish={() => setPhase("conclusion")}
          />
          {detailStatus && !navigationLocked && currentRoom ? (
            <Button
              type="button"
              size="sm"
              variant="glass"
              className="absolute bottom-16 left-3 z-30 rounded-full bg-black/45 text-xs text-white md:bottom-20 md:left-6"
              style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
              aria-live="polite"
              aria-disabled={detailStatus === "loading" || detailStatus === "ready"}
              onClick={() => {
                if (detailStatus === "available" || detailStatus === "failed") {
                  setDetailRequest({ roomId: currentRoom.id, originalPath: currentRoom.imagePath });
                }
              }}
            >
              {tourT(`detail.${detailStatus}`)}
            </Button>
          ) : null}
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
                  // aria-disabled (not disabled) keeps keyboard focus on the control while locked.
                  aria-disabled={navigationLocked}
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
                  // aria-disabled (not disabled) keeps keyboard focus on the control while locked.
                  aria-disabled={navigationLocked}
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

      {!failed && phase === "conclusion" ? (
        <TourConclusion
          property={property}
          onClose={() => setPhase("tour")}
          onLead={() => setPhase("leadCapture")}
        />
      ) : null}

      {!failed && phase === "leadCapture" ? (
        <LeadCapture propertySlug={property.id} onClose={() => setPhase("conclusion")} />
      ) : null}
    </div>
  );

  return createPortal(viewer, document.body);
}
