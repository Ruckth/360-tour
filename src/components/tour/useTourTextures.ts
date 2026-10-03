"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const CURRENT_OWNER = "current";
const PREVIOUS_OWNER = "previous";

export interface TourTexturesState {
  currentTexture: Texture | null;
  previousTexture: Texture | null;
  currentReady: boolean;
  currentFailed: boolean;
  retryCurrent: () => void;
}

/**
 * Owns a {@link TourTextureCache} for one open tour. Loads the current room first and renders it as
 * soon as ready; after the current room is ready, prefetches hotspot targets then sequential
 * neighbours with bounded concurrency. Keeps the previous room's texture during a crossfade (both
 * `currentTexture` and `previousTexture` are live) so a transition never flashes a missing texture.
 * Stale loads on room switch/unmount are ignored via the cache's generation token; teardown disposes
 * everything, and a fresh mount reopens the cache so reopening the tour loads fresh textures.
 *
 * `onReady` is invoked once the current room's texture is first available; `invalidate` (optional) is
 * called whenever a texture becomes ready so a demand-driven render loop repaints.
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
  previousRoomId: string | null;
  loader?: (path: string, signal: AbortSignal) => Promise<Texture>;
  maxTextures?: number;
  prefetchConcurrency?: number;
  onInvalidate?: () => void;
  retrySignal?: number;
}): TourTexturesState {
  // Stable per-mount cache instance. useState's lazy initializer runs once; the setter is never
  // called, so this is a value (not a ref) and is safe to list in effect dependency arrays.
  const [cache] = useState(
    () =>
      new TourTextureCache<Texture>({
        load: loader,
        maxTextures,
        prefetchConcurrency,
      }),
  );

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    for (const room of rooms) map.set(room.id, room);
    return map;
  }, [rooms]);
  const orderedRoomIds = useMemo(() => rooms.map((room) => room.id), [rooms]);

  const [currentTexture, setCurrentTexture] = useState<Texture | null>(null);
  const [previousTexture, setPreviousTexture] = useState<Texture | null>(null);
  const [currentFailed, setCurrentFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const invalidate = useCallback(() => onInvalidate?.(), [onInvalidate]);

  // Dispose everything this tour owns on unmount, and reopen so a future mount loads fresh.
  useEffect(() => {
    return () => {
      cache.disposeAll();
      cache.reopen();
    };
  }, [cache]);

  // Load the current room first; render as soon as it is ready. Prefetch likely-next AFTER.
  useEffect(() => {
    if (!currentRoomId) return;
    const path = roomById.get(currentRoomId)?.imagePath;
    if (!path) return;

    // A room switch is a new generation: stale loads for the old room are ignored on resolve.
    const generation = cache.bumpGeneration();
    setCurrentFailed(false);

    let cancelled = false;
    void cache.acquire(path, CURRENT_OWNER).then((result) => {
      if (cancelled || cache.currentGeneration !== generation) return;
      if (result.failed) {
        setCurrentFailed(true);
        return;
      }
      if (!result.texture) return;
      setCurrentTexture(result.texture);
      setCurrentFailed(false);
      invalidate();

      // Prefetch only after the current room is ready: hotspot targets first, then neighbours.
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
      // Release the current owner from the room we are leaving so its texture becomes evictable
      // unless it is also the crossfade-previous room (which holds the PREVIOUS owner).
      cache.releaseOwner(CURRENT_OWNER);
    };
    // retryCount / retrySignal re-run this effect on an explicit retry of a failed current room.
  }, [cache, currentRoomId, invalidate, orderedRoomIds, roomById, retryCount, retrySignal]);

  // Pin the previous room during a crossfade so the outgoing sphere never loses its texture.
  useEffect(() => {
    cache.releaseOwner(PREVIOUS_OWNER);
    if (!previousRoomId) {
      setPreviousTexture(null);
      return;
    }
    const path = roomById.get(previousRoomId)?.imagePath;
    if (!path) {
      setPreviousTexture(null);
      return;
    }
    const resident = cache.peek(path);
    if (resident) {
      // Re-acquire to add the PREVIOUS owner so eviction cannot take it mid-transition.
      void cache.acquire(path, PREVIOUS_OWNER);
      setPreviousTexture(resident);
      invalidate();
    } else {
      setPreviousTexture(null);
    }
  }, [cache, invalidate, previousRoomId, roomById]);

  const retryCurrent = useCallback(() => {
    setCurrentFailed(false);
    setRetryCount((count) => count + 1);
  }, []);

  const currentReady = currentTexture !== null && !currentFailed;

  return { currentTexture, previousTexture, currentReady, currentFailed, retryCurrent };
}
