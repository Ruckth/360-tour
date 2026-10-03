import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nextRoomPrefetchOrder,
  TourTextureCache,
  type DisposableTexture,
} from "@/lib/tour/texture-cache";

/** A fake texture carrying a dispose spy — the WebGL-free stand-in the module is designed for. */
class FakeTexture implements DisposableTexture {
  dispose = vi.fn();
  constructor(public readonly path: string) {}
}

/**
 * A controllable loader: each `load(path)` returns a promise the test resolves/rejects by hand, so
 * ordering and concurrency are deterministic. Records call order and tracks concurrent in-flight.
 */
function makeLoader() {
  const pending = new Map<
    string,
    { resolve: (t: FakeTexture) => void; reject: (e: unknown) => void }
  >();
  const callOrder: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const aborted: string[] = [];

  const load = vi.fn(async (path: string, signal: AbortSignal) => {
    callOrder.push(path);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    signal.addEventListener("abort", () => aborted.push(path));
    try {
      return await new Promise<FakeTexture>((resolve, reject) => {
        pending.set(path, { resolve, reject });
      });
    } finally {
      inFlight -= 1;
    }
  });

  return {
    load,
    callOrder,
    get maxInFlight() {
      return maxInFlight;
    },
    get inFlight() {
      return inFlight;
    },
    aborted,
    settle(path: string): FakeTexture {
      const entry = pending.get(path);
      if (!entry) throw new Error(`no in-flight load for ${path}`);
      pending.delete(path);
      const texture = new FakeTexture(path);
      entry.resolve(texture);
      return texture;
    },
    fail(path: string): void {
      const entry = pending.get(path);
      if (!entry) throw new Error(`no in-flight load for ${path}`);
      pending.delete(path);
      entry.reject(new Error(`load failed: ${path}`));
    },
    isPending(path: string): boolean {
      return pending.has(path);
    },
  };
}

