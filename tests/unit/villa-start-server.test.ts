import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoundedMemoryCache, createRuntimeCacheSource, villaCacheNamespace, villaCacheTags } from "@/lib/server/villa-runtime-cache";
import { sdkCache } from "./villa-runtime-cache-fixtures";

const { query, vercel } = vi.hoisted(() => ({
  query: vi.fn(),
  vercel: { getCache: vi.fn(), waitUntil: vi.fn() },
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; } }));
vi.mock("@vercel/functions", () => vercel);
// The Start entry must not reach Next or React server caches.
vi.mock("next/cache", () => { throw new Error("next/cache imported by the Start entry"); });
vi.mock("react", () => { throw new Error("react imported by the Start entry"); });

const villa = {
  _id: "p1", slug: "extra-99", name: "Villa 101", tagline: "Tagline", description: "Description",
  pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
  images: [], amenities: [], tourRoomIds: [], contentEditedAt: null, directDiscountPercent: 0,
  reviewCount: 0, averageRating: null,
  translations: [{ locale: "th", tagline: "แท็กไลน์" }],
};
const detail = { villa, reviews: [] };
const catalog = { hasProperties: true, villas: [villa] };
const URL = "https://villa.example.test";
const fn = (index: number) => getFunctionName(query.mock.calls[index][0]);

let start: typeof import("@/start-app/villas.server");

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  query.mockReset();
  vercel.getCache.mockReset().mockImplementation(() => createBoundedMemoryCache());
  vercel.waitUntil.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://villa.example.test");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("RUNTIME_CACHE_ENDPOINT", "https://runtime-cache.invalid/");
  vi.stubEnv("RUNTIME_CACHE_HEADERS", "{}");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  start = await import("@/start-app/villas.server");
}, 15_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
// Past fresh (60 s) and bounded stale retention (1 h): storage has evicted the entry.
const expireTtl = () => vi.advanceTimersByTime((60 + 3_600) * 1_000 + 1_000);

