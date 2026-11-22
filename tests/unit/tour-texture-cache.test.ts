import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nextRoomPrefetchOrder,
  stageFirstTexture,
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
  // Several loads of one path can be pending at once (e.g. across a teardown/reopen): FIFO per path.
  const pending = new Map<
    string,
    Array<{ resolve: (t: FakeTexture) => void; reject: (e: unknown) => void }>
  >();
  const take = (path: string) => {
    const queue = pending.get(path);
    const entry = queue?.shift();
    if (!entry) throw new Error(`no in-flight load for ${path}`);
    if (!queue!.length) pending.delete(path);
    return entry;
  };
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
        pending.set(path, [...(pending.get(path) ?? []), { resolve, reject }]);
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
    /** Resolve the OLDEST pending load of `path`. */
    settle(path: string): FakeTexture {
      const entry = take(path);
      const texture = new FakeTexture(path);
      entry.resolve(texture);
      return texture;
    },
    fail(path: string): void {
      const entry = take(path);
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

  it("a stale acquire gets nothing; its texture is kept unowned (never handed out, disposed once on eviction)", async () => {
    const stale = cache.acquire("roomA", "current");
    await flush();
    // Guest switches rooms before roomA's texture arrives.
    cache.bumpGeneration();
    const staleTex = loader.settle("roomA");
    const result = await stale;

    expect(result.texture).toBeNull();
    expect(result.failed).toBe(false);
    // Installed by the flight's single completion owner, but with NO owner: an eviction candidate.
    expect(cache.peek("roomA")).toBe(staleTex);
    expect(cache.ownersOf("roomA")).toEqual([]);
    expect(staleTex.dispose).not.toHaveBeenCalled();

    // Overfill: the unowned stale texture is evicted and disposed exactly once.
    cache.prefetch(["b", "c", "d", "e"]);
    for (const p of ["b", "c", "d", "e"]) {
      await flush();
      if (loader.isPending(p)) loader.settle(p);
    }
    await flush();
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

  describe("one completion owner per flight (deferred loader)", () => {
    it("prefetch, then room switch, then acquire of the same path: promoted, live, not disposed", async () => {
      cache.prefetch(["B"]);
      await flush();
      expect(loader.isPending("B")).toBe(true);
      cache.bumpGeneration(); // the room switch that makes the prefetch's generation stale
      const acquire = cache.acquire("B", "current");
      await flush();
      expect(loader.load).toHaveBeenCalledTimes(1); // joined the prefetch flight
      const tex = loader.settle("B");
      const result = await acquire;

      expect(result.texture).toBe(tex);
      expect(tex.dispose).not.toHaveBeenCalled();
      expect(cache.peek("B")).toBe(tex);
      expect(cache.ownersOf("B")).toEqual(["current"]);
      expect(cache.prefetchesInFlight).toBe(0);
    });

    it("same-generation acquire joining a prefetch flight is promoted to an owner and survives eviction pressure", async () => {
      cache.prefetch(["B"]);
      await flush();
      const acquire = cache.acquire("B", "current");
      const tex = loader.settle("B");
      expect((await acquire).texture).toBe(tex);
      expect(cache.ownersOf("B")).toEqual(["current"]);

      cache.prefetch(["x1", "x2", "x3", "x4", "x5"]);
      for (const p of ["x1", "x2", "x3", "x4", "x5"]) {
        await flush();
        if (loader.isPending(p)) loader.settle(p);
      }
      await flush();
      expect(cache.peek("B")).toBe(tex);
      expect(tex.dispose).not.toHaveBeenCalled();
    });

    it("simultaneous acquires of one path share one load, both own it, and nothing is disposed", async () => {
      const first = cache.acquire("A", "current");
      const second = cache.acquire("A", "previous");
      await flush();
      expect(loader.load).toHaveBeenCalledTimes(1);
      const tex = loader.settle("A");
      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.texture).toBe(tex);
      expect(r2.texture).toBe(tex);
      expect(cache.ownersOf("A").sort()).toEqual(["current", "previous"]);
      expect(tex.dispose).not.toHaveBeenCalled();

      cache.release("A", "current");
      expect(cache.ownersOf("A")).toEqual(["previous"]);
    });

    it("a stale acquire and a live acquire of the same path: only the live owner receives and owns it", async () => {
      const stale = cache.acquire("A", "old");
      await flush();
      cache.bumpGeneration();
      const live = cache.acquire("A", "current");
      const tex = loader.settle("A");
      const [staleResult, liveResult] = await Promise.all([stale, live]);
      expect(staleResult.texture).toBeNull();
      expect(liveResult.texture).toBe(tex);
      expect(cache.ownersOf("A")).toEqual(["current"]);
      expect(tex.dispose).not.toHaveBeenCalled();
    });

    it("a failed shared flight fails the live acquire and is retried on demand", async () => {
      cache.prefetch(["A"]);
      await flush();
      const acquire = cache.acquire("A", "current");
      loader.fail("A");
      expect(await acquire).toEqual({ texture: null, failed: true });
      expect(cache.prefetchesInFlight).toBe(0);

      const retry = cache.acquire("A", "current");
      await flush();
      const tex = loader.settle("A");
      expect((await retry).texture).toBe(tex);
    });

    it("shutdown then reopen: late completions from before shutdown cannot touch the new flight, counters, or cache", async () => {
      cache.prefetch(["A", "P"]);
      await flush();
      expect(cache.prefetchesInFlight).toBe(2);
      const oldAcquire = cache.acquire("A", "current"); // joins the old A flight

      cache.disposeAll();
      expect(loader.aborted).toEqual(expect.arrayContaining(["A", "P"]));
      cache.reopen();

      // The reopened tour starts a NEW flight for the same path, plus a new prefetch.
      const freshAcquire = cache.acquire("A", "current");
      cache.prefetch(["Q"]);
      await flush();
      expect(loader.load).toHaveBeenCalledTimes(4);
      expect(cache.loadsInFlight).toBe(2);
      expect(cache.prefetchesInFlight).toBe(1);

      // The pre-shutdown loads complete late (the fake loader ignores abort).
      const lateA = loader.settle("A"); // oldest pending A = the pre-shutdown flight
      loader.fail("P");
      await flush();
      expect(await oldAcquire).toEqual({ texture: null, failed: false });
      expect(lateA.dispose).toHaveBeenCalledTimes(1);
      expect(cache.peek("A")).toBeUndefined();
      expect(cache.hasFailed("P")).toBe(false);
      expect(cache.loadsInFlight).toBe(2); // fresh A and Q are still tracked
      expect(cache.prefetchesInFlight).toBe(1); // the old P slot was not double-released

      const freshA = loader.settle("A");
      const fresh = await freshAcquire;
      expect(fresh.texture).toBe(freshA);
      expect(freshA.dispose).not.toHaveBeenCalled();
      expect(cache.ownersOf("A")).toEqual(["current"]);

      const q = loader.settle("Q");
      await flush();
      expect(cache.peek("Q")).toBe(q);
      expect(cache.prefetchesInFlight).toBe(0);
      expect(cache.loadsInFlight).toBe(0);
    });

    it("every loaded texture is disposed exactly once across eviction and teardown", async () => {
      const textures: FakeTexture[] = [];
      const cur = cache.acquire("cur", "current");
      await flush();
      textures.push(loader.settle("cur"));
      await cur;
      const paths = ["p1", "p2", "p3", "p4", "p5", "p6"];
      cache.prefetch(paths);
      for (const p of paths) {
        await flush();
        if (loader.isPending(p)) textures.push(loader.settle(p));
      }
      await flush();
      cache.disposeAll();
      for (const texture of textures) expect(texture.dispose).toHaveBeenCalledTimes(1);
    });

    it("cancelPrefetches drops queued items, aborts unowned speculative loads, and preserves shared live acquire flights without draining", async () => {
      // p1 and p2 occupy the 2 prefetch slots; p3 sits in the queue.
      cache.prefetch(["p1", "p2", "p3"]);
      await flush();
      expect(loader.callOrder).toEqual(["p1", "p2"]);
      expect(cache.prefetchesInFlight).toBe(2);

      // An explicit acquire joins p2 while p1 remains purely speculative and p3 stays queued.
      const sharedAcquire = cache.acquire("p2", "requested");
      cache.cancelPrefetches();

      // p1 (unowned speculative) is aborted; p2 (shared with live acquire) is preserved.
      expect(loader.aborted).toEqual(["p1"]);
      expect(cache.prefetchesInFlight).toBe(1);
      expect(cache.loadsInFlight).toBe(1);

      // Even if p1 ignores abort and resolves late, its texture is disposed once and never cached/failed.
      const lateP1 = loader.settle("p1");
      await flush();
      expect(lateP1.dispose).toHaveBeenCalledOnce();
      expect(cache.peek("p1")).toBeUndefined();
      expect(cache.hasFailed("p1")).toBe(false);

      // Finishing shared p2 satisfies the live acquire and does NOT drain queued p3.
      const p2Tex = loader.settle("p2");
      expect(await sharedAcquire).toEqual({ texture: p2Tex, failed: false });
      await flush();
      expect(cache.ownersOf("p2")).toEqual(["requested"]);
      expect(loader.callOrder).toEqual(["p1", "p2"]);
      expect(cache.prefetchesInFlight).toBe(0);
    });

    it("replacePrefetch drops removed queued targets and cancels removed unowned flights while keeping wanted ones", async () => {
      cache.prefetch(["p1", "p2", "p3"]);
      await flush();
      expect(loader.callOrder).toEqual(["p1", "p2"]);

      // Live edit removes p3 from the queue and replaces p2 with p4 while p1 remains wanted.
      cache.replacePrefetch(["p1", "p4"]);
      await flush();
      expect(loader.aborted).toEqual(["p2"]);
      expect(loader.callOrder).toEqual(["p1", "p2", "p4"]);
      expect(cache.prefetchesInFlight).toBe(2);

      // Completing p1 must NOT drain stale p3.
      const p1Tex = loader.settle("p1");
      const p4Tex = loader.settle("p4");
      const lateP2 = loader.settle("p2");
      await flush();
      expect(lateP2.dispose).toHaveBeenCalledOnce();
      expect(cache.peek("p1")).toBe(p1Tex);
      expect(cache.peek("p4")).toBe(p4Tex);
      expect(cache.peek("p2")).toBeUndefined();
      expect(loader.callOrder).toEqual(["p1", "p2", "p4"]);
    });
  });
});

