import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaReader, type VillaReadTrace } from "@/lib/server/villa-reads";
import { createBoundedMemoryCache, createRuntimeCacheSource, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";
import { delayedWrites } from "./villa-runtime-cache-fixtures";

// Independent workers (source + reader each) over one shared cache, with TTL-only edits
// (no invalidation call), held origin reads and delayed storage writes.

const URL = "https://villa.example.test";
const FRESH_MS = 60_000;
const EVICT_MS = (60 + 3_600) * 1_000 + 1_000;
const villa = {
  _id: "p1", slug: "extra-99", name: "active", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null, translations: [],
};
type Detail = { villa: typeof villa; reviews: never[] };
const active = (name = "active"): Detail => ({ villa: { ...villa, name }, reviews: [] });
const settle = async () => {
  for (let index = 0; index < 4; index++) await new Promise((resolve) => setImmediate(resolve));
};
type Ref = Parameters<typeof getFunctionName>[0];

/**
 * The committed origin state. `hold()` makes the next detail query capture the state at its
 * start and wait; `slugsDown` fails only the sitemap query.
 */
function origin() {
  const state = { row: active() as Detail | null, down: false, slugsDown: false, calls: 0, slugCalls: 0 };
  const holds: (() => void)[] = [];
  let holdNext = 0;
  const query = vi.fn(async (ref: Ref, args: { slug?: string; paginationOpts?: unknown }) => {
    if (args.paginationOpts) {
      state.slugCalls++;
      if (state.slugsDown || state.down) throw new Error("sitemap offline");
      return { page: ["extra-99"], continueCursor: "", isDone: true };
    }
    state.calls++;
    if (getFunctionName(ref) !== "catalog/publicProperties:getBySlug") throw new Error("unexpected query");
    const seen = args.slug === "extra-99" ? state.row : active(args.slug);
    if (holdNext > 0) {
      holdNext--;
      const down = state.down;
      await new Promise<void>((resolve) => holds.push(resolve));
      if (down) throw new Error("offline");
      return seen;
    }
    if (state.down) throw new Error("offline");
    return seen;
  });
  return {
    state,
    query,
    hold: () => { holdNext++; },
    release: async () => {
      for (const resume of holds.splice(0)) resume();
      await settle();
    },
    releaseFirst: async () => {
      holds.shift()?.();
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
  return { name: page?.villa.name ?? null, cache: trace.runtimeCache, recovery: trace.recovery };
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

describe("(1) a held refresh cannot republish older content after another worker published a change", () => {
  it("TTL-only archive across three workers: A's held active result never reaches readers", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const [a, b, c] = [worker(shared, db.query), worker(shared, db.query), worker(shared, db.query)];
    expect(await read(a)).toMatchObject({ name: "active", cache: "miss" });
    await settle();
    expect(await read(b)).toMatchObject({ name: "active", cache: "hit" });
    vi.advanceTimersByTime(FRESH_MS + 1);

    db.hold();
    expect(await read(a)).toMatchObject({ name: "active", cache: "stale" });
    // Same-worker stale calls share A's one held refresh.
    for (let index = 0; index < 3; index++) expect(await read(a)).toMatchObject({ name: "active", cache: "stale" });
    expect(db.state.calls).toBe(2);

    vi.advanceTimersByTime(1);
    db.state.row = null;
    expect(await read(b)).toMatchObject({ name: "active", cache: "stale" });
    await settle();
    expect(await read(a)).toMatchObject({ name: null });
    expect(await read(c)).toMatchObject({ name: null, cache: "hit" });

    await db.release();
    // No later foreground read on A is needed for the state to stay correct for every worker.
    expect(await read(c)).toMatchObject({ name: null, cache: "hit" });
    expect(await read(a)).toMatchObject({ name: null, cache: "hit" });
    expect(await read(b)).toMatchObject({ name: null, cache: "hit" });
  });

  it("TTL-only reactivation with a delayed republish write: no worker returns the older null", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    db.state.row = null;
    const slowB = delayedWrites(shared);
    const [a, b, c] = [worker(shared, db.query), worker(slowB.cache, db.query), worker(shared, db.query)];
    expect(await read(a)).toMatchObject({ name: null, cache: "miss" });
    await settle();
    vi.advanceTimersByTime(FRESH_MS + 1);

    db.hold();
    expect(await read(a)).toMatchObject({ name: null, cache: "stale" });
    vi.advanceTimersByTime(1);
    db.state.row = active("reactivated");
    expect(await read(b)).toMatchObject({ name: null, cache: "stale" });
    await settle();
    // B rotated before publishing; its write is still pending, so C waits on the origin.
    expect(await read(c)).toMatchObject({ name: "reactivated", cache: "miss" });
    await db.release();
    await slowB.release();
    await settle();
    expect(await read(a)).toMatchObject({ name: "reactivated" });
    expect(await read(c)).toMatchObject({ name: "reactivated", cache: "hit" });
  });

  it("an unchanged refresh extends freshness in place without rotating", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const [a, b] = [worker(shared, db.query), worker(shared, db.query)];
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS + 1);
    expect(await read(a)).toMatchObject({ cache: "stale" });
    await settle();
    expect(await read(b)).toMatchObject({ name: "active", cache: "hit" });
    expect(db.state.calls).toBe(2);
  });
});

