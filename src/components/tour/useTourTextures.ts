"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SRGBColorSpace, Texture, TextureLoader } from "three";
import type { Room } from "@/lib/data/rooms";
import { panoramaRendition, type PanoramaWidth } from "@/lib/tour/panoramas";
import { nextRoomPrefetchOrder, TourTextureCache } from "@/lib/tour/texture-cache";

/** Load one equirectangular panorama as a THREE.Texture, abortable, colour space set for display. */
function loadPanorama(path: string, signal: AbortSignal): Promise<Texture> {
  const loader = new TextureLoader();
  return new Promise<Texture>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    loader.load(
      path,
      (texture) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          texture.dispose();
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
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
 * becomes `outgoing` (pinned) so the canvas can crossfade between two ACTUAL textures. After the
 * requested room is ready, hotspot targets then sequential neighbours are prefetched with bounded
 * concurrency. Teardown disposes everything; a fresh mount reopens the cache and loads fresh.
 */
export function useTourTextures({
  rooms,
  currentRoomId,
  previousRoomId,
  panoramaWidth,
  maxTextureSize,
  detailRequest,
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

  const [shown, setShown] = useState<TaggedTexture | null>(null);
  const [outgoing, setOutgoing] = useState<TaggedTexture | null>(null);
  const [failedRoomId, setFailedRoomId] = useState<string | null>(null);
  const [failedDetailRequest, setFailedDetailRequest] = useState<PanoramaDetailRequest | null>(null);
  // Mirrors used by async completions; only read/written inside effects and callbacks.
  const shownRef = useRef<TaggedTexture | null>(null);
  const outgoingRef = useRef<TaggedTexture | null>(null);
  const transitionActiveRef = useRef(false);

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

  // Dispose everything this tour owns on unmount, and reopen so a future mount loads fresh.
  useEffect(() => {
    return () => {
      cache.disposeAll();
      cache.reopen();
      shownRef.current = null;
      outgoingRef.current = null;
      setShown(null);
      setOutgoing(null);
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

  // Load the requested room first; prefetch likely-next rooms only AFTER it is ready.
  useEffect(() => {
    if (!originalPath || !entryPath) return;
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
        path = originalPath;
        result = await cache.acquire(path, REQUESTED_OWNER);
        if (!isCurrent()) return;
      }
      if (result.failed) {
        if (activeDetailRequest && shownRef.current?.roomId === currentRoomId) {
          setFailedDetailRequest(activeDetailRequest);
        } else {
          setFailedRoomId(currentRoomId);
        }
        return;
      }
      if (!result.texture) return;

      const next: TaggedTexture = { roomId: currentRoomId, path, texture: result.texture };
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
      setShown(next);
      invalidate();

      const current = roomById.get(currentRoomId);
      const hotspotTargetIds = (current?.hotspots ?? [])
        .map((hotspot) => hotspot.targetRoomId)
        .filter((id) => roomById.has(id));
      const order = nextRoomPrefetchOrder({ currentRoomId, hotspotTargetIds, orderedRoomIds });
      const prefetchPaths = order
        .map((id) => roomById.get(id)?.imagePath)
        .filter((p): p is string => Boolean(p))
        .map((p) => panoramaRendition(p, panoramaWidth).path);
      cache.prefetch(prefetchPaths, generation);
    }
    void loadRoom();

    return () => {
      cancelled = true;
      // The room on screen keeps its SHOWN owner, so releasing the request never blanks it.
      cache.release(path, REQUESTED_OWNER);
    };
  }, [activeDetailRequest, cache, currentRoomId, entryPath, invalidate, orderedRoomIds, originalPath, panoramaWidth, roomById, retrySignal]);

  const currentFailed = failedRoomId !== null && failedRoomId === currentRoomId;
  const currentReady = shown !== null && shown.roomId === currentRoomId && !currentFailed;
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
