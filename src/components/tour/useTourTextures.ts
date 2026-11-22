"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SRGBColorSpace, Texture } from "three";
import type { Room } from "@/lib/data/rooms";
import { markTourBench } from "@/lib/tour/bench";
import { panoramaRendition, type PanoramaWidth } from "@/lib/tour/panoramas";
import { nextRoomPrefetchOrder, TourTextureCache } from "@/lib/tour/texture-cache";

/** Load one equirectangular panorama as a THREE.Texture, abortable, colour space set for display. */
export function loadPanorama(path: string, signal: AbortSignal): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const image = new Image();
    if (!path.startsWith("data:")) image.crossOrigin = "anonymous";
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const onAbort = () => {
      cleanup();
      // Cancel the underlying browser image transfer so teardown leaves no in-flight download.
      image.removeAttribute("src");
      reject(new DOMException("aborted", "AbortError"));
    };
    const onLoad = () => {
      cleanup();
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const texture = new Texture(image);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    };
    const onError = (event: Event) => {
      cleanup();
      const detail = typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent ? event.error : undefined;
      reject(detail instanceof Error ? detail : new Error(`Failed to load panorama: ${path}`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    markTourBench("texture_request_start");
    image.src = path;
  });
}

/** Holds the texture of the REQUESTED room while it is requested. */
const REQUESTED_OWNER = "requested";
/** Holds the texture currently on screen (may be an older room while the requested one loads). */
const SHOWN_OWNER = "shown";
/** Holds the outgoing texture of a crossfade until the transition completes. */
const OUTGOING_OWNER = "outgoing";

/** A loaded panorama tagged with the room and path it belongs to. */
export interface TaggedTexture {
  roomId: string;
  originalPath: string;
  path: string;
  texture: Texture;
}

export interface TourTexturesState {
  /** The texture on screen: the requested room once ready, otherwise the last ready room. */
  shown: TaggedTexture | null;
  /** The room shown before `shown`, pinned while a transition is active (crossfade source). */
  outgoing: TaggedTexture | null;
  /** True only when `shown` belongs to the requested room and its load did not fail. */
  currentReady: boolean;
  currentFailed: boolean;
  detailStatus: PanoramaDetailStatus;
}

export type PanoramaDetailStatus = "available" | "loading" | "ready" | "failed" | null;
export type PanoramaDetailRequest = { roomId: string; originalPath: string };

/**
 * Owns a {@link TourTextureCache} for one open tour. Loads the requested room first; until it is
 * ready the last ready room stays on screen (pinned), so a navigation never shows an empty
 * panorama. When the requested room becomes ready during a transition, the previously shown room
 * becomes `outgoing` (pinned) so the canvas can crossfade between two ACTUAL textures. Hotspot
 * targets then sequential neighbours are prefetched with bounded concurrency only after the caller
 * confirms the currently shown texture has drawn, is visible after intro, and accepts input.
 * Teardown disposes everything; a fresh mount reopens the cache and loads fresh.
 */
