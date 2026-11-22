import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaReader } from "@/lib/server/villa-reads";
import { createBoundedMemoryCache, createRuntimeCacheSource, villaCacheTags, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";
import { delayedWrites, sdkCache } from "./villa-runtime-cache-fixtures";

// Two independent sources model two workers: separate in-flight maps and readers, one cache.

const URL = "https://villa.example.test";
/** Past fresh (60 s) and bounded stale retention (1 h): storage has evicted the entry. */
const EVICT_MS = (60 + 3_600) * 1_000 + 1_000;
const villa = {
  _id: "p1", slug: "extra-99", name: "Old name", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null, translations: [],
};
type Detail = { villa: typeof villa; reviews: never[] };
const named = (name: string, slug = "extra-99"): Detail => ({ villa: { ...villa, slug, name }, reviews: [] });
const catalog = { hasProperties: true, villas: [villa] };
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A mutable backend: `rows` is the committed state; `down` fails every query. */
function backend() {
  const state = { rows: new Map<string, Detail | null>([["extra-99", named("Old name")]]), down: false, calls: 0 };
  const query = vi.fn(async (ref: Parameters<typeof getFunctionName>[0], args: { slug?: string }) => {
    state.calls++;
    if (state.down) throw new Error("offline");
    if (getFunctionName(ref) === "catalog/publicProperties:list") return catalog;
    return state.rows.get(args.slug!) ?? null;
  });
  return { state, query };
}

function worker(cache: VillaRuntimeCache, query: ReturnType<typeof backend>["query"], options: { verifyWrites?: boolean } = {}) {
  const source = createRuntimeCacheSource({ cache: () => cache, client: () => ({ query } as never), env: {}, ...options });
  return { source, reader: createVillaReader(source) };
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

describe("shared villa cache generations", () => {
  it("drops worker A's delayed stale fill after worker B acknowledges a committed edit", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const slowA = delayedWrites(shared);
    const a = worker(slowA.cache, db.query);
    const b = worker(shared, db.query);

    expect(await a.source.detail(URL, "extra-99")).toEqual(named("Old name"));
    await settle();
    expect(slowA.held).toHaveLength(1);
    db.state.rows.set("extra-99", named("New name"));
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    await slowA.release();

    expect(await b.source.detail(URL, "extra-99")).toEqual(named("New name"));
    await settle();
    const trace = {};
    expect(await a.source.detail(URL, "extra-99", trace)).toEqual(named("New name"));
    expect(trace).toMatchObject({ runtimeCache: "hit" });
    expect(db.state.calls).toBe(2);
  });

  it("drops a fill whose backend read is still pending on another worker during invalidation", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const pending = Promise.withResolvers<Detail>();
    const slowQuery = vi.fn().mockReturnValueOnce(pending.promise);
    const a = worker(shared, slowQuery as never);
    const b = worker(shared, db.query);

    const stale = a.source.detail(URL, "extra-99");
    await settle();
    db.state.rows.set("extra-99", named("New name"));
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    pending.resolve(named("Old name"));
    expect(await stale).toEqual(named("Old name"));
    await settle();
    expect(await b.source.detail(URL, "extra-99")).toEqual(named("New name"));
  });

  it("scopes slug invalidation to that villa and shared reads; full invalidation reaches everything", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    db.state.rows.set("other", named("Other", "other"));
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await a.source.list(URL);
    await a.source.detail(URL, "extra-99");
    await a.source.detail(URL, "other");
    await settle();

    await b.source.expire("extra-99");
    const traces = { slug: {}, other: {} };
    await b.source.detail(URL, "extra-99", traces.slug);
    await b.source.detail(URL, "other", traces.other);
    expect(traces).toMatchObject({ slug: { runtimeCache: "miss" }, other: { runtimeCache: "hit" } });
    const callsBeforeList = db.state.calls;
    await b.source.list(URL);
    expect(db.state.calls).toBe(callsBeforeList + 1);
    await settle();

    expect(await a.source.expire()).toEqual({ status: "confirmed" });
    const other = {};
    await b.source.detail(URL, "other", other);
    expect(other).toMatchObject({ runtimeCache: "miss" });
  });

  it("confirms concurrent edits from two workers and serves both", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    db.state.rows.set("other", named("Other", "other"));
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await a.source.detail(URL, "extra-99");
    await a.source.detail(URL, "other");
    await settle();

    db.state.rows.set("extra-99", named("New name"));
    db.state.rows.set("other", named("Other 2", "other"));
    expect(await Promise.all([a.source.expire("extra-99"), b.source.expire("other"), b.source.expire("extra-99")]))
      .toEqual([{ status: "confirmed" }, { status: "confirmed" }, { status: "confirmed" }]);
    expect(await a.source.detail(URL, "extra-99")).toEqual(named("New name"));
    expect(await b.source.detail(URL, "other")).toEqual(named("Other 2", "other"));
  });

  it("serves last-good data on the warm worker through an outage after invalidation", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    await a.reader.getVilla("extra-99", "en");
    await b.source.expire("extra-99");
    db.state.down = true;

    const trace = {};
    expect(await a.reader.getVilla("extra-99", "en", trace)).toMatchObject({ villa: { name: "Old name" } });
    expect(trace).toMatchObject({ recovery: "read-error", fallback: "detail", runtimeCache: "miss" });
    await expect(b.reader.getVilla("extra-99", "en")).rejects.toMatchObject({ status: 503 });
  });

  it("bypasses an SDK cache that swallows failures and never acknowledges its invalidation", async () => {
    const db = backend();
    const down = sdkCache(true);
    const a = worker(down.cache, db.query, { verifyWrites: true });
    const trace = {};
    expect(await a.source.detail(URL, "extra-99", trace)).toEqual(named("Old name"));
    expect(trace).toMatchObject({ runtimeCache: "miss", storage: "unavailable" });
    const gets = down.state.gets;
    expect(await a.source.detail(URL, "extra-99")).toEqual(named("Old name"));
    expect(down.state.gets).toBe(gets);
    expect(db.state.calls).toBe(2);
    expect(await a.source.expire("extra-99")).toEqual({ status: "unconfirmed" });

    down.state.down = false;
    vi.advanceTimersByTime(5_000);
    const healthy = {};
    await a.source.detail(URL, "extra-99", healthy);
    expect(healthy).toMatchObject({ runtimeCache: "miss", storage: "confirmed" });
    expect(await a.source.expire("extra-99")).toEqual({ status: "confirmed" });
  });

  it("labels a fresh fill unconfirmed when only its data write is dropped", async () => {
    const db = backend();
    const sdk = sdkCache();
    sdk.state.dropData = true;
    const a = worker(sdk.cache, db.query, { verifyWrites: true });
    const trace = {};
    expect(await a.source.detail(URL, "extra-99", trace)).toEqual(named("Old name"));
    expect(trace).toMatchObject({ runtimeCache: "miss", storage: "unconfirmed" });
  });

  it("shares one generation bootstrap across concurrent cold requests", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query);
    await Promise.all([a.source.detail(URL, "extra-99"), a.source.detail(URL, "extra-99"), a.source.list(URL)]);
    expect(db.state.calls).toBe(2);
  });

  it("refuses a read-back of the previous generation when its own write was silently dropped", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const flaky = sdkCache(false, shared);
    const a = worker(flaky.cache, db.query);
    await a.source.detail(URL, "extra-99");
    await a.source.list(URL);
    await settle();
    const set = vi.spyOn(flaky.cache, "set").mockResolvedValue(undefined);
    expect(await a.source.expire("extra-99")).toEqual({ status: "unconfirmed" });
    set.mockRestore();
    expect(await a.source.expire("extra-99")).toEqual({ status: "confirmed" });
  });
});

