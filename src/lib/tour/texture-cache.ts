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
//   Each cache entry carries an `owners` set of opaque owner keys. Only UNOWNED entries are ever
//   evicted (and disposed). The viewer holds owner keys for the requested room, the room on screen,
//   and the outgoing room of a crossfade, so a texture in use is never disposed.
//
// One completion owner per load ("flight"):
//   Every network load is a single flight. Acquirers and prefetchers only register CLAIMS on the
//   flight; exactly one completion handler — `completeFlight` — decides what happens to the loaded
//   texture: install it (owned by every claim of the live generation, or unowned when only a
//   prefetch wanted it) or dispose it (the cache was torn down since the flight began). Callers
//   never install or dispose a flight's texture themselves, so a stale claim can never dispose an
//   object a live claim is about to receive, and every loaded texture is disposed at most once.
//
// Generations and epochs:
//   - `generation` advances on every room switch. A claim made in an older generation is ignored at
//     completion: its acquire resolves `{ texture: null }` and contributes no owner.
//   - `epoch` advances on `disposeAll`. A flight from an older epoch is aborted; if it still
//     completes, its texture is disposed and it never touches the new epoch's flights, queue,
//     counters or cache.

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
  /** Max textures held at once (owned entries may exceed it; unowned ones are evicted). Default 5. */
  maxTextures?: number;
  /** Max concurrent in-flight loads started by PREFETCH. Acquires are never queued. Default 2. */
  prefetchConcurrency?: number;
}

interface CacheEntry<T extends DisposableTexture> {
  path: string;
  texture: T;
  owners: Set<string>;
  /** Monotonic counter bumped on every acquire/touch — LRU orders by this. */
  lastUsed: number;
}

interface Flight {
  path: string;
  epoch: number;
  controller: AbortController;
  /** Acquire claims: owner → generation in which it was claimed (latest wins). */
  claims: Map<string, number>;
  /** True when this flight occupies a prefetch concurrency slot. */
  holdsPrefetchSlot: boolean;
  /** Set by `completeFlight` when the load failed. */
  failed: boolean;
  /** Resolves after `completeFlight` has run (install/dispose decided). Never rejects. */
  settled: Promise<void>;
}

/** Result of requesting the current room's texture. */
export interface AcquireResult<T extends DisposableTexture> {
  /** The ready texture, or null if the load failed or the request went stale. */
  texture: T | null;
  /** True when the load failed for this generation; the caller should show the error/retry state. */
  failed: boolean;
}

export class TourTextureCache<T extends DisposableTexture> {
  private readonly load: TextureLoaderFn<T>;
  private readonly maxTextures: number;
  private readonly prefetchConcurrency: number;

  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Flight>();
  /** Paths whose last load FAILED — used to drive the error state; never a cached texture. */
  private readonly failedPaths = new Set<string>();
  /** Prefetch requests waiting for a concurrency slot. */
  private prefetchQueue: Array<{ path: string; generation: number }> = [];
  private activePrefetches = 0;

  private generation = 0;
  private epoch = 0;
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

  /** Advance the generation so claims made for the old generation are ignored on completion. */
  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  get size(): number {
    return this.cache.size;
  }

  /** Number of prefetch slots in use (for tests/diagnostics). */
  get prefetchesInFlight(): number {
    return this.activePrefetches;
  }

  /** Number of loads in flight for the current epoch (for tests/diagnostics). */
  get loadsInFlight(): number {
    return this.inFlight.size;
  }

  cachedPaths(): string[] {
    return [...this.cache.keys()];
  }

  hasFailed(path: string): boolean {
    return this.failedPaths.has(path);
  }

  /** Owners currently holding `path` (for tests/diagnostics). */
  ownersOf(path: string): string[] {
    return [...(this.cache.get(path)?.owners ?? [])];
  }

  /** The texture for `path` if already resident, else undefined. Does not trigger a load. */
  peek(path: string): T | undefined {
    return this.cache.get(path)?.texture;
  }

  /**
   * Synchronously add `owner` to a RESIDENT texture and return it (undefined when not resident).
   * Used to pin a texture that is already on screen (e.g. the outgoing room of a crossfade).
   */
  retain(path: string, owner: string): T | undefined {
    if (this.disposed) return undefined;
    const entry = this.cache.get(path);
    if (!entry) return undefined;
    entry.owners.add(owner);
    entry.lastUsed = ++this.clock;
    return entry.texture;
  }

