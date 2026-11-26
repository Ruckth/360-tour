import { AsyncLocalStorage } from "node:async_hooks";
import { getCache, waitUntil } from "@vercel/functions";
import { ConvexHttpClient } from "convex/browser";
import type { Review } from "@/lib/data/reviews";
import {
  createBoundedMemoryCache,
  createRuntimeCacheSource,
  type RuntimeCacheSourceOptions,
  type VillaCacheScope,
  type VillaInvalidation,
  type VillaRuntimeCache,
} from "@/lib/server/villa-runtime-cache";
import { createVillaReader, type VillaPage, type VillaReadTrace } from "@/lib/server/villa-reads";
import type { VillaCatalog } from "@/lib/villas";
import { villaBenchmarkNamespace, villaBenchmarkReaders, type VillaCacheObservation } from "@/lib/server/villa-cache-benchmark";
import { faultableVillaCache, faultableVillaClient, markVillaFaultResponse } from "@/lib/server/villa-read-fault";

// Start server villa reads. Anonymous raw DTOs are cached for 60 s in the Vercel Runtime
// Cache (bounded in-memory elsewhere) and localized per request. Never import next/* or
// React server APIs here, and never use this for scene subscriptions or private data.

export { VillaUnavailableError } from "@/lib/server/villa-reads";
export type { VillaPage } from "@/lib/server/villa-reads";

let runtimeCache: VillaRuntimeCache | undefined;
const cache = () => (runtimeCache ??= faultableVillaCache(process.env.VERCEL === "1" ? getCache() : createBoundedMemoryCache()));

/**
 * Where the runtime cache lives for this request. Hosted: shared when the Vercel request
 * context supplies one or the SDK has a configured endpoint; otherwise the SDK silently falls
 * back to per-process memory (`hosted-process`). Off Vercel: local development memory.
 */
export function villaCacheScope(env: Record<string, string | undefined> = process.env): VillaCacheScope {
  if (env.VERCEL !== "1") return "local";
  const context = (globalThis as { [key: symbol]: { get?: () => { cache?: unknown } } | undefined })[
    Symbol.for("@vercel/request-context")
  ]?.get?.();
  if (context?.cache) return "shared";
  if (env.RUNTIME_CACHE_DISABLE_BUILD_CACHE === "true" || !env.RUNTIME_CACHE_ENDPOINT || !env.RUNTIME_CACHE_HEADERS) {
    return "hosted-process";
  }
  try {
    JSON.parse(env.RUNTIME_CACHE_HEADERS);
    return "shared";
  } catch {
    return "hosted-process";
  }
}

const cacheSource = (getRuntimeCache: () => VillaRuntimeCache, benchmark?: RuntimeCacheSourceOptions["benchmark"]) => createRuntimeCacheSource({
  cache: getRuntimeCache,
  client: (url) => faultableVillaClient(new ConvexHttpClient(url)),
  waitUntil: (pending) => {
    if (process.env.VERCEL === "1") waitUntil(pending);
  },
  scope: () => villaCacheScope(),
  verifyWrites: Boolean(benchmark),
  benchmark,
});
const source = cacheSource(cache);
const reader = createVillaReader(source);
const benchmarkTrace = new AsyncLocalStorage<{ unavailable?: boolean }>();
const benchmarkReader = villaBenchmarkReaders((namespace) => {
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? "local";
  return createVillaReader(cacheSource(() => ({
    async get(key) {
      try {
        return await cache().get(key);
      } catch (error) {
        const trace = benchmarkTrace.getStore();
        if (trace) trace.unavailable = true;
        throw error;
      }
    },
    set: (key, value, options) => cache().set(key, value, options),
    delete: (key) => cache().delete(key),
    expireTag: (tag) => cache().expireTag(tag),
  }), { deployment, dataNamespace: namespace }));
});

export type StartVillaRead = {
  page: VillaPage | null;
  /**
   * `hit`: fresh cache entry. `stale`: answered without waiting on the origin, either a cached
   * entry past its 60 s freshness (refreshing in the background) or, with `recovery`, saved data
   * during an outage. `miss`: the request waited on the origin.
   */
  cache: VillaCacheObservation;
  recovery?: VillaReadTrace["recovery"];
};

/**
 * `page: null` is an authoritative miss (404). Throws `VillaUnavailableError` (status 503,
 * `retryAfterSeconds`) when a cold outage has no saved data, and a plain Error when unconfigured.
 */
export async function getStartVilla(slug: string, locale: string, benchmarkNamespace?: string): Promise<StartVillaRead> {
  const timeLocalRead = process.env.BENCH_LOCAL_SSR === "1" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.VITE_CONVEX_URL ?? "");
  let transportMs: number | undefined;
  const started = timeLocalRead ? performance.now() : 0;
  const trace: VillaReadTrace = timeLocalRead
    ? { observeTransportMs: (duration) => { transportMs = duration; } }
    : {};
  const namespace = villaBenchmarkNamespace(benchmarkNamespace);
  const runtime: { unavailable?: boolean } = {};
  let cacheState: VillaCacheObservation = "bypass";
  try {
    const page = namespace
      ? await benchmarkTrace.run(runtime, () => benchmarkReader(namespace).getVilla(slug, locale, trace))
      : await reader.getVilla(slug, locale, trace);
    cacheState = trace.fallback ? "stale"
      : runtime.unavailable || trace.storage === "unavailable" || trace.storage === "process" ? "bypass"
      : trace.runtimeCache === "miss" && trace.storage === "unconfirmed" ? "unconfirmed"
      : trace.runtimeCache ?? "miss";
    return trace.recovery ? { page, cache: cacheState, recovery: trace.recovery } : { page, cache: cacheState };
  } finally {
    markVillaFaultResponse();
    if (timeLocalRead) {
      console.log("BENCH_VILLA_SSR", JSON.stringify({
        cache: cacheState, recovery: trace.recovery, durationMs: performance.now() - started, transportMs,
      }));
    }
  }
}

/** Value for a Preview-only diagnostic response header, e.g. `x-villa-cache`. */
export function villaCacheHeader({ cache: state, recovery }: StartVillaRead) {
  return recovery ? `${state}; ${recovery}` : state;
}

export const getStartVillaCatalog = (locale: string): Promise<VillaCatalog> => reader.getCatalog(locale);
/** Complete paged sitemap inventory; a failure retains only the last complete list. */
export const getStartVillaSlugs = (): Promise<string[]> => reader.getSlugs();
// The root and home loaders both need reviews during the same HTML request.
const featuredReviewsByRequest = new WeakMap<Request, Promise<Review[]>>();
export function getStartFeaturedReviews(request: Request): Promise<Review[]> {
  const pending = featuredReviewsByRequest.get(request);
  if (pending) return pending;
  const reviews = reader.getFeaturedReviews();
  featuredReviewsByRequest.set(request, reviews);
  return reviews;
}

export async function hasStartFeaturedReviews(request: Request): Promise<boolean> {
  return (await getStartFeaturedReviews(request)).length > 0;
}

/**
 * Trusted server callers only (after authenticating the request): expire one villa's cached
 * detail plus the shared catalog/sitemap/review reads, or every villa entry without a slug.
 * Only `confirmed` proves every worker will miss; on `unconfirmed` retry (entries still
 * expire after 60 s). `local` means local development without a shared cache.
 */
export const expireStartVillaCache = (slug?: string): Promise<VillaInvalidation> => source.expire(slug);
