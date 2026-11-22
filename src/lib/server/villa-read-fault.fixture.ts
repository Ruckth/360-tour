import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getFunctionName } from "convex/server";
import type { VillaQueryClient } from "@/lib/server/villa-reads";
import type { VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";

// Disposable Preview outage fixture, aliased over villa-read-fault.ts only by a
// `START_VILLA_FAULT_FIXTURE=1` build. A request that carries the deployment's fault token
// still performs each allowlisted anonymous villa read upstream, then holds it past the
// reader's 3 s deadline and fails it, so nothing from that read is cached. It needs Preview,
// a token digest and a run name in this deployment's own env, and otherwise does nothing.

export const VILLA_FAULT_TOKEN_HEADER = "x-villa-fault-token";
export const VILLA_FAULT_HOLD_MS = 4_000;
const ALLOWED = new Set(["list", "getBySlug", "listSlugs", "featuredReviews"].map((name) => `catalog/publicProperties:${name}`));

type Env = Record<string, string | undefined>;
type Config = { digest: Buffer; run: string };

export function villaFaultConfig(env: Env = process.env): Config | undefined {
  const digest = env.VILLA_FAULT_TOKEN_SHA256;
  const run = env.VILLA_FAULT_RUN;
  if (env.VERCEL_ENV !== "preview" || !digest || !/^[0-9a-f]{64}$/.test(digest) || !run || !/^[a-z0-9-]{8,40}$/.test(run)) return undefined;
  return { digest: Buffer.from(digest, "hex"), run };
}

export function villaFaultRequested(config: Config | undefined, token: string | null | undefined) {
  if (!config || !token || token.length < 32 || token.length > 128) return false;
  return timingSafeEqual(createHash("sha256").update(token).digest(), config.digest);
}

const config = villaFaultConfig();
const processId = randomUUID();
const ledger = { upstream: 0, held: 0, detail: 0, detailHeld: 0 };
type Ledger = typeof ledger;
const DETAIL = "catalog/publicProperties:getBySlug";

function currentRequestFaulted() {
  if (!config) return false;
  try {
    return villaFaultRequested(config, getRequest().headers.get(VILLA_FAULT_TOKEN_HEADER));
  } catch {
    return false;
  }
}

/** Counts one allowlisted read; `getBySlug` is also counted alone so a test can attribute reads to one key. */
export function countVillaRead(name: string, held: boolean, counts: Ledger = ledger) {
  counts.upstream += 1;
  if (held) counts.held += 1;
  if (name !== DETAIL) return;
  counts.detail += 1;
  if (held) counts.detailHeld += 1;
}

export function holdVillaRead<T>(read: () => Promise<T>, hold = VILLA_FAULT_HOLD_MS): Promise<T> {
  const start = Date.now();
  return read().then(
    () => new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("villa fault fixture held this read")), Math.max(0, hold - (Date.now() - start)))),
  );
}

export function faultableVillaClient(client: VillaQueryClient): VillaQueryClient {
  if (!config) return client;
  return {
    query: ((reference: Parameters<VillaQueryClient["query"]>[0], ...args: unknown[]) => {
      const read = () => (client.query as (...a: unknown[]) => Promise<unknown>)(reference, ...args);
      const name = getFunctionName(reference);
      if (!ALLOWED.has(name)) return read();
      const held = currentRequestFaulted();
      countVillaRead(name, held);
      return held ? holdVillaRead(read) : read();
    }) as VillaQueryClient["query"],
  };
}

/** Keeps this run's entries and tags apart from other deployments sharing the project's Runtime Cache. */
export function faultableVillaCache(cache: VillaRuntimeCache, run = config?.run): VillaRuntimeCache {
  if (!run) return cache;
  const prefix = `villa-fault:${run}:`;
  const tagged = (tag: string | string[]) => (Array.isArray(tag) ? tag : [tag]).map((item) => prefix + item);
  return {
    get: (key) => cache.get(prefix + key),
    set: (key, value, options) => cache.set(prefix + key, value, options && { ...options, ...(options.tags && { tags: tagged(options.tags) }) }),
    delete: (key) => cache.delete(prefix + key),
    expireTag: (tag) => cache.expireTag(tagged(tag)),
  };
}

/** Counts only: process identity, whether this request was faulted, and process read totals. */
export function markVillaFaultResponse() {
  if (!config) return;
  try {
    setResponseHeader("x-villa-fault-process", processId);
    setResponseHeader("x-villa-fault-active", currentRequestFaulted() ? "1" : "0");
    setResponseHeader("x-villa-fault-ledger", `upstream=${ledger.upstream};held=${ledger.held};detail=${ledger.detail};detailHeld=${ledger.detailHeld}`);
  } catch {
    // Outside a request there is nothing to annotate.
  }
}
