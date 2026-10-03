// Pure, framework-light loading/caching/eviction/refcount/concurrency logic for the 360 tour.
//
// Why this module exists separately from the React/Three components:
//   `TourCanvas` used to hand every room image to one `useLoader(TextureLoader, paths)` call, so the
//   first render waited for ALL textures and drei's global `useLoader` cache then retained every
//   texture for the life of the page. This module instead loads the CURRENT room first, prefetches
//   likely-next rooms with bounded concurrency, keeps a bounded LRU cache, and disposes textures the
//   moment no active user holds them — all with an INJECTED loader so it is unit-testable without
//   WebGL (fake textures carrying a `dispose` spy).
//
// Ownership model (the invariant that makes disposal safe):
//   Each cache entry carries an `owners` set of opaque owner keys. A texture is disposed only when
//   its owner set becomes empty AND it is not pinned by being the current/previous active room. The
//   two owners the viewer uses are the current room and, during a crossfade, the previous room — so
//   a texture in use by either is never disposed. Prefetched-but-unowned textures are the eviction
//   candidates; eviction only ever touches an entry with no owners.
//
// Generations (stale-load safety):
//   Every room switch / teardown bumps the generation token. A load that resolves against a stale
//   generation is DISPOSED immediately and never installed, so a slow network for an abandoned room
//   can neither leak memory nor overwrite the live cache.

/** The minimal shape this module needs from a THREE.Texture. Keeps it WebGL-free for tests. */
export interface DisposableTexture {
  dispose(): void;
}

/** Loads one panorama by path. May reject; a rejection is treated as a failed load (never cached). */
export type TextureLoaderFn<T extends DisposableTexture> = (
  path: string,
  signal: AbortSignal,
) => Promise<T>;

export interface TextureCacheOptions<T extends DisposableTexture> {
  load: TextureLoaderFn<T>;
  /** Max textures held at once (current + previous + prefetched). Default 5. */
  maxTextures?: number;
  /** Max concurrent in-flight loads for PREFETCH. The current-room load is not subject to this. Default 2. */
  prefetchConcurrency?: number;
}

interface CacheEntry<T extends DisposableTexture> {
  path: string;
  texture: T;
  owners: Set<string>;
  /** Monotonic counter bumped on every acquire/touch — LRU orders by this. */
  lastUsed: number;
}

interface InFlight<T extends DisposableTexture> {
  path: string;
  generation: number;
  controller: AbortController;
  promise: Promise<T | null>;
}

/** Result of requesting the current room's texture. */
export interface AcquireResult<T extends DisposableTexture> {
  /** The ready texture, or null if the load failed (see `failed`). */
  texture: T | null;
  /** True when the load failed for this generation; the caller should show the error/retry state. */
  failed: boolean;
}

export class TourTextureCache<T extends DisposableTexture> {
  private readonly load: TextureLoaderFn<T>;
  private readonly maxTextures: number;
  private readonly prefetchConcurrency: number;

  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, InFlight<T>>();
  /** Paths whose last load FAILED — used to drive the error state; never a cached texture. */
  private readonly failedPaths = new Set<string>();
  /** Prefetch requests waiting for a concurrency slot. */
  private prefetchQueue: Array<{ path: string; generation: number }> = [];
  private activePrefetches = 0;

  private generation = 0;
  private clock = 0;
  private disposed = false;

  constructor(options: TextureCacheOptions<T>) {
    this.load = options.load;
    this.maxTextures = Math.max(1, options.maxTextures ?? 5);
    this.prefetchConcurrency = Math.max(1, options.prefetchConcurrency ?? 2);
  }

  /** The current generation token. Advances on every `bumpGeneration` (room switch / teardown). */
  get currentGeneration(): number {
    return this.generation;
  }

  /** Advance the generation so any in-flight load for the old generation is ignored on resolve. */
  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  /** Snapshot for assertions/tests: cached paths and in-use (owned) paths. */
  get size(): number {
    return this.cache.size;
  }

  cachedPaths(): string[] {
    return [...this.cache.keys()];
  }

  hasFailed(path: string): boolean {
    return this.failedPaths.has(path);
  }

  /** The texture for `path` if already resident, else undefined. Does not trigger a load. */
  peek(path: string): T | undefined {
    return this.cache.get(path)?.texture;
  }

  /**
   * Load (or reuse) the texture for `path` and mark `owner` as holding it. Loading the current room
   * MUST go through this; it is not subject to prefetch concurrency so the current room is never
   * queued behind prefetches. The returned promise resolves to `{ texture, failed }` for the
   * generation captured at call time; a stale resolve yields `{ texture: null, failed: false }` and
   * the loaded texture (if any) is disposed, never installed.
   */
  async acquire(path: string, owner: string): Promise<AcquireResult<T>> {
    if (this.disposed) return { texture: null, failed: false };
    const generation = this.generation;

    const existing = this.cache.get(path);
    if (existing) {
      existing.owners.add(owner);
      existing.lastUsed = ++this.clock;
      this.failedPaths.delete(path);
      return { texture: existing.texture, failed: false };
    }

    this.failedPaths.delete(path);
    const texture = await this.runLoad(path, generation, /* isPrefetch */ false);

    if (this.generation !== generation || this.disposed) {
      // Stale result: dispose and never install.
      if (texture) safeDispose(texture);
      return { texture: null, failed: false };
    }
    if (!texture) {
      this.failedPaths.add(path);
      return { texture: null, failed: true };
    }
    this.install(path, texture, owner);
    return { texture, failed: false };
  }

