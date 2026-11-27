import { defaultLocale, isLocale, localizeHref, type Locale } from "@/i18n/routing";
import type { Review } from "@/lib/data/reviews";
import type { PublicMessages } from "@/lib/i18n/public-content";
import type { PublicVilla } from "@/lib/villas";
import type { TourRenderer } from "@/lib/tour/renderer";

import {
  VILLA_BENCH_REQUEST_HEADER,
  VILLA_CACHE_HEADER,
  villaBenchmarkNamespace,
  villaBenchmarkResponse,
  type VillaCacheObservation,
} from "@/lib/server/villa-cache-benchmark";

export { VILLA_CACHE_HEADER };
const MAX_ROOM_SLUG_LENGTH = 200;
const SAFE_SLUG_PATTERN = /^[^\s/\\?#\u0000-\u001f]+$/;
const FALLBACK_RESORT_TITLE = "Auralis Cove Retreat";

export type StartRoomSearch = { tour?: "1"; tourRenderer?: "pannellum" };
export type StartRoomInput = { slug: string; locale: Locale };

export type StartVillaRead = {
  page: { villa: PublicVilla; reviews: Review[] } | null;
  cache: VillaCacheObservation;
  recovery?: "backoff" | "read-error";
};

export type StartRoomMetadata = {
  title: string;
  description: string;
  resortName: string;
  canonicalUrl: string;
  ogImage?: string;
};

export type StartRoomNotFoundData = {
  locale: Locale;
  reason: "invalid-locale" | "missing-villa";
  title: string;
  backHomeLabel: string;
  homeHref: string;
};

export type StartRoomLoaderData = {
  locale: Locale;
  slug: string;
  villa: PublicVilla;
  reviews: Review[];
  meta: StartRoomMetadata;
  loadingLabel: string;
  tourModulePreloads?: readonly string[];
  tourModulePreloadRenderer?: "pannellum";
  pannellumAvailable?: true;
  /** Present only when Preview cache header diagnostics are enabled. */
  cacheHeader?: string;
  benchmarkHeaders?: Record<string, string>;
};

export type StartRoomServerResult =
  | { status: "ok"; data: StartRoomLoaderData }
  | { status: "not_found"; notFound: StartRoomNotFoundData }
  | { status: "unavailable"; retryAfterSeconds: number; homeHref: string; backHomeLabel: string }
  | { status: "error"; homeHref: string; backHomeLabel: string };

export type StartRoomLocaleResolution =
  | { kind: "ok"; locale: Locale }
  | { kind: "redirect"; locale: Locale }
  | { kind: "invalid"; rawLocale: string };

export type StartHeadMetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

export type StartRouteHead = {
  meta: StartHeadMetaTag[];
  links?: ({ rel: "canonical"; href: string } | { rel: "modulepreload"; href: string; crossOrigin: "anonymous" })[];
};

export class StartRoomUnavailableError extends Error {
  readonly statusCode = 503 as const;
  readonly retriable = true as const;
  readonly retryAfterSeconds: number;
  readonly homeHref: string;
  readonly backHomeLabel: string;

  constructor(params: { retryAfterSeconds: number; homeHref: string; backHomeLabel: string }) {
    super("Villa details are temporarily unavailable.");
    this.name = "StartRoomUnavailableError";
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.homeHref = params.homeHref;
    this.backHomeLabel = params.backHomeLabel;
  }
}

export class StartRoomLoadError extends Error {
  readonly statusCode = 500 as const;
  readonly retriable = false as const;
  readonly homeHref: string;
  readonly backHomeLabel: string;

  constructor(params: { homeHref: string; backHomeLabel: string }) {
    super("Unable to load this villa right now.");
    this.name = "StartRoomLoadError";
    this.homeHref = params.homeHref;
    this.backHomeLabel = params.backHomeLabel;
  }
}

export function isStartRoomUnavailableError(error: unknown): error is StartRoomUnavailableError {
  if (error instanceof StartRoomUnavailableError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<StartRoomUnavailableError>;
  return (
    candidate.name === "StartRoomUnavailableError" &&
    candidate.statusCode === 503 &&
    candidate.retriable === true
  );
}

export function isStartRoomLoadError(error: unknown): error is StartRoomLoadError {
  if (error instanceof StartRoomLoadError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<StartRoomLoadError>;
  return candidate.name === "StartRoomLoadError" && candidate.statusCode === 500;
}

export function resolveRoomLocale(rawLocale: string | undefined): StartRoomLocaleResolution {
  if (!rawLocale) return { kind: "ok", locale: defaultLocale };
  if (rawLocale === defaultLocale) return { kind: "redirect", locale: defaultLocale };
  if (isLocale(rawLocale)) return { kind: "ok", locale: rawLocale };
  return { kind: "invalid", rawLocale };
}

/** Root router uses `parseUrlSearch`, retaining `?tour=1` as the string `"1"`. */
export function validateRoomSearch(search: Record<string, unknown>): StartRoomSearch {
  return {
    ...(search.tour === "1" && { tour: "1" }),
    ...(search.tourRenderer === "pannellum" && { tourRenderer: "pannellum" }),
  };
}

export function roomTourRenderer(available: true | undefined, search: StartRoomSearch): TourRenderer {
  return available && search.tourRenderer === "pannellum" ? "pannellum" : "three";
}

export function validateRoomInput(input: unknown): StartRoomInput {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid room request payload.");
  }
  const { slug, locale } = input as Record<string, unknown>;
  if (typeof slug !== "string") {
    throw new Error("Room slug must be a string.");
  }
  const normalizedSlug = slug.trim();
  if (
    normalizedSlug.length === 0 ||
    normalizedSlug.length > MAX_ROOM_SLUG_LENGTH ||
    !SAFE_SLUG_PATTERN.test(normalizedSlug)
  ) {
    throw new Error("Invalid room slug.");
  }
  if (typeof locale !== "string" || !isLocale(locale)) {
    throw new Error("Unsupported room locale.");
  }
  return { slug: normalizedSlug, locale };
}

export function buildInvalidLocaleNotFoundData(): StartRoomNotFoundData {
  return {
    locale: defaultLocale,
    reason: "invalid-locale",
    title: "Property not found",
    backHomeLabel: "Back to Home",
    homeHref: localizeHref("/", defaultLocale),
  };
}

export function isStartRoomNotFoundData(value: unknown): value is StartRoomNotFoundData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StartRoomNotFoundData>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.backHomeLabel === "string" &&
    typeof candidate.homeHref === "string" &&
    (candidate.reason === "invalid-locale" || candidate.reason === "missing-villa")
  );
}

export function isPreviewCacheHeaderEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return (
    env.VERCEL_ENV === "preview" ||
    env.START_EXPOSE_CACHE_HEADER === "1" ||
    env.BENCH_LOCAL_SSR === "1"
  );
}

export function buildRoomCanonicalUrl(baseUrl: string, slug: string, locale: Locale): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}${localizeHref(`/rooms/${encodeURIComponent(slug)}`, locale)}`;
}

function resolveAbsoluteImageUrl(baseUrl: string, image: string | undefined): string | undefined {
  const trimmed = image?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, `${baseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return undefined;
  }
}

export function buildRoomHead(loaderData: StartRoomLoaderData | undefined, search?: StartRoomSearch): StartRouteHead {
  if (!loaderData) {
    return { meta: [{ title: FALLBACK_RESORT_TITLE }] };
  }

  const { meta: roomMeta } = loaderData;
  const meta: StartHeadMetaTag[] = [
    { title: roomMeta.title },
    { name: "description", content: roomMeta.description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: roomMeta.resortName },
    { property: "og:title", content: roomMeta.title },
    { property: "og:description", content: roomMeta.description },
    { property: "og:url", content: roomMeta.canonicalUrl },
  ];

  if (roomMeta.ogImage) {
    meta.push({ property: "og:image", content: roomMeta.ogImage });
  }

  meta.push(
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: roomMeta.title },
    { name: "twitter:description", content: roomMeta.description },
  );

  if (roomMeta.ogImage) {
    meta.push({ name: "twitter:image", content: roomMeta.ogImage });
  }

  const requestedRenderer = roomTourRenderer(loaderData.pannellumAvailable, search ?? {});
  const preloads = search?.tour === "1" && requestedRenderer === (loaderData.tourModulePreloadRenderer ?? "three")
    ? loaderData.tourModulePreloads
    : undefined;

  return {
    meta,
    links: [
      { rel: "canonical", href: roomMeta.canonicalUrl },
      ...(preloads ?? [])
        .map((href) => ({ rel: "modulepreload" as const, href, crossOrigin: "anonymous" as const })),
    ],
  };
}

export function buildRoomHeaders(
  loaderData: StartRoomLoaderData | undefined,
): Record<string, string> {
  return loaderData?.benchmarkHeaders ?? (loaderData?.cacheHeader ? { [VILLA_CACHE_HEADER]: loaderData.cacheHeader } : {});
}

export function isServerFnRpcRequest(request: Request): boolean {
  try {
    return new URL(request.url, "http://localhost").pathname.startsWith("/_serverFn");
  } catch {
    return request.url.startsWith("/_serverFn");
  }
}

export type StartRoomServerDeps = {
  getStartVilla: (slug: string, locale: string, namespace?: string) => Promise<StartVillaRead>;
  villaCacheHeader: (read: StartVillaRead) => string;
  hasSharedVillaCache?: () => boolean;
  isVillaUnavailableError: (error: unknown) => error is { retryAfterSeconds: number };
  getLocalizedResort: (locale?: string) => { name: string; description: string };
  getPublicMessages: (locale?: string) => Pick<PublicMessages, "Villa">;
  siteUrl: () => string;
  getRequest: () => Request;
  getTourModulePreloads?: (renderer: TourRenderer) => Promise<readonly string[]>;
  setResponseStatus: (status: number, statusText?: string) => void;
  setResponseHeader: (name: string, value: string) => void;
  env?: Record<string, string | undefined>;
};

