// Pure helpers for scripts/bench/room-preview-parity.mjs. Nothing here touches the network.
import { createHash, randomBytes } from "node:crypto";

export const MARKER = "\n__ROOM_PREVIEW__";
export const CLASSES = /** @type {const} */ (["hit", "miss"]);
const APP_CACHE = new Set(["hit", "stale", "miss", "bypass", "unconfirmed", "recovery"]);
// Responses served by the Vercel edge cache never ran the app, so their app header is a replay.
const EDGE_SERVED = new Set(["HIT", "STALE", "PRERENDER", "REVALIDATED"]);

/**
 * Split `curl --include --write-out MARKER...` output. Raw headers and body stay in memory only.
 * @param {Buffer} stdout
 */
export function parseCurlOutput(stdout) {
  const text = stdout.toString("utf8");
  const at = text.lastIndexOf(MARKER);
  if (at < 0) throw Error("curl output has no timing marker");
  const timing = text.slice(at + MARKER.length).trim().split(/\s+/).map(Number);
  if (timing.length !== 4 || timing.some((value) => !Number.isFinite(value))) throw Error("curl timing marker is malformed");
  const [status, startTransfer, preTransfer, total] = timing;
  let rest = text.slice(0, at);
  let head = "";
  // Skip interim responses (100 Continue, proxy CONNECT) and keep the final header block.
  while (rest.startsWith("HTTP/")) {
    const end = rest.search(/\r?\n\r?\n/);
    if (end < 0) { head = rest; rest = ""; break; }
    head = rest.slice(0, end);
    rest = rest.slice(end).replace(/^\r?\n\r?\n/, "");
  }
  /** @type {Map<string, string>} */
  const headers = new Map();
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    // Repeated fields (Next sends alternates and preloads as separate Link lines) combine per RFC 9110.
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return {
    status,
    ttfbMs: round(startTransfer * 1000),
    waitMs: round((startTransfer - preTransfer) * 1000),
    totalMs: round(total * 1000),
    headers,
    body: rest,
  };
}

/** `x-vercel-id` is `edge::function::request-id`; only the region labels are kept. */
export function vercelRegions(/** @type {string | undefined} */ value) {
  const parts = (value ?? "").split("::");
  if (parts.length < 2) return { edge: null, fn: null };
  const labels = parts.slice(0, -1).filter((part) => /^[a-z]{3}\d$/.test(part));
  return { edge: labels[0] ?? null, fn: labels.length > 1 ? labels[labels.length - 1] : null };
}

/** Application cache state from the instrumentation header. Edge headers are never consulted. */
export function classifyCache(/** @type {string | undefined} */ value) {
  if (value && /(?:^|[;,]\s*)(?:backoff|read-error)(?:$|[;,])/i.test(value)) return "recovery";
  const state = value?.split(/[;,\s]/)[0].trim().toLowerCase();
  return state && APP_CACHE.has(state) ? state : null;
}

/** The Next natural replay can use an observation emitted by the completed
 * document when the native response hook did not label a cold invocation.
 * @param {string | undefined} header
 * @param {{ html: string, witness: string | undefined, namespaceEcho: string | undefined, namespace: string | undefined }} [document]
 */
export function roomCacheObservation(header, document) {
  if (header !== undefined) {
    const cache = classifyCache(header);
    return { cache, source: cache ? "header" : null };
  }
  const unverified = { cache: null, source: null };
  if (!document?.namespace || document.namespace !== document.namespaceEcho ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(document.witness ?? "")) {
    return unverified;
  }
  const html = document.html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const observations = [...html.matchAll(/<span hidden(?:="")? data-villa-cache-observation="([0-9a-f-]+):([a-z0-9-]+):([a-z]+)"><\/span>/g)];
  if (observations.length !== 1) return unverified;
  const [, witness, namespace, state] = observations[0];
  return witness === document.witness && namespace === document.namespace && APP_CACHE.has(state)
    ? { cache: state, source: "server-document" }
    : unverified;
}

export function edgeServed(/** @type {string | undefined} */ value) {
  return EDGE_SERVED.has((value ?? "").trim().toUpperCase());
}

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });
function decode(/** @type {string} */ text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}
const squash = (/** @type {string} */ text) => decode(text).replace(/\s+/g, " ").trim();

function attributes(/** @type {string} */ source) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const [, name, dq, sq, bare] of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[name.toLowerCase()] = decode(dq ?? sq ?? bare ?? "");
  }
  return attrs;
}

