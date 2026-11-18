import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import { locales } from "@/i18n/routing";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; } }));
// The loader's process-level outage fallback is exercised without Next's data cache.
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/components/rooms/RoomDetailClient", () => ({ RoomDetailClient: () => null }));

const detail = {
  villa: {
    slug: "extra-99", name: "Villa 101", tagline: "Tagline", description: "Description",
    pricePerNight: 500000, currency: "THB", maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50,
    images: [], amenities: [], tourRoomIds: [], translations: [], contentEditedAt: null,
    directDiscountPercent: 0, reviewCount: 0, averageRating: null,
  },
  reviews: [],
};

let villas: typeof import("@/lib/server/villas");

beforeEach(async () => {
  vi.resetModules();
  query.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://villa.example.test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  villas = await import("@/lib/server/villas");
}, 15_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("server villa reads", () => {
  it("loads detail by slug without querying the featured catalog and reports authoritative misses", async () => {
    const { getVilla } = villas;
    query.mockResolvedValueOnce(detail).mockResolvedValueOnce(null);
    expect(await getVilla("extra-99", "en")).toMatchObject({ villa: { id: "extra-99", name: "Villa 101" } });
    expect(await getVilla("archived", "en")).toBeNull();
    expect(query.mock.calls.map(([fn]) => getFunctionName(fn))).toEqual([
      "catalog/publicProperties:getBySlug", "catalog/publicProperties:getBySlug",
    ]);
  });

  it("serves a warm villa through an outage after many misses and raises an error for cold slugs", async () => {
    const { getVilla } = villas;
    query.mockResolvedValueOnce(detail).mockResolvedValue(null);
    await getVilla("extra-99", "en");
    for (let i = 0; i < 225; i++) expect(await getVilla(`missing-${i}`, "en")).toBeNull();

    query.mockRejectedValue(new Error("offline"));
    await expect(getVilla("cold", "en")).rejects.toThrow("temporarily unavailable");
    await expect(getVilla("extra-99", "en")).resolves.toMatchObject({ villa: { id: "extra-99" } });
  });

  it("uses a previously loaded catalog when the villa's first detail read fails", async () => {
    const { getVilla, getVillaCatalog } = villas;
    query.mockResolvedValueOnce({ hasProperties: true, villas: [detail.villa] }).mockRejectedValue(new Error("offline"));
    await getVillaCatalog("en");
    await expect(getVilla("extra-99", "en")).resolves.toMatchObject({ villa: { id: "extra-99" }, reviews: [] });
    await expect(getVilla("unknown", "en")).rejects.toThrow("temporarily unavailable");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps an authoritative miss when a stale catalog still lists the villa during an outage", async () => {
    const { getVilla, getVillaCatalog } = villas;
    query.mockResolvedValueOnce({ hasProperties: true, villas: [detail.villa] })
      .mockResolvedValueOnce(null)
      .mockRejectedValue(new Error("offline"));
    await getVillaCatalog("en");
    expect(await getVilla("extra-99", "en")).toBeNull();
    expect(await getVilla("extra-99", "en")).toBeNull();
  });

  it("evicts a warm detail when its slug is no longer active", async () => {
    const { getVilla } = villas;
    query.mockResolvedValueOnce(detail).mockResolvedValueOnce(null).mockRejectedValue(new Error("offline"));
    expect(await getVilla("extra-99", "en")).not.toBeNull();
    expect(await getVilla("extra-99", "en")).toBeNull();
    await expect(getVilla("extra-99", "en")).rejects.toThrow("temporarily unavailable");
  });

  it("requires a configured backend and keeps an empty backend empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", undefined);
    vi.stubEnv("PUBLIC_CONVEX_URL", undefined);
    const { getVilla, getVillaCatalog } = villas;
    await expect(getVilla("extra-99", "en")).rejects.toThrow("NEXT_PUBLIC_CONVEX_URL is required");
    expect(query).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://villa.example.test");
    query.mockResolvedValueOnce(null).mockResolvedValueOnce({ hasProperties: false, villas: [] });
    expect(await getVilla("extra-99", "en")).toBeNull();
    expect(await getVillaCatalog("en")).toEqual({ source: "db", villas: [] });
  });

  it("keeps the warm sitemap inventory while the detail cache rotates", async () => {
    const { getVilla, getVillaSlugs } = villas;
    query.mockResolvedValueOnce({ page: ["extra-99"], continueCursor: "", isDone: true }).mockResolvedValue(detail);
    expect(await getVillaSlugs()).toEqual(["extra-99"]);
    for (let i = 0; i < 201; i++) await getVilla(`extra-${i}`, "en");

    query.mockRejectedValue(new Error("offline"));
    await expect(getVilla("cold", "en")).rejects.toThrow("temporarily unavailable");
    await expect(getVilla("extra-0", "en")).rejects.toThrow("temporarily unavailable");
    expect(await getVillaSlugs()).toEqual(["extra-99"]);
    await expect(getVilla("extra-200", "en")).resolves.toMatchObject({ villa: { id: "extra-99" } });
  });

  it("includes all active slugs in the sitemap and limits static params to the first page", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const { generateStaticParams } = await import("@/app/[locale]/rooms/[id]/page");
    const first = { page: Array.from({ length: 100 }, (_, i) => `villa-${i}`), continueCursor: "second", isDone: false };
    query.mockResolvedValueOnce(first).mockResolvedValueOnce({ page: ["extra-99"], continueCursor: "", isDone: true });
    query.mockResolvedValueOnce(first);
    const entries = await sitemap();
    expect(entries.filter(({ url }) => url.endsWith("/rooms/extra-99"))).toHaveLength(locales.length);
    expect(entries.filter(({ url }) => url.includes("/rooms/"))).toHaveLength(101 * locales.length);
    expect(query).toHaveBeenNthCalledWith(1, api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 100, cursor: null } });
    expect(query).toHaveBeenNthCalledWith(2, api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 100, cursor: "second" } });
    expect(await generateStaticParams()).toEqual(first.page.map(id => ({ id })));
    expect(query).toHaveBeenNthCalledWith(3, api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 100, cursor: null } });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