describe("Start villa reads", () => {
  it("serves runtime cache hits after a fresh miss and reports them for Preview headers", async () => {
    query.mockResolvedValue(detail);
    const first = await start.getStartVilla("extra-99", "en");
    await settle();
    const second = await start.getStartVilla("extra-99", "en");
    expect(first).toMatchObject({ cache: "miss", page: { villa: { id: "extra-99", name: "Villa 101" } } });
    expect(second).toMatchObject({ cache: "hit", page: { villa: { id: "extra-99" } } });
    expect(start.villaCacheHeader(first)).toBe("miss");
    expect(query).toHaveBeenCalledTimes(1);
    expect(vercel.getCache).toHaveBeenCalledTimes(1);
    expect(vercel.waitUntil).toHaveBeenCalled();
  });

  it("isolates Preview detail entries while reusing deployment-scoped generations", async () => {
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_candidate");
    const runtime = createBoundedMemoryCache();
    const set = vi.spyOn(runtime, "set");
    const get = vi.spyOn(runtime, "get");
    vercel.getCache.mockReturnValue(runtime);
    query.mockResolvedValue(detail);
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "miss" });
    await settle();

    set.mockClear();
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "miss" });
    const genesis = set.mock.calls.map(([key]) => key).filter((key) => key.includes(":gen:"));
    expect(genesis.sort()).toEqual([
      expect.stringContaining(":bench-scope:dpl_candidate:gen:all"),
      expect.stringContaining(":bench-scope:dpl_candidate:gen:slug:extra-99"),
    ]);
    expect(await start.getStartVilla("extra-99", "th", "start-run-a")).toMatchObject({ cache: "hit" });

    set.mockClear();
    get.mockClear();
    expect(await start.getStartVilla("extra-99", "en", "start-run-b")).toMatchObject({ cache: "miss" });
    expect(get.mock.calls.map(([key]) => key).filter((key) => key.includes(":gen:")).sort()).toEqual(genesis);
    expect(set.mock.calls).toEqual([[expect.stringContaining(":bench-data:start-run-b"), { v: detail, f: expect.any(Number), o: expect.any(Number) }, expect.any(Object)]]);
    expect(set.mock.calls[0][2]?.tags).toEqual(
      expect.arrayContaining([expect.stringContaining(":bench-scope:dpl_candidate")]),
    );
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "0");
    expect(await start.getStartVilla("extra-99", "en", "start-run-c")).toMatchObject({ cache: "hit" });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("reports cache transport failure as bypass rather than a controlled miss", async () => {
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
    const runtime = createBoundedMemoryCache();
    vi.spyOn(runtime, "get").mockRejectedValue(new Error("runtime cache offline"));
    vercel.getCache.mockReturnValue(runtime);
    query.mockResolvedValue(detail);
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "bypass" });
  });

  it("shares one raw read across concurrent locales and localizes each response separately", async () => {
    let resolve!: (value: typeof detail) => void;
    query.mockReturnValue(new Promise((r) => { resolve = r; }));
    const pending = Promise.all([
      start.getStartVilla("extra-99", "en"),
      start.getStartVilla("extra-99", "th"),
      start.getStartVilla("extra-99", "en"),
    ]);
    await settle();
    resolve(detail);
    const [en, th, enAgain] = await pending;
    expect(query).toHaveBeenCalledTimes(1);
    expect(en.page?.villa.tagline).toBe("Tagline");
    expect(th.page?.villa.tagline).toBe("แท็กไลน์");
    expect(enAgain.page?.villa).toEqual(en.page?.villa);
    expect(enAgain.page?.villa).not.toBe(en.page?.villa);
  });

  it("serves the last good villa through an outage, backs off for 30 s, then recovers", async () => {
    query.mockResolvedValueOnce(detail);
    await start.getStartVilla("extra-99", "en");
    expireTtl();

    query.mockRejectedValue(new Error("offline"));
    const stale = await start.getStartVilla("extra-99", "th");
    expect(stale).toMatchObject({ cache: "stale", recovery: "read-error", page: { villa: { tagline: "แท็กไลน์" } } });
    expect(start.villaCacheHeader(stale)).toBe("stale; read-error");
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "stale", recovery: "backoff" });
    expect(query).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(30_000);
    query.mockResolvedValueOnce({ ...detail, villa: { ...villa, name: "Villa 102" } });
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "miss", page: { villa: { name: "Villa 102" } } });
  });

  it("raises a retriable error for a cold outage and null for an authoritative miss", async () => {
    query.mockRejectedValueOnce(new Error("offline"));
    const error = await start.getStartVilla("cold", "en").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(start.VillaUnavailableError);
    expect(error).toMatchObject({ status: 503, retryAfterSeconds: 30 });

    vi.advanceTimersByTime(30_000);
    query.mockResolvedValue(null);
    expect(await start.getStartVilla("archived", "en")).toEqual({ page: null, cache: "miss" });
    await settle();
    await settle();
    expect(await start.getStartVilla("archived", "en")).toEqual({ page: null, cache: "hit" });
    // The first authoritative miss fences its generation and republishes from one more read.
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("keeps an archived villa missing through a stale-catalog outage and serves it after reactivation", async () => {
    query.mockResolvedValueOnce(catalog).mockResolvedValueOnce(detail);
    await start.getStartVillaCatalog("en");
    await start.getStartVilla("extra-99", "en");
    expireTtl();

    query.mockResolvedValueOnce(null);
    expect((await start.getStartVilla("extra-99", "en")).page).toBeNull();
    expireTtl();
    query.mockRejectedValue(new Error("offline"));
    expect((await start.getStartVilla("extra-99", "en")).page).toBeNull();
    expect((await start.getStartVilla("extra-99", "en")).page).toBeNull();

    vi.advanceTimersByTime(30_000);
    query.mockReset().mockResolvedValueOnce(detail);
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "miss", page: { villa: { id: "extra-99" } } });
  });

  it("falls back to a cached catalog row for a cold detail during an outage", async () => {
    query.mockResolvedValueOnce(catalog).mockRejectedValue(new Error("offline"));
    expect((await start.getStartVillaCatalog("en")).villas).toHaveLength(1);
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "stale", page: { reviews: [] } });
    await expect(start.getStartVilla("unknown", "en")).rejects.toThrow("temporarily unavailable");
  });

  it("answers from a still-valid runtime cache entry while the backend is in backoff", async () => {
    query.mockResolvedValueOnce(detail).mockRejectedValueOnce(new Error("offline"));
    await start.getStartVilla("extra-99", "en");
    await settle();
    await expect(start.getStartVilla("cold", "en")).rejects.toThrow("temporarily unavailable");
    expect(await start.getStartVilla("extra-99", "en")).toEqual(expect.objectContaining({ cache: "hit" }));
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("expires one villa and the shared reads on trusted invalidation", async () => {
    query.mockImplementation(async (ref, args: { slug?: string }) =>
      getFunctionName(ref) === "catalog/publicProperties:list" ? catalog : { ...detail, villa: { ...villa, slug: args.slug } });
    await start.getStartVillaCatalog("en");
    await start.getStartVilla("extra-99", "en");
    await start.getStartVilla("other", "en");
    await settle();

    await start.expireStartVillaCache("extra-99");
    expect((await start.getStartVilla("extra-99", "en")).cache).toBe("miss");
    expect((await start.getStartVilla("other", "en")).cache).toBe("hit");
    await start.getStartVillaCatalog("en");
    expect(query).toHaveBeenCalledTimes(5);
    expect(fn(4)).toBe("catalog/publicProperties:list");
  });

  it("lets a read pending across invalidation finish without caching its older result", async () => {
    const before = Promise.withResolvers<typeof detail>();
    const after = { ...detail, villa: { ...villa, name: "New name" } };
    query.mockReturnValueOnce(before.promise).mockResolvedValue(after);
    const pending = start.getStartVilla("extra-99", "en");
    await settle();
    expect(await start.expireStartVillaCache("extra-99")).toEqual({ status: "confirmed" });
    expect((await start.getStartVilla("extra-99", "en")).page?.villa.name).toBe("New name");
    before.resolve(detail);
    expect((await pending).page?.villa.name).toBe("Villa 101");
    await settle();
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "hit", page: { villa: { name: "New name" } } });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("labels benchmark misses unconfirmed or bypass when storage does not read writes back", async () => {
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
    const sdk = sdkCache();
    sdk.state.dropData = true;
    vercel.getCache.mockReturnValue(sdk.cache);
    query.mockResolvedValue(detail);
    const read = await start.getStartVilla("extra-99", "en", "start-run-a");
    expect(read).toMatchObject({ cache: "unconfirmed", page: { villa: { id: "extra-99" } } });
    expect(start.villaCacheHeader(read)).toBe("unconfirmed");

    sdk.state.down = true;
    expect(await start.getStartVilla("extra-99", "en", "start-run-b")).toMatchObject({ cache: "bypass", page: { villa: { id: "extra-99" } } });
    expect(await start.expireStartVillaCache("extra-99")).toEqual({ status: "unconfirmed" });
  });

  it("never confirms invalidation or measures a hit on a hosted worker with only SDK process memory", async () => {
    vi.stubEnv("RUNTIME_CACHE_ENDPOINT", undefined);
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
    expect(start.villaCacheScope()).toBe("hosted-process");
    query.mockResolvedValue(detail);
    expect(await start.getStartVilla("extra-99", "en")).toMatchObject({ cache: "bypass", page: { villa: { id: "extra-99" } } });
    await settle();
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "bypass" });
    await settle();
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "bypass" });
    expect(await start.expireStartVillaCache()).toEqual({ status: "unconfirmed" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("classifies cache scope: only local development is process-only by design", async () => {
    const endpoint = { RUNTIME_CACHE_ENDPOINT: "x", RUNTIME_CACHE_HEADERS: "{}" };
    expect(start.villaCacheScope({ VERCEL: "1", ...endpoint })).toBe("shared");
    expect(start.villaCacheScope({ VERCEL: "1", ...endpoint, RUNTIME_CACHE_DISABLE_BUILD_CACHE: "true" })).toBe("hosted-process");
    expect(start.villaCacheScope({ VERCEL: "1" })).toBe("hosted-process");
    expect(start.villaCacheScope(endpoint)).toBe("local");
    expect(start.villaCacheScope({ VERCEL: "1", ...endpoint, RUNTIME_CACHE_HEADERS: "invalid" })).toBe("hosted-process");
    const symbol = Symbol.for("@vercel/request-context");
    const global = globalThis as { [key: symbol]: unknown };
    global[symbol] = { get: () => ({ cache: {} }) };
    try {
      expect(start.villaCacheScope({ VERCEL: "1" })).toBe("shared");
    } finally {
      delete global[symbol];
    }
  });

  it("reports process-only invalidation in local development", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", undefined);
    const local = await import("@/start-app/villas.server");
    expect(await local.expireStartVillaCache()).toEqual({ status: "local" });
  });

  it("counts a probe miss on a key it saw present within the TTL as unconfirmed", async () => {
    vi.stubEnv("VILLA_BENCH_NAMESPACE", "1");
    const sdk = sdkCache();
    vercel.getCache.mockReturnValue(sdk.cache);
    query.mockResolvedValue(detail);
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "miss" });
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "hit" });
    // One dropped GET on the warm data key (the SDK resolves null); generation reads still work.
    const get = sdk.cache.get.bind(sdk.cache);
    let drop = true;
    vi.spyOn(sdk.cache, "get").mockImplementation(async (key) => {
      if (key.includes(":gen:") || !drop) return get(key);
      drop = false;
      return null;
    });
    const dropped = await start.getStartVilla("extra-99", "en", "start-run-a");
    expect(drop).toBe(false);
    expect(dropped).toMatchObject({ cache: "unconfirmed", page: { villa: { id: "extra-99" } } });
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "hit" });
    vi.advanceTimersByTime(59_000);
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "hit" });
    vi.advanceTimersByTime(2_000);
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "stale" });
    await settle();
    expireTtl();
    expect(await start.getStartVilla("extra-99", "en", "start-run-a")).toMatchObject({ cache: "miss" });
  });

  it("caches the complete paged sitemap and featured reviews", async () => {
    query.mockImplementation(async (ref, args: { paginationOpts?: { cursor: string | null } }) => {
      if (getFunctionName(ref) === "catalog/publicProperties:featuredReviews") return [];
      return args.paginationOpts?.cursor
        ? { page: ["b"], continueCursor: "", isDone: true }
        : { page: ["a"], continueCursor: "next", isDone: false };
    });
    expect(await start.getStartVillaSlugs()).toEqual(["a", "b"]);
    expect(await start.hasStartFeaturedReviews()).toBe(false);
    await settle();
    expect(await start.getStartVillaSlugs()).toEqual(["a", "b"]);
    expect(await start.getStartFeaturedReviews()).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("uses a bounded local cache off Vercel and requires a configured backend", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", undefined);
    const local = await import("@/start-app/villas.server");
    query.mockResolvedValue(detail);
    await local.getStartVilla("extra-99", "en");
    await settle();
    expect((await local.getStartVilla("extra-99", "en")).cache).toBe("hit");
    expect(vercel.getCache).not.toHaveBeenCalled();
    expect(vercel.waitUntil).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", undefined);
    vi.stubEnv("PUBLIC_CONVEX_URL", undefined);
    await expect(local.getStartVilla("extra-99", "en")).rejects.toThrow("NEXT_PUBLIC_CONVEX_URL is required");
  });
});

