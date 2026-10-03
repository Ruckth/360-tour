"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SRGBColorSpace, Texture, TextureLoader } from "three";
import type { Room } from "@/lib/data/rooms";
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
}

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
  // Mirrors used by async completions; only read/written inside effects and callbacks.
  const shownRef = useRef<TaggedTexture | null>(null);
  const outgoingRef = useRef<TaggedTexture | null>(null);
  const transitionActiveRef = useRef(false);

  const invalidate = useCallback(() => onInvalidate?.(), [onInvalidate]);

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
    if (!currentRoomId) return;
    const path = roomById.get(currentRoomId)?.imagePath;
    if (!path) return;

    // A room switch (or retry) is a new generation: stale requests resolve to nothing.
    const generation = cache.bumpGeneration();
    setFailedRoomId(null);

    let cancelled = false;
    void cache.acquire(path, REQUESTED_OWNER).then((result) => {
      if (cancelled || cache.currentGeneration !== generation) return;
      if (result.failed) {
        setFailedRoomId(currentRoomId);
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
        .filter((p): p is string => Boolean(p));
      cache.prefetch(prefetchPaths, generation);
    });

    return () => {
      cancelled = true;
      // The room on screen keeps its SHOWN owner, so releasing the request never blanks it.
      cache.release(path, REQUESTED_OWNER);
    };
  }, [cache, currentRoomId, invalidate, orderedRoomIds, roomById, retrySignal]);

  const currentFailed = failedRoomId !== null && failedRoomId === currentRoomId;
  const currentReady = shown !== null && shown.roomId === currentRoomId && !currentFailed;

  return { shown, outgoing, currentReady, currentFailed };
}
