import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Review } from "@/lib/data/reviews";
import { getPublicMessages, normalizePublicLocale } from "@/lib/i18n/messages-loader";
import {
  catalogFrom,
  reviewFromDb,
  villaFromDb,
  type DbVillaDetail,
  type DbVillaList,
  type PublicVilla,
  type VillaCatalog,
} from "@/lib/villas";

// Framework-neutral villa read policy shared by the Next and Start server entries.
// Adapters supply fresh reads (each with its own framework cache); this module owns
// the outage recovery state. Never import next/* or React here.

export const VILLA_REVALIDATE_SECONDS = 60;
export const VILLA_READ_TIMEOUT_MS = 3_000;
export const VILLA_FAILURE_BACKOFF_MS = 30_000;
export const MAX_LAST_GOOD_DETAILS = 200;
/** Ordering records outlive last-good entries (detail + shared keys) with headroom. */
export const MAX_ORDERED_KEYS = 512;
export const VILLA_PAGE_SIZE = 100;
export const FEATURED_REVIEW_LIMIT = 6;

export type DbFeaturedReviews = FunctionReturnType<typeof api.catalog.publicProperties.featuredReviews>;
export type VillaPage = { villa: PublicVilla; reviews: Review[] };
export type VillaQueryClient = { query: import("convex/browser").ConvexHttpClient["query"] };

/** No saved data can answer this read during a backend outage. Retriable, unlike a missing villa. */
export class VillaUnavailableError extends Error {
  readonly status = 503;
  readonly retryAfterSeconds = VILLA_FAILURE_BACKOFF_MS / 1000;
  constructor() {
    super("Villas are temporarily unavailable.");
    this.name = "VillaUnavailableError";
  }
}

export function convexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  return url;
}

export async function withReadTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), VILLA_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function readSlugPage(client: VillaQueryClient, cursor: string | null) {
  return withReadTimeout(client.query(api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: VILLA_PAGE_SIZE, cursor } }));
}

/** Every active slug. Each page has its own deadline. */
export async function readAllSlugs(client: VillaQueryClient) {
  const slugs: string[] = [];
  let cursor: string | null = null;
  while (true) {
    const result = await readSlugPage(client, cursor);
    slugs.push(...result.page);
    if (result.isDone) return slugs;
    cursor = result.continueCursor;
  }
}

export const queryList = (client: VillaQueryClient) => client.query(api.catalog.publicProperties.list, {});
export const queryDetail = (client: VillaQueryClient, slug: string) =>
  client.query(api.catalog.publicProperties.getBySlug, { slug });
export const queryFeaturedReviews = (client: VillaQueryClient) =>
  client.query(api.catalog.publicProperties.featuredReviews, { limit: FEATURED_REVIEW_LIMIT });

/** Per-read diagnostics, filled by the source and the recovery policy. */
export type VillaReadTrace = {
  /** Set by a source that has its own runtime cache. */
  runtimeCache?: "hit" | "stale" | "miss";
  /** Isolated benchmark callback for a backend request this read starts. */
  observeTransportMs?: (duration: number) => void;
  /** Set when the backend was skipped (backoff) or failed, so saved data answered. */
  recovery?: "backoff" | "read-error";
  /** Which saved data answered during recovery. */
  fallback?: "detail" | "catalog";
  /**
   * Shared storage state when known: unreachable, a fresh write read back (or not, or a suspected
   * dropped read), or `process` when a hosted worker only has per-process SDK memory.
   */
  storage?: "unavailable" | "confirmed" | "unconfirmed" | "process";
  /**
   * Set by a cache-backed source when a cached value answered: the epoch ms at which its origin
   * read started. Absent for values this read obtained from the origin itself.
   */
  observedAt?: number;
  /** Local tie-break for `observedAt` (origin reads in start order; cached values are 0). */
  observedSeq?: number;
};