/** Keep only a public path: no origin, query or fragment. */
export function publicPath(/** @type {string | undefined} */ value) {
  if (!value) return null;
  try {
    const { pathname } = new URL(value, "https://placeholder.invalid");
    return /^\/[\w.~%/-]*$/.test(pathname) ? pathname : "[redacted]";
  } catch {
    return "[redacted]";
  }
}

/**
 * Comparable room facts for a document. Text includes hidden streamed content and excludes
 * scripts, so a Suspense-streamed body and a fully rendered body compare equal.
 * @param {string} html
 * @param {string[]} ignoreTexts fallback strings such as the localized loading message
 */
export function documentFacts(html, ignoreTexts = []) {
  const ignore = new Set(ignoreTexts.map(squash));
  const source = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const facts = {
    lang: /** @type {string | null} */ (null),
    title: "",
    description: /** @type {string | null} */ (null),
    canonical: /** @type {string | null} */ (null),
    canonicalOrigin: /** @type {string | null} */ (null),
    ogImage: /** @type {string | null} */ (null),
    alternates: /** @type {string[]} */ ([]),
    h1: /** @type {string[]} */ ([]),
  };
  const texts = new Set();
  /** @type {null | "title" | "h1"} */
  let capture = null;
  let captured = "";
  for (const [, closing, rawTag, rawAttrs, text] of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) {
      const value = squash(text);
      if (capture) captured += " " + value;
      if (value.length > 1 && !ignore.has(value)) texts.add(value);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (closing) {
      if (capture === tag) {
        const value = squash(captured);
        if (tag === "title") facts.title ||= value;
        else if (value) facts.h1.push(value);
        capture = null;
      }
      continue;
    }
    const attrs = attributes(rawAttrs);
    if (tag === "html") facts.lang = attrs.lang ?? null;
    else if (tag === "title" || tag === "h1") { capture = tag; captured = ""; }
    else if (tag === "meta" && attrs.name?.toLowerCase() === "description") facts.description = squash(attrs.content ?? "");
    else if (tag === "meta" && attrs.property === "og:image") facts.ogImage = publicPath(attrs.content);
    else if (tag === "link" && attrs.rel === "canonical") {
      facts.canonical = publicPath(attrs.href);
      try {
        const canonical = new URL(attrs.href);
        if (canonical.protocol === "https:" && !canonical.username && !canonical.password && !canonical.search && !canonical.hash) {
          facts.canonicalOrigin = canonical.origin;
        }
      } catch { /* A relative or malformed canonical can never satisfy the candidate gate. */ }
    }
    else if (tag === "link" && attrs.rel === "alternate" && attrs.hreflang) facts.alternates.push(`${attrs.hreflang} ${publicPath(attrs.href)}`);
  }
  facts.alternates.sort();
  const sorted = [...texts].sort();
  return { ...facts, textCount: sorted.length, contentDigest: sha256(sorted.join("\n")), texts: sorted };
}

