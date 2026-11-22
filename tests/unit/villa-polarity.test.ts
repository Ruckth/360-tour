import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaReader, type VillaReadTrace } from "@/lib/server/villa-reads";
import { createBoundedMemoryCache, createRuntimeCacheSource, villaCacheNamespace, villaCacheTags, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";
import { delayedWrites } from "./villa-runtime-cache-fixtures";

// Polarity invariant: a per-slug generation is positive or negative, and only results of its
// polarity are stored or served under it. Three independent workers share one cache.

const URL = "https://villa.example.test";
const FRESH_MS = 60_000;
const villa = {
  _id: "p1", slug: "extra-99", name: "v1", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null, translations: [],
};
const named = (name: string) => ({ villa: { ...villa, name }, reviews: [] });
const settle = async () => {
  for (let index = 0; index < 8; index++) await new Promise((resolve) => setImmediate(resolve));
};

/** Origin where chosen calls (1-based) wait; a held call returns the row at release. */
function origin(row: unknown = named("v1")) {
  const state = { row, calls: 0 };
  const held = new Set<number>();
  const gates: (() => void)[] = [];
  const query = vi.fn(async (_ref: unknown, args: { slug?: string }) => {
    const call = ++state.calls;
    if (held.has(call)) await new Promise<void>((resolve) => gates.push(resolve));
    return args.slug === "extra-99" ? state.row : null;
  });
  return {
    state,
    query,
    hold: (call: number) => held.add(call),
    releaseFirst: async () => {
      gates.shift()?.();
      await settle();
    },
  };
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

/** Counts cache operations by kind for one worker's view. */
function counted(shared: VillaRuntimeCache) {
  const counts = { genGets: 0, dataGets: 0, genSets: 0, dataSets: 0 };
  const cache: VillaRuntimeCache = {
    ...shared,
    get: (key) => {
      counts[key.includes(":gen:") ? "genGets" : "dataGets"]++;
      return shared.get(key);
    },
    set: (key, value, options) => {
      counts[key.includes(":gen:") ? "genSets" : "dataSets"]++;
      return shared.set(key, value, options);
    },
  };
  return { cache, counts };
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

describe("detail generations carry polarity", () => {
  it("A republishes v2, B's v2 fill is delayed, the archive lands: the 404 is never followed by v2", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slowB = delayedWrites(shared);
    const [a, b, c] = [worker(shared, db.query), worker(slowB.cache, db.query), worker(shared, db.query)];
    expect(await read(a)).toEqual({ name: "v1", cache: "miss" });
    await settle();
    vi.advanceTimersByTime(FRESH_MS + 1);

    // A's refresh (call 2) sees v2 and rotates (positive); its republish read (call 3) is held.
    db.state.row = named("v2");
    db.hold(3);
    expect(await read(a)).toEqual({ name: "v1", cache: "stale" });
    await settle();
    expect(db.state.calls).toBe(3);

    // B reads v2 under the new positive generation; its cache write is delayed.
    expect(await read(b)).toEqual({ name: "v2", cache: "miss" });
    await settle();
    expect(slowB.held).toHaveLength(1);

    // The archive commits; A's post-rotation read observes it and must not publish it in place.
    vi.advanceTimersByTime(1);
    db.state.row = null;
    await db.releaseFirst();
    expect(await read(c)).toEqual({ name: null, cache: "hit" });

    await slowB.release();
    await settle();
    for (const w of [c, a, b]) expect((await read(w)).name).toBeNull();
    expect(await read(c)).toEqual({ name: null, cache: "hit" });
  });

  it("a reactivation is never followed by an older delayed null from the negative epoch", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin(null);
    const slowA = delayedWrites(shared);
    const [a, b, c] = [worker(slowA.cache, db.query), worker(shared, db.query), worker(shared, db.query)];
    // Establish the negative epoch, then drop its data entry.
    expect(await read(b)).toEqual({ name: null, cache: "miss" });
    await settle();
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));

    // A's cold fill reads null under the negative generation; its write is delayed.
    expect(await read(a)).toEqual({ name: null, cache: "miss" });
    await settle();
    expect(slowA.held).toHaveLength(1);

    vi.advanceTimersByTime(1);
    db.state.row = named("reactivated");
    expect(await read(b)).toEqual({ name: "reactivated", cache: "miss" });
    expect((await read(c)).name).toBe("reactivated");
    await slowA.release();
    await settle();
    for (const w of [c, a, b]) expect((await read(w)).name).toBe("reactivated");
  });

  it("keeps healthy positive reads unchanged: no generation writes, no extra cache reads", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const view = counted(shared);
    const a = worker(view.cache, db.query);
    expect(await read(a)).toEqual({ name: "v1", cache: "miss" });
    await settle();
    // Cold: two generation lookups (+1 read-back per bootstrap), the data GET and the pre-write check.
    expect(view.counts).toEqual({ genGets: 4, dataGets: 2, genSets: 2, dataSets: 1 });

    const before = { ...view.counts };
    expect(await read(a)).toEqual({ name: "v1", cache: "hit" });
    expect(view.counts).toEqual({ ...before, genGets: before.genGets + 2, dataGets: before.dataGets + 1 });
    expect(db.state.calls).toBe(1);
  });

  it("stores repeated 404s in a negative epoch directly, without rotating again", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin(null);
    const view = counted(shared);
    const a = worker(view.cache, db.query);
    expect(await read(a)).toEqual({ name: null, cache: "miss" });
    await settle();
    // Bootstrap (positive) + one rotation to negative; the post-rotation null stores directly.
    expect(view.counts.genSets).toBe(3);
    expect(db.state.calls).toBe(2);

    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));
    expect(await read(a)).toEqual({ name: null, cache: "miss" });
    await settle();
    expect(view.counts.genSets).toBe(3);
    expect(db.state.calls).toBe(3);
    expect(await read(a)).toEqual({ name: null, cache: "hit" });
  });

  it("never serves a stored value that contradicts its generation's polarity", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin(null);
    const writes: string[] = [];
    const set = shared.set.bind(shared);
    vi.spyOn(shared, "set").mockImplementation(async (key, value, options) => {
      if (key.includes(":detail:extra-99@")) writes.push(key);
      return set(key, value, options);
    });
    const a = worker(shared, db.query);
    expect(await read(a)).toEqual({ name: null, cache: "miss" });
    await settle();
    const negativeKey = writes.at(-1)!;
    // A positive envelope planted under the negative generation (e.g. a legacy or foreign write).
    await set(negativeKey, { v: named("planted"), f: Date.now() + FRESH_MS, o: Date.now() }, { ttl: 60 });
    db.state.row = named("live");
    expect(await read(a)).toEqual({ name: "live", cache: "miss" });
  });
});