  /**
   * Prefetch `paths` (likely-next rooms) with bounded concurrency. Prefetched textures are installed
   * with NO owner, so they are eviction candidates until a later `acquire` claims them. A failed
   * prefetch is recorded in `failedPaths` but never breaks navigation — it is retried on demand when
   * the room is actually acquired. Call this only AFTER the current room is ready.
   */
  prefetch(paths: string[], generation = this.generation): void {
    if (this.disposed) return;
    for (const path of paths) {
      if (generation !== this.generation) return;
      if (this.cache.has(path) || this.inFlight.has(path)) continue;
      if (this.prefetchQueue.some((q) => q.path === path)) continue;
      this.prefetchQueue.push({ path, generation });
    }
    this.pumpPrefetch();
  }

  /** Release `owner`'s hold on `path`. Disposal happens lazily via eviction, never here directly. */
  release(path: string, owner: string): void {
    const entry = this.cache.get(path);
    if (!entry) return;
    entry.owners.delete(owner);
  }

  /** Release `owner` from every entry it holds (used when a slot — current/previous — is cleared). */
  releaseOwner(owner: string): void {
    for (const entry of this.cache.values()) entry.owners.delete(owner);
  }

  /**
   * Dispose everything this cache owns and reset it so the SAME instance can be reused after teardown
   * (reopen loads fresh — nothing disposed is ever handed back). Aborts in-flight loads and advances
   * the generation so their resolves are ignored.
   */
  disposeAll(): void {
    this.generation += 1;
    this.disposed = true;
    for (const flight of this.inFlight.values()) flight.controller.abort();
    this.inFlight.clear();
    this.prefetchQueue = [];
    this.activePrefetches = 0;
    for (const entry of this.cache.values()) safeDispose(entry.texture);
    this.cache.clear();
    this.failedPaths.clear();
  }

  /** Re-arm a disposed cache for a fresh tour. */
  reopen(): void {
    this.disposed = false;
    this.generation += 1;
  }

  // --- internals ---

  private install(path: string, texture: T, owner?: string): void {
    const entry: CacheEntry<T> = {
      path,
      texture,
      owners: owner ? new Set([owner]) : new Set(),
      lastUsed: ++this.clock,
    };
    this.cache.set(path, entry);
    this.evictIfNeeded();
  }

  /**
   * Evict unowned LRU entries until the cache is within bound. An OWNED entry is never evicted, so a
   * texture held by the current room or the crossfade-previous room survives regardless of bound.
   */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxTextures) return;
    const evictable = [...this.cache.values()]
      .filter((entry) => entry.owners.size === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of evictable) {
      if (this.cache.size <= this.maxTextures) break;
      this.cache.delete(entry.path);
      safeDispose(entry.texture);
    }
  }

  private pumpPrefetch(): void {
    while (
      !this.disposed &&
      this.activePrefetches < this.prefetchConcurrency &&
      this.prefetchQueue.length > 0
    ) {
      const next = this.prefetchQueue.shift()!;
      if (next.generation !== this.generation) continue;
      if (this.cache.has(next.path) || this.inFlight.has(next.path)) continue;
      this.activePrefetches += 1;
      void this.runLoad(next.path, next.generation, /* isPrefetch */ true)
        .then((texture) => {
          if (this.generation !== next.generation || this.disposed) {
            if (texture) safeDispose(texture);
            return;
          }
          if (!texture) {
            this.failedPaths.add(next.path);
            return;
          }
          if (this.cache.has(next.path)) {
            // Raced with an acquire that already installed it; drop the duplicate.
            safeDispose(texture);
            return;
          }
          this.install(next.path, texture); // unowned
        })
        .finally(() => {
          this.activePrefetches -= 1;
          this.pumpPrefetch();
        });
    }
  }

  /**
   * Run (or join) a single load. Returns the texture, or null on failure/abort. Dedupes concurrent
   * loads of the same path so an acquire and a prefetch for one path share one network request.
   */
  private runLoad(path: string, generation: number, isPrefetch: boolean): Promise<T | null> {
    const existing = this.inFlight.get(path);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = this.load(path, controller.signal)
      .then((texture) => texture)
      .catch(() => null)
      .finally(() => {
        this.inFlight.delete(path);
      });

    this.inFlight.set(path, { path, generation, controller, promise });
    void isPrefetch; // (reserved: a future policy could prioritise non-prefetch loads)
    return promise;
  }
}

function safeDispose(texture: DisposableTexture): void {
  try {
    texture.dispose();
  } catch {
    // A broken texture must not stop teardown of the rest.
  }
}

/**
 * Order likely-next rooms for prefetch: hotspot targets of the current room first (the guest's most
 * probable next step), then sequential neighbours (prev/next in tour order), de-duplicated and with
 * the current room removed. Pure so it is unit-testable without any THREE/React dependency.
 */
export function nextRoomPrefetchOrder(args: {
  currentRoomId: string;
  hotspotTargetIds: string[];
  orderedRoomIds: string[];
}): string[] {
  const { currentRoomId, hotspotTargetIds, orderedRoomIds } = args;
  const index = orderedRoomIds.indexOf(currentRoomId);
  const neighbours: string[] = [];
  if (orderedRoomIds.length > 1 && index >= 0) {
    const prev = orderedRoomIds[(index - 1 + orderedRoomIds.length) % orderedRoomIds.length];
    const next = orderedRoomIds[(index + 1) % orderedRoomIds.length];
    neighbours.push(next, prev);
  }
  const ordered: string[] = [];
  const seen = new Set<string>([currentRoomId]);
  for (const id of [...hotspotTargetIds, ...neighbours]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}
