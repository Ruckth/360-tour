import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { villaBenchmarkReaders, type VillaCacheObservation } from "@/lib/server/villa-cache-benchmark";
import { ConvexHttpClient } from "convex/browser";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  createVillaReader,
  queryDetail,
  queryFeaturedReviews,
  queryList,
  readAllSlugs,
  readSlugPage,
  VILLA_REVALIDATE_SECONDS,
  type VillaReadTrace,
} from "@/lib/server/villa-reads";

// Next server villa reads for pages, metadata and the sitemap. Results are cached for a
// minute, so admin edits show up on the public site within ~60 s without a redeploy.
// The shared recovery policy in villa-reads serves only previously read backend data.

const cacheOptions = { revalidate: VILLA_REVALIDATE_SECONDS, tags: ["villas"] };

const cachedList = unstable_cache(
  (url: string) => queryList(new ConvexHttpClient(url)),
  ["public-villas"],
  cacheOptions,
);

// Enabled only for the isolated integration server. Track the cache's actual
// callback, keeping run IDs and timing state out of the cache key.
type VillaReadTiming = Pick<VillaReadTrace, "recovery"> & {
  cache: "hit" | "miss" | "stale" | "bypass";
  transportStarted: boolean;
  transportMs?: number;
};
const villaReadTiming =
  process.env.BENCH_LOCAL_SSR === "1" &&
  /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
    ? new AsyncLocalStorage<VillaReadTiming>()
    : undefined;

async function timeVillaTransport<T>(timing: VillaReadTiming, read: () => Promise<T>) {
  timing.transportStarted = true;
  const start = performance.now();
  try {
    return await read();
  } finally {
    timing.transportMs = performance.now() - start;
  }
}

const cachedDetail = unstable_cache(
  (url: string, slug: string) => {
    const client = new ConvexHttpClient(url);
    const timing = villaReadTiming?.getStore();
    return timing ? timeVillaTransport(timing, () => queryDetail(client, slug)) : queryDetail(client, slug);
  },
  ["public-villa"],
  cacheOptions,
);

async function timeDetail<T>(read: (trace: VillaReadTrace) => Promise<T>) {
  const storage = villaReadTiming!;
  const start = performance.now();
  const timing: VillaReadTiming = { cache: "bypass", transportStarted: false };
  try {
    const detail = await storage.run(timing, () => read(timing));
    if (timing.transportStarted) {
      timing.cache = timing.transportMs !== undefined || timing.recovery ? "miss" : "stale";
    } else if (!timing.recovery) {
      timing.cache = "hit";
    }
    return detail;
  } finally {
    console.log("BENCH_VILLA_SSR", JSON.stringify({
      cache: timing.cache,
      recovery: timing.recovery,
      durationMs: performance.now() - start,
      transportMs: timing.transportMs,
    }));
  }
}

const reader = createVillaReader(
  {
    list: cachedList,
    detail: (url, slug) => cachedDetail(url, slug),
    slugs: unstable_cache((url: string) => readAllSlugs(new ConvexHttpClient(url)), ["public-villa-slugs"], cacheOptions),
    featuredReviews: unstable_cache(
      (url: string) => queryFeaturedReviews(new ConvexHttpClient(url)),
      ["public-featured-reviews"],
      cacheOptions,
    ),
  },
  { perRequest: cache, timeDetail: villaReadTiming ? timeDetail : undefined },
);

// The production frontend builds before Convex publishes the new slug query.
const cachedInitialSlugs = unstable_cache(
  async (url: string) => {
    try {
      return (await readSlugPage(new ConvexHttpClient(url), null)).page;
    } catch {
      return await reader.readCatalogSlugs(url);
    }
  },
  ["public-villa-initial-slugs"],
  cacheOptions,
);

export const getVillaCatalog = reader.getCatalog;
export const getPrerenderVillaSlugs = cache(async () => (await reader.read("initial-slugs", cachedInitialSlugs)) ?? []);
/** Complete paged sitemap inventory; a failure retains only the last complete list. */
export const getVillaSlugs = reader.getSlugs;
/** Deduplicate the active villa lookup for metadata and content within the request. */
export const getVilla = (slug: string, locale: string) => reader.getVilla(slug, locale);
export const getFeaturedReviews = reader.getFeaturedReviews;
/** Whether the home page shows its reviews section (same source), so the header only links to it then. */
export const hasFeaturedReviews = reader.hasFeaturedReviews;


const benchmarkTransport = new AsyncLocalStorage<{ generation?: string }>();

const cachedBenchmarkDetail = unstable_cache(
  async (url: string, slug: string, namespace: string) => {
    const generation = `${namespace}:${randomUUID()}`;
    const context = benchmarkTransport.getStore();
    if (context) context.generation = generation;
    return { generation, detail: await queryDetail(new ConvexHttpClient(url), slug) };
  },
  ["public-villa-benchmark"],
  cacheOptions,
);

type BenchmarkTrace = VillaReadTrace & { observation?: "hit" | "miss" | "stale" };

const benchmarkReaders = villaBenchmarkReaders((namespace) => createVillaReader({
  list: cachedList,
  async detail(url, slug, trace?: BenchmarkTrace) {
    const transport: { generation?: string } = {};
    const result = await benchmarkTransport.run(transport, () => cachedBenchmarkDetail(url, slug, namespace));
    if (trace) {
      trace.observation = transport.generation === undefined
        ? "hit"
        : transport.generation === result.generation ? "miss" : "stale";
    }
    return result.detail;
  },
  slugs: (url) => readAllSlugs(new ConvexHttpClient(url)),
  featuredReviews: (url) => queryFeaturedReviews(new ConvexHttpClient(url)),
}));

export const getBenchmarkVilla = cache(async (slug: string, locale: string, namespace: string) => {
  const trace: BenchmarkTrace = {};
  const page = await benchmarkReaders(namespace).getVilla(slug, locale, trace);
  const state: VillaCacheObservation = trace.fallback || trace.recovery ? "recovery" : trace.observation ?? "bypass";
  return { page, state };
});