/** Fresh anonymous reads keyed by recovery key: `list`, `detail:<slug>`, `featured-reviews`. */
export type VillaSource = {
  list(url: string, trace?: VillaReadTrace): Promise<DbVillaList>;
  detail(url: string, slug: string, trace?: VillaReadTrace): Promise<DbVillaDetail | null>;
  /** Complete paged inventory for the sitemap. */
  slugs(url: string, trace?: VillaReadTrace): Promise<string[]>;
  featuredReviews(url: string, trace?: VillaReadTrace): Promise<DbFeaturedReviews>;
  /** A still-valid cached value that may answer while the backend is in backoff. */
  peek?(url: string, key: string, trace?: VillaReadTrace): Promise<{ value: unknown } | undefined>;
  /** Registers the reader that owns this source's background refreshes (one reader per source). */
  listen?(listener: VillaRefreshListener): void;
};

/**
 * Background origin reads report to the owning reader: `observed` with the epoch ms at which
 * that origin read started (only while its generation is current), `failed` on origin failure.
 */
export type VillaRefreshListener = {
  observed(key: string, value: unknown, observedAt: number, seq: number): void;
  failed(key: string, error: unknown): void;
};

export type VillaReaderOptions = {
  /** Request-scoped deduplication, e.g. React `cache`. */
  perRequest?: <F extends (...args: never[]) => Promise<unknown>>(fn: F) => F;
  /** Wraps only the detail recovery read, for SSR benchmark instrumentation. */
  timeDetail?: <T>(read: (trace: VillaReadTrace) => Promise<T>) => Promise<T>;
};

/**
 * Process-scoped recovery state: a bounded last-good detail map, last-good shared reads,
 * known-missing/inactive markers and a backend retry backoff. A new process starts empty.
 */
