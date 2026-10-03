"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { MeshBasicMaterial } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import { useTourTextures } from "@/components/tour/useTourTextures";
import type { Room } from "@/lib/data/rooms";

/** The viewer at the sphere's center, looking around by dragging. */
export function TourCamera({ enabled = true }: { enabled?: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  // Demand rendering: OrbitControls damping keeps settling for several frames after the pointer is
  // released, emitting "change" events the whole time. Invalidating on each one repaints until the
  // camera comes to rest, so dragging stays smooth without a continuous render loop.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange);
    return () => controls.removeEventListener("change", onChange);
  }, [invalidate]);

  return (
    <>
      <PerspectiveCamera makeDefault fov={75} near={0.1} far={1100} position={[0, 0, 0.1]} />
      <OrbitControls
        ref={controlsRef}
        enabled={enabled}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={-0.45}
      />
    </>
  );
}

/** Longest frame step the crossfade will take, so a stalled tab cannot skip the fade. */
const MAX_CROSSFADE_STEP_S = 1 / 30;
const CROSSFADE_DURATION_S = 0.4;

/**
 * What the scene is showing, reported to the viewer (navigation lock, overlays, test hooks):
 * - loading: nothing on screen yet (first room still loading)
 * - pending: the requested room is not ready; the last ready room stays on screen, no hotspots
 * - crossfade: both the outgoing and the requested room's textures are on screen, fading
 * - ready: the requested room is fully on screen and interactive
 * - failed: the requested room failed to load (the last ready room, if any, stays on screen)
 */
export type TourSceneStatus = "loading" | "pending" | "crossfade" | "ready" | "failed";

function SphereScene({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onLoadError,
  onStatusChange,
  onNavigate,
  loader,
  retrySignal,
}: {
  rooms: Room[];
  currentRoomId: string;
  previousRoomId: string | null;
  transitioning: boolean;
  onTransitionComplete: () => void;
  onLoaded: () => void;
  onLoadError: (failed: boolean) => void;
  onStatusChange?: (status: TourSceneStatus, shownRoomId: string | null) => void;
  onNavigate: (roomId: string) => void;
  loader?: Parameters<typeof useTourTextures>[0]["loader"];
  retrySignal?: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const { shown, outgoing, currentReady, currentFailed } = useTourTextures({
    rooms,
    currentRoomId,
    previousRoomId,
    onInvalidate: invalidate,
    retrySignal,
    ...(loader ? { loader } : {}),
  });

  const progressRef = useRef(1);
  const completedRef = useRef(false);
  const activeCrossfadeRef = useRef<string | null>(null);
  const incomingMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const activeRoomIds = useMemo(() => new Set(rooms.map((room) => room.id)), [rooms]);

  // A crossfade needs two ACTUAL textures: the requested room's (ready) and a different outgoing one.
  const crossfadeKey =
    transitioning && currentReady && shown && outgoing && outgoing.roomId !== shown.roomId
      ? `${outgoing.roomId}->${shown.roomId}`
      : null;
  const pending = !currentReady;
  // Explicit no-previous case: the requested room is ready and there is nothing to fade from.
  const readyWithoutPrevious = transitioning && currentReady && crossfadeKey === null;

  const status: TourSceneStatus = currentFailed
    ? "failed"
    : !shown
      ? "loading"
      : pending
        ? "pending"
        : crossfadeKey
          ? "crossfade"
          : transitioning
            ? "pending"
            : "ready";
  const shownRoomId = shown?.roomId ?? null;

  // Report readiness/failure up to the viewer (drives the intro → tour progression).
  useEffect(() => {
    if (currentReady) onLoaded();
  }, [currentReady, onLoaded]);
  useEffect(() => {
    onLoadError(currentFailed);
  }, [currentFailed, onLoadError]);
  useEffect(() => {
    onStatusChange?.(status, shownRoomId);
  }, [onStatusChange, shownRoomId, status]);

  useEffect(() => {
    if (readyWithoutPrevious) onTransitionComplete();
  }, [onTransitionComplete, readyWithoutPrevious]);

  useFrame((state, delta) => {
    if (!crossfadeKey) return;
    let step = Math.min(delta, MAX_CROSSFADE_STEP_S);
    if (activeCrossfadeRef.current !== crossfadeKey) {
      // First frame of this crossfade: demand rendering may have idled for seconds, so the clock
      // delta is meaningless here — start from zero instead of jumping to the end.
      activeCrossfadeRef.current = crossfadeKey;
      progressRef.current = 0;
      completedRef.current = false;
      step = 0;
    }
    if (completedRef.current) return;
    const next = Math.min(1, progressRef.current + step / CROSSFADE_DURATION_S);
    progressRef.current = next;
    if (incomingMaterialRef.current) incomingMaterialRef.current.opacity = next;
    if (next >= 1) {
      completedRef.current = true;
      onTransitionComplete();
      return;
    }
    // Demand rendering: keep repainting every frame while the crossfade is in motion.
    state.invalidate();
  });

  const currentRoom = rooms.find((room) => room.id === currentRoomId) ?? rooms[0];
  const showHotspots = !transitioning && currentReady && currentRoom;

  return (
    <>
      <TourCamera />
      {crossfadeKey && outgoing ? (
        // Opaque and drawn first; the incoming sphere fades in over it (a true crossfade).
        <RoomSphere key={`outgoing:${outgoing.roomId}`} texture={outgoing.texture} opacity={1} />
      ) : null}
      {shown ? (
        // Keyed by room so each room's material is created with the right `transparent` flag
        // (three compiles opaque materials with alpha forced to 1; toggling it later is ignored).
        <RoomSphere
          key={`shown:${shown.roomId}`}
          texture={shown.texture}
          opacity={crossfadeKey ? 0 : 1}
          materialRef={incomingMaterialRef}
        />
      ) : null}
      {showHotspots
        ? currentRoom.hotspots
            .filter((hotspot) => activeRoomIds.has(hotspot.targetRoomId))
            .map((hotspot) => (
              <Hotspot
                key={hotspot.id}
                position={hotspot.position}
                label={hotspot.label}
                onClick={() => onNavigate(hotspot.targetRoomId)}
              />
            ))
        : null}
    </>
  );
}

function noop() {}

export function TourCanvas({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onLoadError,
  onStatusChange,
  onNavigate,
  loader,
  retrySignal,
}: {
  rooms: Room[];
  currentRoomId: string;
  previousRoomId: string | null;
  transitioning: boolean;
  onTransitionComplete: () => void;
  onLoaded: () => void;
  onLoadError?: (failed: boolean) => void;
  onStatusChange?: (status: TourSceneStatus, shownRoomId: string | null) => void;
  onNavigate: (roomId: string) => void;
  loader?: Parameters<typeof useTourTextures>[0]["loader"];
  retrySignal?: number;
}) {
  return (
    <Canvas
      // Demand rendering: no continuous loop. Frames are drawn only when something invalidates —
      // texture ready, crossfade in motion, camera-damping "change" events, and R3F's own resize.
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <SphereScene
        rooms={rooms}
        currentRoomId={currentRoomId}
        previousRoomId={previousRoomId}
        transitioning={transitioning}
        onTransitionComplete={onTransitionComplete}
        onLoaded={onLoaded}
        onLoadError={onLoadError ?? noop}
        onStatusChange={onStatusChange}
        onNavigate={onNavigate}
        loader={loader}
        retrySignal={retrySignal}
      />
    </Canvas>
  );
}
