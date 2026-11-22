import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaReader, type VillaReadTrace } from "@/lib/server/villa-reads";
import { createBoundedMemoryCache, createRuntimeCacheSource, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";

// Stale-while-revalidate over one shared cache, with independent workers (sources + readers).

const URL = "https://villa.example.test";
const FRESH_MS = 60_000;
const EVICT_MS = (60 + 3_600) * 1_000 + 1_000;
const villa = {
  _id: "p1", slug: "extra-99", name: "v1", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null, translations: [],
};
type Detail = { villa: typeof villa; reviews: never[] };
const named = (name: string): Detail => ({ villa: { ...villa, name }, reviews: [] });
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Committed rows; `hold()` makes the next detail query wait until released. */
function backend() {
  const state = { row: named("v1") as Detail | null, down: false, calls: 0 };
  const holds: { resolve: () => void }[] = [];
  let holdNext = 0;
  const query = vi.fn(async () => {
    state.calls++;
    if (holdNext > 0) {
      holdNext--;
      const gate = Promise.withResolvers<void>();
      holds.push(gate);
      // Snapshot at query start: a held read returns the state it saw, like a slow origin.
      const seen = state.row;
      const down = state.down;
      await gate.promise;
      if (down) throw new Error("offline");
      return seen;
    }
    if (state.down) throw new Error("offline");
    return state.row;
  });
  return {
    state,
    query,
    hold: (count = 1) => { holdNext += count; },
    release: async () => {
      for (const gate of holds.splice(0)) gate.resolve();
      await settle();
    },
  };
}

function worker(cache: VillaRuntimeCache, query: ReturnType<typeof backend>["query"], options: { verifyWrites?: boolean } = {}) {
  const waits: Promise<unknown>[] = [];
  const source = createRuntimeCacheSource({
    cache: () => cache,
    client: () => ({ query } as never),
    waitUntil: (pending) => waits.push(pending),
    env: {},
    ...options,
  });
  return { source, reader: createVillaReader(source), waits };
}

const read = async (w: ReturnType<typeof worker>, transport?: number[]) => {
  const trace: VillaReadTrace = transport ? { observeTransportMs: (ms) => transport.push(ms) } : {};
  const page = await w.reader.getVilla("extra-99", "en", trace);
  return { name: page?.villa.name ?? null, cache: trace.runtimeCache, storage: trace.storage, recovery: trace.recovery };
};

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

describe("Start villa stale-while-revalidate", () => {
  it("serves 60 s fresh, then answers stale immediately while a held refresh runs, then the update", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query);
    const transport: number[] = [];
    expect(await read(a, transport)).toEqual({ name: "v1", cache: "miss", storage: undefined, recovery: undefined });
    expect(transport).toHaveLength(1);
    await settle();

    vi.advanceTimersByTime(FRESH_MS - 1);
    expect(await read(a, transport)).toMatchObject({ name: "v1", cache: "hit" });
    expect(db.state.calls).toBe(1);

    vi.advanceTimersByTime(1);
    db.state.row = named("v2");
    db.hold();
    const stale = await read(a, transport);
    expect(stale).toMatchObject({ name: "v1", cache: "stale" });
    expect(db.state.calls).toBe(2);
    // The response did not wait on the origin, so no transport time is attributed to it.
    expect(transport).toHaveLength(1);
    expect(a.waits.length).toBeGreaterThan(0);

    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    expect(db.state.calls).toBe(2);
    await db.release();
    await settle();
    // Changed content is republished under a new generation from one more origin read.
    expect(await read(a)).toMatchObject({ name: "v2", cache: "hit" });
    expect(db.state.calls).toBe(3);
    vi.advanceTimersByTime(FRESH_MS - 1);
    expect(await read(a)).toMatchObject({ name: "v2", cache: "hit" });
    expect(db.state.calls).toBe(3);
  });

  it("coalesces refreshes per worker: no storm across many stale requests on two workers", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);
    db.hold(2);
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => read(index % 2 ? a : b)));
    expect(results.every((result) => result.cache === "stale" && result.name === "v1")).toBe(true);
    expect(db.state.calls).toBe(3);
    await db.release();
  });

  it("keeps serving stale through refresh failures without retrying each request", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);
    db.state.down = true;

    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale", recovery: undefined });
    await settle();
    for (let index = 0; index < 5; index++) expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    expect(db.state.calls).toBe(2);

    vi.advanceTimersByTime(30_000);
    db.state.down = false;
    db.state.row = named("v2");
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    await settle();
    await settle();
    expect(db.state.calls).toBe(4);
    expect(await read(a)).toMatchObject({ name: "v2", cache: "hit" });
  });

  it("cannot hang a key: a never-settling refresh is dropped at the 3 s deadline and retried later", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const shared = createBoundedMemoryCache();
    let calls = 0;
    const never = new Promise<Detail>(() => {});
    const query = vi.fn(async () => {
      calls++;
      if (calls === 2) return never;
      return named(calls === 1 ? "v1" : "v3");
    });
    const a = worker(shared, query as never);
    await read(a);
    await vi.advanceTimersByTimeAsync(FRESH_MS);
    expect(await read(a)).toMatchObject({ cache: "stale" });
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(4);
    expect(await read(a)).toMatchObject({ name: "v3", cache: "hit" });
  });

  it("never answers stale after a confirmed archive, and a held stale refresh cannot write it back", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);

    db.hold();
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    db.state.row = null;
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await read(a)).toMatchObject({ name: null, cache: "miss" });
    await db.release();
    await settle();
    expect(await read(a)).toMatchObject({ name: null, cache: "hit" });
    expect(await read(b)).toMatchObject({ name: null, cache: "hit" });

    // Even once the archive itself is stale, it stays a 404 while refreshing.
    vi.advanceTimersByTime(FRESH_MS);
    expect(await read(b)).toMatchObject({ name: null, cache: "stale" });
  });

  it("keeps the final edit when an older refresh lands after reordered, confirmed edits", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);

    db.state.row = named("v2");
    db.hold();
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    db.state.row = named("v3");
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await read(b)).toMatchObject({ name: "v3", cache: "miss" });
    await db.release();
    await settle();
    expect(await read(a)).toMatchObject({ name: "v3", cache: "hit" });
    vi.advanceTimersByTime(FRESH_MS);
    expect(await read(a)).toMatchObject({ name: "v3", cache: "stale" });
  });

  it("waits on the origin only after bounded stale retention, and serves stale while the reader is in backoff", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(EVICT_MS);
    const transport: number[] = [];
    expect(await read(a, transport)).toMatchObject({ name: "v1", cache: "miss" });
    expect(transport).toHaveLength(1);
    await settle();

    // A blocking read fails (cold key) and puts the reader into backoff; stale data still answers.
    vi.advanceTimersByTime(FRESH_MS);
    db.state.down = true;
    await expect(a.reader.getVilla("cold", "en")).rejects.toMatchObject({ status: 503 });
    // In backoff the reader only peeks: stale data answers and no refresh is attempted.
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    expect(db.state.calls).toBe(3);
  });

  it("labels benchmark stale answers without claiming a confirmed origin write", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query, { verifyWrites: true });
    expect(await read(a)).toMatchObject({ cache: "miss", storage: "confirmed" });
    vi.advanceTimersByTime(FRESH_MS);
    expect(await read(a)).toEqual({ name: "v1", cache: "stale", storage: undefined, recovery: undefined });
    await settle();
    expect(await read(a)).toMatchObject({ cache: "hit" });
  });
});

