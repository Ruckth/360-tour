import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNotFound, isRedirect, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/routing";
import { resortHighlights } from "@/components/home/HomeView";
import { bookingAccessParams, bookingFunnelProps, payPageProps } from "@/lib/booking/page-params";
import { experiencesSeo } from "@/lib/data/experiences";
import { getPublicMessages } from "@/lib/i18n/server-content";
import { servicesQuery } from "@/lib/services-query";
import type { PublicVilla } from "@/lib/villas";
import {
  chatQuery,
  guestHead,
  guestLocaleContext,
  guestSearch,
  loadStartChatData,
  loadStartHomeData,
  validateChatInput,
  validateGuestLocaleInput,
  validateServicesInput,
} from "@/start-app/guest/guest-route";

const routesDir = resolve(__dirname, "../../src/start-app/routes");

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

const villa = (overrides: Partial<PublicVilla> = {}): PublicVilla => ({
  id: "pool-villa",
  slug: "pool-villa",
  name: "Pool Villa",
  tagline: "",
  description: "",
  pricePerNight: 1_200_000,
  currency: "THB",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 2,
  area: 180,
  images: [],
  amenities: [],
  tourRoomIds: [],
  directDiscountPercent: 0,
  rating: null,
  ...overrides,
});

describe("guest route tree", () => {
  const expected: Record<string, string> = {
    "{-$locale}.index.tsx": "/{-$locale}/",
    "{-$locale}.booking.index.tsx": "/{-$locale}/booking/",
    "{-$locale}.booking.pay.tsx": "/{-$locale}/booking/pay",
    "{-$locale}.booking.success.tsx": "/{-$locale}/booking/success",
    "{-$locale}.chat.tsx": "/{-$locale}/chat",
    "{-$locale}.experiences.tsx": "/{-$locale}/experiences",
    "{-$locale}.privacy.tsx": "/{-$locale}/privacy",
    "{-$locale}.services.tsx": "/{-$locale}/services",
    "{-$locale}.terms.tsx": "/{-$locale}/terms",
    "{-$locale}.rooms.$id.tsx": "/{-$locale}/rooms/$id",
  };

  it("maps every localized Next page to an optional-locale file route and has no catch-all", () => {
    const files = readdirSync(routesDir).filter((file) => file.startsWith("{-$locale}"));
    expect(files.sort()).toEqual(Object.keys(expected).sort());
    for (const [file, path] of Object.entries(expected)) {
      const source = readFileSync(resolve(routesDir, file), "utf8");
      expect(source).toContain(`createFileRoute("${path}")`);
      if (file !== "{-$locale}.rooms.$id.tsx") expect(source).toContain("beforeLoad: guestLocaleContext");
    }
    // A global or localized guest splat could swallow the root 404.
    // The separate /admin fallback preserves legacy staff redirects.
    expect(readdirSync(routesDir)).not.toContain("$.tsx");
    expect(files.some((file) => file.endsWith(".$.tsx"))).toBe(false);
  });

  it("keeps Next-only modules and the Next app out of guest route sources", () => {
    const sources = [
      ...readdirSync(routesDir).filter((file) => file.startsWith("{-$locale}")).map((file) => resolve(routesDir, file)),
      resolve(__dirname, "../../src/start-app/guest/guest-route.ts"),
    ];
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from ["'](next(\/|["'])|next-intl|@clerk\/nextjs|@sentry\/nextjs|@\/app\/)/);
      expect(source, file).not.toMatch(/from ["']@\/lib\/server\/villas["']/);
    }
  });

  it("imports server reads only dynamically inside server functions", () => {
    for (const file of ["{-$locale}.index.tsx", "{-$locale}.chat.tsx", "{-$locale}.services.tsx"]) {
      const source = readFileSync(resolve(routesDir, file), "utf8");
      expect(source).not.toMatch(/^import .*(villas\.server|lib\/server\/|react-start\/server)/m);
      expect(source).toMatch(/createServerFn\(\{ method: "GET" \}\)\s*\.validator\(/);
    }
  });
});

describe("guest locale resolution", () => {
  it("serves bare paths in English and every other locale under its prefix", () => {
    expect(guestLocaleContext({ params: {}, location: { href: "/booking" } })).toEqual({ guestLocale: "en" });
    for (const locale of locales.filter((value) => value !== "en")) {
      expect(guestLocaleContext({ params: { locale }, location: { href: `/${locale}/chat` } })).toEqual({ guestLocale: locale });
    }
  });

  it("redirects /en/... to the bare path with 308, keeping query and hash", () => {
    const error = thrown(() => guestLocaleContext({ params: { locale: "en" }, location: { href: "/en/booking?checkin=2026-12-01&mk=f1#x" } }));
    expect(isRedirect(error)).toBe(true);
    const { options } = error as { options: { href: string; statusCode: number } };
    expect(options).toMatchObject({ href: "/booking?checkin=2026-12-01&mk=f1#x", statusCode: 308 });
    const home = thrown(() => guestLocaleContext({ params: { locale: "en" }, location: { href: "/en" } }));
    expect((home as { options: { href: string } }).options.href).toBe("/");
  });

  it("throws a root-handled notFound for an unknown prefix", () => {
    for (const locale of ["xx", "zh-cn", "admin"]) {
      const error = thrown(() => guestLocaleContext({ params: { locale }, location: { href: `/${locale}` } }));
      expect(isNotFound(error)).toBe(true);
    }
  });
});

describe("guest search and metadata", () => {
  it("passes every string parameter through, including attribution", () => {
    expect(guestSearch({ coupon: "DCNT-F1-20", mk: "f1", guests: ["2", "3"], bad: 4, mixed: ["a", 1] }))
      .toEqual({ coupon: "DCNT-F1-20", mk: "f1", guests: ["2", "3"] });
  });

  it("overrides the root title and adds absolute social cards from the shell", () => {
    const messages = getPublicMessages("th");
    const matches = [
      { routeId: rootRouteId, loaderData: { locale: "th", messages, resort: "Auralis", site: "https://resort.example" } },
      { routeId: "/{-$locale}/experiences" },
    ];
    const head = guestHead(matches, (copy) => {
      const seo = experiencesSeo(copy);
      return { title: seo.title, description: seo.description, social: { title: seo.ogTitle, description: seo.description, image: seo.image } };
    });
    expect(head.meta[0]).toEqual({ title: messages.SEO.experiencesTitle });
    expect(head.meta).toContainEqual({ name: "description", content: messages.SEO.experiencesDescription });
    expect(head.meta).toContainEqual({ property: "og:site_name", content: "Auralis" });
    expect(head.meta).toContainEqual({ property: "og:image", content: "https://resort.example/experiences/hero-samui-experiences.png" });
    expect(head.meta).toContainEqual({ name: "twitter:image", content: "https://resort.example/experiences/hero-samui-experiences.png" });

    const booking = guestHead(matches, (copy) => ({ title: copy.SEO.bookingTitle }));
    expect(booking).toEqual({ meta: [{ title: messages.SEO.bookingTitle }] });
    expect(guestHead([], () => ({ title: "x" }))).toEqual({ meta: [] });
  });
});

describe("guest server function inputs", () => {
  it("accepts only supported locales", () => {
    expect(validateGuestLocaleInput({ locale: "ja" })).toEqual({ locale: "ja" });
    expect(() => validateGuestLocaleInput({ locale: "xx" })).toThrow();
    expect(() => validateGuestLocaleInput(null)).toThrow();
  });

  it("bounds chat parameters and ignores oversize values", () => {
    expect(chatQuery({ property: ["pool-villa", "other"], service: "thai-massage" })).toEqual({ property: "pool-villa", service: "thai-massage" });
    expect(chatQuery({ property: "", service: "x".repeat(201) })).toEqual({ property: undefined, service: undefined });
    expect(validateChatInput({ locale: "th", property: 3, service: "spa" })).toEqual({ locale: "th", property: undefined, service: "spa" });
  });

  it("re-applies the services page limits to RPC input", () => {
    expect(validateServicesInput({ query: "q".repeat(150), category: "Spa", cursor: 5, extra: "x" }))
      .toEqual({ category: "Spa", query: "q".repeat(100), cursor: undefined, categoryAfter: undefined });
    expect(servicesQuery({ q: ["a", "b"], category: "Spa" })).toEqual({ category: "Spa", query: undefined, cursor: undefined, categoryAfter: undefined });
  });
});

describe("guest server data", () => {
  const responseDeps = () => ({ setResponseHeader: vi.fn(), setResponseStatus: vi.fn() });
  const isUnavailable = (error: unknown): error is { retryAfterSeconds: number } =>
    error instanceof Error && error.name === "VillaUnavailableError";

  it("returns the live catalog villas and featured reviews for home", async () => {
    const deps = responseDeps();
    const getCatalog = vi.fn(async () => ({ villas: [villa()] }));
    const result = await loadStartHomeData("ko", { ...deps, getCatalog, getFeaturedReviews: async () => [], isVillaUnavailableError: isUnavailable });
    expect(getCatalog).toHaveBeenCalledWith("ko");
    expect(result).toEqual({ status: "ok", data: { villas: [villa()], reviews: [] } });
    expect(deps.setResponseStatus).not.toHaveBeenCalled();
  });

  it("answers a cold catalog outage with 503 Retry-After and other failures with 500", async () => {
    const unavailable = Object.assign(new Error("down"), { name: "VillaUnavailableError", retryAfterSeconds: 30 });
    const deps = responseDeps();
    expect(await loadStartHomeData("en", { ...deps, getCatalog: () => Promise.reject(unavailable), getFeaturedReviews: async () => [], isVillaUnavailableError: isUnavailable }))
      .toEqual({ status: "unavailable", retryAfterSeconds: 30 });
    expect(deps.setResponseStatus).toHaveBeenCalledWith(503, "Service Unavailable");
    expect(deps.setResponseHeader).toHaveBeenCalledWith("Retry-After", "30");
    expect(deps.setResponseHeader).toHaveBeenCalledWith("Cache-Control", "no-store");

    const failing = responseDeps();
    expect(await loadStartHomeData("en", { ...failing, getCatalog: () => Promise.reject(new Error("boom")), getFeaturedReviews: async () => [], isVillaUnavailableError: isUnavailable }))
      .toEqual({ status: "error" });
    expect(failing.setResponseStatus).toHaveBeenCalledWith(500, "Internal Server Error");
  });

  it("resolves chat service and villa context, omitting unknown or failed reads", async () => {
    const getVilla = vi.fn(async () => ({ page: { villa: villa({ name: "วิลล่า" }) } }));
    expect(await loadStartChatData({ locale: "th", property: "pool-villa", service: "spa" }, {
      getPublicService: async () => ({ slug: "spa", name: "Spa", price: 1 } as { slug: string; name: string }),
      getVilla,
    })).toEqual({ service: { slug: "spa", name: "Spa" }, property: { id: "pool-villa", name: "วิลล่า" } });
    expect(getVilla).toHaveBeenCalledWith("pool-villa", "th");

    expect(await loadStartChatData({ locale: "en", property: "gone", service: "missing" }, {
      getPublicService: async () => null,
      getVilla: () => Promise.reject(new Error("down")),
    })).toEqual({ service: null, property: null });

    const untouched = vi.fn();
    expect(await loadStartChatData({ locale: "en" }, { getPublicService: untouched, getVilla: untouched }))
      .toEqual({ service: null, property: null });
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("shared page rules", () => {
  it("maps booking links to funnel selections", () => {
    expect(bookingFunnelProps({ checkin: "2026-12-01", checkout: ["2026-12-04", "x"], guests: "2", unit: "pool-villa", property: "other", coupon: "DCNT", mk: "f1" }))
      .toEqual({
        initialCheckIn: "2026-12-01", initialCheckOut: "2026-12-04", initialNights: undefined, initialGuests: "2",
        initialAdults: undefined, initialChildren: undefined, initialProperty: "pool-villa", initialCoupon: "DCNT",
      });
    expect(bookingFunnelProps({ property: "garden" }).initialProperty).toBe("garden");
  });

  it("accepts both booking id/token spellings and the proposal switch", () => {
    expect(bookingAccessParams({ booking_id: "b1", bookingToken: "t1" })).toEqual({ bookingId: "b1", accessToken: "t1" });
    expect(bookingAccessParams({})).toEqual({ bookingId: "", accessToken: "" });
    expect(payPageProps({ proposal: "", bookingId: "b1" })).toEqual({ kind: "proposal", token: "" });
    expect(payPageProps({ bookingId: "b1", token: "t1", quoted: "1250000" }))
      .toEqual({ kind: "booking", bookingId: "b1", accessToken: "t1", quotedTotal: 1_250_000 });
    expect(payPageProps({ quoted: "12.5" })).toMatchObject({ quotedTotal: null });
  });

  it("computes home highlights only from live data", () => {
    const labels = getPublicMessages("en").Resort.highlights;
    expect(resortHighlights([villa()], labels)).toEqual([{ stat: "1", label: labels.villaTypes }]);
    expect(resortHighlights([
      villa({ rating: { average: 5, count: 2 }, directDiscountPercent: 1500 }),
      villa({ id: "b", rating: { average: 4, count: 2 } }),
    ], labels)).toEqual([
      { stat: "2", label: labels.villaTypes },
      { stat: "4.5", label: labels.guestRating },
      { stat: "4", label: labels.reviews },
      { stat: "15%", label: labels.directSavings },
    ]);
  });
});