describe("villa runtime cache", () => {
  it("scopes keys by environment, deployment and DTO version", () => {
    const url = "https://a.example.test";
    expect(villaCacheNamespace(url, { VERCEL_ENV: "preview" })).toBe(`villas:preview:${url}:v2`);
    expect(villaCacheNamespace(url, {})).not.toBe(villaCacheNamespace(url, { VERCEL_ENV: "production" }));
    expect(villaCacheNamespace(url, {})).not.toBe(villaCacheNamespace("https://b.example.test", {}));
  });

  it("bounds entries and honors TTL and tags", async () => {
    let now = 0;
    const cache = createBoundedMemoryCache(2, () => now);
    await cache.set("a", 1, { ttl: 60, tags: ["t"] });
    await cache.set("b", 2);
    await cache.get("a");
    await cache.set("c", 3);
    expect([await cache.get("a"), await cache.get("b"), await cache.get("c")]).toEqual([1, null, 3]);
    await cache.expireTag("t");
    expect(await cache.get("a")).toBeNull();
    await cache.set("d", 4, { ttl: 60 });
    now = 60_000;
    expect(await cache.get("d")).toBeNull();
  });

  it("scopes cleanup tags to the environment and Convex deployment", () => {
    const a = villaCacheTags("https://a.example.test", "detail:x", { VERCEL_ENV: "preview" });
    const b = villaCacheTags("https://b.example.test", "detail:x", { VERCEL_ENV: "preview" });
    expect(a).toHaveLength(2);
    expect(a.some((tag) => b.includes(tag))).toBe(false);
    expect(a.every((tag) => !tag.includes(","))).toBe(true);
  });

  it("bypasses a failing cache without failing the backend read", async () => {
    const broken = {
      get: vi.fn().mockRejectedValue(new Error("cache down")),
      set: vi.fn().mockRejectedValue(new Error("cache down")),
      delete: vi.fn(),
      expireTag: vi.fn(),
    };
    query.mockResolvedValue(detail);
    const source = createRuntimeCacheSource({ cache: () => broken, client: () => ({ query }), env: {} });
    const trace = {};
    expect(await source.detail(URL, "extra-99", trace)).toEqual(detail);
    expect(await source.detail(URL, "extra-99")).toEqual(detail);
    await settle();
    expect(trace).toMatchObject({ runtimeCache: "miss", storage: "unavailable" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(broken.set.mock.calls.every(([key]) => String(key).includes(":gen:"))).toBe(true);

    const healthy = createBoundedMemoryCache();
    const set = vi.spyOn(healthy, "set");
    await createRuntimeCacheSource({ cache: () => healthy, client: () => ({ query }), env: {} }).detail(URL, "extra-99");
    await settle();
    expect(set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^villas:local:https:\/\/villa\.example\.test:v2:detail:extra-99@[0-9a-f-]{36}\.[0-9a-f-]{36}$/),
      { v: detail, f: Date.now() + 60_000, o: Date.now() },
      { ttl: 3_660, tags: villaCacheTags(URL, "detail:extra-99", {}), name: "detail:extra-99" },
    );
  });
});