export function createVillaReader(source: VillaSource, options: VillaReaderOptions = {}) {
  const perRequest = options.perRequest ?? (<F>(fn: F) => fn);
  /** Shared catalog results stay available during an outage as detail entries rotate. */
  const lastGood = new Map<string, unknown>();
  const lastGoodDetails = new Map<string, unknown>();
  // Pin misses for the current catalog and retain a bounded window for a catalog arriving later.
  const recentMissingSlugs = new Set<string>();
  const inactiveListedSlugs = new Set<string>();
  /** After a failure the backend is not retried until this time, so an outage doesn't add a timeout to every request. */
  let retryAfter = 0;
  let lastCompleteSlugs: string[] | undefined;
  /**
   * Per-key ordering by origin observation time, not by request or completion order: each
   * applied value records when its origin read started (a cached value carries the time of the
   * origin read that produced it). Only a newer observation may change saved data or markers,
   * so a stale cached answer served while a newer origin read is in flight, or an older read
   * landing late, cannot overwrite what that newer read learned. Ties break by local order.
   * Bounded: the oldest key's record is dropped beyond MAX_ORDERED_KEYS.
   */
  let ticket = 0;
  const applied = new Map<string, { at: number; seq: number }>();
  function claim(key: string, at: number, seq: number) {
    const previous = applied.get(key);
    if (previous && (at < previous.at || (at === previous.at && seq < previous.seq))) return false;
    applied.delete(key);
    applied.set(key, { at, seq });
    if (applied.size > MAX_ORDERED_KEYS) applied.delete(applied.keys().next().value!);
    return true;
  }
  /** The observation time of a value just read: its cache origin time, else this read's start. */
  function observation(trace: VillaReadTrace, startedAt: number, seq: number) {
    return trace.observedAt === undefined ? { at: startedAt, seq } : { at: trace.observedAt, seq: trace.observedSeq ?? 0 };
  }

  /** An authoritative value replaces saved data; a miss evicts it and is never saved here. */
  function remember(key: string, value: unknown, fallback: Map<string, unknown>) {
    fallback.delete(key);
    if (value === null) return;
    fallback.set(key, value);
    if (fallback === lastGoodDetails && fallback.size > MAX_LAST_GOOD_DETAILS) {
      const oldest = fallback.keys().next();
      if (!oldest.done) fallback.delete(oldest.value);
    }
  }

  /**
   * Runs a configured backend read. `undefined` means it is failing and nothing has been read
   * successfully yet. Missing configuration throws before entering the recovery path.
   * `superseded`: a newer read for this key already applied, so this result changed nothing.
   */
  async function readTracked<T>(
    key: string,
    fresh: (url: string, trace: VillaReadTrace) => Promise<T>,
    fallback = lastGood,
    trace: VillaReadTrace = {},
  ): Promise<{ value: T | undefined; superseded: boolean }> {
    const url = convexUrl();
    const startedAt = Date.now();
    const seq = ++ticket;
    delete trace.observedAt;
    delete trace.observedSeq;
    if (Date.now() < retryAfter) {
      trace.recovery = "backoff";
      const cached = await source.peek?.(url, key, trace).catch(() => undefined);
      if (cached) {
        // A confirmed shared value is as authoritative as a fresh read: reconcile saved data
        // so an authoritative miss cannot later resurrect an older last-good villa.
        delete trace.recovery;
        const { at, seq: order } = observation(trace, startedAt, seq);
        const current = claim(key, at, order);
        if (current) remember(key, cached.value, fallback);
        return { value: cached.value as T, superseded: !current };
      }
      return { value: fallback.get(key) as T | undefined, superseded: false };
    }
    try {
      const value = await withReadTimeout(fresh(url, trace));
      const { at, seq: order } = observation(trace, startedAt, seq);
      const current = claim(key, at, order);
      if (current) remember(key, value, fallback);
      return { value, superseded: !current };
    } catch (error) {
      trace.recovery = "read-error";
      retryAfter = Date.now() + VILLA_FAILURE_BACKOFF_MS;
      console.warn(`[villas] ${key} failed; serving the last good result for ${VILLA_FAILURE_BACKOFF_MS / 1000}s`, error);
      return { value: fallback.get(key) as T | undefined, superseded: false };
    }
  }

  async function read<T>(key: string, fresh: (url: string, trace: VillaReadTrace) => Promise<T>, fallback = lastGood, trace?: VillaReadTrace) {
    return (await readTracked(key, fresh, fallback, trace)).value;
  }

  const readDetail = (slug: string, trace?: VillaReadTrace) =>
    readTracked<DbVillaDetail | null>(`detail:${slug}`, (url, local) => source.detail(url, slug, local), lastGoodDetails, trace);

  /** Reconciles known-inactive markers with an authoritative catalog. */
  function markList(list: DbVillaList) {
    if (!recentMissingSlugs.size && !inactiveListedSlugs.size) return;
    const listedSlugs = new Set(list.villas.map((row) => row.slug));
    for (const slug of listedSlugs) {
      if (recentMissingSlugs.has(slug)) inactiveListedSlugs.add(slug);
    }
    for (const slug of inactiveListedSlugs) {
      if (!listedSlugs.has(slug)) inactiveListedSlugs.delete(slug);
    }
  }

  /** An authoritative detail: a miss is remembered (bounded); an active villa clears its markers. */
  function markDetail(slug: string, detail: DbVillaDetail | null) {
    if (detail) {
      inactiveListedSlugs.delete(slug);
      recentMissingSlugs.delete(slug);
      return;
    }
    recentMissingSlugs.delete(slug);
    recentMissingSlugs.add(slug);
    const oldest = recentMissingSlugs.values().next();
    if (recentMissingSlugs.size > MAX_LAST_GOOD_DETAILS && !oldest.done) recentMissingSlugs.delete(oldest.value);
    const catalog = lastGood.get("list") as DbVillaList | undefined;
    if (catalog?.villas.some((row) => row.slug === slug)) inactiveListedSlugs.add(slug);
  }

  // A completed background origin read is as authoritative as a fresh read, under the same
  // observation ordering. A failed one puts this worker's detail/catalog backend into the shared
  // 30 s backoff; the sitemap keeps its own recovery (last complete inventory), as before.
  source.listen?.({
    observed(key, value, observedAt, seq) {
      if (!claim(key, observedAt, seq)) return;
      if (key === "slugs") lastCompleteSlugs = value as string[];
      else remember(key, value, key.startsWith("detail:") ? lastGoodDetails : lastGood);
      if (key === "list") markList(value as DbVillaList);
      if (key.startsWith("detail:")) markDetail(key.slice("detail:".length), value as DbVillaDetail | null);
    },
    failed(key, error) {
      if (key === "slugs") {
        console.warn("[villas] background sitemap refresh failed; serving the last complete inventory", error);
        return;
      }
      retryAfter = Date.now() + VILLA_FAILURE_BACKOFF_MS;
      console.warn(`[villas] background refresh of ${key} failed; backend backoff for ${VILLA_FAILURE_BACKOFF_MS / 1000}s`, error);
    },
  });

  const loadList = perRequest(async () => {
    const { value: list, superseded } = await readTracked("list", (url, local) => source.list(url, local));
    if (list && !superseded) markList(list);
    return list;
  });

  const loadFeaturedReviews = perRequest(() => read("featured-reviews", (url, local) => source.featuredReviews(url, local)));

  async function readCatalogSlugs(url: string) {
    const { villas } = await withReadTimeout(source.list(url));
    return villas.map(({ slug }) => slug);
  }

  async function getCatalog(locale: string): Promise<VillaCatalog> {
    return catalogFrom(await loadList(), getPublicMessages(locale), normalizePublicLocale(locale));
  }

  // A sitemap failure must not put villa detail reads into backoff.
  const getSlugs = perRequest(async () => {
    const url = convexUrl();
    try {
      lastCompleteSlugs = await source.slugs(url);
      return lastCompleteSlugs;
    } catch (error) {
      if (lastCompleteSlugs) return lastCompleteSlugs;
      const catalogSlugs = await readCatalogSlugs(url).catch(() => undefined);
      // The previous catalog endpoint caps its response at the villa page size.
      if (catalogSlugs && catalogSlugs.length < VILLA_PAGE_SIZE) return catalogSlugs;
      throw error;
    }
  });

  /**
   * `null` is an authoritative miss (unknown, archived or inactive). A cold outage with no
   * saved data throws `VillaUnavailableError`. Raw data is shared; localization is per call.
   */
  const getVilla = perRequest(async (slug: string, locale: string, trace: VillaReadTrace = {}): Promise<VillaPage | null> => {
    const { value: detail, superseded } =
      await (options.timeDetail ? options.timeDetail((timing) => readDetail(slug, timing)) : readDetail(slug, trace));
    const messages = getPublicMessages(locale);
    const tag = normalizePublicLocale(locale);
    // A superseded (older) read is still this caller's answer, but cannot change markers.
    if (detail !== undefined && !superseded) markDetail(slug, detail);
    if (!detail) {
      const catalog = lastGood.get("list") as DbVillaList | undefined;
      const listed = catalog?.villas.find((row) => row.slug === slug);
      // A confirmed miss stays a 404 through an outage until a fresh read reactivates it.
      if (detail === null || inactiveListedSlugs.has(slug) || recentMissingSlugs.has(slug)) return null;
      if (!listed) throw new VillaUnavailableError();
      trace.fallback = "catalog";
      return { villa: villaFromDb(listed, messages, tag), reviews: [] };
    }
    if (trace.recovery) trace.fallback = "detail";
    return { villa: villaFromDb(detail.villa, messages, tag), reviews: detail.reviews.map(reviewFromDb) };
  });

  async function getFeaturedReviews(): Promise<Review[]> {
    return ((await loadFeaturedReviews()) ?? []).map(reviewFromDb);
  }

  return {
    read,
    readCatalogSlugs,
    getCatalog,
    getSlugs,
    getVilla,
    getFeaturedReviews,
    /** Per-key ordering records (bounded by MAX_ORDERED_KEYS). For bounded-state tests. */
    orderedKeys: () => applied.size,
  };
}
