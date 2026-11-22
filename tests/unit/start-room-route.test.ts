import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Review } from "@/lib/data/reviews";
import { getLocalizedResort, getPublicMessages } from "@/lib/i18n/server-content";
import type { PublicVilla } from "@/lib/villas";
import {
  buildRoomCanonicalUrl,
  buildRoomHead,
  buildRoomHeaders,
  isPreviewCacheHeaderEnabled,
  isServerFnRpcRequest,
  isStartRoomLoadError,
  isStartRoomUnavailableError,
  loadStartRoomData,
  resolveRoomLocale,
  validateRoomInput,
  validateRoomSearch,
  VILLA_CACHE_HEADER,
  type StartVillaRead,
} from "@/start-app/guest/room-route";

class MockVillaUnavailableError extends Error {
  readonly status = 503;
  readonly retryAfterSeconds = 30;
  constructor() {
    super("Villas are temporarily unavailable.");
    this.name = "VillaUnavailableError";
  }
}

function mockVillaCacheHeader({ cache, recovery }: StartVillaRead) {
  return recovery ? `${cache}; ${recovery}` : cache;
}

const sampleVilla: PublicVilla = {
  id: "pool-villa",
  slug: "pool-villa",
  name: "Pool Villa",
  tagline: "Private infinity pool overlooking the bay",
  description: "Spacious hillside sanctuary with private pool and ocean deck.",
  pricePerNight: 1_200_000,
  currency: "THB",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 2,
  area: 180,
  images: ["/images/pool-villa-hero.webp"],
  amenities: ["Private pool", "High-speed Wi-Fi"],
  tourRoomIds: ["pv-living"],
  directDiscountPercent: 1500,
  rating: { average: 4.9, count: 12 },
};

const sampleReviews: Review[] = [
  {
    id: "rev-1",
    propertyId: "pool-villa",
    author: { name: "Nadia", city: "Singapore", country: "Singapore", avatarUrl: "" },
    rating: 5,
    title: "Unforgettable view",
    body: "Waking up to the bay was extraordinary.",
    date: "2026-09-01",
    verified: true,
  },
];

describe("start room contract & validation", () => {
  it("resolves optional {-$locale} segment with as-needed English canonicalization", () => {
    expect(resolveRoomLocale(undefined)).toEqual({ kind: "ok", locale: "en" });
    expect(resolveRoomLocale("")).toEqual({ kind: "ok", locale: "en" });
    expect(resolveRoomLocale("en")).toEqual({ kind: "redirect", locale: "en" });
    expect(resolveRoomLocale("th")).toEqual({ kind: "ok", locale: "th" });
    expect(resolveRoomLocale("zh-CN")).toEqual({ kind: "ok", locale: "zh-CN" });
    expect(resolveRoomLocale("ar")).toEqual({ kind: "invalid", rawLocale: "ar" });
    expect(resolveRoomLocale("zh-cn")).toEqual({ kind: "invalid", rawLocale: "zh-cn" });
  });

  it("validates ?tour=1 as retained string from parseUrlSearch and strips invalid values", () => {
    expect(validateRoomSearch({ tour: "1" })).toEqual({ tour: "1" });
    expect(validateRoomSearch({ tour: "0" })).toEqual({});
    expect(validateRoomSearch({ tour: "true" })).toEqual({});
    expect(validateRoomSearch({ tour: 1 })).toEqual({});
    expect(validateRoomSearch({})).toEqual({});
  });

  it("validates createServerFn inputs strictly at the network boundary", () => {
    expect(validateRoomInput({ slug: " pool-villa ", locale: "th" })).toEqual({
      slug: "pool-villa",
      locale: "th",
    });

    expect(() => validateRoomInput(null)).toThrow("Invalid room request payload");
    expect(() => validateRoomInput({ slug: "", locale: "en" })).toThrow("Invalid room slug");
    expect(() => validateRoomInput({ slug: "../secret", locale: "en" })).toThrow("Invalid room slug");
    expect(() => validateRoomInput({ slug: "a".repeat(201), locale: "en" })).toThrow("Invalid room slug");
    expect(() => validateRoomInput({ slug: "pool-villa", locale: "ar" })).toThrow("Unsupported room locale");
  });

  it("enables Preview x-villa-cache header only outside production", () => {
    expect(VILLA_CACHE_HEADER).toBe("x-villa-cache");
    expect(isPreviewCacheHeaderEnabled({})).toBe(false);
    expect(isPreviewCacheHeaderEnabled({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isPreviewCacheHeaderEnabled({ START_EXPOSE_CACHE_HEADER: "1" })).toBe(true);
    expect(isPreviewCacheHeaderEnabled({ BENCH_LOCAL_SSR: "1" })).toBe(true);
    expect(
      isPreviewCacheHeaderEnabled({
        VERCEL_ENV: "production",
        START_EXPOSE_CACHE_HEADER: "1",
        BENCH_LOCAL_SSR: "1",
      }),
    ).toBe(false);
  });

  it("detects /_serverFn RPC requests vs document SSR requests", () => {
    expect(isServerFnRpcRequest(new Request("https://example.test/_serverFn/loadStartRoom"))).toBe(true);
    expect(isServerFnRpcRequest(new Request("https://example.test/th/rooms/pool-villa?tour=1"))).toBe(false);
  });
});

describe("start room metadata & head builder", () => {
  it("preserves title, description, OpenGraph/Twitter image, and canonical URL per locale", () => {
    const resortTh = getLocalizedResort("th");
    const head = buildRoomHead({
      locale: "th",
      slug: "pool-villa",
      villa: sampleVilla,
      reviews: sampleReviews,
      meta: {
        title: `Pool Villa — ${resortTh.name}`,
        description: sampleVilla.description,
        resortName: resortTh.name,
        canonicalUrl: buildRoomCanonicalUrl("https://tour.helpgueststay.com/", "pool-villa", "th"),
        ogImage: "https://tour.helpgueststay.com/images/pool-villa-hero.webp",
      },
      loadingLabel: "กำลังโหลด...",
    });

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: `Pool Villa — ${resortTh.name}` },
        { name: "description", content: sampleVilla.description },
        { property: "og:site_name", content: resortTh.name },
        { property: "og:url", content: "https://tour.helpgueststay.com/th/rooms/pool-villa" },
        { property: "og:image", content: "https://tour.helpgueststay.com/images/pool-villa-hero.webp" },
        { name: "twitter:image", content: "https://tour.helpgueststay.com/images/pool-villa-hero.webp" },
      ]),
    );
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://tour.helpgueststay.com/th/rooms/pool-villa" },
    ]);
  });

  it("omits canonical URL when loaderData is absent (error / 404)", () => {
    const head = buildRoomHead(undefined);
    expect(head.meta).toEqual([{ title: "Auralis Cove Retreat" }]);
    expect(head.links).toBeUndefined();
  });
});

