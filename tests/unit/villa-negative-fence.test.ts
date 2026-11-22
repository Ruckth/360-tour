import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaReader, type VillaReadTrace } from "@/lib/server/villa-reads";
import { createBoundedMemoryCache, createRuntimeCacheSource, villaCacheTags, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";
import { delayedWrites } from "./villa-runtime-cache-fixtures";

// First authoritative 404 on an empty detail key, with an older positive cold fill whose
// cache.set is delayed past its empty-key check. Three independent workers, one shared cache.

const URL = "https://villa.example.test";
const villa = {
  _id: "p1", slug: "extra-99", name: "active", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null, translations: [],
};
const settle = async () => {
  for (let index = 0; index < 6; index++) await new Promise((resolve) => setImmediate(resolve));
};

function origin() {
  const state = { row: { villa, reviews: [] } as unknown, calls: 0 };
  const query = vi.fn(async (_ref: unknown, args: { slug?: string }) => {
    state.calls++;
    return args.slug === "extra-99" ? state.row : null;
  });
  return { state, query };
}

function worker(cache: VillaRuntimeCache, query: ReturnType<typeof origin>["query"]) {
  const source = createRuntimeCacheSource({ cache: () => cache, client: () => ({ query } as never), env: {} });
  return { source, reader: createVillaReader(source) };
}

async function read(w: ReturnType<typeof worker>, slug = "extra-99") {
  const trace: VillaReadTrace = {};
  const page = await w.reader.getVilla(slug, "en", trace);
  return { name: page?.villa.name ?? null, cache: trace.runtimeCache };
}

/** Records every write of a slug's shared generation (bootstraps and rotations). */
function generationWrites(cache: VillaRuntimeCache) {
  const writes: string[] = [];
  const set = cache.set.bind(cache);
  vi.spyOn(cache, "set").mockImplementation(async (key, value, options) => {
    const slug = key.match(/:gen:slug:(.+)$/)?.[1];
    if (slug) writes.push(slug);
    return set(key, value, options);
  });
  return (slug: string) => writes.filter((item) => item === slug).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", URL);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("negative detail misses fence the generation before a shared 404", () => {
  it("an older active cold fill delayed past its empty-key check cannot follow an observable 404", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slowA = delayedWrites(shared);
    const [a, b, c] = [worker(slowA.cache, db.query), worker(shared, db.query), worker(shared, db.query)];

    // A's cold fill reads active, finds the key empty, and its write is held.
    expect(await read(a)).toEqual({ name: "active", cache: "miss" });
    await settle();
    expect(slowA.held).toHaveLength(1);

    // The archive commits; B makes the first authoritative null observation on the empty key.
    vi.advanceTimersByTime(1);
    db.state.row = null;
    expect(await read(b)).toEqual({ name: null, cache: "miss" });
    // C reads after B's 404 was observable, before and after A's delayed write lands.
    expect((await read(c)).name).toBeNull();
    await slowA.release();
    await settle();
    expect((await read(c)).name).toBeNull();
    expect((await read(b)).name).toBeNull();
    expect((await read(a)).name).toBeNull();
    expect(await read(c)).toEqual({ name: null, cache: "hit" });
  });

  it("does not answer the 404 until its fencing rotation is acknowledged", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slowA = delayedWrites(shared);
    const gates: (() => void)[] = [];
    let holdRotation = false;
    // B's view of the cache: its fencing generation write waits while `holdRotation` is set.
    const bCache: VillaRuntimeCache = {
      ...shared,
      async set(key, value, options) {
        if (holdRotation && key.endsWith(":gen:slug:extra-99")) await new Promise<void>((resolve) => gates.push(resolve));
        return shared.set(key, value, options);
      },
    };
    const [a, b, c] = [worker(slowA.cache, db.query), worker(bCache, db.query), worker(shared, db.query)];
    expect(await read(a)).toEqual({ name: "active", cache: "miss" });
    await settle();
    expect(await read(b)).toEqual({ name: "active", cache: "miss" });
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));
    await slowA.release();
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));

    // A cold-fills active again; its write is held past its empty-key check.
    expect(await read(a)).toEqual({ name: "active", cache: "miss" });
    await settle();
    vi.advanceTimersByTime(1);
    db.state.row = null;
    holdRotation = true;
    let answered = false;
    const pending = read(b).then((result) => {
      answered = true;
      return result;
    });
    await settle();
    expect(answered).toBe(false);
    holdRotation = false;
    for (const open of gates.splice(0)) open();
    expect(await pending).toEqual({ name: null, cache: "miss" });
    await slowA.release();
    await settle();
    expect((await read(c)).name).toBeNull();
  });

  it("keeps ordinary TTL semantics when nobody has observed the archive", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slowA = delayedWrites(shared);
    const [a, c] = [worker(slowA.cache, db.query), worker(shared, db.query)];
    expect(await read(a)).toEqual({ name: "active", cache: "miss" });
    await settle();
    db.state.row = null;
    await slowA.release();
    // No worker saw the archive yet: the cached active value serves until its freshness ends.
    expect(await read(c)).toEqual({ name: "active", cache: "hit" });
  });

  it("rotates once per negative miss, never again for the post-rotation null, and never for positive misses", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const writes = generationWrites(shared);
    const b = worker(shared, db.query);

    expect(await read(b, "gone")).toEqual({ name: null, cache: "miss" });
    await settle();
    // One bootstrap plus one fencing rotation; the republished null is stored without another.
    expect(writes("gone")).toBe(2);
    expect(db.state.calls).toBe(2);
    expect(await read(b, "gone")).toEqual({ name: null, cache: "hit" });
    expect(writes("gone")).toBe(2);

    expect(await read(b)).toEqual({ name: "active", cache: "miss" });
    await settle();
    expect(writes("extra-99")).toBe(1);
    expect(db.state.calls).toBe(3);
  });
});