/** Header `Link: <...>; rel="alternate"; hreflang="th"` entries, reduced to public paths. */
export function linkAlternates(/** @type {string | undefined} */ value) {
  const out = [];
  for (const [, target, params] of (value ?? "").matchAll(/<([^>]+)>([^,]*)/g)) {
    const lang = /hreflang="?([\w-]+)/.exec(params)?.[1];
    if (/rel="?alternate/.test(params) && lang) out.push(`${lang} ${publicPath(target)}`);
  }
  return out.sort();
}

export const FACT_FIELDS = /** @type {const} */ (["lang", "title", "description", "canonical", "canonicalOrigin", "ogImage", "alternates", "h1", "linkAlternates", "contentDigest"]);

/**
 * Field names that differ from the reference document.
 * @param {Record<string, unknown>} facts
 * @param {Record<string, unknown>} reference
 */
export function factMismatches(facts, reference) {
  return FACT_FIELDS.filter((field) => JSON.stringify(facts[field]) !== JSON.stringify(reference[field]));
}

/**
 * A canonical addition is only equivalent when it points at the expected room and origin.
 * @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} reference
 * @param {{ path: string, origin: string | null }} expected
 */
export function roomCandidateFacts(actual, reference, expected) {
  const canonicalValid = actual.canonical === expected.path.split("?")[0] && Boolean(actual.canonicalOrigin) &&
    (!expected.origin || actual.canonicalOrigin === expected.origin);
  const addedCanonical = canonicalValid && reference.canonical === null;
  let mismatches = factMismatches(actual, reference);
  if (addedCanonical) mismatches = mismatches.filter((field) => field !== "canonical" && field !== "canonicalOrigin");
  if (!canonicalValid && !mismatches.includes("canonical")) mismatches.unshift("canonical");
  return { mismatches, addedCanonical };
}

/** Inspect cookie names only. Next's locale-only cookie does not indicate a personalized document.
 * @param {string | undefined} header
 */
export function roomPreviewCookies(header) {
  const names = Array.from((header ?? "").matchAll(/(?:^|,\s*)([^=;,\s]+)=/g), ([, name]) => name);
  return {
    setsLocaleCookie: names.includes("NEXT_LOCALE"),
    setsOtherCookie: Boolean(header) && (!names.length || names.some((name) => name !== "NEXT_LOCALE")),
  };
}

/** Short, public description of how two text sets differ. */
export function textDiff(/** @type {string[]} */ actual, /** @type {string[]} */ reference) {
  const want = new Set(reference);
  const have = new Set(actual);
  const clip = (/** @type {string} */ value) => (value.length > 60 ? value.slice(0, 57) + "..." : value);
  const missing = reference.filter((value) => !have.has(value));
  const extra = actual.filter((value) => !want.has(value));
  return { missing: missing.length, extra: extra.length, missingSample: missing.slice(0, 3).map(clip), extraSample: extra.slice(0, 3).map(clip) };
}

/**
 * Why a measured response cannot be used, or null when it is a verified sample.
 * @param {{ status: number, cache: string | null, edgeCache: string | undefined, namespaceEcho: string | undefined, fnRegion: string | null, mismatches: string[] }} sample
 * @param {{ expect: "hit" | "miss" | "natural", namespace: string, region: string }} rule
 */
export function rejectReason(sample, rule) {
  if (sample.status !== 200) return `status-${sample.status}`;
  if (edgeServed(sample.edgeCache)) return "edge-served";
  if (sample.fnRegion !== rule.region) return "region";
  if (sample.mismatches.length) return "facts:" + sample.mismatches.join(",");
  if (sample.namespaceEcho !== rule.namespace) return "namespace-not-honored";
  if (!sample.cache) return "cache-unverified";
  if (sample.cache === "unconfirmed") return "unconfirmed-write";
  if (rule.expect === "natural") return sample.cache === "bypass" ? "cache-bypass" : null;
  return sample.cache === rule.expect ? null : `expected-${rule.expect}-got-${sample.cache}`;
}

export function median(/** @type {number[]} */ values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Nearest-rank percentile, as used by the other tour benchmarks. */
export function nearestRank(/** @type {number[]} */ values, /** @type {number} */ p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(/** @type {{ ttfbMs: number, waitMs: number }[]} */ samples) {
  if (!samples.length) return { n: 0, medianMs: null, p95Ms: null, waitMedianMs: null, waitP95Ms: null };
  const ttfb = samples.map((sample) => sample.ttfbMs);
  const wait = samples.map((sample) => sample.waitMs);
  return { n: samples.length, medianMs: median(ttfb), p95Ms: nearestRank(ttfb, 95), waitMedianMs: median(wait), waitP95Ms: nearestRank(wait, 95) };
}

/**
 * Parity gates. The candidate may be at most `limitRatio` slower at p95 for each
 * controlled class, and lose at most `hitRateLossPp` points of natural cache hits.
 * @param {{
 *   classes: Record<"hit" | "miss", { control: ReturnType<typeof summarize>, candidate: ReturnType<typeof summarize> }> | null,
 *   natural: { control: { rate: number | null, unverifiedShare: number }, candidate: { rate: number | null, unverifiedShare: number } } | null,
 *   factMismatches: number, regionMismatches: number,
 * }} input
 * @param {{ samples: number, limitRatio?: number, hitRateLossPp?: number, maxUnverifiedShare?: number }} options
 */
export function evaluateGates(input, { samples, limitRatio = 1.05, hitRateLossPp = 2, maxUnverifiedShare = 0.05 }) {
  /** @type {{ gate: string, pass: boolean | null, detail: string }[]} */
  const gates = [];
  const classes = input.classes;
  for (const name of CLASSES) {
    if (!classes) break;
    const { control, candidate } = classes[name];
    const complete = control.n >= samples && candidate.n >= samples;
    gates.push({ gate: `${name}-samples`, pass: complete || null, detail: `control ${control.n}, candidate ${candidate.n}, need ${samples}` });
    const base = control.p95Ms;
    const value = candidate.p95Ms;
    const limit = base === null ? null : round(base * limitRatio);
    gates.push({
      gate: `${name}-p95`,
      pass: complete && value !== null && limit !== null ? value <= limit : null,
      detail: `candidate ${value} ms, limit ${limit} ms (control ${base} ms × ${limitRatio})`,
    });
  }
  if (input.natural) {
    const { control, candidate } = input.natural;
    const floor = control.rate === null ? null : control.rate - hitRateLossPp / 100;
    const usable = Math.max(control.unverifiedShare, candidate.unverifiedShare) <= maxUnverifiedShare;
    gates.push({
      gate: "natural-hit-rate",
      pass: usable && candidate.rate !== null && floor !== null ? candidate.rate >= floor - 1e-9 : null,
      detail: `candidate ${pct(candidate.rate)}, floor ${pct(floor)} (control ${pct(control.rate)} − ${hitRateLossPp} pp); unverified ≤ ${pct(maxUnverifiedShare)}`,
    });
  } else {
    gates.push({ gate: "natural-hit-rate", pass: null, detail: "natural replay skipped" });
  }
  gates.push({ gate: "document-equivalence", pass: input.factMismatches === 0, detail: `${input.factMismatches} responses differed from the control reference` });
  gates.push({ gate: "same-region", pass: input.regionMismatches === 0, detail: `${input.regionMismatches} responses ran outside the labelled region` });
  const verdict = gates.some((gate) => gate.pass === false) ? "fail" : gates.every((gate) => gate.pass) ? "pass" : "inconclusive";
  return { verdict, gates };
}

/**
 * Bounds the effect of an early miss that could be a silent cache GET failure or an eviction.
 * A verified miss writes back before the response, making its request start a conservative
 * upper age bound for subsequent samples. Never removes or reclassifies an observation.
 * @param {{ eligible: boolean, cache: unknown, startedMs: number, completedMs: number }[]} samples
 */
export function naturalHitUncertainty(samples, earlyAgeMs = 45_000) {
  let confirmedWriteStarted;
  let hits = 0, verified = 0, unexpectedMisses = 0;
  for (const sample of samples) {
    if (!sample.eligible) continue;
    verified++;
    if (sample.cache === "hit" || sample.cache === "stale") hits++;
    if (sample.cache === "miss") {
      if (confirmedWriteStarted !== undefined && sample.completedMs - confirmedWriteStarted < earlyAgeMs) {
        unexpectedMisses++;
      }
      confirmedWriteStarted = sample.startedMs;
    }
  }
  return {
    earlyAgeMs,
    unexpectedMisses,
    observedRate: verified ? hits / verified : null,
    optimisticRate: verified ? (hits + unexpectedMisses) / verified : null,
  };
}

/** Deterministic exponential gaps so both arms replay exactly the same natural sequence. */
export function naturalSchedule(/** @type {number} */ seed, /** @type {number} */ count, /** @type {number} */ meanGapMs, /** @type {number} */ maxGapMs) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => (index === 0 ? 0 : Math.min(maxGapMs, Math.round(-Math.log(1 - random()) * meanGapMs))));
}

/** Test-only cache namespace accepted by the Preview instrumentation: [a-z0-9-]{8,48}. */
export function namespace(/** @type {string} */ prefix) {
  const value = `${prefix}-${randomBytes(6).toString("hex")}`;
  if (!/^[a-z0-9-]{8,48}$/.test(value)) throw Error("Namespace prefix must be lowercase letters, digits or dashes");
  return value;
}

/** Same-locale room document path using the app's as-needed locale prefix. */
export function roomPath(/** @type {string} */ slug, /** @type {string} */ locale, defaultLocale = "en") {
  if (!/^[a-z0-9-]+$/.test(slug)) throw Error("--slug must be a public slug");
  return `${locale === defaultLocale ? "" : `/${locale}`}/rooms/${slug}?tour=1`;
}

function sha256(/** @type {string} */ value) {
  return createHash("sha256").update(value).digest("hex");
}
function round(/** @type {number} */ value) {
  return Math.round(value * 10) / 10;
}
function pct(/** @type {number | null} */ value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