describe("a transition is answered only once the current generation has its polarity", () => {
  const GEN = `${villaCacheNamespace(URL, {})}:gen:slug:extra-99`;
  const polarity = async (cache: VillaRuntimeCache) => ((await cache.get(GEN)) as { n?: true } | null)?.n === true ? "negative" : "positive";

  /** A worker's view whose first lookup of the slug generation is dropped (the SDK reports null). */
  function droppedGenerationRead(shared: VillaRuntimeCache) {
    let drop = true;
    return {
      ...shared,
      async get(key: string) {
        if (drop && key === GEN) {
          drop = false;
          return null;
        }
        return shared.get(key);
      },
    } satisfies VillaRuntimeCache;
  }

  it("bootstrap race: B installs a second positive generation and caches active; A's later 404 waits for a negative one", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const [a, b, c] = [worker(shared, db.query), worker(droppedGenerationRead(shared), db.query), worker(shared, db.query)];

    // A bootstraps the first positive generation; its origin read (call 1) is slow.
    db.hold(1);
    const first = read(a);
    await settle();
    // B cannot read that generation, bootstraps a second positive one, and caches active.
    expect(await read(b)).toEqual({ name: "v1", cache: "miss" });
    await settle();

    vi.advanceTimersByTime(1);
    db.state.row = null;
    // A's background republish read (call 3) is held, so only the fence can protect readers.
    db.hold(3);
    await db.releaseFirst();
    expect(await first).toEqual({ name: null, cache: "miss" });
    expect(await polarity(shared)).toBe("negative");
    expect((await read(c)).name).toBeNull();
  });

  it("inverse: B installs a second negative generation and caches null; A's later reactivation waits for a positive one", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin(null);
    const [x, a, b, c] = [worker(shared, db.query), worker(shared, db.query), worker(shared, db.query), worker(shared, db.query)];
    // Establish a negative epoch (calls 1-2), then drop its data entry so A misses.
    expect(await read(x)).toEqual({ name: null, cache: "miss" });
    await settle();
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));

    db.hold(3);
    const first = read(a);
    await settle();
    // B rotates to a second negative generation (invalidation keeps polarity) and caches null.
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await read(b)).toEqual({ name: null, cache: "miss" });
    await settle();

    vi.advanceTimersByTime(1);
    db.state.row = named("reactivated");
    db.hold(5);
    await db.releaseFirst();
    expect(await first).toEqual({ name: "reactivated", cache: "miss" });
    expect(await polarity(shared)).toBe("positive");
    expect((await read(c)).name).toBe("reactivated");
  });

  it("overlapping rotations: a competing opposite-polarity token is not taken as acknowledgement", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    let compete = true;
    // While A rotates to negative, another worker's positive rotation lands before A reads back.
    const contended: VillaRuntimeCache = {
      ...shared,
      async set(key, value, options) {
        await shared.set(key, value, options);
        if (compete && key === GEN && (value as { n?: true }).n === true) {
          compete = false;
          await shared.set(GEN, { g: "competitor" }, options);
        }
      },
    };
    const [a, c] = [worker(contended, db.query), worker(shared, db.query)];
    db.hold(1);
    const first = read(a);
    await settle();
    vi.advanceTimersByTime(1);
    db.state.row = null;
    db.hold(2);
    await db.releaseFirst();
    expect(await first).toEqual({ name: null, cache: "miss" });
    expect(compete).toBe(false);
    expect(await polarity(shared)).toBe("negative");
    expect((await read(c)).name).toBeNull();
  });

  it("releases a transition only at the bounded deadline when storage never converges", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const shared = createBoundedMemoryCache();
    const db = origin();
    // Every negative rotation is immediately overwritten by a positive one.
    const fighting: VillaRuntimeCache = {
      ...shared,
      async set(key, value, options) {
        await shared.set(key, value, options);
        if (key === GEN && (value as { n?: true }).n === true) await shared.set(GEN, { g: crypto.randomUUID() }, options);
      },
    };
    const a = worker(fighting, db.query);
    db.hold(1);
    const first = read(a);
    await vi.advanceTimersByTimeAsync(0);
    db.state.row = null;
    let answered = false;
    void first.then(() => { answered = true; });
    await db.releaseFirst();
    await vi.advanceTimersByTimeAsync(999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ name: null, cache: "miss" });
  });
});
