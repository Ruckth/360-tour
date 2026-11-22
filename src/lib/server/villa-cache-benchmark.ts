export const VILLA_BENCH_REQUEST_HEADER = "x-villa-bench-namespace";
export const VILLA_CACHE_NAMESPACE_HEADER = "x-villa-cache-namespace";
export const VILLA_CACHE_HEADER = "x-villa-cache";
export const VILLA_BENCH_REQUEST_ID_HEADER = "x-villa-bench-request-id";

/**
 * `bypass`: cache transport threw. `unconfirmed` (benchmark only): the origin read ran but the
 * write was not read back, so storage may be unavailable (the SDK reports failures as null).
 * A recovery uses the worker’s saved data after an origin error or during backoff.
 * Record it as a known non-hit in the natural schedule.
 */
export type VillaCacheObservation = "hit" | "miss" | "stale" | "bypass" | "unconfirmed" | "recovery";

type Env = Record<string, string | undefined>;

export function villaBenchmarkEnabled(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview" && env.VILLA_BENCH_NAMESPACE === "1";
}

export function villaBenchmarkNamespace(value: string | null | undefined, env?: Env): string | undefined {
  return villaBenchmarkEnabled(env) && value && /^[a-z0-9-]{8,48}$/.test(value) ? value : undefined;
}

export function villaBenchmarkResponse(namespace: string, cache: VillaCacheObservation) {
  return {
    [VILLA_CACHE_NAMESPACE_HEADER]: namespace,
    [VILLA_CACHE_HEADER]: cache,
    "Cache-Control": "private, no-store",
  };
}

/** A fresh cache key must also get its own last-good state and in-flight requests. */
export function villaBenchmarkReaders<Reader>(create: (namespace: string) => Reader) {
  const readers = new Map<string, Reader>();
  return (namespace: string): Reader => {
    const reader = readers.get(namespace) ?? create(namespace);
    readers.delete(namespace);
    readers.set(namespace, reader);
    if (readers.size > 256) readers.delete(readers.keys().next().value!);
    return reader;
  };
}
