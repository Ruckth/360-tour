import { api } from "convex/_generated/api";
import { AsyncLocalStorage } from "node:async_hooks";
import { ConvexHttpClient } from "convex/browser";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { Review } from "@/lib/data/reviews";
import { getPublicMessages, normalizePublicLocale } from "@/lib/i18n/messages-loader";
import {
  catalogFrom,
  reviewFromDb,
  villaFromDb,
  type DbVillaList,
  type PublicVilla,
  type VillaCatalog,
} from "@/lib/villas";

// Server-side villa reads for pages, metadata and the sitemap. Results are cached for a
// minute, so admin edits show up on the public site within ~60 s without a redeploy.
// During temporary backend failures, serve only previously read backend data.

const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 3_000;
const FAILURE_BACKOFF_MS = 30_000;
const MAX_LAST_GOOD_DETAILS = 200;
const VILLA_PAGE_SIZE = 100;
const cacheOptions = { revalidate: REVALIDATE_SECONDS, tags: ["villas"] };

function convexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  return url;
}

const cachedList = unstable_cache(
  (url: string) => new ConvexHttpClient(url).query(api.catalog.publicProperties.list, {}),
  ["public-villas"],
  cacheOptions,
);

// Enabled only for the isolated integration server. Track the cache's actual
// callback, keeping run IDs and timing state out of the cache key.
type VillaReadTiming = {
  cache: "hit" | "miss" | "stale" | "bypass";
  recovery?: "backoff" | "read-error";
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
    return timing
      ? timeVillaTransport(timing, () => client.query(api.catalog.publicProperties.getBySlug, { slug }))
      : client.query(api.catalog.publicProperties.getBySlug, { slug });
  },
  ["public-villa"],
  cacheOptions,
);
async function withReadTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function readSlugPage(client: ConvexHttpClient, cursor: string | null) {
  return withReadTimeout(client.query(api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: VILLA_PAGE_SIZE, cursor } }));
}

// The production frontend builds before Convex publishes the new slug query.
async function readCatalogSlugs(url: string) {
  const { villas } = await withReadTimeout(cachedList(url));
  return villas.map(({ slug }) => slug);
}

const cachedInitialSlugs = unstable_cache(
  async (url: string) => {
    try {
      return (await readSlugPage(new ConvexHttpClient(url), null)).page;
    } catch {
      return await readCatalogSlugs(url);
    }
  },
  ["public-villa-initial-slugs"],
  cacheOptions,
);
const cachedSlugs = unstable_cache(
  async (url: string) => {
    const client = new ConvexHttpClient(url);
    const slugs: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const result = await readSlugPage(client, cursor);
      slugs.push(...result.page);
      if (result.isDone) return slugs;
      cursor = result.continueCursor;
    }
  },
  ["public-villa-slugs"],
  cacheOptions,
);
const cachedFeaturedReviews = unstable_cache(
  (url: string) => new ConvexHttpClient(url).query(api.catalog.publicProperties.featuredReviews, { limit: 6 }),
  ["public-featured-reviews"],
  cacheOptions,
);

/** Shared catalog results stay available during an outage as detail entries rotate. */
const lastGood = new Map<string, unknown>();
const lastGoodDetails = new Map<string, unknown>();
// Pin misses for the current catalog and retain a bounded window for a catalog arriving later.
const recentMissingSlugs = new Set<string>();
const inactiveListedSlugs = new Set<string>();
/** After a failure Convex is not retried until this time, so an outage doesn't add a timeout to every request. */
let retryAfter = 0;

/**
 * Runs a configured Convex read. `undefined` means it is failing and nothing has been read
 * successfully yet. Missing configuration throws before entering the recovery path.
 */
async function readConvex<T>(
  key: string,
  read: (url: string) => Promise<T>,
  fallback = lastGood,
): Promise<T | undefined> {
  const url = convexUrl();
  const timing = fallback === lastGoodDetails ? villaReadTiming?.getStore() : undefined;
  if (Date.now() < retryAfter) {
    if (timing) timing.recovery = "backoff";
    return fallback.get(key) as T | undefined;
  }
  try {
    const value = await withReadTimeout(read(url));
    fallback.delete(key);
    // Missing slugs use the 60-second framework cache. They never displace a known villa here.
    if (value !== null) {
      fallback.set(key, value);
      if (fallback === lastGoodDetails && fallback.size > MAX_LAST_GOOD_DETAILS) {
        const oldest = fallback.keys().next();
        if (!oldest.done) fallback.delete(oldest.value);
      }
    }
    return value;
  } catch (error) {
    if (timing) timing.recovery = "read-error";
    retryAfter = Date.now() + FAILURE_BACKOFF_MS;
    console.warn(`[villas] ${key} failed; serving the last good result for ${FAILURE_BACKOFF_MS / 1000}s`, error);
    return fallback.get(key) as T | undefined;
  }
}

