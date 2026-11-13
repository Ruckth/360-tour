import { api } from "convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { Review } from "@/lib/data/reviews";
import { getPublicMessages, normalizePublicLocale } from "@/lib/i18n/messages-loader";
import {
  catalogFrom,
  reviewFromDb,
  villaFromDb,
  type PublicVilla,
  type VillaCatalog,
} from "@/lib/villas";

// Server-side villa reads for pages, metadata and the sitemap. Results are cached for a
// minute, so admin edits show up on the public site within ~60 s without a redeploy.
// During temporary backend failures, serve only previously read backend data.

const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 3_000;
const FAILURE_BACKOFF_MS = 30_000;
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
const cachedDetail = unstable_cache(
  (url: string, slug: string) => new ConvexHttpClient(url).query(api.catalog.publicProperties.getBySlug, { slug }),
  ["public-villa"],
  cacheOptions,
);
const cachedFeaturedReviews = unstable_cache(
  (url: string) => new ConvexHttpClient(url).query(api.catalog.publicProperties.featuredReviews, { limit: 6 }),
  ["public-featured-reviews"],
  cacheOptions,
);

/** Last successful result per read, kept for the life of the server instance. */
const lastGood = new Map<string, unknown>();
/** After a failure Convex is not retried until this time, so an outage doesn't add a timeout to every request. */
let retryAfter = 0;

/**
 * Runs a configured Convex read. `undefined` means it is failing and nothing has been read
 * successfully yet. Missing configuration throws before entering the recovery path.
 */
async function readConvex<T>(key: string, read: (url: string) => Promise<T>): Promise<T | undefined> {
  const url = convexUrl();
  if (Date.now() < retryAfter) return lastGood.get(key) as T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      read(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
      }),
    ]);
    lastGood.set(key, value);
    return value;
  } catch (error) {
    retryAfter = Date.now() + FAILURE_BACKOFF_MS;
    console.warn(`[villas] ${key} failed; serving the last good result for ${FAILURE_BACKOFF_MS / 1000}s`, error);
    return lastGood.get(key) as T | undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Deduped per request: metadata, layout, page and sitemap share one read.
const loadList = cache(() => readConvex("list", cachedList));
const loadFeaturedReviews = cache(() => readConvex("featured-reviews", cachedFeaturedReviews));

/** Convex is configured but unreachable, with no earlier result to fall back on. */
async function listUnavailable() {
  return (await loadList()) === undefined && convexUrl() !== undefined;
}

export async function getVillaCatalog(locale: string): Promise<VillaCatalog> {
  // An empty backend has no bookable inventory.
  if (await listUnavailable()) return { source: "db", villas: [] };
  return catalogFrom(await loadList(), getPublicMessages(locale), normalizePublicLocale(locale));
}

/** A villa with its reviews, or null when it does not exist or is not active (→ 404). */
export async function getVilla(
  slug: string,
  locale: string,
): Promise<{ villa: PublicVilla; reviews: Review[] } | null> {
  const catalog = await getVillaCatalog(locale);
  const villa = catalog.villas.find((item) => item.id === slug);
  if (!villa) {
    // An outage is not a 404: show the error page and let the next request retry.
    if (await listUnavailable()) throw new Error("Villas are temporarily unavailable.");
    return null;
  }

  const detail = await readConvex(`detail:${slug}`, (url) => cachedDetail(url, slug));
  if (detail === null) return null;
  if (!detail) return { villa, reviews: [] };
  return {
    villa: villaFromDb(detail.villa, getPublicMessages(locale), normalizePublicLocale(locale)),
    reviews: detail.reviews.map(reviewFromDb),
  };
}

export async function getFeaturedReviews(): Promise<Review[]> {
  const rows = await loadFeaturedReviews();
  return (rows ?? []).map(reviewFromDb);
}

/** Whether the home page shows its reviews section (same source), so the header only links to it then. */
export async function hasFeaturedReviews() {
  return (await getFeaturedReviews()).length > 0;
}
