"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Euler, type MeshBasicMaterial } from "three";
import { Hotspot } from "@/components/tour/Hotspot";
import { RoomSphere } from "@/components/tour/RoomSphere";
import {
  loadPanorama,
  useTourTextures,
  type PanoramaDetailRequest,
  type PanoramaDetailStatus,
  type TaggedTexture,
} from "@/components/tour/useTourTextures";
import type { Room } from "@/lib/data/rooms";
import { markTourBench, tourBench } from "@/lib/tour/bench";
import { choosePanoramaWidth, earlyMobilePanoramaPath, TOUR_CANVAS_DPR } from "@/lib/tour/panoramas";
import { stageFirstTexture } from "@/lib/tour/texture-cache";

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

function effectiveInheritedStyle(
  element: Element,
  property: "pointerEvents" | "visibility",
): string {
  let node: Element | null = element;
  while (node) {
    const value = window.getComputedStyle(node)[property];
    if (value && value !== "inherit") return value;
    node = node.parentElement;
  }
  return "";
}

/**
 * True only when the WebGL canvas is mounted in a visible tab, has non-zero computed opacity
 * (past the t=0 frame of the intro fade), and can receive pointer input (respecting child
 * `pointer-events: auto` overrides and actual pointer hit-testing when laid out).
 */