export async function loadStartRoomData(
  input: StartRoomInput,
  deps: StartRoomServerDeps,
): Promise<StartRoomServerResult> {
  const { slug, locale } = input;
  const exposeCache = isPreviewCacheHeaderEnabled(deps.env);
  const request = deps.getRequest();
  const namespace = !isServerFnRpcRequest(request) && request.method === "GET"
    ? villaBenchmarkNamespace(request.headers.get(VILLA_BENCH_REQUEST_HEADER), deps.env)
    : undefined;
  const setBenchmarkHeaders = (cache: VillaCacheObservation) => {
    const headers = namespace ? {
      ...villaBenchmarkResponse(namespace, cache),
      ...(deps.hasSharedVillaCache && {
        "x-villa-cache-storage": deps.hasSharedVillaCache() ? "shared" : "local",
      }),
    } : undefined;
    for (const [name, value] of Object.entries(headers ?? {})) deps.setResponseHeader(name, value);
    return headers;
  };
  const resort = deps.getLocalizedResort(locale);
  const villaCopy = deps.getPublicMessages(locale).Villa;
  const homeHref = localizeHref("/", locale);

  let read: StartVillaRead;
  try {
    read = namespace ? await deps.getStartVilla(slug, locale, namespace) : await deps.getStartVilla(slug, locale);
  } catch (error) {
    deps.setResponseHeader("Cache-Control", "no-store");
    setBenchmarkHeaders("bypass");
    if (deps.isVillaUnavailableError(error)) {
      deps.setResponseStatus(503, "Service Unavailable");
      deps.setResponseHeader("Retry-After", String(error.retryAfterSeconds));
      if (exposeCache && !namespace) {
        deps.setResponseHeader(VILLA_CACHE_HEADER, "unavailable");
      }
      return {
        status: "unavailable",
        retryAfterSeconds: error.retryAfterSeconds,
        homeHref,
        backHomeLabel: villaCopy.backHome,
      };
    }

    deps.setResponseStatus(500, "Internal Server Error");
    return {
      status: "error",
      homeHref,
      backHomeLabel: villaCopy.backHome,
    };
  }

  const benchmarkHeaders = setBenchmarkHeaders(read.recovery ? "recovery" : read.cache);
  const cacheHeader = exposeCache && !namespace ? deps.villaCacheHeader(read) : undefined;
  if (cacheHeader) {
    deps.setResponseHeader(VILLA_CACHE_HEADER, cacheHeader);
  }

  if (!read.page) {
    if (!isServerFnRpcRequest(request)) {
      deps.setResponseStatus(404, "Not Found");
    }
    return {
      status: "not_found",
      notFound: {
        locale,
        reason: "missing-villa",
        title: villaCopy.propertyNotFound,
        backHomeLabel: villaCopy.backHome,
        homeHref,
      },
    };
  }

  const { villa, reviews } = read.page;
  const baseUrl = deps.siteUrl();
  const ogImage = resolveAbsoluteImageUrl(baseUrl, villa.images[0]);
  const url = new URL(request.url);
  const expectedPath = localizeHref(`/rooms/${encodeURIComponent(slug)}`, locale);
  const [tour, ...duplicate] = url.searchParams.getAll("tour");
  const directTour = request.method === "GET" && url.pathname === expectedPath && tour === "1" && duplicate.length === 0;
  const env = deps.env ?? process.env;
  const localTrial = !env.VERCEL_ENV && env.BENCH_LOCAL_SSR === "1" && env.START_PANNELLUM_TRIAL === "1";
  const pannellumAvailable = !read.recovery && slug === "pool-villa" && (env.VERCEL_ENV === "preview" || localTrial)
    ? true
    : undefined;
  const [tourRenderer, ...additionalRenderers] = url.searchParams.getAll("tourRenderer");
  const renderer = roomTourRenderer(pannellumAvailable, validateRoomSearch({
    tourRenderer: additionalRenderers.length === 0 ? tourRenderer : undefined,
  }));
  const tourModulePreloads = directTour && !read.recovery
    ? await deps.getTourModulePreloads?.(renderer)
    : undefined;

  return {
    status: "ok",
    data: {
      locale,
      slug,
      villa,
      reviews,
      meta: {
        title: `${villa.name} — ${resort.name}`,
        description: villa.description || resort.description,
        resortName: resort.name,
        canonicalUrl: buildRoomCanonicalUrl(baseUrl, villa.slug ?? villa.id ?? slug, locale),
        ...(ogImage ? { ogImage } : {}),
      },
      loadingLabel: villaCopy.loadingVilla,
      ...(tourModulePreloads?.length ? {
        tourModulePreloads,
        ...(renderer === "pannellum" && { tourModulePreloadRenderer: renderer }),
      } : {}),
      ...(pannellumAvailable ? { pannellumAvailable } : {}),
      ...(cacheHeader ? { cacheHeader } : {}),
      ...(benchmarkHeaders ? { benchmarkHeaders } : {}),
    },
  };
}