export function useTourTextures({
  rooms,
  currentRoomId,
  previousRoomId,
  panoramaWidth,
  maxTextureSize,
  detailRequest,
  isDrawnAndInteractive,
  canPrefetch,
  isCurrentSource,
  contextEpoch = 0,
  loader = loadPanorama,
  maxTextures = 5,
  prefetchConcurrency = 2,
  onInvalidate,
  retrySignal = 0,
}: {
  rooms: Room[];
  currentRoomId: string;
  /** Non-null while the viewer's room transition is active. */
  previousRoomId: string | null;
  panoramaWidth: PanoramaWidth;
  maxTextureSize: number;
  detailRequest?: PanoramaDetailRequest | null;
  /**
   * Tests whether this exact texture has drawn and the canvas can receive guest input.
   * Omitting the check pauses speculation while the viewer is locked.
   */
  isDrawnAndInteractive?: (item: TaggedTexture) => boolean;
  canPrefetch?: () => boolean;
  /**
   * Tests whether the DOM viewer's committed selection still requests this room's source. The scene root can
   * commit after the DOM, so its generation alone may still belong to a replaced source.
   */
  isCurrentSource?: (roomId: string, originalPath: string) => boolean;
  /** Changes on every WebGL context loss: the drawn texture must be presented again before speculation. */
  contextEpoch?: number;
  loader?: (path: string, signal: AbortSignal) => Promise<Texture>;
  maxTextures?: number;
  prefetchConcurrency?: number;
  onInvalidate?: () => void;
  retrySignal?: number;
}): TourTexturesState {
  // Stable per-mount cache instance (lazy initializer runs once; the setter is never called).
  const [cache] = useState(
    () => new TourTextureCache<Texture>({ load: loader, maxTextures, prefetchConcurrency }),
  );

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    for (const room of rooms) map.set(room.id, room);
    return map;
  }, [rooms]);
  const orderedRoomIds = useMemo(() => rooms.map((room) => room.id), [rooms]);

  const [shownState, setShownState] = useState<{ item: TaggedTexture; generation: number } | null>(null);
  const shown = shownState?.item ?? null;
  const [outgoing, setOutgoing] = useState<TaggedTexture | null>(null);
  const [failedRoomId, setFailedRoomId] = useState<string | null>(null);
  const [failedDetailRequest, setFailedDetailRequest] = useState<PanoramaDetailRequest | null>(null);
  // Mirrors used by async completions; only read/written inside effects and callbacks.
  const shownRef = useRef<TaggedTexture | null>(null);
  const outgoingRef = useRef<TaggedTexture | null>(null);
  const transitionActiveRef = useRef(false);
  const mountedRef = useRef(false);
  const presentedRef = useRef<TaggedTexture | null>(null);
  const presentedEpochRef = useRef(0);

  const invalidate = useCallback(() => onInvalidate?.(), [onInvalidate]);
  const originalPath = roomById.get(currentRoomId)?.imagePath;
  const rendition = originalPath ? panoramaRendition(originalPath, panoramaWidth) : null;
  const entryPath = rendition?.path;
  const canLoadDetail = Boolean(
    rendition?.originalWidth && Math.min(rendition.originalWidth, maxTextureSize) > panoramaWidth,
  );
  const activeDetailRequest =
    canLoadDetail && detailRequest?.roomId === currentRoomId && detailRequest.originalPath === originalPath
      ? detailRequest
      : null;

  // Dispose everything this tour owns on a real unmount, while surviving React StrictMode's
  // synchronous effect cleanup + replay without aborting and re-fetching the first panorama.
  // Synchronously pause/clear speculative prefetch draining so an already-queued completion
  // microtask cannot drain a queued neighbor before deferred disposal runs.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cache.cancelPrefetches();
      queueMicrotask(() => {
        if (mountedRef.current) return;
        cache.disposeAll();
        cache.reopen();
        shownRef.current = null;
        outgoingRef.current = null;
      });
    };
  }, [cache]);

  // Must run before the load effect so a completion sees the transition state of this commit.
  useEffect(() => {
    transitionActiveRef.current = previousRoomId !== null;
    if (previousRoomId === null && outgoingRef.current) {
      // Transition finished: unpin the outgoing room so it becomes an eviction candidate.
      cache.release(outgoingRef.current.path, OUTGOING_OWNER);
      outgoingRef.current = null;
      setOutgoing(null);
    }
  }, [cache, previousRoomId]);

  // Load the requested room first; neighbors stay deferred until the current frame is usable.
  useEffect(() => {
    if (!originalPath || !entryPath) return;
    const sourcePath = originalPath;
    let path = activeDetailRequest ? originalPath : entryPath;

    // A room switch (or retry) is a new generation: stale requests resolve to nothing.
    const generation = cache.bumpGeneration();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new texture generation clears the last failure in the same step as the cache bump
    setFailedRoomId(null);

    let cancelled = false;
    const isCurrent = () => !cancelled && cache.currentGeneration === generation;

    async function loadRoom() {
      let result = await cache.acquire(path, REQUESTED_OWNER);
      if (!isCurrent()) return;
      // An unavailable rendition should feel like an ordinary first load. The original is only
      // tried when entering the room, so a failed speculative request never prefetches the master.
      if (result.failed && originalPath && path !== originalPath) {
        // Never fetch the master of a source the viewer has already replaced.
        if (isCurrentSource?.(currentRoomId, sourcePath) === false) return;
        path = originalPath;
        result = await cache.acquire(path, REQUESTED_OWNER);
        if (!isCurrent()) return;
      }
      if (result.failed) {
        if (activeDetailRequest && shownRef.current?.roomId === currentRoomId &&
          shownRef.current.originalPath === activeDetailRequest.originalPath) {
          setFailedDetailRequest(activeDetailRequest);
        } else {
          markTourBench("texture_load_failed");
          setFailedRoomId(currentRoomId);
        }
        return;
      }
      if (!result.texture) return;
      if (!activeDetailRequest) markTourBench("texture_available");

      const next: TaggedTexture = { roomId: currentRoomId, originalPath: sourcePath, path, texture: result.texture };
      const previous = shownRef.current;
      cache.retain(path, SHOWN_OWNER);
      if (previous && previous.path !== path) {
        if (transitionActiveRef.current) {
          // Pin the room that was on screen as the crossfade source.
          const stale = outgoingRef.current;
          if (stale && stale.path !== previous.path) cache.release(stale.path, OUTGOING_OWNER);
          cache.retain(previous.path, OUTGOING_OWNER);
          outgoingRef.current = previous;
          setOutgoing(previous);
        }
        cache.release(previous.path, SHOWN_OWNER);
      }
      shownRef.current = next;
      setShownState({ item: next, generation });
      invalidate();
    }
    void loadRoom();

    return () => {
      cancelled = true;
      // The room on screen keeps its SHOWN owner, so releasing the request never blanks it.
      cache.release(path, REQUESTED_OWNER);
    };
  }, [activeDetailRequest, cache, currentRoomId, entryPath, invalidate, isCurrentSource, originalPath, retrySignal]);

  const currentFailed = failedRoomId !== null && failedRoomId === currentRoomId;
  const currentReady = shown !== null && shown.roomId === currentRoomId &&
    shown.originalPath === originalPath && !currentFailed;

  const prefetch = useMemo(() => {
    if (!isDrawnAndInteractive || !currentReady || !shownState ||
      (activeDetailRequest && shownState.item.path !== originalPath)) return null;
    const current = roomById.get(currentRoomId);
    if (!current || current.imagePath !== shownState.item.originalPath) return null;
    const hotspotTargetIds = current.hotspots.map((hotspot) => hotspot.targetRoomId);
    const order = nextRoomPrefetchOrder({ currentRoomId, hotspotTargetIds, orderedRoomIds });
    const paths = order.flatMap((id) => {
      const image = roomById.get(id)?.imagePath;
      return image ? [panoramaRendition(image, panoramaWidth).path] : [];
    });
    return { ...shownState, paths, isDrawnAndInteractive, contextEpoch };
  }, [activeDetailRequest, contextEpoch, currentReady, currentRoomId, isDrawnAndInteractive, orderedRoomIds,
    originalPath, panoramaWidth, roomById, shownState]);

  const committedPrefetch = useRef<typeof prefetch>(null);
  useLayoutEffect(() => {
    committedPrefetch.current = prefetch;
    return () => {
      // Revoke old frame callbacks and queued starts as soon as the selection commits.
      // Keep in-flight images available for the requested room's acquisition above.
      committedPrefetch.current = null;
      cache.pausePrefetches();
    };
  }, [cache, prefetch]);

  useEffect(() => {
    if (!prefetch || prefetch.generation !== cache.currentGeneration) {
      presentedRef.current = null;
      cache.cancelPrefetches();
      return;
    }
    const { item, generation, paths } = prefetch;
    // Presented before a context loss counts for nothing: the restored canvas must show it again.
    if (presentedRef.current === item && presentedEpochRef.current === prefetch.contextEpoch) {
      cache.replacePrefetch(paths, generation, canPrefetch);
      return;
    }
    // Seeing the drawn texture at two consecutive animation frames leaves one paint
    // for the guest. Recording it does not change the scene or invalidate the renderer.
    let visibleLastFrame = false;
    let frame: number;
    const checkFrame = () => {
      if (committedPrefetch.current !== prefetch || canPrefetch?.() === false) return;
      const visible = prefetch.isDrawnAndInteractive(item);
      if (visible && visibleLastFrame) {
        presentedRef.current = item;
        presentedEpochRef.current = prefetch.contextEpoch;
        cache.replacePrefetch(paths, generation, canPrefetch);
        return;
      }
      visibleLastFrame = visible;
      frame = window.requestAnimationFrame(checkFrame);
    };
    frame = window.requestAnimationFrame(checkFrame);
    return () => window.cancelAnimationFrame(frame);
  }, [cache, canPrefetch, prefetch]);
  let detailStatus: PanoramaDetailStatus = null;
  if (currentReady && canLoadDetail) {
    if (activeDetailRequest) {
      detailStatus = shown.path === originalPath ? "ready" : failedDetailRequest === activeDetailRequest ? "failed" : "loading";
    } else if (shown.path !== originalPath) {
      detailStatus = "available";
    }
  }

  return { shown, outgoing, currentReady, currentFailed, detailStatus };
}