function isCanvasVisibleForInput(canvas: HTMLCanvasElement): boolean {
  if (!canvas.isConnected) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof canvas.checkVisibility === "function") {
    if (!canvas.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  }
  const visibility = effectiveInheritedStyle(canvas, "visibility");
  if (visibility === "hidden" || visibility === "collapse") return false;
  if (effectiveInheritedStyle(canvas, "pointerEvents") === "none") return false;
  let node: Element | null = canvas;
  while (node) {
    const style = window.getComputedStyle(node);
    if (style.display === "none") return false;
    if (style.opacity !== "" && Number(style.opacity) <= 0) return false;
    node = node.parentElement;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (typeof document.elementFromPoint === "function") {
    const y = rect.top + rect.height / 2;
    const sampleXs = [
      rect.left + rect.width / 2,
      rect.left + rect.width * 0.25,
      rect.left + rect.width * 0.75,
    ];
    if (!sampleXs.some((x) => document.elementFromPoint(x, y) === canvas)) return false;
  }
  return true;
}

/**
 * What the scene is showing, reported to the viewer (navigation lock, overlays, test hooks):
 * - loading: nothing on screen yet (first room still loading)
 * - pending: the requested room is not ready; the last ready room stays on screen, no hotspots
 * - crossfade: both the outgoing and the requested room's textures are on screen, fading
 * - ready: the requested room is fully on screen and interactive
 * - failed: the requested room failed to load (the last ready room, if any, stays on screen)
 */
export type TourSceneStatus = "loading" | "pending" | "crossfade" | "ready" | "failed";

type SceneProps = {
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
  detailRequest?: PanoramaDetailRequest | null;
  onDetailStatusChange?: (status: PanoramaDetailStatus) => void;
  /** No look-around drag while set; hotspot clicks still reach onNavigate, which decides. */
  inputLocked?: boolean;
  /** True only after the intro/overlays clear and the confirmed viewer accepts input. */
  prefetchAllowed?: boolean;
};

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
  detailRequest,
  onDetailStatusChange,
  inputLocked = false,
  prefetchAllowed = false,
}: SceneProps) {
  useEffect(() => markTourBench("sphere_scene_mounted"), []);
  const invalidate = useThree((state) => state.invalidate);
  const canvas = useThree((state) => state.gl.domElement);
  // Three restores its GL objects, but a settled demand-rendered scene needs a draw request.
  useEffect(() => {
    const onRestore = () => invalidate();
    canvas.addEventListener("webglcontextrestored", onRestore);
    return () => canvas.removeEventListener("webglcontextrestored", onRestore);
  }, [canvas, invalidate]);
  const getState = useThree((state) => state.get);
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  // Use one entry size per open tour so a rotation or resize can reuse the prefetched textures.
  const [panoramaWidth] = useState(() => {
    const { size, viewport } = getState();
    return choosePanoramaWidth(size.width, viewport.dpr, maxTextureSize);
  });
  const [drawnShown, setDrawnShown] = useState<TaggedTexture | null>(null);
  const drawnShownRef = useRef<TaggedTexture | null>(null);
  const [presentedShown, setPresentedShown] = useState<TaggedTexture | null>(null);
  const prefetchGate = prefetchAllowed && !inputLocked && !transitioning;
  const { shown, outgoing, currentReady, currentFailed, detailStatus } = useTourTextures({
    rooms,
    currentRoomId,
    previousRoomId,
    panoramaWidth,
    maxTextureSize,
    detailRequest,
    prefetchFor: prefetchGate ? presentedShown : null,
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
  const readyToPresentPrefetch =
    prefetchGate && status === "ready" && currentReady && shown !== null && drawnShown === shown;

  // Reset draw/presentation tracking on unmount (including StrictMode replay).
  useEffect(() => {
    return () => {
      drawnShownRef.current = null;
      setDrawnShown(null);
      setPresentedShown(null);
    };
  }, []);

  // Ensure a newly committed `shown` texture always schedules a WebGL draw so `onAfterRender` runs.
  useEffect(() => {
    if (shown && drawnShown !== shown) invalidate();
  }, [drawnShown, invalidate, shown]);

  // Wait until the drawn canvas is visibly painted (past intro fade) and one post-paint frame
  // has passed before enabling speculative neighbor prefetch.
  useEffect(() => {
    if (!readyToPresentPrefetch || !shown || presentedShown === shown) return;
    let cancelled = false;
    let seenVisibleFrame = false;
    let rafId = 0;

    const step = () => {
      if (cancelled) return;
      if (!isCanvasVisibleForInput(canvas)) {
        seenVisibleFrame = false;
        rafId = window.requestAnimationFrame(step);
        return;
      }
      if (!seenVisibleFrame) {
        seenVisibleFrame = true;
        rafId = window.requestAnimationFrame(step);
        return;
      }
      setPresentedShown(shown);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [canvas, presentedShown, readyToPresentPrefetch, shown]);

  // Report readiness/failure up to the viewer (drives the intro → tour progression).
  useEffect(() => {
    if (currentReady) onLoaded();
  }, [currentReady, onLoaded]);
  useEffect(() => {
    onLoadError?.(currentFailed);
  }, [currentFailed, onLoadError]);
  useEffect(() => {
    onStatusChange?.(status, shownRoomId);
  }, [onStatusChange, shownRoomId, status]);
  useEffect(() => {
    onDetailStatusChange?.(detailStatus);
  }, [detailStatus, onDetailStatusChange]);

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

  const probe = tourBench();
  const currentRoom = rooms.find((room) => room.id === currentRoomId) ?? rooms[0];
  const showHotspots = !transitioning && currentReady && currentRoom;

  return (
    <>
      <TourCamera enabled={!inputLocked} />
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
          onAfterRender={(_gl, _scene, camera, _geometry, material) => {
            if (material.opacity <= 0) return;
            if (drawnShownRef.current !== shown) {
              drawnShownRef.current = shown;
              setDrawnShown(shown);
            }
            if (probe) {
              probe.frame(new Euler().setFromQuaternion(camera.quaternion, "YXZ").y, shown.roomId);
            }
          }}
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

export function TourCanvas({
  initialTextureConfirmed,
  ...props
}: SceneProps & { initialTextureConfirmed: boolean }) {
  const originalPath = props.rooms.find((room) => room.id === props.currentRoomId)?.imagePath;
  const [initialSelection] = useState(() => ({ roomId: props.currentRoomId, originalPath }));
  const [firstTexture] = useState(() => stageFirstTexture(props.loader ?? loadPanorama));
  useLayoutEffect(() => {
    if (!initialTextureConfirmed || !originalPath || initialSelection.roomId !== props.currentRoomId ||
      initialSelection.originalPath !== originalPath) return;
    const path = earlyMobilePanoramaPath(originalPath, window.innerWidth);
    if (path) firstTexture.start(path);
    return firstTexture.release;
  }, [firstTexture, initialSelection, originalPath, props.currentRoomId, initialTextureConfirmed]);
  useEffect(() => markTourBench("canvas_mounted"), []);
  return (
    <Canvas
      // Demand rendering: no continuous loop. Frames are drawn only when something invalidates —
      // texture ready, crossfade in motion, camera-damping "change" events, and R3F's own resize.
      onCreated={tourBench() ? () => markTourBench("webgl_created") : undefined}
      frameloop="demand"
      dpr={TOUR_CANVAS_DPR}
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <SphereScene {...props} loader={firstTexture.load} />
    </Canvas>
  );
}
