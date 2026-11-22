"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Euler, type Mesh, type MeshBasicMaterial } from "three";
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
import { preparePanoramaFilter } from "@/lib/tour/panorama-filter";
import { firstPanoramaLoader } from "@/lib/tour/first-panorama-cache";
import { stageFirstTexture } from "@/lib/tour/texture-cache";

const TOUR_CAMERA = {
  fov: 75,
  near: 0.1,
  far: 1100,
  position: [0, 0, 0.1],
} satisfies NonNullable<React.ComponentProps<typeof Canvas>["camera"]>;

/** Standalone camera for the hotspot editor's independently configured canvas. */
export function TourCamera({ enabled = true }: { enabled?: boolean }) {
  return (
    <>
      <PerspectiveCamera makeDefault {...TOUR_CAMERA} />
      <TourControls enabled={enabled} />
    </>
  );
}

function TourControls({ enabled }: { enabled: boolean }) {
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
    <OrbitControls
      ref={controlsRef}
      enabled={enabled}
      enableZoom={false}
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={-0.45}
    />
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
  canPrefetch,
  isRequestedTexture,
  isRequestedSource,
}: SceneProps & {
  canPrefetch: () => boolean;
  isRequestedTexture: (item: TaggedTexture) => boolean;
  isRequestedSource: (roomId: string, originalPath: string) => boolean;
}) {
  useEffect(() => markTourBench("sphere_scene_mounted"), []);
  const invalidate = useThree((state) => state.invalidate);
  const canvas = useThree((state) => state.gl.domElement);
  const drawnShownRef = useRef<TaggedTexture | null>(null);
  const contextLost = useRef(false);
  const contextVersion = useRef(0);
  const [drawnContextVersion, setDrawnContextVersion] = useState(0);
  useLayoutEffect(() => {
    const onLost = () => {
      contextLost.current = true;
      contextVersion.current++;
      drawnShownRef.current = null;
    };
    const onRestore = () => {
      contextLost.current = false;
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestore);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestore);
    };
  }, [canvas, invalidate]);
  const getState = useThree((state) => state.get);
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  // Use one entry size per open tour so a rotation or resize can reuse the prefetched textures.
  const [panoramaWidth] = useState(() => {
    const { size, viewport } = getState();
    return choosePanoramaWidth(size.width, viewport.dpr, maxTextureSize);
  });
  const isDrawnAndInteractive = useCallback((item: TaggedTexture) =>
    !contextLost.current && drawnShownRef.current === item && isCanvasVisibleForInput(canvas), [canvas]);
  // Every queue drain asks this before starting a speculative download.
  const canPrefetchDrawn = useCallback(() =>
    !contextLost.current && contextVersion.current === drawnContextVersion && canPrefetch(),
  [canPrefetch, drawnContextVersion]);
  const prefetchGate = prefetchAllowed && !inputLocked && !transitioning;
  const { shown, outgoing, currentReady, currentFailed, detailStatus } = useTourTextures({
    rooms,
    currentRoomId,
    previousRoomId,
    panoramaWidth,
    maxTextureSize,
    detailRequest,
    isDrawnAndInteractive: prefetchGate ? isDrawnAndInteractive : undefined,
    canPrefetch: canPrefetchDrawn,
    contextEpoch: drawnContextVersion,
    isCurrentSource: isRequestedSource,
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
  const probe = tourBench();
  const recordDraw = useCallback<Mesh["onAfterRender"]>((_gl, _scene, camera, _geometry, material) => {
    if (contextLost.current || !shown || material.opacity <= 0) return;
    if (drawnShownRef.current !== shown && currentReady && isRequestedTexture(shown)) {
      drawnShownRef.current = shown;
      // A callback from the lost context cannot drain the new generation, even between
      // this draw and the next two presented frames.
      if (contextVersion.current !== drawnContextVersion) setDrawnContextVersion(contextVersion.current);
      onLoaded();
    }
    if (probe) probe.frame(new Euler().setFromQuaternion(camera.quaternion, "YXZ").y, shown.roomId);
  }, [currentReady, drawnContextVersion, isRequestedTexture, onLoaded, probe, shown]);

  // Data and navigation status can update independently of the first visible draw.
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
    if (shown && state.camera && state.gl?.domElement.height) {
      const context = state.gl.getContext();
      const canvas = state.gl.domElement;
      // A constrained GPU may allocate a smaller surface. In that case retain full mip filtering.
      const height = context.drawingBufferWidth === canvas.width && context.drawingBufferHeight === canvas.height
        ? context.drawingBufferHeight : 0;
      preparePanoramaFilter(shown.texture, shown.path, state.camera, height);
      if (outgoing) preparePanoramaFilter(outgoing.texture, outgoing.path, state.camera, height);
    }
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
      <TourControls enabled={!inputLocked} />
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
          onAfterRender={recordDraw}
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
  // R3F commits its scene in a separate React root. A draw or a free download slot
  // must observe selection changes already committed in the DOM viewer.
  const latest = useRef<SceneProps | null>(null);
  useLayoutEffect(() => {
    latest.current = props;
    return () => { latest.current = null; };
  });
  const { rooms, currentRoomId, retrySignal, detailRequest } = props;
  const canPrefetch = useCallback(() => {
    const current = latest.current;
    return !!current && current.rooms === rooms && current.currentRoomId === currentRoomId &&
      current.retrySignal === retrySignal && current.detailRequest === detailRequest &&
      current.prefetchAllowed === true && !current.transitioning && !current.inputLocked;
  }, [currentRoomId, detailRequest, retrySignal, rooms]);
  const originalPath = rooms.find(room => room.id === currentRoomId)?.imagePath;
  const isRequestedSource = useCallback((roomId: string, path: string) => {
    const current = latest.current;
    // The last confirmed scene can remain visible while reconnecting; navigation and
    // speculation have separate freshness gates. A replaced room or source never qualifies.
    return roomId === currentRoomId && path === originalPath && !!current && current.currentRoomId === roomId &&
      current.rooms.find(room => room.id === roomId)?.imagePath === path;
  }, [currentRoomId, originalPath]);
  const isRequestedTexture = useCallback(
    (item: TaggedTexture) => isRequestedSource(item.roomId, item.originalPath),
    [isRequestedSource],
  );
  const initialSelection = useRef<{ roomId: string; originalPath: string } | null>(null);
  // The first bundled 2048 panorama of an open may reuse the CPU copy kept from a previous open.
  const [firstPanorama] = useState(() => firstPanoramaLoader(props.loader ?? loadPanorama));
  useEffect(() => firstPanorama.open(), [firstPanorama]);
  const [firstTexture] = useState(() => stageFirstTexture(firstPanorama.load));
  useLayoutEffect(() => {
    if (!originalPath) return;
    initialSelection.current ??= { roomId: props.currentRoomId, originalPath };
    if (!initialTextureConfirmed || initialSelection.current.roomId !== props.currentRoomId ||
      initialSelection.current.originalPath !== originalPath) return;
    const path = earlyMobilePanoramaPath(originalPath, window.innerWidth);
    if (path) firstTexture.start(path);
    return firstTexture.release;
  }, [firstTexture, originalPath, props.currentRoomId, initialTextureConfirmed]);
  useEffect(() => markTourBench("canvas_mounted"), []);
  return (
    <Canvas
      // Demand rendering: no continuous loop. Frames are drawn only when something invalidates —
      // texture ready, crossfade in motion, camera-damping "change" events, and R3F's own resize.
      onCreated={tourBench() ? () => markTourBench("webgl_created") : undefined}
      // This surface is fixed to the viewport. Observe its first size and rotations
      // immediately so renderer creation can overlap the live room lookup.
      resize={{ scroll: false, debounce: 0 }}
      frameloop="demand"
      camera={TOUR_CAMERA}
      dpr={TOUR_CANVAS_DPR}
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      {originalPath ? <SphereScene {...props} loader={firstTexture.load} canPrefetch={canPrefetch} isRequestedTexture={isRequestedTexture} isRequestedSource={isRequestedSource} /> : null}
    </Canvas>
  );
}