function readDetail(slug: string) {
  return readConvex(`detail:${slug}`, (url) => cachedDetail(url, slug), lastGoodDetails);
}

async function readTimedDetail(slug: string, storage: AsyncLocalStorage<VillaReadTiming>) {
  const start = performance.now();
  const timing: VillaReadTiming = { cache: "bypass", transportStarted: false };
  try {
    const detail = await storage.run(timing, () => readDetail(slug));
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

const loadList = cache(async () => {
  const list = await readConvex("list", cachedList);
  if (list && (recentMissingSlugs.size || inactiveListedSlugs.size)) {
    const listedSlugs = new Set(list.villas.map((row) => row.slug));
    for (const slug of listedSlugs) {
      if (recentMissingSlugs.has(slug)) inactiveListedSlugs.add(slug);
    }
    for (const slug of inactiveListedSlugs) {
      if (!listedSlugs.has(slug)) inactiveListedSlugs.delete(slug);
    }
  }
  return list;
});
const loadFeaturedReviews = cache(() => readConvex("featured-reviews", cachedFeaturedReviews));

export async function getVillaCatalog(locale: string): Promise<VillaCatalog> {
  return catalogFrom(await loadList(), getPublicMessages(locale), normalizePublicLocale(locale));
}

export const getPrerenderVillaSlugs = cache(async () => (await readConvex("initial-slugs", cachedInitialSlugs)) ?? []);

// Each page has its own deadline. A sitemap failure must not put villa detail reads into backoff.
let lastCompleteSlugs: string[] | undefined;
export const getVillaSlugs = cache(async () => {
  const url = convexUrl();
  try {
    lastCompleteSlugs = await cachedSlugs(url);
    return lastCompleteSlugs;
  } catch (error) {
    if (lastCompleteSlugs) return lastCompleteSlugs;
    const catalogSlugs = await readCatalogSlugs(url).catch(() => undefined);
    // The previous catalog endpoint caps its response at the villa page size.
    if (catalogSlugs && catalogSlugs.length < VILLA_PAGE_SIZE) return catalogSlugs;
    throw error;
  }
});

/** Deduplicate the active villa lookup for metadata and content within the request. */
export const getVilla = cache(async (
  slug: string,
  locale: string,
): Promise<{ villa: PublicVilla; reviews: Review[] } | null> => {
  const detail = await (villaReadTiming ? readTimedDetail(slug, villaReadTiming) : readDetail(slug));
  if (!detail) {
    const catalog = lastGood.get("list") as DbVillaList | undefined;
    const listed = catalog?.villas.find((row) => row.slug === slug);
    if (detail === null) {
      recentMissingSlugs.delete(slug);
      recentMissingSlugs.add(slug);
      const oldest = recentMissingSlugs.values().next();
      if (recentMissingSlugs.size > MAX_LAST_GOOD_DETAILS && !oldest.done) recentMissingSlugs.delete(oldest.value);
      if (listed) inactiveListedSlugs.add(slug);
    }
    if (detail === null || inactiveListedSlugs.has(slug)) return null;
    if (!listed) throw new Error("Villas are temporarily unavailable.");
    return {
      villa: villaFromDb(listed, getPublicMessages(locale), normalizePublicLocale(locale)),
      reviews: [],
    };
  }
  inactiveListedSlugs.delete(slug);
  recentMissingSlugs.delete(slug);
  return {
    villa: villaFromDb(detail.villa, getPublicMessages(locale), normalizePublicLocale(locale)),
    reviews: detail.reviews.map(reviewFromDb),
  };
});

export async function getFeaturedReviews(): Promise<Review[]> {
  const rows = await loadFeaturedReviews();
  return (rows ?? []).map(reviewFromDb);
}

/** Whether the home page shows its reviews section (same source), so the header only links to it then. */
export async function hasFeaturedReviews() {
  return (await getFeaturedReviews()).length > 0;
}