describe("start room server orchestration (loadStartRoomData)", () => {
  it("reads getStartVilla once, falls back to resort description without og:image, and hides x-villa-cache in production", async () => {
    const getStartVilla = vi.fn().mockResolvedValue({
      page: { villa: { ...sampleVilla, description: "", images: [] }, reviews: [] },
      cache: "hit",
    } satisfies StartVillaRead);
    const setResponseStatus = vi.fn();
    const setResponseHeader = vi.fn();

    const result = await loadStartRoomData(
      { slug: "pool-villa", locale: "en" },
      {
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/rooms/pool-villa"),
        setResponseStatus,
        setResponseHeader,
        env: { VERCEL_ENV: "production" },
      },
    );

    expect(getStartVilla).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.data.meta.description).toBe(getLocalizedResort("en").description);
    expect(result.data.meta.ogImage).toBeUndefined();
    expect(result.data.meta.canonicalUrl).toBe("https://tour.helpgueststay.com/rooms/pool-villa");
    expect(result.data.cacheHeader).toBeUndefined();
    expect(buildRoomHeaders(result.data)).toEqual({});
    expect(setResponseHeader).not.toHaveBeenCalled();
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it("exposes Preview-only x-villa-cache using villaCacheHeader(read)", async () => {
    const getStartVilla = vi.fn().mockResolvedValue({
      page: { villa: sampleVilla, reviews: sampleReviews },
      cache: "stale",
      recovery: "backoff",
    } satisfies StartVillaRead);
    const setResponseHeader = vi.fn();

    const result = await loadStartRoomData(
      { slug: "pool-villa", locale: "ja" },
      {
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/ja/rooms/pool-villa"),
        setResponseStatus: vi.fn(),
        setResponseHeader,
        env: { VERCEL_ENV: "preview" },
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.data.cacheHeader).toBe("stale; backoff");
    expect(setResponseHeader).toHaveBeenCalledWith("x-villa-cache", "stale; backoff");
    expect(buildRoomHeaders(result.data)).toEqual({ "x-villa-cache": "stale; backoff" });
  });

  it.each([
    { state: "miss", recovery: undefined, expected: "miss" },
    { state: "stale", recovery: undefined, expected: "stale" },
    { state: "stale", recovery: "read-error", expected: "recovery" },
    { state: "stale", recovery: "backoff", expected: "recovery" },
  ] as const)("publishes the verified Preview cache class for $state/$recovery", async ({ state, recovery, expected }) => {
    const getStartVilla = vi.fn().mockResolvedValue({
      page: { villa: sampleVilla, reviews: sampleReviews }, cache: state, recovery,
    } satisfies StartVillaRead);
    const setResponseHeader = vi.fn();
    const result = await loadStartRoomData(
      { slug: "pool-villa", locale: "en" },
      {
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        hasSharedVillaCache: () => true,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError => e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/rooms/pool-villa", {
          headers: { "X-Villa-Bench-Namespace": "start-run-1" },
        }),
        setResponseStatus: vi.fn(),
        setResponseHeader,
        env: { VERCEL_ENV: "preview", VILLA_BENCH_NAMESPACE: "1" },
      },
    );
    expect(getStartVilla).toHaveBeenCalledExactlyOnceWith("pool-villa", "en", "start-run-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    const headers = buildRoomHeaders(result.data);
    expect(headers).toEqual({
      "x-villa-cache-namespace": "start-run-1", "x-villa-cache": expected, "Cache-Control": "private, no-store",
      "x-villa-cache-storage": "shared",
    });
    for (const [name, value] of Object.entries(headers)) expect(setResponseHeader).toHaveBeenCalledWith(name, value);
  });

  it("returns localized 404 on authoritative page: null and only stamps HTTP 404 on document SSR", async () => {
    const getStartVilla = vi.fn().mockResolvedValue({
      page: null,
      cache: "miss",
    } satisfies StartVillaRead);
    const ssrStatus = vi.fn();
    const ssrHeader = vi.fn();

    const ssrResult = await loadStartRoomData(
      { slug: "archived-villa", locale: "th" },
      {
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/th/rooms/archived-villa"),
        setResponseStatus: ssrStatus,
        setResponseHeader: ssrHeader,
        env: { VERCEL_ENV: "preview" },
      },
    );

    expect(ssrStatus).toHaveBeenCalledWith(404, "Not Found");
    expect(ssrHeader).toHaveBeenCalledWith("x-villa-cache", "miss");
    expect(ssrResult.status).toBe("not_found");
    if (ssrResult.status !== "not_found") throw new Error("expected not_found");
    expect(ssrResult.notFound.homeHref).toBe("/th");
    expect(ssrResult.notFound.title).toBe(getPublicMessages("th").Villa.propertyNotFound);

    const rpcStatus = vi.fn();
    const rpcResult = await loadStartRoomData(
      { slug: "archived-villa", locale: "th" },
      {
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/_serverFn/loadStartRoom"),
        setResponseStatus: rpcStatus,
        setResponseHeader: vi.fn(),
        env: {},
      },
    );

    expect(rpcResult.status).toBe("not_found");
    expect(rpcStatus).not.toHaveBeenCalled();
  });

  it("returns retriable 503 for VillaUnavailableError and sanitized 500 without leaking raw server error text", async () => {
    const setResponseStatus = vi.fn();
    const setResponseHeader = vi.fn();

    const unavailableResult = await loadStartRoomData(
      { slug: "cold-villa", locale: "en" },
      {
        getStartVilla: vi.fn().mockRejectedValue(new MockVillaUnavailableError()),
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/rooms/cold-villa"),
        setResponseStatus,
        setResponseHeader,
        env: { VERCEL_ENV: "preview" },
      },
    );

    expect(setResponseStatus).toHaveBeenCalledWith(503, "Service Unavailable");
    expect(setResponseHeader).toHaveBeenCalledWith("Retry-After", "30");
    expect(setResponseHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(setResponseHeader).toHaveBeenCalledWith("x-villa-cache", "unavailable");
    expect(unavailableResult).toEqual({
      status: "unavailable",
      retryAfterSeconds: 30,
      homeHref: "/",
      backHomeLabel: "Back to Home",
    });

    const errStatus = vi.fn();
    const errHeader = vi.fn();
    const configErrorResult = await loadStartRoomData(
      { slug: "cold-villa", locale: "en" },
      {
        getStartVilla: vi.fn().mockRejectedValue(new Error("NEXT_PUBLIC_CONVEX_URL is required")),
        villaCacheHeader: mockVillaCacheHeader,
        isVillaUnavailableError: (e): e is MockVillaUnavailableError =>
          e instanceof MockVillaUnavailableError,
        getLocalizedResort,
        getPublicMessages,
        siteUrl: () => "https://tour.helpgueststay.com",
        getRequest: () => new Request("https://tour.helpgueststay.com/rooms/cold-villa"),
        setResponseStatus: errStatus,
        setResponseHeader: errHeader,
        env: {},
      },
    );

    expect(errStatus).toHaveBeenCalledWith(500, "Internal Server Error");
    expect(errHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(configErrorResult).toEqual({
      status: "error",
      homeHref: "/",
      backHomeLabel: "Back to Home",
    });
    expect(JSON.stringify(configErrorResult)).not.toContain("NEXT_PUBLIC_CONVEX_URL");
  });
});

describe("start room route static boundary and wiring", () => {
  const routeFile = resolve(process.cwd(), "src/start-app/routes/{-$locale}.rooms.$id.tsx");
  const routeSource = readFileSync(routeFile, "utf8");

  it("declares TanStack optional locale segment, native imports, and dynamic server-only boundary", () => {
    expect(routeSource).toContain('createFileRoute("/{-$locale}/rooms/$id")');
    expect(routeSource).toContain('createServerFn({ method: "GET" })');
    expect(routeSource).toContain(".validator(validateRoomInput)");
    expect(routeSource).toContain('import("../villas.server")');
    expect(routeSource).toContain('import("@tanstack/react-start/server")');
    expect(routeSource).not.toContain("getStartVillaWithMeta");
    expect(routeSource).not.toContain("as Promise<");

    const staticImportLines = routeSource
      .split("\n")
      .filter((line) => /^\s*import\s+/.test(line) && !/^\s*import\s+type\s+/.test(line));
    const joined = staticImportLines.join("\n");
    expect(joined).not.toContain("villas.server");
    expect(joined).not.toContain("server-content");
    expect(joined).not.toContain("messages-loader");
    expect(joined).not.toContain("messages/");
    expect(joined).not.toContain("next/");
    expect(joined).not.toContain("TourViewer");
    expect(joined).not.toContain("@tanstack/react-start/server");
  });

  describe("route lifecycle integration with mocked TanStack Start runtime", () => {
    const getStartVilla = vi.fn();
    const setResponseStatus = vi.fn();
    const setResponseHeader = vi.fn();
    const getRequest = vi.fn();

    beforeEach(() => {
      vi.resetModules();
      getStartVilla.mockReset();
      setResponseStatus.mockReset();
      setResponseHeader.mockReset();
      getRequest.mockReset();
      getRequest.mockReturnValue(new Request("https://tour.helpgueststay.com/rooms/pool-villa"));

      vi.doMock("@tanstack/react-router", () => ({
        createFileRoute: (id: string) => (options: Record<string, unknown>) => ({
          id,
          options,
          useLoaderData: () => undefined,
        }),
        notFound: (payload: Record<string, unknown>) => ({ __notFound: true, ...payload }),
        redirect: (payload: Record<string, unknown>) => ({ __redirect: true, ...payload }),
        rootRouteId: "__root__",
        useRouter: () => ({ invalidate: vi.fn() }),
      }));

      vi.doMock("@tanstack/react-start", () => ({
        createServerFn: () => ({
          validator: (validate: (input: unknown) => unknown) => ({
            handler:
              (fn: (ctx: { data: unknown }) => Promise<unknown>) =>
              async ({ data }: { data: unknown }) =>
                fn({ data: validate(data) }),
          }),
        }),
      }));

      vi.doMock("@tanstack/react-start/server", () => ({
        getRequest,
        setResponseStatus,
        setResponseHeader,
      }));

      vi.doMock("@/start-app/villas.server", () => ({
        villaCacheScope: () => "shared",
        getStartVilla,
        villaCacheHeader: mockVillaCacheHeader,
        VillaUnavailableError: MockVillaUnavailableError,
      }));
    });

    afterEach(() => {
      vi.doUnmock("@tanstack/react-router");
      vi.doUnmock("@tanstack/react-start");
      vi.doUnmock("@tanstack/react-start/server");
      vi.doUnmock("@/start-app/villas.server");
      vi.unstubAllEnvs();
    });

    it("executes beforeLoad, single-read loader, head, headers, 404, 503, and sanitized 500", async () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("SITE_URL", "https://tour.helpgueststay.com");

      const mod = await import("@/start-app/routes/{-$locale}.rooms.$id");
      const route = mod.Route as unknown as {
        id: string;
        options: {
          validateSearch: (search: Record<string, unknown>) => { tour?: "1" };
          beforeLoad: (args: {
            params: { locale?: string; id: string };
            search: { tour?: "1" };
          }) => { roomLocale: string };
          loader: (args: {
            params: { locale?: string; id: string };
            context: { roomLocale: string };
          }) => Promise<unknown>;
          head: (args: { loaderData: unknown; match?: { status: string } }) => { meta: unknown[]; links?: unknown[] };
          headers: (args: { loaderData: unknown }) => Record<string, string>;
        };
      };

      expect(route.id).toBe("/{-$locale}/rooms/$id");
      expect(route.options.validateSearch({ tour: "1" })).toEqual({ tour: "1" });

      // Explicit /en/rooms/$id redirects canonically to /rooms/$id while keeping ?tour=1.
      let caughtRedirect: unknown;
      try {
        route.options.beforeLoad({
          params: { locale: "en", id: "pool-villa" },
          search: { tour: "1" },
        });
      } catch (thrown) {
        caughtRedirect = thrown;
      }
      expect(caughtRedirect).toEqual({
        __redirect: true,
        to: "/{-$locale}/rooms/$id",
        params: { locale: undefined, id: "pool-villa" },
        search: { tour: "1" },
        statusCode: 308,
      });

      // Unsupported locale throws notFound before touching getStartVilla.
      let caughtInvalidLocale: unknown;
      try {
        route.options.beforeLoad({
          params: { locale: "ar", id: "pool-villa" },
          search: {},
        });
      } catch (thrown) {
        caughtInvalidLocale = thrown;
      }
      // An unknown prefix is the root global 404, not the villa boundary.
      expect(caughtInvalidLocale).toMatchObject({
        __notFound: true,
        routeId: "__root__",
        data: { kind: "start-global-404" },
      });
      expect(getStartVilla).not.toHaveBeenCalled();

      // Happy path shares one getStartVilla read across loader, head, and x-villa-cache header.
      getStartVilla.mockResolvedValueOnce({
        page: { villa: sampleVilla, reviews: sampleReviews },
        cache: "hit",
      } satisfies StartVillaRead);
      const ctx = route.options.beforeLoad({
        params: { locale: "th", id: "pool-villa" },
        search: { tour: "1" },
      });
      const loaderData = await route.options.loader({
        params: { locale: "th", id: "pool-villa" },
        context: ctx,
      });
      expect(getStartVilla).toHaveBeenCalledTimes(1);
      expect(route.options.head({ loaderData }).links).toEqual([
        { rel: "canonical", href: "https://tour.helpgueststay.com/th/rooms/pool-villa" },
      ]);
      expect(route.options.headers({ loaderData })).toEqual({ "x-villa-cache": "hit" });

      // Authoritative miss throws notFound and stamps HTTP 404 on document SSR.
      getStartVilla.mockResolvedValueOnce({
        page: null,
        cache: "miss",
      } satisfies StartVillaRead);
      await expect(
        route.options.loader({
          params: { locale: undefined, id: "missing-villa" },
          context: { roomLocale: "en" },
        }),
      ).rejects.toMatchObject({
        __notFound: true,
        data: { reason: "missing-villa", homeHref: "/" },
      });
      expect(setResponseStatus).toHaveBeenCalledWith(404, "Not Found");
      // The villa boundary keeps the root's localized title and adds noindex.
      expect(route.options.head({ loaderData: undefined, match: { status: "notFound" } })).toEqual({
        meta: [{ name: "robots", content: "noindex" }],
      });

      // Cold backend outage throws sanitized StartRoomUnavailableError (503 + Retry-After).
      getStartVilla.mockRejectedValueOnce(new MockVillaUnavailableError());
      let caughtUnavailable: unknown;
      try {
        await route.options.loader({
          params: { locale: undefined, id: "cold-villa" },
          context: { roomLocale: "en" },
        });
      } catch (thrown) {
        caughtUnavailable = thrown;
      }
      expect(isStartRoomUnavailableError(caughtUnavailable)).toBe(true);
      expect(caughtUnavailable).toMatchObject({ statusCode: 503, retryAfterSeconds: 30 });
      expect(setResponseStatus).toHaveBeenCalledWith(503, "Service Unavailable");
      expect(setResponseHeader).toHaveBeenCalledWith("Retry-After", "30");

      // Unexpected server error throws sanitized StartRoomLoadError without raw message.
      getStartVilla.mockRejectedValueOnce(new Error("SECRET_INTERNAL_TOKEN missing"));
      let caughtLoadError: unknown;
      try {
        await route.options.loader({
          params: { locale: undefined, id: "broken-villa" },
          context: { roomLocale: "en" },
        });
      } catch (thrown) {
        caughtLoadError = thrown;
      }
      expect(isStartRoomLoadError(caughtLoadError)).toBe(true);
      expect((caughtLoadError as Error).message).not.toContain("SECRET_INTERNAL_TOKEN");
      expect(setResponseStatus).toHaveBeenCalledWith(500, "Internal Server Error");
    });
  });
});