describe("in-flight deadline", () => {
  it("issues a second fresh query while the first never settles and drops the late first result", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const shared = createBoundedMemoryCache();
    const first = Promise.withResolvers<Detail>();
    const query = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(named("New name"));
    const a = worker(shared, query as never);

    const cold = a.reader.getVilla("extra-99", "en").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await cold).toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await a.reader.getVilla("extra-99", "en")).toMatchObject({ villa: { name: "New name" } });
    expect(query).toHaveBeenCalledTimes(2);
    first.resolve(named("Old name"));
    await vi.advanceTimersByTimeAsync(0);
    const trace = {};
    expect(await a.source.detail(URL, "extra-99", trace)).toEqual(named("New name"));
    expect(trace).toMatchObject({ runtimeCache: "hit" });
  });

  it("keeps a 3 s deadline per sitemap page rather than per flight", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const query = vi.fn(async (_ref: unknown, { paginationOpts }: { paginationOpts: { cursor: string | null } }) => {
      const index = Number(paginationOpts.cursor ?? 0);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return { page: [String(index)], continueCursor: String(index + 1), isDone: index === 2 };
    });
    const a = worker(createBoundedMemoryCache(), query as never);
    const slugs = a.reader.getSlugs();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await slugs).toEqual(["0", "1", "2"]);
  });
});