describe("staged first texture", () => {
  it.each([false, true])("adopts one early load through the per-open cache (settled=%s)", async (settled) => {
    const source = makeLoader();
    const staged = stageFirstTexture(source.load);
    const cache = new TourTextureCache({ load: staged.load });
    expect(staged.start("entry")).toBe(true);
    expect(staged.start("entry")).toBe(false);
    const beforeRenderer = settled ? source.settle("entry") : undefined;
    if (settled) await flush();

    const requested = cache.acquire("entry", "requested");
    const texture = beforeRenderer ?? source.settle("entry");
    expect(await requested).toEqual({ texture, failed: false });
    expect(source.callOrder).toEqual(["entry"]);
    staged.cancel();
    expect(texture.dispose).not.toHaveBeenCalled();
    cache.disposeAll();
    expect(texture.dispose).toHaveBeenCalledOnce();
  });

  it("preserves an early failure until normal acquisition and permits a deliberate retry", async () => {
    const source = makeLoader();
    const staged = stageFirstTexture(source.load);
    const cache = new TourTextureCache({ load: staged.load });
    staged.start("entry");
    source.fail("entry");
    await flush();
    expect(await cache.acquire("entry", "requested")).toEqual({ texture: null, failed: true });
    expect(source.callOrder).toEqual(["entry"]);

    const retry = cache.acquire("entry", "requested");
    const texture = source.settle("entry");
    expect(await retry).toEqual({ texture, failed: false });
    expect(source.callOrder).toEqual(["entry", "entry"]);
  });

  it("aborts and disposes an unclaimed request if the viewer closes or selects a different rendition", async () => {
    const source = makeLoader();
    const staged = stageFirstTexture(source.load);
    const cache = new TourTextureCache({ load: staged.load });
    staged.start("mobile");
    const requested = cache.acquire("desktop", "requested");
    const stale = source.settle("mobile");
    const desktop = source.settle("desktop");
    expect(await requested).toEqual({ texture: desktop, failed: false });
    expect(source.aborted).toEqual(["mobile"]);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(staged.start("later")).toBe(false);

    const closing = stageFirstTexture(source.load);
    closing.start("another-room");
    closing.cancel();
    const closed = source.settle("another-room");
    await flush();
    expect(source.aborted).toEqual(["mobile", "another-room"]);
    expect(closed.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the request when a released stage starts the same path in the same task", async () => {
    const source = makeLoader();
    const staged = stageFirstTexture(source.load);
    staged.start("entry");
    staged.release();
    expect(staged.start("entry")).toBe(true);
    await flush();
    expect(source.callOrder).toEqual(["entry"]);
    expect(source.aborted).toEqual([]);

    const cache = new TourTextureCache({ load: staged.load });
    const requested = cache.acquire("entry", "requested");
    const texture = source.settle("entry");
    expect(await requested).toEqual({ texture, failed: false });
    expect(source.callOrder).toEqual(["entry"]);
  });

  it("cancels a released stage after the task, or at once when replay selects another path", async () => {
    const source = makeLoader();
    const closing = stageFirstTexture(source.load);
    closing.start("entry");
    closing.release();
    expect(source.aborted).toEqual([]);
    await flush();
    expect(source.aborted).toEqual(["entry"]);
    const late = source.settle("entry");
    await flush();
    expect(late.dispose).toHaveBeenCalledOnce();

    const switching = stageFirstTexture(source.load);
    switching.start("mobile");
    switching.release();
    expect(switching.start("other")).toBe(true);
    expect(source.aborted).toEqual(["entry", "mobile"]);
    await flush();
    expect(source.aborted).toEqual(["entry", "mobile"]);
    expect(source.callOrder).toEqual(["entry", "mobile", "other"]);
  });

  it("forwards cache teardown after takeover and disposes a late completion once", async () => {
    const source = makeLoader();
    const staged = stageFirstTexture(source.load);
    const cache = new TourTextureCache({ load: staged.load });
    staged.start("entry");
    const requested = cache.acquire("entry", "requested");
    cache.disposeAll();
    const stale = source.settle("entry");
    expect(await requested).toEqual({ texture: null, failed: false });
    expect(source.aborted).toEqual(["entry"]);
    expect(stale.dispose).toHaveBeenCalledOnce();
  });
});
