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

function SphereScene({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onLoadError,
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
  onNavigate: (roomId: string) => void;
  loader?: Parameters<typeof useTourTextures>[0]["loader"];
  retrySignal?: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const { currentTexture, previousTexture, currentReady, currentFailed } = useTourTextures({
    rooms,
    currentRoomId,
    previousRoomId,
    onInvalidate: invalidate,
    retrySignal,
    ...(loader ? { loader } : {}),
  });

  const progressRef = useRef(1);
  const completedRef = useRef(false);
  const previousMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const currentMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const activeRoomIds = useMemo(() => new Set(rooms.map((room) => room.id)), [rooms]);

  // Report readiness/failure up to the viewer (drives the intro → tour progression).
  useEffect(() => {
    if (currentReady) onLoaded();
  }, [currentReady, onLoaded]);
  useEffect(() => {
    onLoadError(currentFailed);
  }, [currentFailed, onLoadError]);

  // A crossfade only runs when the incoming texture is already available, so it never flashes empty.
  const canCrossfade = transitioning && Boolean(previousTexture) && Boolean(currentTexture);

  useEffect(() => {
    progressRef.current = canCrossfade ? 0 : 1;
    completedRef.current = false;
    if (previousMaterialRef.current) previousMaterialRef.current.opacity = canCrossfade ? 1 : 0;
    if (currentMaterialRef.current) currentMaterialRef.current.opacity = canCrossfade ? 0 : 1;
    invalidate();
    // If we are "transitioning" but cannot crossfade (incoming not ready), complete immediately so
    // navigation is never stuck waiting on a texture that is still loading.
    if (transitioning && !canCrossfade && !completedRef.current) {
      completedRef.current = true;
      onTransitionComplete();
    }
  }, [canCrossfade, currentRoomId, invalidate, onTransitionComplete, transitioning]);

  useFrame((state, delta) => {
    if (!canCrossfade) return;
    const next = Math.min(1, progressRef.current + delta / 0.4);
    progressRef.current = next;
    if (previousMaterialRef.current) previousMaterialRef.current.opacity = 1 - next;
    if (currentMaterialRef.current) currentMaterialRef.current.opacity = next;
    // Demand rendering: keep repainting every frame while the crossfade is in motion.
    state.invalidate();
    if (next >= 1 && !completedRef.current) {
      completedRef.current = true;
      onTransitionComplete();
    }
  });

  const currentRoom = rooms.find((room) => room.id === currentRoomId) ?? rooms[0];

  return (
    <>
      <TourCamera />
      {previousTexture && canCrossfade ? (
        <RoomSphere texture={previousTexture} opacity={1} materialRef={previousMaterialRef} />
      ) : null}
      {currentTexture ? (
        <RoomSphere
          texture={currentTexture}
          opacity={canCrossfade ? 0 : 1}
          materialRef={currentMaterialRef}
        />
      ) : null}
      {!transitioning && currentRoom
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

export function TourCanvas({
  rooms,
  currentRoomId,
  previousRoomId,
  transitioning,
  onTransitionComplete,
  onLoaded,
  onLoadError,
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
        onLoadError={onLoadError ?? (() => {})}
        onNavigate={onNavigate}
        loader={loader}
        retrySignal={retrySignal}
      />
    </Canvas>
  );
}