describe("authoritative shared misses during backoff", () => {
  it("keeps an archived villa 404 after its shared null expires while the backend is still down", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const a = worker(shared, db.query);
    const b = worker(shared, db.query);
    expect(await a.reader.getVilla("extra-99", "en")).toMatchObject({ villa: { name: "Old name" } });

    // B's archive is observed after A's read (ordering is by origin observation time).
    vi.advanceTimersByTime(1);
    db.state.rows.set("extra-99", null);
    await b.source.expire("extra-99");
    expect(await b.reader.getVilla("extra-99", "en")).toBeNull();
    await settle();

    vi.advanceTimersByTime(40_000);
    db.state.down = true;
    await expect(a.reader.getVilla("other", "en")).rejects.toMatchObject({ status: 503 });
    const backoff = {};
    expect(await a.reader.getVilla("extra-99", "en", backoff)).toBeNull();
    expect(backoff).toMatchObject({ runtimeCache: "hit" });

    // Still inside the 30 s backoff, storage evicts the shared null: saved data must not resurface.
    await shared.expireTag(villaCacheTags(URL, "detail:extra-99", {}));
    const expired = {};
    expect(await a.reader.getVilla("extra-99", "en", expired)).toBeNull();
    expect(expired).toMatchObject({ recovery: "backoff" });
    // B's first authoritative miss fenced its generation and republished from one more read.
    expect(db.state.calls).toBe(4);
    await a.reader.getCatalog("en");
    expect(await a.reader.getVilla("extra-99", "en")).toBeNull();

    db.state.down = false;
    db.state.rows.set("extra-99", named("Reactivated"));
    vi.advanceTimersByTime(30_000);
    expect(await a.reader.getVilla("extra-99", "en")).toMatchObject({ villa: { name: "Reactivated" } });
  });
});

describe("per-reader recovery fence across workers", () => {
  /** Worker A's first detail read is held; every other read goes to the live backend. */
  function heldFirstDetail(db: ReturnType<typeof backend>) {
    const held = Promise.withResolvers<Detail | null>();
    let first = true;
    const query = vi.fn(async (ref: Parameters<typeof getFunctionName>[0], args: { slug?: string }) => {
      if (first && getFunctionName(ref) === "catalog/publicProperties:getBySlug") {
        first = false;
        return held.promise;
      }
      return db.query(ref, args);
    });
    return { held, query };
  }

  it("keeps an archive 404 when A's older active read lands after A learned the authoritative null", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    const { held, query } = heldFirstDetail(db);
    const a = worker(shared, query as never);
    const b = worker(shared, db.query);

    const old = a.reader.getVilla("extra-99", "en");
    await settle();
    db.state.rows.set("extra-99", null);
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await a.reader.getVilla("extra-99", "en")).toBeNull();
    held.resolve(named("Old name"));
    expect(await old).toMatchObject({ villa: { name: "Old name" } });

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    expect(await a.reader.getVilla("extra-99", "en")).toBeNull();
    expect(await a.reader.getVilla("extra-99", "en")).toBeNull();
  });

  it("keeps a reactivated villa when A's older null read lands after A learned it is active", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    db.state.rows.set("extra-99", null);
    const { held, query } = heldFirstDetail(db);
    const a = worker(shared, query as never);
    const b = worker(shared, db.query);

    const old = a.reader.getVilla("extra-99", "en");
    await settle();
    db.state.rows.set("extra-99", named("Reactivated"));
    expect(await b.source.expire("extra-99")).toEqual({ status: "confirmed" });
    expect(await a.reader.getVilla("extra-99", "en")).toMatchObject({ villa: { name: "Reactivated" } });
    held.resolve(null);
    expect(await old).toBeNull();
    // A's older null briefly forces a negative generation; its post-rotation re-read sees the
    // reactivation and restores a positive one. Let that background work finish.
    await settle();
    await settle();

    vi.advanceTimersByTime(EVICT_MS);
    db.state.down = true;
    const trace = {};
    expect(await a.reader.getVilla("extra-99", "en", trace)).toMatchObject({ villa: { name: "Reactivated" } });
    expect(trace).toMatchObject({ recovery: "read-error", fallback: "detail" });
  });

  it("does not mark a reactivated villa missing from an older null once its detail rotates out", async () => {
    const shared = createBoundedMemoryCache();
    const db = backend();
    db.state.rows.set("extra-99", null);
    for (let index = 0; index < 200; index++) db.state.rows.set(`villa-${index}`, named(`Villa ${index}`, `villa-${index}`));
    const { held, query } = heldFirstDetail(db);
    const a = worker(shared, query as never);
    const b = worker(shared, db.query);

    const old = a.reader.getVilla("extra-99", "en");
    await settle();
    db.state.rows.set("extra-99", named("Reactivated"));
    await b.source.expire("extra-99");
    await a.reader.getVilla("extra-99", "en");
    held.resolve(null);
    await old;
    await a.reader.getCatalog("en");
    for (let index = 0; index < 200; index++) await a.reader.getVilla(`villa-${index}`, "en");

    db.state.down = true;
    vi.advanceTimersByTime(EVICT_MS);
    const trace = {};
    expect(await a.reader.getVilla("extra-99", "en", trace)).toMatchObject({ villa: { id: "extra-99" }, reviews: [] });
    expect(trace).toMatchObject({ fallback: "catalog" });
  });

  it("bounds per-key ordering records across many slugs", async () => {
    const db = backend();
    const a = worker(createBoundedMemoryCache(), db.query);
    for (let index = 0; index < 700; index++) await a.reader.getVilla(`villa-${index}`, "en");
    expect(a.reader.orderedKeys()).toBe(512);
  });
});