describe("(2) observation order, not request order, decides a worker's recovery state", () => {
  it("a stale answer served while an authoritative null refresh is in flight does not retain the villa", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const db = origin();
    const a = worker(createBoundedMemoryCache(), db.query);
    await read(a);
    await vi.advanceTimersByTimeAsync(FRESH_MS + 1);
    db.state.row = null;

    // Hold both the refresh and its republish read, so only the refresh's own observation lands.
    db.hold();
    db.hold();
    expect(await read(a)).toMatchObject({ name: "active", cache: "stale" });
    // A later request on the same worker is answered by the same (older) stale entry.
    await vi.advanceTimersByTimeAsync(1);
    expect(await read(a)).toMatchObject({ name: "active", cache: "stale" });
    await db.releaseFirst();
    await vi.advanceTimersByTimeAsync(0);

    db.state.down = true;
    await vi.advanceTimersByTimeAsync(EVICT_MS);
    const pending = read(a);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toMatchObject({ name: null });
  });
});

describe("(3) a key stays in flight until its write is visible", () => {
  it("does not start a second refresh while the first one's write is still pending", async () => {
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slow = delayedWrites(shared);
    const a = worker(slow.cache, db.query);
    await read(a);
    await slow.release();
    vi.advanceTimersByTime(FRESH_MS + 1);

    expect(await read(a)).toMatchObject({ cache: "stale" });
    await settle();
    expect(slow.held).toHaveLength(1);
    for (let index = 0; index < 3; index++) expect(await read(a)).toMatchObject({ cache: "stale" });
    expect(db.state.calls).toBe(2);
    await slow.release();
    expect(await read(a)).toMatchObject({ cache: "hit" });
  });

  it("releases a key whose storage write never settles after the bound", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const shared = createBoundedMemoryCache();
    const db = origin();
    const slow = delayedWrites(shared);
    const a = worker(slow.cache, db.query);
    await read(a);
    await slow.release();
    await vi.advanceTimersByTimeAsync(FRESH_MS + 1);
    expect(await read(a)).toMatchObject({ cache: "stale" });
    await vi.advanceTimersByTimeAsync(0);
    expect(db.state.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await read(a)).toMatchObject({ cache: "stale" });
    await vi.advanceTimersByTimeAsync(0);
    expect(db.state.calls).toBe(3);
  });
});

describe("(4) the sitemap keeps its own recovery policy", () => {
  it("a failed background sitemap refresh does not put detail reads into backoff", async () => {
    const db = origin();
    const a = worker(createBoundedMemoryCache(), db.query);
    expect(await a.reader.getSlugs()).toEqual(["extra-99"]);
    await settle();
    vi.advanceTimersByTime(FRESH_MS + 1);
    db.state.slugsDown = true;
    expect(await a.reader.getSlugs()).toEqual(["extra-99"]);
    await settle();
    expect(db.state.slugCalls).toBe(2);

    expect(await read(a, "cold")).toEqual({ name: "cold", cache: "miss", recovery: undefined });
  });

  it("a failed background detail refresh still backs off the worker", async () => {
    const db = origin();
    const a = worker(createBoundedMemoryCache(), db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS + 1);
    db.state.down = true;
    await read(a);
    await settle();
    const calls = db.state.calls;
    await expect(a.reader.getVilla("cold", "en")).rejects.toMatchObject({ status: 503 });
    expect(db.state.calls).toBe(calls);
  });
});
