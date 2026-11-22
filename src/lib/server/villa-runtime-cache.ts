import { createHash, randomUUID } from "node:crypto";
import {
  convexUrl,
  queryDetail,
  queryFeaturedReviews,
  queryList,
  readAllSlugs,
  VILLA_REVALIDATE_SECONDS,
  withReadTimeout,
  type VillaQueryClient,
  type VillaReadTrace,
  type VillaRefreshListener,
  type VillaSource,
} from "@/lib/server/villa-reads";

// Framework-neutral runtime-cache source for anonymous raw villa DTOs (before localization).
// Structurally matches `RuntimeCache` from @vercel/functions so the Start entry can pass
// `getCache()` on Vercel and a bounded in-memory cache in local harnesses.

/** Bump when the cached raw DTO shape or its meaning changes. */
export const VILLA_DTO_VERSION = 2;

export type VillaRuntimeCache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options?: { name?: string; tags?: string[]; ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  expireTag(tag: string | string[]): Promise<void>;
};

type Env = Record<string, string | undefined>;

const environmentName = (env: Env) => env.VERCEL_ENV ?? "local";

/** Keys are scoped by environment, Convex deployment URL and DTO version. */
export function villaCacheNamespace(url: string, env: Env = process.env) {
  return `villas:${environmentName(env)}:${url}:v${VILLA_DTO_VERSION}`;
}

/** Short, comma-free tag scope for one namespace (environment + Convex deployment + version). */
const tagScope = (namespace: string) => createHash("sha256").update(namespace).digest("hex").slice(0, 16);

/**
 * Storage-cleanup tags for a cache key: every entry carries `villas:<scope>`; a detail adds
 * `villa:<scope>:<slug>` and shared reads (catalog, sitemap, reviews) add `villas-index:<scope>`.
 * Correctness never depends on tags: invalidation rotates shared generations.
 */
export function villaCacheTags(url: string, key: string, env: Env = process.env) {
  const scope = tagScope(villaCacheNamespace(url, env));
  const slug = key.startsWith("detail:") ? key.slice("detail:".length) : undefined;
  return [`villas:${scope}`, slug ? `villa:${scope}:${slug}` : `villas-index:${scope}`];
}

/** Tags that expire one villa (its detail and every shared read) or, without a slug, everything. */
export function villaExpiryTags(url: string, slug?: string, env: Env = process.env) {
  const scope = tagScope(villaCacheNamespace(url, env));
  return slug ? [`villa:${scope}:${slug}`, `villas-index:${scope}`] : [`villas:${scope}`];
}

/** Bounded TTL/tag cache with Vercel's JSON semantics, for local and test harnesses. */
export function createBoundedMemoryCache(maxEntries = 500, now = Date.now): VillaRuntimeCache {
  const entries = new Map<string, { json: string; expiresAt: number; tags: Set<string> }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (entry.expiresAt <= now()) return null;
      entries.set(key, entry);
      return JSON.parse(entry.json) as unknown;
    },
    async set(key, value, options) {
      entries.delete(key);
      entries.set(key, {
        json: JSON.stringify(value ?? null),
        expiresAt: options?.ttl === undefined ? Infinity : now() + options.ttl * 1000,
        tags: new Set(options?.tags),
      });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    async delete(key) {
      entries.delete(key);
    },
    async expireTag(tag) {
      const tags = Array.isArray(tag) ? tag : [tag];
      for (const [key, entry] of entries) {
        if (tags.some((item) => entry.tags.has(item))) entries.delete(key);
      }
    },
  };
}


export type RuntimeCacheSourceOptions = {
  cache: () => VillaRuntimeCache;
  client: (url: string) => VillaQueryClient;
  /** Keeps a non-blocking cache write alive after the response, e.g. Vercel `waitUntil`. */
  waitUntil?: (pending: Promise<unknown>) => void;
  /** Where `cache()` lives for this request. Default `shared`. */
  scope?: () => VillaCacheScope;
  /** Await each fresh write and read it back, recording `trace.storage`. Benchmark use only. */
  verifyWrites?: boolean;
  /** Isolate benchmark storage from ordinary data and reuse generation metadata across data-entry namespaces. */
  benchmark?: { deployment: string; dataNamespace: string };
  env?: Env;
};

/**
 * `confirmed`: every rotated shared generation was read back. `unconfirmed`: the cache did not
 * acknowledge it (the Vercel SDK reports transport/HTTP failures as `null` or silent success),
 * or a hosted worker has only process memory, so callers must retry. `local`: local
 * development without a shared cache; only this process was invalidated.
 */
