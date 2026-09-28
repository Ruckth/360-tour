import { api } from "convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { Review } from "@/lib/data/reviews";
import {
  catalogFrom,
  reviewFromDb,
  staticReviews,
  topReviews,
  villaFromDb,
  type PublicVilla,
  type VillaCatalog,
} from "@/lib/villas";

// Server-side villa reads for pages, metadata and the sitemap. Results are cached for a
// minute, so admin edits show up on the public site within ~60 s without a redeploy.

const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 3_000;
const cacheOptions = { revalidate: REVALIDATE_SECONDS, tags: ["villas"] };

function convexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  return url && !url.includes("placeholder") ? url : undefined;
}

const cachedList = unstable_cache(
  (url: string) => new ConvexHttpClient(url).query(api.publicProperties.list, {}),
  ["public-villas"],
  cacheOptions,
);
const cachedDetail = unstable_cache(
  (url: string, slug: string) => new ConvexHttpClient(url).query(api.publicProperties.getBySlug, { slug }),
  ["public-villa"],
  cacheOptions,
);
const cachedFeaturedReviews = unstable_cache(
  (url: string) => new ConvexHttpClient(url).query(api.publicProperties.featuredReviews, { limit: 6 }),
  ["public-featured-reviews"],
  cacheOptions,
);

/** Runs a Convex read; `undefined` means Convex is not configured or failed (use bundled content). */
async function readConvex<T>(label: string, read: (url: string) => Promise<T>): Promise<T | undefined> {
  const url = convexUrl();
  if (!url) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn(`[villas] ${label} failed; using bundled content`, error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Deduped per request: metadata, page and sitemap share one read (and one timeout if Convex is down).
const loadList = cache(() => readConvex("list", cachedList));

export async function getVillaCatalog(locale: string): Promise<VillaCatalog> {
  return catalogFrom(await loadList(), locale);
}

/** A villa with its reviews, or null when it does not exist or is not active (→ 404). */
export async function getVilla(
  slug: string,
  locale: string,
): Promise<{ villa: PublicVilla; reviews: Review[] } | null> {
  const catalog = await getVillaCatalog(locale);
  const villa = catalog.villas.find((item) => item.id === slug);
  if (!villa) return null;
  if (catalog.source === "static") return { villa, reviews: staticReviews(slug, locale) };

  const detail = await readConvex("detail", (url) => cachedDetail(url, slug));
  if (detail === null) return null;
  if (!detail) return { villa, reviews: [] };
  return { villa: villaFromDb(detail.villa, locale), reviews: detail.reviews.map(reviewFromDb) };
}

export async function getFeaturedReviews(catalog: VillaCatalog, locale: string): Promise<Review[]> {
  if (catalog.source === "static") {
    return topReviews(catalog.villas.flatMap((villa) => staticReviews(villa.id, locale)));
  }
  const rows = await readConvex("featured reviews", cachedFeaturedReviews);
  return (rows ?? []).map(reviewFromDb);
}
