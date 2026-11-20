import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import { locales } from "@/i18n/routing";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; } }));
// The loader's process-level outage fallback is exercised without Next's data cache.
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en", getTranslations: async () => (key: string) => key }));
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

  it("uses the same direct detail in room metadata and content", async () => {
    const { default: RoomPage, generateMetadata } = await import("@/app/[locale]/rooms/[id]/page");
    query.mockResolvedValue(detail);
    const props = { params: Promise.resolve({ id: "extra-99" }) };
    expect(await generateMetadata(props)).toMatchObject({ title: expect.stringContaining("Villa 101"), description: "Description" });
    expect((await RoomPage(props)).props.children.props).toMatchObject({ property: { id: "extra-99", name: "Villa 101" } });
    expect(query.mock.calls.every(([fn]) => getFunctionName(fn) === "catalog/publicProperties:getBySlug")).toBe(true);
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

  it("remembers a direct miss before a stale catalog is first read", async () => {
    query.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ hasProperties: true, villas: [detail.villa] })
      .mockRejectedValue(new Error("offline"));
    expect(await villas.getVilla("extra-99", "en")).toBeNull();
    await villas.getVillaCatalog("en");
    expect(await villas.getVilla("extra-99", "en")).toBeNull();
  });

  it("gives each sitemap page its own deadline and retains only a complete sitemap", async () => {
    vi.useFakeTimers();
    try {
      query.mockImplementation(async (_ref, { paginationOpts }) => {
        const index = Number(paginationOpts.cursor ?? 0);
        await new Promise(resolve => setTimeout(resolve, 900));
        return { page: [String(index)], continueCursor: String(index + 1), isDone: index === 3 };
      });
      const slugs = villas.getVillaSlugs();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(await slugs).toEqual(["0", "1", "2", "3"]);
      query.mockRejectedValueOnce(new Error("offline"));
      expect(await villas.getVillaSlugs()).toEqual(["0", "1", "2", "3"]);
      query.mockResolvedValueOnce(detail);
      expect(await villas.getVilla("extra-99", "en")).toMatchObject({ villa: { id: "extra-99" } });
    } finally {
      vi.useRealTimers();
    }
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

  it("builds the sitemap and room paths against the previous backend contract", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const { generateStaticParams } = await import("@/app/[locale]/rooms/[id]/page");
    query.mockImplementation(async (ref) => {
      if (getFunctionName(ref) === "catalog/publicProperties:list") {
        return { hasProperties: true, villas: [detail.villa] };
      }
      throw new Error("Server Error");
    });

    expect(await generateStaticParams()).toEqual([{ id: "extra-99" }]);
    expect((await sitemap()).filter(({ url }) => url.endsWith("/rooms/extra-99"))).toHaveLength(locales.length);
  });

  it("rejects a cold sitemap fallback when the catalog is at its limit", async () => {
    query.mockRejectedValueOnce(new Error("Server Error")).mockResolvedValueOnce({
      hasProperties: true,
      villas: Array.from({ length: 100 }, (_, index) => ({ slug: `villa-${index}` })),
    });

    await expect(villas.getVillaSlugs()).rejects.toThrow("Server Error");
    expect(query).toHaveBeenNthCalledWith(2, api.catalog.publicProperties.list, {});
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