/** Let queued microtasks (promise .then/.finally chains) drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("nextRoomPrefetchOrder", () => {
  it("puts hotspot targets first, then sequential neighbours, de-duplicated and without the current room", () => {
    const order = nextRoomPrefetchOrder({
      currentRoomId: "b",
      hotspotTargetIds: ["c"],
      orderedRoomIds: ["a", "b", "c", "d"],
    });
    // hotspot target c first; then neighbours next=c (dropped, already seen), prev=a
    expect(order).toEqual(["c", "a"]);
  });

  it("never includes the current room and dedupes", () => {
    const order = nextRoomPrefetchOrder({
      currentRoomId: "a",
      hotspotTargetIds: ["a", "b", "b"],
      orderedRoomIds: ["a", "b"],
    });
    expect(order).toEqual(["b"]);
  });

  it("handles a single-room tour with no neighbours", () => {
    expect(
      nextRoomPrefetchOrder({ currentRoomId: "a", hotspotTargetIds: [], orderedRoomIds: ["a"] }),
    ).toEqual([]);
  });
});

describe("TourTextureCache", () => {
  let loader: ReturnType<typeof makeLoader>;
  let cache: TourTextureCache<FakeTexture>;

  beforeEach(() => {
    loader = makeLoader();
    cache = new TourTextureCache<FakeTexture>({
      load: loader.load,
      maxTextures: 4,
      prefetchConcurrency: 2,
    });
  });

  afterEach(() => {
    cache.disposeAll();
  });

  it("requests the current room first, before any prefetch", async () => {
    const acquire = cache.acquire("current", "currentRoom");
    cache.prefetch(["p1", "p2"]); // issued, but current must be first in call order
    await flush();
    expect(loader.callOrder[0]).toBe("current");
    const tex = loader.settle("current");
    expect((await acquire).texture).toBe(tex);
  });

  it("never exceeds the prefetch concurrency bound", async () => {
    const acquire = cache.acquire("current", "currentRoom");
    await flush();
    loader.settle("current");
    await acquire;

    cache.prefetch(["p1", "p2", "p3", "p4"]);
    await flush();
    expect(loader.inFlight).toBeLessThanOrEqual(2);
    expect(loader.maxInFlight).toBeLessThanOrEqual(2);

    loader.settle("p1");
    await flush();
    expect(loader.inFlight).toBeLessThanOrEqual(2);
    loader.settle("p2");
    loader.settle("p3");
    await flush();
    loader.settle("p4");
    await flush();
    expect(loader.maxInFlight).toBeLessThanOrEqual(2);
  });

  it("never exceeds the cache bound and evicts the LRU unowned entry (disposing it)", async () => {
    // Fill with 4 unowned prefetched textures (bound = 4).
    cache.prefetch(["p1", "p2", "p3", "p4"]);
    await flush();
    loader.settle("p1");
    loader.settle("p2");
    await flush();
    loader.settle("p3");
    loader.settle("p4");
    await flush();
    expect(cache.size).toBe(4);

    // A fifth, newly acquired, forces eviction of the LRU unowned (p1).
    const acquire = cache.acquire("p5", "currentRoom");
    await flush();
    const t5 = loader.settle("p5");
    await acquire;
    expect(cache.size).toBe(4);
    expect(cache.cachedPaths()).not.toContain("p1");
    expect(cache.peek("p5")).toBe(t5);
  });

  it("never disposes a texture in use by the current or crossfade-previous room", async () => {
    const prev = cache.acquire("prevRoom", "previous");
    await flush();
    const prevTex = loader.settle("prevRoom");
    await prev;
    const cur = cache.acquire("curRoom", "current");
    await flush();
    const curTex = loader.settle("curRoom");
    await cur;

    // Flood with prefetches beyond the bound; owned entries must survive. Settle across flushes so
    // the bounded-concurrency queue drains.
    cache.prefetch(["x1", "x2", "x3", "x4", "x5", "x6"]);
    for (const p of ["x1", "x2", "x3", "x4", "x5", "x6"]) {
      await flush();
      if (loader.isPending(p)) loader.settle(p);
    }
    await flush();

    expect(cache.peek("prevRoom")).toBe(prevTex);
    expect(cache.peek("curRoom")).toBe(curTex);
    expect(prevTex.dispose).not.toHaveBeenCalled();
    expect(curTex.dispose).not.toHaveBeenCalled();
    expect(cache.size).toBeLessThanOrEqual(4);
  });

  it("disposes a texture once it is unowned and evicted", async () => {
    const a = cache.acquire("a", "current");
    await flush();
    const ta = loader.settle("a");
    await a;

    cache.release("a", "current"); // now unowned
    // Force eviction by overfilling with other unowned entries. Bounded concurrency means only two
    // load at a time, so settle in a loop across flushes to let the queued ones (d, e) pump through.
    cache.prefetch(["b", "c", "d", "e"]);
    for (const p of ["b", "c", "d", "e"]) {
      await flush();
      if (loader.isPending(p)) loader.settle(p);
    }
    await flush();

    expect(cache.peek("a")).toBeUndefined();
    expect(ta.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes everything on teardown and reopen loads fresh (no disposed reuse)", async () => {
    const a = cache.acquire("a", "current");
    const b = cache.acquire("b", "previous");
    await flush();
    const ta = loader.settle("a");
    const tb = loader.settle("b");
    await Promise.all([a, b]);
    expect(cache.size).toBe(2);

    cache.disposeAll();
    expect(ta.dispose).toHaveBeenCalledTimes(1);
    expect(tb.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);

    // Reopen and re-acquire the same path: a brand-new texture, never the disposed one.
    cache.reopen();
    const a2 = cache.acquire("a", "current");
    await flush();
    const ta2 = loader.settle("a");
    const result = await a2;
    expect(result.texture).toBe(ta2);
    expect(result.texture).not.toBe(ta);
    expect(cache.peek("a")).toBe(ta2);
  });

  it("disposes a stale-generation result instead of installing it", async () => {
    const stale = cache.acquire("roomA", "current");
    await flush();
    // Guest switches rooms before roomA's texture arrives.
    cache.bumpGeneration();
    const staleTex = loader.settle("roomA");
    const result = await stale;

    expect(result.texture).toBeNull();
    expect(result.failed).toBe(false);
    expect(cache.peek("roomA")).toBeUndefined();
    expect(staleTex.dispose).toHaveBeenCalledTimes(1);
  });

  it("aborts in-flight loads on teardown", async () => {
    void cache.acquire("roomA", "current");
    cache.prefetch(["roomB"]);
    await flush();
    cache.disposeAll();
    expect(loader.aborted).toContain("roomA");
    expect(loader.aborted).toContain("roomB");
  });

  it("does not cache a failed load, surfaces failure, and retries on demand", async () => {
    const first = cache.acquire("roomA", "current");
    await flush();
    loader.fail("roomA");
    const failed = await first;
    expect(failed.texture).toBeNull();
    expect(failed.failed).toBe(true);
    expect(cache.hasFailed("roomA")).toBe(true);
    expect(cache.peek("roomA")).toBeUndefined();

    // Retry: a fresh acquire re-issues the load and succeeds.
    const retry = cache.acquire("roomA", "current");
    await flush();
    const tex = loader.settle("roomA");
    const ok = await retry;
    expect(ok.texture).toBe(tex);
    expect(ok.failed).toBe(false);
    expect(cache.hasFailed("roomA")).toBe(false);
    expect(cache.peek("roomA")).toBe(tex);
  });

  it("a failed prefetch does not break navigation and is retried on demand when acquired", async () => {
    const cur = cache.acquire("current", "current");
    await flush();
    loader.settle("current");
    await cur;

    cache.prefetch(["p1"]);
    await flush();
    loader.fail("p1");
    await flush();
    expect(cache.hasFailed("p1")).toBe(true);
    expect(cache.peek("p1")).toBeUndefined();

    // Navigating to p1 (acquire) retries and succeeds.
    const acquire = cache.acquire("p1", "current");
    await flush();
    const tex = loader.settle("p1");
    expect((await acquire).texture).toBe(tex);
  });

  it("dedupes a concurrent acquire and prefetch of the same path to one load", async () => {
    const acquire = cache.acquire("shared", "current");
    cache.prefetch(["shared"]);
    await flush();
    const calls = loader.callOrder.filter((p) => p === "shared");
    expect(calls).toHaveLength(1);
    const tex = loader.settle("shared");
    expect((await acquire).texture).toBe(tex);
  });

  it("reuses a resident texture and adds the new owner without reloading", async () => {
    const first = cache.acquire("roomA", "current");
    await flush();
    const tex = loader.settle("roomA");
    await first;

    const callsBefore = loader.load.mock.calls.length;
    const second = await cache.acquire("roomA", "previous");
    expect(second.texture).toBe(tex);
    expect(loader.load.mock.calls.length).toBe(callsBefore); // no reload
  });
});