describe("background refresh outcomes reach the worker's recovery state", () => {
  /** Per-slug rows; `holdNext` makes the next query never settle (an origin that hangs). */
  function slugBackend() {
    const rows = new Map<string, Detail | null>([["extra-99", named("v1")], ["gone", null]]);
    const state = { down: false, calls: 0, holdNext: false };
    const query = vi.fn(async (_ref: unknown, args: { slug?: string }) => {
      state.calls++;
      if (state.holdNext) {
        state.holdNext = false;
        return new Promise<never>(() => {});
      }
      if (state.down) throw new Error("offline");
      return rows.get(args.slug!) ?? null;
    });
    return { rows, state, query };
  }
  const page = async (w: ReturnType<typeof worker>, slug: string) => (await w.reader.getVilla(slug, "en"))?.villa.name ?? null;

  it("puts the worker in 30 s backend backoff when a held refresh times out: cold 503 with no origin read, archive 404", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const db = slugBackend();
    const a = worker(createBoundedMemoryCache(), db.query as never);
    expect(await page(a, "extra-99")).toBe("v1");
    expect(await page(a, "gone")).toBeNull();
    await vi.advanceTimersByTimeAsync(FRESH_MS);

    db.state.holdNext = true;
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    await vi.advanceTimersByTimeAsync(3_000);
    const calls = db.state.calls;

    const cold = await a.reader.getVilla("cold", "en").catch((error: unknown) => error);
    expect(cold).toMatchObject({ status: 503, retryAfterSeconds: 30 });
    expect(await page(a, "gone")).toBeNull();
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale", recovery: undefined });
    expect(db.state.calls).toBe(calls);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await page(a, "cold")).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    // The first authoritative miss on an empty key also republishes after its fence.
    expect(db.state.calls).toBe(calls + 2);
  });

  it("evicts last-good data when a completed refresh observes an archive, so a later outage stays 404", async () => {
    const db = slugBackend();
    const a = worker(createBoundedMemoryCache(), db.query as never);
    expect(await page(a, "extra-99")).toBe("v1");
    await settle();
    vi.advanceTimersByTime(FRESH_MS);

    db.rows.set("extra-99", null);
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    await settle();
    await settle();

    // No further request on this worker: only the refresh itself can have learned the archive.
    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect(await page(a, "extra-99")).toBeNull();
    expect(await page(a, "extra-99")).toBeNull();
  });

  it("replaces last-good data with a completed refresh's edit for later outages", async () => {
    const db = slugBackend();
    const a = worker(createBoundedMemoryCache(), db.query as never);
    await page(a, "extra-99");
    await settle();
    vi.advanceTimersByTime(FRESH_MS);
    db.rows.set("extra-99", named("v2"));
    await read(a);
    await settle();
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    const trace: VillaReadTrace = {};
    expect((await a.reader.getVilla("extra-99", "en", trace))?.villa.name).toBe("v2");
    expect(trace).toMatchObject({ recovery: "read-error", fallback: "detail" });
  });

  it("ignores an overtaken refresh: a held stale refresh landing after a confirmed archive cannot restore it", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);

    db.hold();
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    db.state.row = null;
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await read(a)).toMatchObject({ name: null, cache: "miss" });
    await db.release();
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect(await read(a)).toMatchObject({ name: null });
    expect(await read(a)).toMatchObject({ name: null });
  });

  it("ignores a refresh whose generation was invalidated before it landed, even without a newer local read", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await b.reader.getVilla("extra-99", "en");
    await settle();
    // A learns the archive first; its stale refresh (holding the reactivated row) is overtaken
    // by a second, confirmed archive that A never reads before the outage.
    db.state.row = null;
    await b.source.expire("extra-99");
    expect(await read(a)).toMatchObject({ name: null, cache: "miss" });
    await settle();
    vi.advanceTimersByTime(FRESH_MS);
    db.state.row = named("briefly reactivated");
    db.hold();
    expect(await read(a)).toMatchObject({ name: null, cache: "stale" });
    db.state.row = null;
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    await db.release();
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect(await read(a)).toMatchObject({ name: null });
  });

  it("fences a same-generation refresh that lands after this worker applied a newer answer", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await read(a);
    await read(b);
    await settle();
    vi.advanceTimersByTime(FRESH_MS);

    db.hold();
    expect(await read(a)).toMatchObject({ name: "v1", cache: "stale" });
    db.state.row = null;
    expect(await read(b)).toMatchObject({ name: "v1", cache: "stale" });
    await settle();
    await settle();
    expect(await read(a)).toMatchObject({ name: null, cache: "hit" });
    await db.release();
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect(await read(a)).toMatchObject({ name: null });
  });
});
