"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { TourCanvas, TourSceneStatus } from "@/components/tour/TourCanvas";
import type { PanoramaDetailStatus } from "@/components/tour/useTourTextures";
import type { Room } from "@/lib/data/rooms";
import { markTourBench, tourBench } from "@/lib/tour/bench";
import { choosePanoramaWidth, panoramaRendition, TOUR_CANVAS_DPR } from "@/lib/tour/panoramas";
import { INITIAL_VIEW, PANNELLUM_STRINGS, pannellumErrorKind, pannellumView, tourHfov } from "@/lib/tour/pannellum-view";
import { nextRoomPrefetchOrder } from "@/lib/tour/texture-cache";

export type PannellumTourCanvasProps = ComponentProps<typeof TourCanvas> & {
  /** The Pannellum renderer cannot continue (no usable WebGL, lost context, unsupported detail): mount the existing renderer. */
  onFallback: () => void;
};

type Camera = { yaw: number; pitch: number; hfov: number };
type PanoramaRenderer = {
  render(pitch: number, yaw: number, hfov: number, options?: { returnImage?: boolean; roll?: number }): unknown;
};
type PannellumViewer = {
  on(type: string, listener: (value?: unknown) => void): PannellumViewer;
  addScene(id: string, config: object): PannellumViewer;
  loadScene(id: string, pitch?: number | "same", yaw?: number | "same", hfov?: number | "same"): PannellumViewer;
  getRenderer(): PanoramaRenderer;
  getYaw(): number;
  getPitch(): number;
  getHfov(): number;
  setHfov(hfov: number, animated: false): PannellumViewer;
  setHfovBounds(bounds: [number, number]): PannellumViewer;
  resize(): void;
  destroy(): void;
};
type PannellumGlobal = { viewer(container: HTMLElement, config: object): PannellumViewer };

/** One panorama scene: the room and source it shows, the file loaded and the hotspots it carries. */
type Scene = { id: string; roomId: string; originalPath: string; path: string; room: Room };

/** Longest wait for the browser to restore a lost WebGL context before the existing renderer takes over. */
const CONTEXT_RESTORE_TIMEOUT_MS = 3_000;
/** Context recoveries per open tour; a device that keeps losing its context gets the existing renderer. */
const MAX_CONTEXT_RECOVERIES = 2;
const SCENE_FADE_MS = 180;
const PREFETCH_LIMIT = 2;

let pannellumScript: Promise<PannellumGlobal> | undefined;
function loadPannellum(): Promise<PannellumGlobal> {
  pannellumScript ??= Promise.all([
    import("pannellum/build/pannellum.js"),
    import("pannellum/build/pannellum.css"),
  ]).then(() => {
    const global = (window as { pannellum?: PannellumGlobal }).pannellum;
    if (!global) throw new Error("Pannellum did not load");
    return global;
  });
  // A failed chunk can be retried by a later open.
  void pannellumScript.catch(() => { pannellumScript = undefined; });
  return pannellumScript;
}

function sceneFor(room: Room, path: string): Scene {
  const hotspots = room.hotspots.map(({ id, targetRoomId, label, position }) => [id, targetRoomId, label, ...position]);
  return { id: JSON.stringify([room.id, room.imagePath, path, hotspots]), roomId: room.id, originalPath: room.imagePath, path, room };
}

/** Pannellum's scene config: the panorama and accessible hotspot buttons to rooms still in the tour. */
function sceneConfig(scene: Scene, latest: { current: PannellumTourCanvasProps }) {
  const activeIds = new Set(latest.current.rooms.map((item) => item.id));
  return {
    type: "equirectangular",
    panorama: scene.path,
    hotSpots: scene.room.hotspots.filter((hotspot) => activeIds.has(hotspot.targetRoomId)).map((hotspot) => ({
      id: hotspot.id,
      ...pannellumView(hotspot.position),
      cssClass: "tour-pannellum-hotspot",
      createTooltipFunc: (div: HTMLElement) => {
        div.append(hotspotButton(hotspot.label, () => {
          // The viewer's navigation decides whether the guest may move now.
          if (latest.current.rooms.some((item) => item.id === hotspot.targetRoomId)) {
            latest.current.onNavigate(hotspot.targetRoomId);
          }
        }));
      },
    })),
  };
}