/**
 * `shared`: one cache for every worker. `local`: local development, process memory by design.
 * `hosted-process`: hosted, but the SDK fell back to per-process memory (no request-context
 * cache or endpoint). Reads still cache per process for 60 s; invalidation is never confirmed.
 */
export type VillaCacheScope = "shared" | "local" | "hosted-process";

export type VillaInvalidation = { status: "confirmed" | "unconfirmed" | "local" };

/**
 * Stale-while-revalidate, following Next's `unstable_cache({ revalidate: 60 })`: an entry is
 * fresh for 60 s (explicit `f` deadline in the envelope), then served immediately as `stale`
 * while one background refresh per key and worker replaces it. Unlike Next, stale retention is
 * bounded: the storage TTL is fresh + stale, after which a request waits on the origin (`miss`).
 */
export const VILLA_STALE_SECONDS = 60 * 60;
const ENTRY_TTL_SECONDS = VILLA_REVALIDATE_SECONDS + VILLA_STALE_SECONDS;
/** A failed background refresh is not retried for this key and worker within this window. */
export const VILLA_REFRESH_RETRY_MS = 30_000;
const MAX_REFRESH_BACKOFF_KEYS = 256;

/** Generations outlive data (fresh + stale); an evicted generation only causes a fresh generation. */
const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Benchmark-only: data keys this process saw present, so a later miss before expiry is suspect. */
const MAX_OBSERVED_KEYS = 256;
/** After storage fails to read back a generation, bypass it (fresh reads only) this long. */
export const VILLA_STORAGE_RETRY_MS = 5_000;
const ROTATION_ATTEMPTS = 3;

/**
 * `f`: epoch ms until which the value is fresh; afterwards it is stale until storage evicts it.
 * `o`: epoch ms at which the origin read that produced it started (ordering for readers).
 */
type Envelope = { v: unknown; f: number; o?: number };
/** A key stays in flight until its write (or rotation and republish) settles, at most this long. */
export const VILLA_SETTLE_MS = 5_000;
const MAX_REPUBLISH_DEPTH = 2;
/** Resolves when `pending` settles or after `ms`, whichever is first. */
async function waitAtMost(pending: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  clearTimeout(timer);
}
/** Content comparison for change detection; a false "changed" only costs one rotation. */
const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * `n`: this per-slug generation is negative (a tombstone epoch): only an authoritative miss may
 * be stored or served under it. Without `n` the generation is positive: only an active villa.
 */
type Generation = { g: string; n?: true };
/** A data key and the polarity of the slug generation it was derived from. */
type Slot = { key: string; negative: boolean };
/** Whether a detail value contradicts its generation's polarity (never for shared reads). */
const contradicts = (key: string, value: unknown, negative: boolean) => key.startsWith("detail:") && (value === null) !== negative;
const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === "object" && value !== null && "v" in value && typeof (value as Envelope).f === "number";
const isGeneration = (value: unknown): value is Generation =>
  typeof value === "object" && value !== null && typeof (value as Generation).g === "string";
/**
 * `observedAt`/`seq`: when this flight's origin read started (and its local order), shared by
 * every request that joins it. `fence`: settles once a polarity transition (first 404 under a
 * positive generation, or an active villa under a negative one) has rotated the slug
 * (immediately for every other outcome).
 */
type Flight = { result: Promise<unknown>; written: Promise<boolean>; observedAt: number; seq: number; fence: Promise<void> };
/** An answer that transitions polarity waits at most this long for its rotation (storage health bound). */
export const VILLA_NEGATIVE_FENCE_WAIT_MS = 1_000;

/**
 * Data keys embed shared generations: `<ns>:<key>@<all>.<scope>`, where scope is the slug for a
 * detail and `index` for shared reads. Invalidation rotates generations in the shared cache, so
 * after an acknowledged rotation every worker reads a new key, and a fill that started under an
 * older generation (on any worker) can only write to a key nobody reads. A generation is always
 * read before its fresh query starts, so data under a generation observed after an
 * acknowledged rotation was read after the committed edit. A missing generation is written and
 * read back before any query uses it (concurrent requests share that bootstrap), so even a
 * bootstrap that overwrites a newer rotation only carries data read after it became visible.
 * If storage cannot read a generation back, requests bypass the cache for a few seconds.
 *
 * Only successful origin responses (including an authoritative `null`) enter the cache: fresh
 * for 60 s, then stale-while-revalidate for up to an hour (see VILLA_STALE_SECONDS). Stale data
 * is reachable only under its own generations, so an acknowledged invalidation is never
 * answered with stale data; a refresh that started under an older generation writes a key
 * nobody reads.
 * Single queries have a 3 s deadline and paged reads 3 s per page, so a never-settling SDK call
 * leaves the in-flight map and cannot write later. Cache failures are misses, never backend
 * failures. Concurrent misses for one key share a read.
 */