  /**
   * Load (or reuse) the texture for `path` and mark `owner` as holding it. Acquires are never queued
   * behind prefetches; an acquire for a path a prefetch is already loading JOINS that flight (one
   * network request) and is promoted to an owner when it completes. Resolves `{ texture, failed }`
   * for the generation captured at call time; a stale request resolves `{ texture: null, failed:
   * false }` and contributes no owner (the texture is still cached or disposed by the flight).
   */
  async acquire(path: string, owner: string): Promise<AcquireResult<T>> {
    if (this.disposed) return { texture: null, failed: false };
    const generation = this.generation;
    const epoch = this.epoch;

    const resident = this.retain(path, owner);
    if (resident) {
      this.failedPaths.delete(path);
      return { texture: resident, failed: false };
    }

    this.failedPaths.delete(path);
    const flight = this.inFlight.get(path) ?? this.startFlight(path, false);
    flight.claims.set(owner, generation);
    await flight.settled;

    if (this.epoch !== epoch || this.disposed || this.generation !== generation) {
      return { texture: null, failed: false };
    }
    const entry = this.cache.get(path);
    if (entry && entry.owners.has(owner)) return { texture: entry.texture, failed: false };
    if (flight.failed) return { texture: null, failed: true };
    // Owner released (or entry evicted after release) between completion and now: not ours.
    return { texture: null, failed: false };
  }

  /**
   * Prefetch `paths` (likely-next rooms) with bounded concurrency. Prefetched textures are installed
   * with NO owner, so they are eviction candidates until a later `acquire` claims them. A failed
   * prefetch is recorded in `failedPaths` but never breaks navigation — it is retried on demand when
   * the room is actually acquired. Call this only AFTER the current room is ready.
   */
  prefetch(paths: string[], generation = this.generation): void {
    if (this.disposed || generation !== this.generation) return;
    for (const path of paths) {
      if (this.cache.has(path)) continue;
      // Already loading (any generation): its completion installs it, so do not duplicate it.
      if (this.inFlight.has(path)) continue;
      const queued = this.prefetchQueue.find((q) => q.path === path);
      if (queued) {
        queued.generation = generation;
        continue;
      }
      this.prefetchQueue.push({ path, generation });
    }
    this.pumpPrefetch();
  }

  /** Release `owner`'s hold on `path`. Disposal happens lazily via eviction, never here directly. */
  release(path: string, owner: string): void {
    this.cache.get(path)?.owners.delete(owner);
  }

  /** Release `owner` from every entry it holds. */
  releaseOwner(owner: string): void {
    for (const entry of this.cache.values()) entry.owners.delete(owner);
  }

  /**
   * Dispose everything this cache owns and reset it so the SAME instance can be reused after teardown
   * (reopen loads fresh — nothing disposed is ever handed back). Aborts in-flight loads; their late
   * completions dispose their own texture and never touch the reset state.
   */
  disposeAll(): void {
    this.epoch += 1;
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

  private startFlight(path: string, holdsPrefetchSlot: boolean): Flight {
    const controller = new AbortController();
    const flight: Flight = {
      path,
      epoch: this.epoch,
      controller,
      claims: new Map(),
      holdsPrefetchSlot,
      failed: false,
      settled: Promise.resolve(),
    };
    if (holdsPrefetchSlot) this.activePrefetches += 1;
    let loading: Promise<T>;
    try {
      loading = this.load(path, controller.signal);
    } catch (error) {
      loading = Promise.reject(error);
    }
    flight.settled = loading.then(
      (texture) => this.completeFlight(flight, texture),
      () => this.completeFlight(flight, null),
    );
    this.inFlight.set(path, flight);
    return flight;
  }

  /** The ONLY place a loaded texture is installed or disposed. */
  private completeFlight(flight: Flight, texture: T | null): void {
    if (flight.epoch !== this.epoch) {
      // Torn down since this flight began: the new epoch's state is not ours to touch.
      if (texture) safeDispose(texture);
      return;
    }
    if (this.inFlight.get(flight.path) === flight) this.inFlight.delete(flight.path);
    if (flight.holdsPrefetchSlot) {
      flight.holdsPrefetchSlot = false;
      this.activePrefetches -= 1;
    }

    if (!texture) {
      flight.failed = true;
      this.failedPaths.add(flight.path);
    } else {
      const liveOwners = [...flight.claims]
        .filter(([, generation]) => generation === this.generation)
        .map(([owner]) => owner);
      const existing = this.cache.get(flight.path);
      if (existing) {
        // Defensive: one flight per path means this should not happen; never replace a live entry.
        if (existing.texture !== texture) safeDispose(texture);
        for (const owner of liveOwners) existing.owners.add(owner);
        existing.lastUsed = ++this.clock;
      } else {
        // Within the same epoch a loaded texture is always worth keeping: owned by live claims, or
        // unowned (evictable) when only a prefetch or a stale request wanted it.
        this.install(flight.path, texture, liveOwners);
      }
    }
    this.pumpPrefetch();
  }

  private install(path: string, texture: T, owners: string[]): void {
    this.cache.set(path, { path, texture, owners: new Set(owners), lastUsed: ++this.clock });
    this.evictIfNeeded();
  }

  /** Evict unowned LRU entries until within bound. An OWNED entry is never evicted. */
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
      if (this.cache.has(next.path)) continue;
      if (this.inFlight.has(next.path)) continue;
      this.startFlight(next.path, true);
    }
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