const HOTSPOT_CLASS =
  "group pointer-events-auto flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-black/45 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md transition hover:bg-white hover:text-black";
const SVG_NS = "http://www.w3.org/2000/svg";

/** The guest hotspot button of the existing renderer, built as DOM because Pannellum positions it each frame. */
function hotspotButton(label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.testid = "tour-hotspot";
  button.className = HOTSPOT_CLASS;
  // Pannellum sets content-box on everything inside its container.
  button.style.boxSizing = "border-box";
  button.addEventListener("click", onClick);
  const dot = document.createElement("span");
  dot.className = "flex h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_18px_rgba(214,166,72,0.9)]";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "h-3.5 w-3.5 transition group-hover:translate-x-0.5");
  for (const d of ["M18 8L22 12L18 16", "M2 12H22"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.append(dot, label, svg);
  return button;
}

/**
 * Guest panorama renderer on Pannellum, a drop-in for {@link TourCanvas}. It loads only the requested
 * room's rendition (the original when the rendition fails), keeps the last ready room on screen while
 * the next one loads, and reports the same scene status, load, failure and transition callbacks.
 * Anything it cannot do itself — no usable WebGL, a context the browser does not restore in time,
 * repeated context loss, or a full-detail request — calls `onFallback` for the existing renderer.
 */
export function PannellumTourCanvas({ onFallback, ...props }: PannellumTourCanvasProps) {
  const {
    rooms, currentRoomId, transitioning, onTransitionComplete, onLoadError, onStatusChange,
    retrySignal, detailRequest, onDetailStatusChange, initialTextureConfirmed,
    inputLocked = false, prefetchAllowed = false, onLoaded,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // Event handlers run outside React: they read the committed props, never a stale render.
  const latest = useRef<PannellumTourCanvasProps>({ ...props, onFallback });
  useLayoutEffect(() => {
    latest.current = { ...props, onFallback };
  });
  // One entry size per open tour, as in the existing renderer. Pannellum splits wide images across two
  // textures and reports an oversized one as a renderer error, which falls back.
  const [panoramaWidth] = useState(() =>
    choosePanoramaWidth(window.innerWidth, Math.min(window.devicePixelRatio || 1, TOUR_CANVAS_DPR[1]), 4096));

  const room = rooms.find((item) => item.id === currentRoomId);
  const rendition = room ? panoramaRendition(room.imagePath, panoramaWidth) : null;
  const roomKey = room ? `${room.id}\n${room.imagePath}` : null;
  // A rendition that fails to load is replaced by the original, as in the existing renderer.
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const wanted = useMemo(() => {
    if (!room) return null;
    const useOriginal = originalFor === `${room.id}\n${room.imagePath}`;
    return sceneFor(room, useOriginal ? room.imagePath : panoramaRendition(room.imagePath, panoramaWidth).path);
  }, [originalFor, panoramaWidth, room]);
  const hasScene = wanted !== null;

  const [shown, setShown] = useState<Scene | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [library, setLibrary] = useState<PannellumGlobal>();
  const [started, setStarted] = useState(false);
  const mountViewer = !!library && hasScene && (started || initialTextureConfirmed);
  // Once mounted, keep the last confirmed room visible if the catalog connection drops.
  if (mountViewer && !started) setStarted(true);

  const viewerRef = useRef<PannellumViewer | null>(null);
  const loadingRef = useRef<Scene | null>(null);
  const shownRef = useRef<Scene | null>(null);
  const wantedRef = useRef(wanted);
  const failedRef = useRef(failedKey);
  const recoveringRef = useRef(false);
  const waitingForConfirmation = useRef<Scene | null>(null);
  const recoveries = useRef(0);
  const fellBack = useRef(false);
  useLayoutEffect(() => {
    wantedRef.current = wanted;
    failedRef.current = failedKey;
  });

  const fallback = useCallback(() => {
    if (fellBack.current) return;
    fellBack.current = true;
    markTourBench("pannellum_fallback");
    latest.current.onFallback();
  }, []);

  /** Starts loading the wanted scene when the viewer is idle; Pannellum ignores loadScene mid-load. */
  const reconcile = useCallback(() => {
    const viewer = viewerRef.current;
    const next = wantedRef.current;
    if (!viewer || !next || loadingRef.current || recoveringRef.current || !latest.current.initialTextureConfirmed) return;
    if (shownRef.current?.id === next.id) return;
    if (failedRef.current === `${next.roomId}\n${next.originalPath}`) return;
    loadingRef.current = next;
    viewer.addScene(next.id, sceneConfig(next, latest));
    viewer.loadScene(next.id, "same", "same", "same");
  }, []);

  useEffect(() => {
    let active = true;
    void loadPannellum().then(
      (loaded) => { if (active) setLibrary(loaded); },
      () => { if (active) fallback(); },
    );
    return () => { active = false; };
  }, [fallback]);

  // Viewer lifecycle: create only after confirmation, and destroy on unmount.
  useEffect(() => {
    const container = containerRef.current;
    const first = shownRef.current ?? wantedRef.current;
    if (!container || !first || !library || !mountViewer) return;
    let disposed = false;
    let camera: Camera | null = null;
    let restoreTimer: number | undefined;
    let instance: { viewer: PannellumViewer; host: HTMLDivElement } | null = null;

    function disposeInstance(viewer: PannellumViewer, host: HTMLDivElement) {
      try {
        viewer.destroy();
      } finally {
        host.remove();
      }
    }

    function disposeCurrent() {
      const previous = instance;
      instance = null;
      viewerRef.current = null;
      if (previous) disposeInstance(previous.viewer, previous.host);
    }

    function create(global: PannellumGlobal, scene: Scene, view: Camera | null) {
      const hfov = view?.hfov ?? tourHfov(container!.clientWidth, container!.clientHeight);
      loadingRef.current = scene;
      // A late completion belongs to this host only. Pannellum clears its host in destroy().
      const host = document.createElement("div");
      Object.assign(host.style, { position: "absolute", inset: "0", background: "#000", fontFamily: "inherit", lineHeight: "inherit" });
      container!.append(host);
      const config = {
        default: {
          firstScene: scene.id,
          autoLoad: true,
          showControls: false,
          compass: false,
          mouseZoom: false,
          doubleClickZoom: false,
          keyboardZoom: false,
          disableKeyboardCtrl: true,
          // Look-around matches the existing renderer: drag only, no zoom.
          hfov,
          minHfov: hfov,
          maxHfov: hfov,
          yaw: view?.yaw ?? INITIAL_VIEW.yaw,
          pitch: view?.pitch ?? INITIAL_VIEW.pitch,
          sceneFadeDuration: SCENE_FADE_MS,
          backgroundColor: [0, 0, 0],
          strings: PANNELLUM_STRINGS,
        },
        scenes: { [scene.id]: sceneConfig(scene, latest) },
      };
      let viewer: PannellumViewer;
      try {
        viewer = global.viewer(host, config);
      } catch (error) {
        host.remove();
        throw error;
      }
      instance = { viewer, host };
      viewerRef.current = viewer;

      function isCurrent() {
        if (!disposed && viewerRef.current === viewer) return true;
        // The library's image request can finish after destroy() and allocate a renderer and
        // document listeners. Dispose again once that callback stack has returned.
        queueMicrotask(() => disposeInstance(viewer, host));
        return false;
      }
      let instrumented: PanoramaRenderer | undefined;
      viewer.on("load", () => {
        if (!isCurrent()) return;
        const loaded = loadingRef.current;
        loadingRef.current = null;
        if (!loaded) return;
        markTourBench("pannellum_scene_loaded");
        shownRef.current = loaded;
        const probe = tourBench();
        if (probe) {
          // The load event precedes the library's first draw. Observe its actual render call,
          // excluding the offscreen snapshots it uses to build a scene transition.
          const renderer = viewer.getRenderer();
          if (renderer !== instrumented) {
            const draw = renderer.render;
            renderer.render = (...args) => {
              const result = draw.apply(renderer, args);
              const visible = shownRef.current;
              if (!disposed && viewerRef.current === viewer && visible && !recoveringRef.current && !args[3]?.returnImage) {
                probe.frame(args[1], visible.roomId);
              }
              return result;
            };
            instrumented = renderer;
          }
        }
        recoveringRef.current = false;
        setRecovering(false);
        setShown(loaded);
        setFading(!!container!.querySelector(".pnlm-fade-img"));
        const current = latest.current;
        waitingForConfirmation.current = null;
        if (current.currentRoomId === loaded.roomId &&
          current.rooms.find((item) => item.id === loaded.roomId)?.imagePath === loaded.originalPath) {
          if (current.initialTextureConfirmed) current.onLoaded();
          else waitingForConfirmation.current = loaded;
        }
        reconcile();
      });
      viewer.on("scenechangefadedone", () => {
        if (!disposed && viewerRef.current === viewer) setFading(false);
      });
      viewer.on("error", (message) => {
        if (!isCurrent()) return;
        const failed = loadingRef.current;
        loadingRef.current = null;
        if (pannellumErrorKind(message) === "renderer" || !failed) {
          fallback();
          return;
        }
        // Pannellum hides the panorama on any error: nothing stays on screen. The state set
        // here (original instead of rendition, or a failed room) reconciles the next scene.
        shownRef.current = null;
        setShown(null);
        setFading(false);
        const key = `${failed.roomId}\n${failed.originalPath}`;
        if (failed.path !== failed.originalPath) {
          setOriginalFor(key);
        } else {
          markTourBench("texture_load_failed");
          failedRef.current = key;
          setFailedKey(key);
        }
      });
    }

    function onContextLost(event: Event) {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const viewer = viewerRef.current;
      if (!viewer) return;
      // Allow the browser to restore the context; until then the scene is not interactive.
      event.preventDefault();
      camera = { yaw: viewer.getYaw(), pitch: viewer.getPitch(), hfov: viewer.getHfov() };
      recoveringRef.current = true;
      setRecovering(true);
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(fallback, CONTEXT_RESTORE_TIMEOUT_MS);
    }
    function onContextRestored(event: Event) {
      if (!(event.target instanceof HTMLCanvasElement) || !recoveringRef.current) return;
      window.clearTimeout(restoreTimer);
      if (++recoveries.current > MAX_CONTEXT_RECOVERIES) {
        fallback();
        return;
      }
      // Pannellum cannot rebuild its GPU state: replace the viewer on the same scene and camera.
      disposeCurrent();
      loadingRef.current = null;
      const scene = shownRef.current ?? wantedRef.current;
      if (!scene || !library || !latest.current.initialTextureConfirmed) {
        fallback();
        return;
      }
      try {
        create(library, scene, camera);
      } catch {
        fallback();
      }
    }
    container.addEventListener("webglcontextlost", onContextLost, true);
    container.addEventListener("webglcontextrestored", onContextRestored, true);

    try {
      create(library, first, null);
      markTourBench("pannellum_created");
    } catch {
      fallback();
    }

    const resize = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer || recoveringRef.current) return;
      const hfov = tourHfov(container.clientWidth, container.clientHeight);
      viewer.resize();
      viewer.setHfovBounds([hfov, hfov]);
      viewer.setHfov(hfov, false);
    });
    resize.observe(container);

    return () => {
      disposed = true;
      window.clearTimeout(restoreTimer);
      resize.disconnect();
      container.removeEventListener("webglcontextlost", onContextLost, true);
      container.removeEventListener("webglcontextrestored", onContextRestored, true);
      disposeCurrent();
      loadingRef.current = null;
      shownRef.current = null;
      recoveringRef.current = false;
      waitingForConfirmation.current = null;
    };
    // One viewer per open tour once a first scene exists; later scenes reconcile into it.
  }, [fallback, library, mountViewer, reconcile]);

  // A new requested room (or a retry) starts a new attempt: earlier failures do not carry over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new room or retry clears the last failure
    setFailedKey(null);
    setOriginalFor(null);
    failedRef.current = null;
  }, [roomKey, retrySignal]);
  useEffect(() => reconcile(), [reconcile, wanted, failedKey, initialTextureConfirmed]);

  const currentFailed = roomKey !== null && failedKey === roomKey;
  const currentReady = !!shown && !!room && shown.roomId === room.id && shown.originalPath === room.imagePath &&
    !currentFailed && !recovering;
  const status: TourSceneStatus = currentFailed
    ? "failed"
    : !shown
      ? "loading"
      : !currentReady
        ? "pending"
        : transitioning
          ? fading ? "crossfade" : "pending"
          : "ready";
  const shownRoomId = shown?.roomId ?? null;

  const canLoadDetail = !!rendition?.originalWidth && rendition.originalWidth > panoramaWidth;
  const detailWanted = canLoadDetail && !!room && detailRequest?.roomId === room.id &&
    detailRequest.originalPath === room.imagePath;
  const detailStatus: PanoramaDetailStatus =
    currentReady && canLoadDetail && !detailWanted && shown?.path !== shown?.originalPath ? "available" : null;

  useEffect(() => {
    if (!initialTextureConfirmed || !currentReady || !shown || waitingForConfirmation.current !== shown) return;
    waitingForConfirmation.current = null;
    onLoaded();
  }, [currentReady, initialTextureConfirmed, onLoaded, shown]);
  useEffect(() => { onLoadError?.(currentFailed); }, [currentFailed, onLoadError]);
  useEffect(() => { onStatusChange?.(status, shownRoomId); }, [onStatusChange, shownRoomId, status]);
  useEffect(() => { onDetailStatusChange?.(detailStatus); }, [detailStatus, onDetailStatusChange]);
  // Full detail is the existing renderer's job: it loads the original for this request on mount.
  useEffect(() => { if (detailWanted) fallback(); }, [detailWanted, fallback]);
  useEffect(() => {
    if (transitioning && currentReady && !fading) onTransitionComplete();
  }, [currentReady, fading, onTransitionComplete, transitioning]);

  // Warm the HTTP cache for likely next rooms only once the guest can use the current one.
  const prefetchPaths = useMemo(() => {
    if (status !== "ready" || !prefetchAllowed || inputLocked || !room) return [];
    const order = nextRoomPrefetchOrder({
      currentRoomId: room.id,
      hotspotTargetIds: room.hotspots.map((hotspot) => hotspot.targetRoomId),
      orderedRoomIds: rooms.map((item) => item.id),
    });
    return order.slice(0, PREFETCH_LIMIT).flatMap((id) => {
      const image = rooms.find((item) => item.id === id)?.imagePath;
      return image ? [panoramaRendition(image, panoramaWidth).path] : [];
    });
  }, [inputLocked, panoramaWidth, prefetchAllowed, room, rooms, status]);
  const prefetchKey = prefetchPaths.join("\n");
  useEffect(() => {
    if (!prefetchKey) return;
    const controller = new AbortController();
    let afterPaint: number | undefined;
    const beforePaint = window.requestAnimationFrame(() => {
      afterPaint = window.requestAnimationFrame(() => {
        for (const path of prefetchKey.split("\n")) {
          void fetch(path, { signal: controller.signal }).then((response) => response.blob()).catch(() => undefined);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(beforePaint);
      if (afterPaint !== undefined) window.cancelAnimationFrame(afterPaint);
      controller.abort();
    };
  }, [prefetchKey]);

  useEffect(() => markTourBench("canvas_mounted"), []);

  const showHotspots = !transitioning && currentReady;
  return (
    <div
      ref={containerRef}
      data-testid="tour-pannellum"
      data-renderer="pannellum"
      // Pannellum's unlayered stylesheet outranks utilities: keep the full-screen box, black backdrop and
      // site type inline.
      style={{ position: "absolute", inset: 0, background: "#000", fontFamily: "inherit", lineHeight: "inherit" }}
      className={[
        // Pannellum draws its own load and error boxes; the viewer shows the tour's.
        "[&_.pnlm-load-box]:!hidden [&_.pnlm-error-msg]:!hidden [&_.pnlm-about-msg]:!hidden",
        // Drag stops while locked; hotspot buttons still receive clicks and the viewer decides.
        inputLocked && "[&_.pnlm-dragfix]:pointer-events-none",
        !showHotspots && "[&_.tour-pannellum-hotspot]:!hidden",
      ].filter(Boolean).join(" ")}
    />
  );
}