export function createRuntimeCacheSource({
  cache,
  client,
  waitUntil,
  scope = () => "shared",
  verifyWrites = false,
  benchmark,
  env = process.env,
}: RuntimeCacheSourceOptions): VillaSource & { expire(slug?: string): Promise<VillaInvalidation> } {
  const inFlight = new Map<string, Flight>();
  /** Local order of origin reads, to break same-millisecond ties between observations. */
  let originSeq = 0;
  let listener: VillaRefreshListener | undefined;
  const bootstraps = new Map<string, Promise<Generation | undefined>>();
  const rotations = new Map<string, Promise<boolean>>();
  let storageRetryAt = 0;
  const benchmarkScope = benchmark ? `:bench-scope:${benchmark.deployment}` : "";
  const namespace = (url: string) => villaCacheNamespace(url, env) + benchmarkScope;
  const scopedTags = (tags: string[]) => benchmarkScope ? tags.map((tag) => tag + benchmarkScope) : tags;
  const dataSuffix = benchmark ? `:bench-data:${benchmark.dataNamespace}` : "";
  /** Keys whose background refresh failed recently: full data key -> retry time. */
  const refreshRetryAt = new Map<string, number>();
  /** Benchmark-only positive guard: full data key -> expiry of its last confirmed write. */
  const observed = new Map<string, number>();
  const observeWrite = (fullKey: string, expiresAt: number) => {
    observed.delete(fullKey);
    observed.set(fullKey, expiresAt);
    if (observed.size > MAX_OBSERVED_KEYS) observed.delete(observed.keys().next().value!);
  };

  async function safeGet(key: string, trace?: VillaReadTrace) {
    try {
      return await cache().get(key);
    } catch (error) {
      if (trace) trace.storage = "unavailable";
      console.warn("[villas] runtime cache read failed", error);
      return null;
    }
  }

  async function safeSet(key: string, value: unknown, options: Parameters<VillaRuntimeCache["set"]>[2]) {
    try {
      await cache().set(key, value, options);
      return true;
    } catch (error) {
      console.warn("[villas] runtime cache write failed", error);
      return false;
    }
  }

  async function generation(url: string, scope: string, trace?: VillaReadTrace): Promise<Generation | undefined> {
    const key = `${namespace(url)}:gen:${scope}`;
    const value = await safeGet(key, trace);
    if (isGeneration(value)) return value;
    // Missing or unreadable (indistinguishable through the SDK): publish a new generation and use
    // whatever the cache reads back, only after it is visible to every worker.
    let pending = bootstraps.get(key) as Promise<Generation | undefined> | undefined;
    if (!pending) {
      const bootstrap = (async () => {
        if (!(await safeSet(key, { g: randomUUID() } satisfies Generation, { ttl: GENERATION_TTL_SECONDS, name: `gen:${scope}` }))) return undefined;
        const visible = await safeGet(key);
        return isGeneration(visible) ? visible : undefined;
      })();
      pending = bootstrap;
      bootstraps.set(key, bootstrap);
      void bootstrap.finally(() => bootstraps.delete(key));
    }
    const published = await pending;
    if (published === undefined) storageRetryAt = Date.now() + VILLA_STORAGE_RETRY_MS;
    return published;
  }

  /** `undefined`: storage is unavailable, so read fresh without caching. */
  async function dataKey(url: string, key: string, trace?: VillaReadTrace): Promise<Slot | undefined> {
    if (Date.now() < storageRetryAt) {
      if (trace) trace.storage = "unavailable";
      return undefined;
    }
    const scope = key.startsWith("detail:") ? `slug:${key.slice("detail:".length)}` : "index";
    const [all, own] = await Promise.all([generation(url, "all", trace), generation(url, scope, trace)]);
    if (all === undefined || own === undefined) {
      if (trace) trace.storage = "unavailable";
      return undefined;
    }
    return { key: `${namespace(url)}:${key}@${all.g}.${own.g}${dataSuffix}`, negative: own.n === true };
  }

  async function peek(url: string, key: string, trace?: VillaReadTrace) {
    const slot = await dataKey(url, key, trace);
    const value = slot === undefined ? undefined : await safeGet(slot.key, trace);
    if (!isEnvelope(value) || contradicts(key, value.v, slot!.negative)) return undefined;
    // Backoff peeks never start a refresh: the reader is already avoiding the failing origin.
    if (trace) {
      trace.runtimeCache = Date.now() < value.f ? "hit" : "stale";
      trace.observedAt = value.o ?? 0;
      trace.observedSeq = 0;
    }
    return { value: value.v };
  }

  const genKeyFor = (url: string, key: string) =>
    `${namespace(url)}:gen:${key.startsWith("detail:") ? `slug:${key.slice("detail:".length)}` : "index"}`;

  async function store(url: string, key: string, fullKey: string, value: unknown, observedAt: number) {
    const now = Date.now();
    const stored = await safeSet(fullKey, { v: value, f: now + VILLA_REVALIDATE_SECONDS * 1000, o: observedAt } satisfies Envelope, {
      ttl: ENTRY_TTL_SECONDS,
      tags: scopedTags(villaCacheTags(url, key, env)),
      name: key,
    });
    const confirmed = stored && (!verifyWrites || isEnvelope(await safeGet(fullKey)));
    if (verifyWrites && confirmed) observeWrite(fullKey, now + ENTRY_TTL_SECONDS * 1000);
    return confirmed;
  }

  /** Holds the key in flight until storage settles (bounded), and keeps that work alive. */
  function track(fullKey: string, entry: Flight) {
    inFlight.set(fullKey, entry);
    const settle = () => {
      if (inFlight.get(fullKey) === entry) inFlight.delete(fullKey);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, VILLA_SETTLE_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    void Promise.race([entry.written, bound]).then(() => {
      clearTimeout(timer);
      settle();
    });
    waitUntil?.(entry.written);
  }

  type Report = { observed(value: unknown, observedAt: number, seq: number): void; failed(error: unknown): void };
  const reportFor = (key: string): Report | undefined => listener && {
    observed: (value, observedAt, seq) => listener?.observed(key, value, observedAt, seq),
    failed: (error) => listener?.failed(key, error),
  };

  /**
   * One origin read and publish per data key and worker; foreground misses join it.
   *
   * Polarity invariant: a detail generation is positive or negative, and only a result of the
   * same polarity is ever stored (or served) under it. A result of the opposite polarity, from
   * any path (cold miss, refresh, republish), rotates the slug to that polarity with
   * acknowledgement and publishes only from an origin read started under the new generation.
   * So within a negative generation no active value can reverse a 404, and within a positive one
   * no stale null can hide a reactivation; a delayed write from an older read targets either a
   * generation of its own polarity it was read under (abandoned once rotated) or is refused.
   * The request that observed the transition waits until the current generation is verified to
   * have the observed polarity, or at most VILLA_NEGATIVE_FENCE_WAIT_MS (storage degradation).
   * Same-polarity content that differs from what is already stored also rotates (keeping the
   * polarity). Depth is bounded: under repeated edits publication may be skipped, never forced.
   */
  function startFlight<T>(
    url: string,
    key: string,
    slot: Slot,
    fresh: (client: VillaQueryClient) => Promise<T>,
    options: { observe?: (duration: number) => void; report?: Report; depth?: number } = {},
  ): Flight {
    const existing = inFlight.get(slot.key);
    if (existing) return existing;
    const { observe, report, depth = 0 } = options;
    const observedAt = Date.now();
    const seq = ++originSeq;
    const started = performance.now();
    const result = observe ? fresh(client(url)).finally(() => observe(performance.now() - started)) : fresh(client(url));
    const fence = Promise.withResolvers<void>();
    const written = result.then(async (fetched) => {
      const transition = contradicts(key, fetched, slot.negative);
      // Only a polarity transition holds the answering request; everything else is background.
      // A transition releases it only once the current generation is verified to have the
      // observed polarity; otherwise only the caller's storage-degradation deadline releases it.
      if (!transition) fence.resolve();
      const existingValue = transition ? undefined : await safeGet(slot.key);
      const conflict = isEnvelope(existingValue) && !sameContent(existingValue.v, fetched);
      if (transition || conflict) {
        if (depth >= MAX_REPUBLISH_DEPTH) return false;
        const next = await abandon(url, key, slot.key, transition ? fetched === null : slot.negative);
        if (next === undefined) return false;
        fence.resolve();
        return startFlight(url, key, next, fresh, { report, depth: depth + 1 }).written;
      }
      // Background observers learn this observation only while its generation is current.
      if (report && (await dataKey(url, key))?.key === slot.key) report.observed(fetched, observedAt, seq);
      return store(url, key, slot.key, fetched, observedAt);
    }, (error: unknown) => {
      fence.resolve();
      report?.failed(error);
      return false;
    });
    const entry: Flight = { result, written, observedAt, seq, fence: fence.promise };
    track(slot.key, entry);
    return entry;
  }

  /**
   * Moves the slug off `fromKey`'s generation onto a current generation of the wanted polarity,
   * without compare-and-set: a different generation counts only if its polarity matches;
   * otherwise (including one another worker bootstrapped or rotated meanwhile) it is rotated to
   * the wanted polarity and verified again, a bounded number of times. Returns the verified
   * slot, or undefined when storage did not converge (publication skipped).
   */
  async function abandon(url: string, key: string, fromKey: string, negative: boolean) {
    for (let attempt = 0; attempt <= ROTATION_ATTEMPTS; attempt++) {
      const current = await dataKey(url, key);
      if (current === undefined) return undefined;
      if (current.key !== fromKey && current.negative === negative) return current;
      if (attempt === ROTATION_ATTEMPTS || !(await rotate(genKeyFor(url, key), negative))) return undefined;
    }
    return undefined;
  }

  /**
   * Background refresh of a stale entry: coalesced per key and worker, bounded by the read
   * deadline and held until its publish settles. Unchanged content extends freshness in place;
   * changed content (edit, archive, reactivation) is republished under a new generation.
   * The reader learns the origin observation only while its generation is current.
   */
  function revalidate<T>(url: string, key: string, slot: Slot, stale: Envelope, fresh: (client: VillaQueryClient) => Promise<T>) {
    const fullKey = slot.key;
    if (inFlight.has(fullKey) || (refreshRetryAt.get(fullKey) ?? 0) > Date.now()) return;
    const report = reportFor(key);
    const observedAt = Date.now();
    const seq = ++originSeq;
    const result = fresh(client(url));
    const written = result.then(async (value) => {
      refreshRetryAt.delete(fullKey);
      if ((await dataKey(url, key))?.key !== fullKey) return false;
      report?.observed(value, observedAt, seq);
      if (sameContent(value, stale.v)) return store(url, key, fullKey, value, observedAt);
      // Changed content (edit, archive, reactivation): rotate to the observed polarity and
      // publish only from a read under the new generation (which applies the invariant again).
      const next = await abandon(url, key, fullKey, key.startsWith("detail:") ? value === null : slot.negative);
      if (next === undefined) return false;
      return startFlight(url, key, next, fresh, { report, depth: 1 }).written;
    }, (error: unknown) => {
      report?.failed(error);
      refreshRetryAt.delete(fullKey);
      refreshRetryAt.set(fullKey, Date.now() + VILLA_REFRESH_RETRY_MS);
      if (refreshRetryAt.size > MAX_REFRESH_BACKOFF_KEYS) refreshRetryAt.delete(refreshRetryAt.keys().next().value!);
      return false;
    });
    track(fullKey, { result, written, observedAt, seq, fence: Promise.resolve() });
  }

  /**
   * `trace.runtimeCache`: `hit` (fresh), `stale` (answered from cache, refresh in background) or
   * `miss` (the request waited on the origin). `observeTransportMs` reports only reads the
   * request waited on; background refreshes are never attributed to a response.
   */
  async function cached<T>(url: string, key: string, fresh: (client: VillaQueryClient) => Promise<T>, trace?: VillaReadTrace): Promise<T> {
    const observe = trace?.observeTransportMs;
    const slot = await dataKey(url, key, trace);
    if (slot === undefined) {
      if (trace) {
        trace.runtimeCache = "miss";
        trace.observedAt = Date.now();
        trace.observedSeq = ++originSeq;
      }
      const started = performance.now();
      return observe ? fresh(client(url)).finally(() => observe(performance.now() - started)) : fresh(client(url));
    }
    if (trace && scope() === "hosted-process") trace.storage = "process";
    const fullKey = slot.key;
    const stored = await safeGet(fullKey, trace);
    // A value contradicting its generation's polarity is never served as a cache answer.
    const value = isEnvelope(stored) && !contradicts(key, stored.v, slot.negative) ? stored : undefined;
    if (value) {
      if (trace) {
      trace.observedAt = value.o ?? 0;
      trace.observedSeq = 0;
    }
      if (Date.now() < value.f) {
        if (trace) trace.runtimeCache = "hit";
      } else {
        if (trace) trace.runtimeCache = "stale";
        revalidate(url, key, slot, value, fresh);
      }
      return value.v as T;
    }
    if (trace) trace.runtimeCache = "miss";
    // The SDK reports a failed GET as null. A miss on a key this probe saw present (or wrote)
    // within its storage TTL is likely a dropped read, not a natural miss. The guard is
    // conservative: an early eviction is also counted as uncertain rather than as a miss.
    const suspect = verifyWrites && (observed.get(fullKey) ?? 0) > Date.now();
    const flight = startFlight(url, key, slot, fresh, { observe });
    // Order this answer by when the origin read it joined actually started, not by request start.
    if (trace) {
      trace.observedAt = flight.observedAt;
      trace.observedSeq = flight.seq;
    }
    const result = (await flight.result) as T;
    // Settled immediately unless this answer is a polarity transition, which waits (bounded)
    // until the slug has rotated to it, so no later reader sees the opposite polarity.
    await waitAtMost(flight.fence, VILLA_NEGATIVE_FENCE_WAIT_MS);
    if (verifyWrites) {
      const written = await flight.written;
      if (trace && trace.storage !== "process") trace.storage = written && !suspect ? "confirmed" : "unconfirmed";
    }
    return result;
  }

  /**
   * Rotates one shared generation and requires the cache to read back a newer one. A different
   * token is accepted only if the previous one was seen (a concurrent rotation won); otherwise
   * a silently dropped write could read back the old generation. Serialized per key in-process.
   */
  function rotate(key: string, negative?: boolean) {
    const run = (rotations.get(key) ?? Promise.resolve(true)).then(async () => {
      const before = await safeGet(key);
      // Invalidation keeps the current polarity; transitions set it explicitly.
      const polarity = negative ?? (isGeneration(before) && before.n === true);
      for (let attempt = 0; attempt < ROTATION_ATTEMPTS; attempt++) {
        const next = randomUUID();
        if (!(await safeSet(key, (polarity ? { g: next, n: true } : { g: next }) satisfies Generation, { ttl: GENERATION_TTL_SECONDS, name: key.slice(key.lastIndexOf(":gen:") + 1) }))) return false;
        const after = await safeGet(key);
        if (!isGeneration(after)) return false;
        // Acknowledges only a new token; callers that need a polarity verify it (see abandon).
        if (after.g === next || (isGeneration(before) && after.g !== before.g)) return true;
      }
      return false;
    });
    rotations.set(key, run);
    void run.finally(() => {
      if (rotations.get(key) === run) rotations.delete(key);
    });
    return run;
  }

  /** Trusted server callers only: rotate one villa's detail plus shared reads, or everything. */
  async function expire(slug?: string): Promise<VillaInvalidation> {
    const url = convexUrl();
    const scopes = slug ? [`slug:${slug}`, "index"] : ["all"];
    const rotated = await Promise.all(scopes.map((scope) => rotate(`${namespace(url)}:gen:${scope}`)));
    // Storage cleanup only; the SDK resolves this even when the request failed.
    const cleanup = cache().expireTag(scopedTags(villaExpiryTags(url, slug, env))).catch((error: unknown) =>
      console.warn("[villas] runtime cache tag expiry failed", error));
    waitUntil?.(cleanup);
    const where = scope();
    if (where === "local") return { status: "local" };
    return { status: where === "shared" && rotated.every(Boolean) ? "confirmed" : "unconfirmed" };
  }

  const single = <T>(read: (client: VillaQueryClient) => Promise<T>) => (c: VillaQueryClient) => withReadTimeout(read(c));
  return {
    list: (url, trace) => cached(url, "list", single(queryList), trace),
    detail: (url, slug, trace) => cached(url, `detail:${slug}`, single((c) => queryDetail(c, slug)), trace),
    slugs: (url, trace) => cached(url, "slugs", readAllSlugs, trace),
    featuredReviews: (url, trace) => cached(url, "featured-reviews", single(queryFeaturedReviews), trace),
    peek,
    expire,
    listen: (owner) => {
      listener = owner;
    },
  };
}