describe("foreground and joined reads are ordered by the origin read they used", () => {
  const EVICT_MS = (60 + 3_600) * 1_000 + 1_000;
  const named = (name: string) => ({ villa: { ...villa, name }, reviews: [] });

  /**
   * Origin where chosen calls (1-based) wait to be released. `snapshot`: return the row seen at
   * the call's start (a slow reply); otherwise the row at release.
   */
  function heldOrigin() {
    const state = { row: named("active") as unknown, down: false, calls: 0 };
    const held = new Map<number, boolean>();
    const gates: (() => void)[] = [];
    const query = vi.fn(async () => {
      const call = ++state.calls;
      const seen = state.row;
      if (held.has(call)) {
        const snapshot = held.get(call);
        await new Promise<void>((resolve) => gates.push(resolve));
        if (state.down) throw new Error("offline");
        return snapshot ? seen : state.row;
      }
      if (state.down) throw new Error("offline");
      return seen;
    });
    return {
      state,
      query,
      hold: (call: number, snapshot = true) => held.set(call, snapshot),
      releaseFirst: async () => {
        gates.shift()?.();
        await settle();
      },
    };
  }

  /** A worker's cache view whose next generation lookup (both parallel GETs) waits. */
  function slowGenerations(shared: VillaRuntimeCache) {
    const gates: (() => void)[] = [];
    let hold = 0;
    const cache: VillaRuntimeCache = {
      ...shared,
      async get(key) {
        if (key.includes(":gen:") && hold > 0) {
          hold--;
          await new Promise<void>((resolve) => gates.push(resolve));
        }
        return shared.get(key);
      },
    };
    return {
      cache,
      holdLookup: () => { hold += 2; },
      release: async () => {
        for (const open of gates.splice(0)) open();
        await settle();
      },
    };
  }

  it("a later request's older origin reply cannot outrank an earlier request's newer 404 (out-of-order generation lookup)", async () => {
    const shared = createBoundedMemoryCache();
    const db = heldOrigin();
    const slow = slowGenerations(shared);
    const a = worker(slow.cache, db.query as never);
    const b = worker(shared, db.query as never);
    // Warm the generations, then drop the data entry so both A requests miss.
    expect(await read(a)).toEqual({ name: "active", cache: "miss" });
    await settle();
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));

    // Request 1 starts first but its generation lookup is delayed.
    slow.holdLookup();
    const first = read(a);
    await settle();
    // Request 2 starts later, uses the old generation, and its pre-archive origin reply is slow.
    vi.advanceTimersByTime(1);
    db.hold(db.state.calls + 1);
    const second = read(a);
    await settle();

    vi.advanceTimersByTime(1);
    db.state.row = null;
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    await slow.release();
    expect(await first).toMatchObject({ name: null, cache: "miss" });
    await db.releaseFirst();
    expect(await second).toMatchObject({ name: "active", cache: "miss" });
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect((await read(a)).name).toBeNull();
  });

  it("joined foreground reads carry the flight's origin start", async () => {
    const shared = createBoundedMemoryCache();
    const db = heldOrigin();
    const a = worker(shared, db.query as never);
    db.hold(1);
    const traces: VillaReadTrace[] = [{}, {}];
    const first = a.source.detail(URL, "extra-99", traces[0]);
    await settle();
    const started = Date.now();
    vi.advanceTimersByTime(5);
    const joined = a.source.detail(URL, "extra-99", traces[1]);
    await settle();
    await db.releaseFirst();
    await Promise.all([first, joined]);
    expect(db.state.calls).toBe(1);
    expect(traces[1].observedAt).toBe(started);
    expect(traces[1]).toMatchObject({ observedAt: traces[0].observedAt, observedSeq: traces[0].observedSeq });
  });

  it("a background republish whose generation was rotated again is not reported to the worker", async () => {
    const shared = createBoundedMemoryCache();
    const db = heldOrigin();
    const a = worker(shared, db.query as never);
    const b = worker(shared, db.query as never);
    expect(await read(a)).toMatchObject({ name: "active" });
    await settle();
    vi.advanceTimersByTime(60_001);

    // A's refresh (call 2) sees v2 and rotates; its republish read (call 3) is held.
    db.state.row = named("v2");
    db.hold(3, false);
    expect(await read(a)).toMatchObject({ name: "active", cache: "stale" });
    await settle();
    expect(db.state.calls).toBe(3);

    // Another worker confirms a later edit, rotating the generation again, before call 3 lands.
    vi.advanceTimersByTime(1);
    db.state.row = named("v3");
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    await db.releaseFirst();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    // A knows only what it observed under current generations: the refresh's v2.
    expect((await read(a)).name).toBe("v2");
  });
});
