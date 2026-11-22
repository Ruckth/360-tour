#!/usr/bin/env node
/**
 * Sanitized, reproducible statistics for the phase 1 tour-entry benchmark.
 *
 * Inputs
 *   --runs <dir>     Run JSON files from tests/bench/tour-open-interaction.bench.ts (BENCH_OUT), one per
 *                    BENCH_BATCH named batch<B>-pair<P>-delay<ms>. Non-JSON files (private traces) are ignored.
 *   --control-only  Check a baseline with no deliberate image-delay arm.
 *   --spans <file>   Span JSON from scripts/local-bench-spans.mjs (BENCH_SPANS_OUT). Repeat for several harness runs.
 * Outputs
 *   --json <file>    Machine-readable report. --md <file> Markdown report (stdout when omitted).
 *
 *   node scripts/bench/tour-entry-report.mjs --runs output/tour-perf/runs \
 *     --spans output/tour-perf/spans.json --json output/tour-perf/report.json --md output/tour-perf/report.md
 *
 * Exit 0: valid (warnings allowed). 1: report written, but invalid or inconclusive. 2: unusable input, nothing written.
 * The output is a pure function of the input bytes: no clock, paths are relative, raw errors and URLs are dropped.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** @typedef {"direct" | "click" | "reopen"} Cohort */
/** @typedef {{level: "invalid" | "inconclusive" | "warning", code: string, message: string}} Issue */
/** @typedef {{n: number, median: number | null, p95: number | null, min: number | null, max: number | null}} Dist */
/**
 * @typedef {{
 *   runId: string, label: string, batch: number, pair: number, delayMs: number, cohort: Cohort, run: number,
 *   withheldMs: number, startedAt: number, cache: string, ssrRecovery: boolean, convexErrors: number,
 *   responseMs: number, dragToFrameMs: number, ttfbMs: number | null, serverHeaderMs: number | null,
 *   textureAcquisitionMs: number | null, roomsToFirstPanoramaRequestMs: number | null,
 *   segments: {stage: string, atMs: number, ms: number}[], beforeStart: string[], fallbacks: string[],
 *   panoramaNetworkMs: number, scriptNetworkMs: number, panoramaRequestsBeforeInput: number,
 *   panoramaCompletedBeforeInput: number, panoramaInFlightAtInput: number, warmPanoramaTransfers: number,
 *   ssrDurationMs: number | null, ssrTransportMs: number | null, ssrConnectionMs: number | null,
 *   convex: {function: string, cached: boolean, executionMs: number | null, handlerMs: number | null}[]
 * }} Sample
 * @typedef {{
 *   file: string, sha256: string, label: string, batch: number, pair: number, delayMs: number,
 *   count: number, cohorts: Cohort[], metadata: Record<string, unknown>, raw: any[],
 *   samples: Sample[], failures: {cohort: Cohort, run: number, error: string}[], startedAt: number
 * }} RunFile
 */

export const COHORTS = /** @type {const} */ (["direct", "click", "reopen"]);
export const CRITERIA = {
  noiseFraction: 0.05,
  minObservationsPerVariantCohort: 20,
  minBatches: 2,
  significance: 0.05,
  couplingToleranceFraction: 0.2,
  // texture_available fires when the panorama texture can be bound (fetched and handed to the renderer), not on GPU decode.
  predictedSpan: "texture_request_start → texture_available (texture acquisition)",
  coupling: "Both end-to-end and texture-acquisition paired median deltas are positive with sign test p < significance; " +
    "the acquisition delta is within couplingToleranceFraction of the delay actually imposed; " +
    "and the end-to-end delta is within the same tolerance of the acquisition delta.",
};
const LABEL = /^batch(\d+)-pair(\d+)-delay(\d+)$/;
const RUN_ID = /^(.+)-(\d+)-(direct|click|reopen)$/;
const STAGE = /^[a-z][a-z0-9_]{0,63}$/;
const PROFILE_KEYS = ["revision", "browser", "node", "platform", "arch", "width", "height", "dpr", "cpuFactor",
  "rttMs", "downMbps", "lockSha256", "assetSha256", "seed", "sceneSeedSha256"];
/** Compared across files like PROFILE_KEYS, but older run files may predate it. */
const OPTIONAL_PROFILE_KEYS = ["renderer", "frontend", "assetEncoding"];
const NEGATIVE_CONTROLS = /** @type {const} */ (["click", "reopen"]);
const FALLBACK_STAGES = ["rooms_timeout", "texture_load_failed"];
const SSR_CACHE = ["hit", "miss", "stale", "bypass"];
const LEVELS = ["warning", "inconclusive", "invalid"];

export class ReportInputError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super("Unusable benchmark input:\n- " + problems.join("\n- "));
    this.problems = problems;
  }
}

/** @param {number[]} values */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank: the smallest value with at least 95% of observations at or below it. @param {number[]} values */
export function nearestRankP95(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

/** Exact two-sided sign test; zero differences are dropped. @param {number[]} diffs */
export function signTestP(diffs) {
  const nonzero = diffs.filter((d) => d !== 0);
  const n = nonzero.length;
  if (!n) return null;
  const k = Math.min(nonzero.filter((d) => d > 0).length, nonzero.filter((d) => d < 0).length);
  let term = 1, tail = 0;
  for (let i = 0; i <= k; i++) {
    tail += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Total time covered by intervals clipped to [lo, hi], counting overlap once. @param {[number, number][]} intervals @param {number} lo @param {number} hi */
export function unionMs(intervals, lo, hi) {
  const clipped = intervals
    .map(([a, b]) => /** @type {[number, number]} */ ([Math.max(a, lo), Math.min(b, hi)]))
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of clipped) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/** @param {number} x */
const round1 = (x) => Math.round(x * 10) / 10;
/** @param {number | null} x */
const round = (x) => (x === null ? null : round1(x));
/** @param {number[]} values @returns {Dist} */
function dist(values) {
  return {
    n: values.length,
    median: round(median(values)),
    p95: round(nearestRankP95(values)),
    min: round(values.length ? Math.min(...values) : null),
    max: round(values.length ? Math.max(...values) : null),
  };
}
/** @param {unknown} x @returns {x is number} */
const num = (x) => typeof x === "number" && Number.isFinite(x);
/** @param {unknown} x @returns {x is number} */
const nonneg = (x) => num(x) && x >= 0;
/** @param {unknown} x @returns {x is Record<string, any>} */
const obj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
/** @param {number} a @param {number} b */
const relative = (a, b) => (b === 0 ? null : (a - b) / b);
/** @template T @param {T[]} xs @param {(x: T) => string} key */
function groupBy(xs, key) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  return groups;
}
/** @param {string} error */
function sanitizeError(error) {
  return error.split("\n")[0]
    .replace(/\b[a-z]+:\/\/\S+/gi, "<url>")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@-]+){2,}/g, "<path>")
    .slice(0, 160);
}

/**
 * @param {{file: string, text: string}} input
 * @param {string[]} problems
 * @returns {RunFile | null}
 */
function parseRunFile({ file, text }, problems) {
  const fail = (/** @type {string} */ message) => (problems.push(`${file}: ${message}`), null);
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("not valid JSON");
  }
  if (!obj(data) || !obj(data.metadata) || !Array.isArray(data.samples) || !Array.isArray(data.failures))
    return fail("not a tour-open-interaction run file (needs metadata, count, samples and failures)");
  if (!Number.isInteger(data.count) || data.count < 1) return fail("count must be a positive integer");
  for (const key of PROFILE_KEYS)
    if (!(typeof data.metadata[key] === "string" || num(data.metadata[key]))) return fail(`metadata.${key} is missing`);
  for (const key of OPTIONAL_PROFILE_KEYS)
    if (data.metadata[key] != null && typeof data.metadata[key] !== "string") return fail(`metadata.${key} must be a string`);

  const fromName = LABEL.exec(path.basename(file, ".json"))?.[0];
  const fromSamples = new Set(data.samples.map((/** @type {any} */ s) => RUN_ID.exec(String(s?.runId))?.[1]));
  if (fromSamples.size > 1) return fail("samples come from more than one BENCH_BATCH");
  const label = [...fromSamples][0] ?? fromName;
  const parts = label ? LABEL.exec(label) : null;
  if (!label || !parts) return fail("BENCH_BATCH must look like batch<B>-pair<P>-delay<ms>");
  if (fromName && fromName !== label) return fail(`file name says ${fromName} but samples say ${label}`);
  const [batch, pair, delayMs] = parts.slice(1).map(Number);

  const samples = [];
  for (const [i, s] of data.samples.entries()) {
    const at = `samples[${i}]`;
    const id = RUN_ID.exec(String(s?.runId));
    if (!obj(s) || !id || id[3] !== s.kind) return fail(`${at} has an invalid runId or kind`);
    const run = Number(id[2]);
    if (run < 1 || run > data.count) return fail(`${at} run ${run} is outside 1..${data.count}`);
    for (const key of ["withheldMs", "responseMs", "dragToFrameMs", "start", "ttfb", "gestureAt", "changedFrameAt", "timeOrigin"])
      if (!nonneg(s[key])) return fail(`${at}.${key} must be a non-negative number`);
    if (s.withheldMs !== (s.kind === "direct" ? delayMs : 0))
      return fail(`${at} withheld ${s.withheldMs} ms, but ${label} imposes ${delayMs} ms on direct entry only`);
    if (Math.abs(s.changedFrameAt - s.start - s.responseMs) > 1 || Math.abs(s.changedFrameAt - s.gestureAt - s.dragToFrameMs) > 1)
      return fail(`${at} timings are internally inconsistent`);
    if (!obj(s.stages) || !Object.entries(s.stages).every(([k, v]) => STAGE.test(k) && nonneg(v)))
      return fail(`${at}.stages must map stage names to timestamps`);
    if (![s.images, s.scripts, s.startedImages].every(Array.isArray) ||
        ![...s.images, ...s.scripts].every((r) => obj(r) && nonneg(r.start) && nonneg(r.end)) ||
        !s.startedImages.every((/** @type {any} */ r) => obj(r) && num(r.start)))
      return fail(`${at} has malformed resource timings`);
    if (s.routeCache !== null && typeof s.routeCache !== "string") return fail(`${at}.routeCache is malformed`);
    if (s.serverHeaderMs != null && !nonneg(s.serverHeaderMs)) return fail(`${at}.serverHeaderMs must be a non-negative number`);
    samples.push(s);
  }
  const failures = [];
  for (const [i, f] of data.failures.entries()) {
    if (!obj(f) || !COHORTS.includes(f.kind) || !Number.isInteger(f.run) || typeof f.error !== "string")
      return fail(`failures[${i}] is malformed`);
    failures.push({ cohort: /** @type {Cohort} */ (f.kind), run: f.run, error: sanitizeError(f.error) });
  }
  const ids = samples.map((s) => s.runId);
  if (new Set(ids).size !== ids.length) return fail("duplicate runId");
  const kinds = new Set([...samples.map((s) => s.kind), ...failures.map((f) => f.cohort)]);
  const cohorts = kinds.size === 1 && kinds.has("direct") ? ["direct"] : [...COHORTS];
  const startedAt = samples.length ? Math.min(...samples.map((s) => s.timeOrigin)) : Infinity;
  return {
    file, sha256: sha256(text), label, batch, pair, delayMs, count: data.count,
    cohorts: /** @type {Cohort[]} */ (cohorts), metadata: data.metadata, raw: samples, samples: [], failures, startedAt,
  };
}

/**
 * @param {{file: string, text: string}} input
 * @param {Map<string, any>} spans
 * @param {string[]} problems
 */
function parseSpanFile({ file, text }, spans, problems) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    problems.push(`${file}: not valid JSON`);
    return 0;
  }
  if (!obj(data) || data.version !== 1 || !Array.isArray(data.runs)) {
    problems.push(`${file}: not a version 1 local-bench-spans file`);
    return 0;
  }
  for (const run of data.runs) {
    const ok = obj(run) && typeof run.runId === "string" && Array.isArray(run.ssr) && Array.isArray(run.convex) &&
      run.ssr.every((/** @type {any} */ s) => obj(s) && SSR_CACHE.includes(s.cache) && nonneg(s.durationMs)) &&
      run.convex.every((/** @type {any} */ c) => obj(c) && typeof c.function === "string" && typeof c.cached === "boolean");
    if (!ok) problems.push(`${file}: malformed span run ${JSON.stringify(String(run?.runId)).slice(0, 80)}`);
    else if (spans.has(run.runId)) problems.push(`${file}: duplicate span run ${run.runId}`);
    else spans.set(run.runId, run);
  }
  return data.runs.length;
}

/**
 * @param {any} s raw sample @param {RunFile} f @param {any} span
 * @returns {Sample}
 */
function deriveSample(s, f, span) {
  const end = s.changedFrameAt;
  const network = panoramaRequests(s);
  /** @type {[string, number][]} */
  const marks = [...Object.entries(/** @type {Record<string, number>} */ (s.stages)),
    ["document_first_byte", s.ttfb], ["drag_started", s.gestureAt],
    ...(network.firstResponseEnd === null ? [] : [/** @type {[string, number]} */ (["first_panorama_response_end", network.firstResponseEnd])])];
  const inside = marks.filter(([, at]) => at > s.start && at <= end).sort((a, b) => a[1] - b[1]);
  // Partition [start, changed frame] at each observed milestone, so concurrent work is attributed once.
  const segments = [];
  let previous = s.start;
  for (const [stage, at] of [...inside, /** @type {[string, number]} */ (["changed_frame", end])]) {
    segments.push({ stage, atMs: at - s.start, ms: at - previous });
    previous = at;
  }
  const ssrStates = new Set(span.ssr.map((/** @type {any} */ x) => x.cache));
  const routeCache = typeof s.routeCache === "string" ? s.routeCache.toLowerCase() : "";
  const cache = ssrStates.size > 1 ? "mixed" : ssrStates.size === 1 ? `ssr-${[...ssrStates][0]}`
    : s.kind !== "direct" ? "no-ssr-call" : /^(hit|stale)$/.test(routeCache) ? `route-${routeCache}` : "unknown";
  const stage = /** @type {Record<string, number>} */ (s.stages);
  // Independent clocks within the document: a delivery/verification callback and CDP requestWillBeSent.
  // Keep negative gaps visible if a future implementation fetches before confirmation.
  const confirmations = [stage.rooms_update, stage.rooms_verified].filter(nonneg);
  const panoramaStarts = s.startedImages.map((/** @type {{start: number}} */ image) => image.start);
  const roomsToFirstPanoramaRequestMs = confirmations.length && panoramaStarts.length
    ? Math.min(...panoramaStarts) - Math.min(...confirmations) : null;
  const ssrDurations = span.ssr.map((/** @type {any} */ x) => x.durationMs);
  const ssrTransport = span.ssr.map((/** @type {any} */ x) => x.transportMs).filter(nonneg);
  const convex = span.convex.map((/** @type {any} */ c) => ({
    function: String(c.function), cached: c.cached, executionMs: nonneg(c.executionMs) ? c.executionMs : null,
    handlerMs: !c.cached && nonneg(c.handlerMs) ? c.handlerMs : null,
  }));
  // The SSR round trip minus the server-side completion it waited for is connection and transport, not database work.
  // Only attributable when the run has exactly one transport and exactly one getBySlug completion.
  const slugReads = convex.filter((/** @type {any} */ c) => c.function === "catalog/publicProperties:getBySlug");
  const ssrConnectionMs = ssrTransport.length === 1 && slugReads.length === 1 && slugReads[0].executionMs !== null
    ? Math.max(0, ssrTransport[0] - slugReads[0].executionMs) : null;
  return {
    runId: s.runId, label: f.label, batch: f.batch, pair: f.pair, delayMs: f.delayMs, cohort: s.kind,
    run: Number(RUN_ID.exec(s.runId)?.[2]), withheldMs: s.withheldMs, startedAt: s.timeOrigin, cache,
    ssrRecovery: span.ssr.some((/** @type {any} */ x) => x.recovery != null),
    convexErrors: span.convex.filter((/** @type {any} */ c) => c.outcome === "error").length,
    responseMs: s.responseMs, dragToFrameMs: s.dragToFrameMs,
    ttfbMs: s.ttfb > s.start ? s.ttfb - s.start : null,
    serverHeaderMs: nonneg(s.serverHeaderMs) ? s.serverHeaderMs : null,
    roomsToFirstPanoramaRequestMs,
    textureAcquisitionMs: nonneg(stage.texture_request_start) && nonneg(stage.texture_available)
      ? stage.texture_available - stage.texture_request_start : null,
    segments, beforeStart: marks.filter(([, at]) => at <= s.start).map(([name]) => name).sort(),
    fallbacks: FALLBACK_STAGES.filter((name) => name in stage),
    panoramaNetworkMs: unionMs(s.images.map((/** @type {any} */ r) => [r.start, r.end]), s.start, end),
    scriptNetworkMs: unionMs(s.scripts.map((/** @type {any} */ r) => [r.start, r.end]), s.start, end),
    panoramaRequestsBeforeInput: network.completedBeforeInput + network.inFlightAtInput,
    panoramaCompletedBeforeInput: network.completedBeforeInput, panoramaInFlightAtInput: network.inFlightAtInput,
    warmPanoramaTransfers: network.warm,
    ssrDurationMs: median(ssrDurations), ssrTransportMs: median(ssrTransport), ssrConnectionMs, convex,
  };
}

/**
 * Pair CDP request starts with Resource Timing entries (which exist only once a response ended) per path, in start
 * order, so repeated requests for one path stay separate. A started request with no entry is still in flight.
 * @param {{path: unknown, start: number, end: number, transferBytes?: unknown, encodedBytes?: unknown}[]} images
 * @param {{path: unknown, start: number}[]} started
 * @returns {{start: number, end: number | null, warm: boolean}[]}
 */
export function matchPanoramaRequests(images, started) {
  const requests = [];
  for (const p of new Set([...images, ...started].map((r) => String(r.path)))) {
    const begun = started.filter((r) => String(r.path) === p).map((r) => r.start).sort((a, b) => a - b);
    const done = images.filter((r) => String(r.path) === p).sort((a, b) => a.start - b.start || a.end - b.end);
    for (const r of done) {
      // The earliest unmatched start that precedes this response's end is the same request.
      const i = begun.findIndex((at) => at <= r.end);
      if (i >= 0) begun.splice(i, 1);
      requests.push({ start: r.start, end: r.end, warm: r.transferBytes === 0 && num(r.encodedBytes) && r.encodedBytes > 0 });
    }
    for (const at of begun) requests.push({ start: at, end: null, warm: false });
  }
  return requests.sort((a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
}

/** @param {any} s raw sample */
function panoramaRequests(s) {
  const requests = matchPanoramaRequests(s.images, s.startedImages);
  // Requests live during [start, input]; ones that finished before the measured interval began are excluded.
  const live = requests.filter((r) => r.start <= s.gestureAt && (r.end === null || r.end > s.start));
  const completedBeforeInput = live.filter((r) => r.end !== null && r.end <= s.gestureAt).length;
  const inWindow = requests.filter((r) => r.end !== null && r.end > s.start && r.end <= s.changedFrameAt);
  const warm = inWindow.filter((r) => r.warm).length;
  // A cache-served completion is not a network milestone, so the milestone is reported only without warm transfers.
  const ends = inWindow.map((r) => /** @type {number} */ (r.end));
  return {
    completedBeforeInput, inFlightAtInput: live.length - completedBeforeInput, warm,
    firstResponseEnd: !warm && ends.length ? Math.min(...ends) : null,
  };
}

/** @param {Sample[]} samples */
function criticalPath(samples) {
  const byStage = groupBy(samples.flatMap((s) => s.segments), (x) => x.stage);
  return [...byStage].map(([stage, xs]) => ({
    stage,
    present: xs.length,
    medianAtMs: round(median(xs.map((x) => x.atMs))),
    medianSegmentMs: round(median(xs.map((x) => x.ms))),
    p95SegmentMs: round(nearestRankP95(xs.map((x) => x.ms))),
  })).sort((a, b) => (a.medianAtMs ?? 0) - (b.medianAtMs ?? 0));
}

/** @param {Sample[]} samples */
function summarize(samples) {
  const caches = groupBy(samples, (s) => s.cache);
  const convex = groupBy(samples.flatMap((s) => s.convex), (c) => c.function);
  return {
    n: samples.length,
    responseMs: dist(samples.map((s) => s.responseMs)),
    dragToFrameMs: dist(samples.map((s) => s.dragToFrameMs)),
    ttfbMs: dist(samples.flatMap((s) => (s.ttfbMs === null ? [] : [s.ttfbMs]))),
    serverHeaderMs: dist(samples.flatMap((s) => (s.serverHeaderMs === null ? [] : [s.serverHeaderMs]))),
    roomsToFirstPanoramaRequestMs: dist(samples.flatMap((s) => s.roomsToFirstPanoramaRequestMs === null ? [] : [s.roomsToFirstPanoramaRequestMs])),
    textureAcquisitionMs: dist(samples.flatMap((s) => (s.textureAcquisitionMs === null ? [] : [s.textureAcquisitionMs]))),
    cache: Object.fromEntries([...caches].sort().map(([k, xs]) => [k, xs.length])),
    responseMsByCache: Object.fromEntries([...caches].sort().map(([k, xs]) => [k, dist(xs.map((s) => s.responseMs))])),
    criticalPath: criticalPath(samples),
    panoramaNetworkMs: dist(samples.map((s) => s.panoramaNetworkMs)),
    scriptNetworkMs: dist(samples.map((s) => s.scriptNetworkMs)),
    panoramaRequestsBeforeInput: dist(samples.map((s) => s.panoramaRequestsBeforeInput)),
    panoramaCompletedBeforeInput: dist(samples.map((s) => s.panoramaCompletedBeforeInput)),
    panoramaInFlightAtInput: dist(samples.map((s) => s.panoramaInFlightAtInput)),
    warmPanoramaTransfers: samples.reduce((n, s) => n + s.warmPanoramaTransfers, 0),
    ssrDurationMs: dist(samples.flatMap((s) => (s.ssrDurationMs === null ? [] : [s.ssrDurationMs]))),
    ssrTransportMs: dist(samples.flatMap((s) => (s.ssrTransportMs === null ? [] : [s.ssrTransportMs]))),
    ssrConnectionMs: dist(samples.flatMap((s) => (s.ssrConnectionMs === null ? [] : [s.ssrConnectionMs]))),
    convex: Object.fromEntries([...convex].sort().map(([fn, xs]) => {
      const ms = (/** @type {typeof xs} */ ys, /** @type {"executionMs" | "handlerMs"} */ k) =>
        dist(ys.flatMap((c) => (c[k] === null ? [] : [/** @type {number} */ (c[k])])));
      const fresh = xs.filter((c) => !c.cached), cached = xs.filter((c) => c.cached);
      return [fn, {
        completions: xs.length, cached: cached.length,
        completionMs: ms(fresh, "executionMs"), cachedCompletionMs: ms(cached, "executionMs"), handlerMs: ms(fresh, "handlerMs"),
      }];
    })),
  };
}

/** @param {number} delta @param {number} base */
function verdict(delta, base) {
  const r = relative(delta + base, base);
  return r === null ? "unknown" : r > CRITERIA.noiseFraction ? "slower" : r < -CRITERIA.noiseFraction ? "faster" : "unchanged";
}

/**
 * Build the report from file contents. Throws ReportInputError when the inputs cannot be compared at all.
 * @param {{runs: {file: string, text: string}[], spans: {file: string, text: string}[], command?: string, generatorSha256?: string, controlOnly?: boolean}} input
 */
export function buildReport({ runs, spans: spanInputs, command = "", generatorSha256 = "", controlOnly = false }) {
  /** @type {string[]} */
  const problems = [];
  if (!runs.length) problems.push("no run JSON files found");
  if (!spanInputs.length) problems.push("no span file given (BENCH_SPANS_OUT); cache state cannot be established");
  const files = /** @type {RunFile[]} */ (runs.map((r) => parseRunFile(r, problems)).filter(Boolean));
  /** @type {Map<string, any>} */
  const spans = new Map();
  const spanSummary = spanInputs.map((s) => ({ file: s.file, sha256: sha256(s.text), runs: parseSpanFile(s, spans, problems) }));
  if (controlOnly && files.some((file) => file.delayMs > 0)) {
    problems.push("--control-only cannot include delayed candidate run files");
  }
  if (problems.length) throw new ReportInputError(problems);

  for (const [label, xs] of groupBy(files, (f) => f.label)) if (xs.length > 1) problems.push(`${label} appears in ${xs.map((f) => f.file).join(", ")}`);
  const profileKeys = [...PROFILE_KEYS, ...OPTIONAL_PROFILE_KEYS];
  const profile = Object.fromEntries(profileKeys.map((k) => [k, files[0].metadata[k] ?? null]));
  for (const f of files) {
    const differing = profileKeys.filter((k) => (f.metadata[k] ?? null) !== profile[k]);
    if (differing.length) problems.push(`${f.file}: ${differing.join(", ")} differ from ${files[0].file}; compare runs from one build, fixture and profile`);
  }
  const expectedSpanIds = new Set(files.flatMap((f) => [
    ...f.raw.map((s) => s.runId), ...f.failures.map((x) => `${f.label}-${x.run}-${x.cohort}`)]));
  for (const id of spans.keys()) if (!expectedSpanIds.has(id)) problems.push(`span run ${id} matches no run file sample (wrong span file?)`);
  /** @type {Sample[]} */
  const samples = [];
  for (const f of files) {
    for (const s of f.raw) {
      const span = spans.get(s.runId);
      if (!span) {
        problems.push(`${f.file}: no span run for ${s.runId}`);
        continue;
      }
      const derived = deriveSample(s, f, span);
      if (derived.cache === "unknown") problems.push(`${f.file}: no cache data for ${s.runId} (no SSR span and no x-nextjs-cache HIT/STALE)`);
      samples.push(derived);
    }
    f.samples = samples.filter((s) => s.label === f.label);
  }
  if (problems.length) throw new ReportInputError(problems);

  /** @type {Issue[]} */
  const issues = [];
  const issue = (/** @type {Issue["level"]} */ level, /** @type {string} */ code, /** @type {string} */ message) => issues.push({ level, code, message });
  if (typeof profile.renderer !== "string" || !/swiftshader/i.test(profile.renderer))
    issue("inconclusive", "unverified-renderer", "the measured renderer must identify SwiftShader for the fixed mobile profile");
  if (samples.some((s) => s.cohort === "direct" && s.serverHeaderMs === null))
    issue("inconclusive", "server-header-unrecorded", "some direct samples lack native server request-to-response-headers duration");
  for (const f of files) {
    const missing = COHORTS.filter((c) => !f.cohorts.includes(c));
    if (missing.length) issue("invalid", "missing-cohort", `${f.label} has no ${missing.join(" or ")} runs; every file needs the full ${COHORTS.join("/")} matrix, whose undelayed cohorts are the negative controls`);
    const expected = f.count * f.cohorts.length;
    if (f.failures.length) issue("invalid", "failed-open", `${f.label}: ${f.failures.length} failed open(s): ${f.failures.map((x) => `run ${x.run} ${x.cohort}: ${x.error}`).join("; ")}`);
    if (f.samples.length !== expected) issue("invalid", "incomplete", `${f.label}: ${f.samples.length} of ${expected} samples`);
  }
  for (const s of samples) {
    if (s.fallbacks.length) issue("invalid", "fallback-path", `${s.runId} reached ${s.fallbacks.join(", ")}`);
    if (s.ssrRecovery) issue("invalid", "ssr-recovery", `${s.runId} served SSR from backoff/read-error recovery`);
    if (s.convexErrors) issue("invalid", "convex-error", `${s.runId} recorded ${s.convexErrors} failed Convex completion(s)`);
  }

  const order = [...files].sort((a, b) => a.startedAt - b.startedAt || a.label.localeCompare(b.label));
  const variants = [...groupBy(samples, (s) => `${s.delayMs}|${s.cohort}`)].map(([, xs]) => ({
    variant: xs[0].delayMs === 0 ? "control" : `delay${xs[0].delayMs}`,
    delayMs: xs[0].delayMs,
    cohort: xs[0].cohort,
    batches: [...new Set(xs.map((s) => s.batch))].sort((a, b) => a - b),
    failures: files.filter((f) => f.delayMs === xs[0].delayMs).flatMap((f) => f.failures).filter((x) => x.cohort === xs[0].cohort).length,
    ...summarize(xs),
  })).sort((a, b) => a.delayMs - b.delayMs || COHORTS.indexOf(a.cohort) - COHORTS.indexOf(b.cohort));
  for (const delayMs of new Set(files.map((f) => f.delayMs)))
    for (const cohort of COHORTS)
      if (!variants.some((v) => v.delayMs === delayMs && v.cohort === cohort))
        issue("invalid", "missing-cohort", `${delayMs === 0 ? "control" : `delay${delayMs}`} ${cohort}: no observations`);
  for (const v of variants) {
    if (v.n < CRITERIA.minObservationsPerVariantCohort || v.batches.length < CRITERIA.minBatches)
      issue("inconclusive", "underpowered", `${v.variant} ${v.cohort}: ${v.n} observations in ${v.batches.length} batch(es); need ${CRITERIA.minObservationsPerVariantCohort} across ${CRITERIA.minBatches}`);
  }

  const batches = files.flatMap((f) => f.cohorts.map((cohort) => {
    const xs = f.samples.filter((s) => s.cohort === cohort);
    return {
      label: f.label, batch: f.batch, pair: f.pair, delayMs: f.delayMs, cohort, order: order.indexOf(f) + 1,
      expected: f.count, failures: f.failures.filter((x) => x.cohort === cohort).length,
      n: xs.length, responseMs: dist(xs.map((s) => s.responseMs)), dragToFrameMs: dist(xs.map((s) => s.dragToFrameMs)),
      cache: Object.fromEntries([...groupBy(xs, (s) => s.cache)].sort().map(([k, ys]) => [k, ys.length])),
    };
  })).sort((a, b) => a.batch - b.batch || a.pair - b.pair || a.delayMs - b.delayMs || COHORTS.indexOf(a.cohort) - COHORTS.indexOf(b.cohort));

  // Control noise: repeated control medians on the same setup, per cohort, across batches.
  const controls = samples.filter((s) => s.delayMs === 0);
  const noise = COHORTS.filter((c) => controls.some((s) => s.cohort === c)).map((cohort) => {
    const xs = controls.filter((s) => s.cohort === cohort);
    const byBatch = [...groupBy(xs, (s) => String(s.batch))].map(([, ys]) => ({
      batch: ys[0].batch, n: ys.length, medianMs: round(median(ys.map((s) => s.responseMs))),
      p95Ms: round(nearestRankP95(ys.map((s) => s.responseMs))),
    })).sort((a, b) => a.batch - b.batch);
    const medians = byBatch.map((b) => b.medianMs ?? 0);
    const spread = byBatch.length > 1 ? (Math.max(...medians) - Math.min(...medians)) / Math.min(...medians) : null;
    const seen = /** @type {number[]} */ ([]);
    const convergence = order.filter((f) => f.delayMs === 0).map((f) => {
      seen.push(...f.samples.filter((s) => s.cohort === cohort).map((s) => s.responseMs));
      return { after: f.label, n: seen.length, medianMs: round(median(seen)) };
    });
    if (spread === null) issue("inconclusive", "noise-unmeasured", `control ${cohort}: only one batch, so control noise is unmeasured`);
    else if (spread > CRITERIA.noiseFraction) issue("inconclusive", "noisy-control", `control ${cohort}: batch medians differ by ${(spread * 100).toFixed(1)}% (> ${CRITERIA.noiseFraction * 100}%); rerun matched batches`);
    return { cohort, byBatch, spreadFraction: spread === null ? null : Math.round(spread * 1000) / 1000, convergence };
  });

  // Paired intervention: same batch and pair, control vs delayed run file, matched by run index.
  const pairs = groupBy(files, (f) => `${f.batch}|${f.pair}`);
  for (const [, xs] of pairs) {
    const label = `batch${xs[0].batch}-pair${xs[0].pair}`;
    if (!xs.some((f) => f.delayMs === 0)) issue("invalid", "missing-control", `${label} has no delay0 control`);
    if (!controlOnly && !xs.some((f) => f.delayMs > 0)) issue("inconclusive", "missing-candidate", `${label} has no delayed candidate`);
    if (xs.length > 2) issue("invalid", "unbalanced-pair", `${label} has ${xs.length} run files; use one control and one candidate per pair`);
  }
  const intervention = [...new Set(files.map((f) => f.delayMs).filter((d) => d > 0))].sort((a, b) => a - b).map((delayMs) => {
    /** @type {{batch: number, pair: number, order: string, cohort: Cohort, total: number, imposed: number, acquisition: number | null}[]} */
    const diffs = [];
    const pairRows = [];
    for (const [, xs] of pairs) {
      const control = xs.find((f) => f.delayMs === 0);
      const candidate = xs.find((f) => f.delayMs === delayMs);
      if (!control || !candidate) continue;
      const pairOrder = control.startedAt <= candidate.startedAt ? "control-first" : "candidate-first";
      for (const cohort of candidate.cohorts) {
        const left = control.samples.filter((s) => s.cohort === cohort), right = candidate.samples.filter((s) => s.cohort === cohort);
        if (left.length !== right.length) issue("invalid", "unbalanced-pair", `batch${control.batch}-pair${control.pair} ${cohort}: ${left.length} control vs ${right.length} candidate samples`);
        for (const r of right) {
          const l = left.find((s) => s.run === r.run);
          if (l) diffs.push({ batch: r.batch, pair: r.pair, order: pairOrder, cohort, total: r.responseMs - l.responseMs,
            imposed: r.withheldMs - l.withheldMs,
            acquisition: r.textureAcquisitionMs !== null && l.textureAcquisitionMs !== null ? r.textureAcquisitionMs - l.textureAcquisitionMs : null });
        }
        const direct = diffs.filter((d) => d.cohort === "direct" && d.batch === control.batch && d.pair === control.pair);
        if (cohort === "direct") pairRows.push({ batch: control.batch, pair: control.pair, order: pairOrder, matched: direct.length,
          medianDeltaMs: round(median(direct.map((d) => d.total))),
          medianAcquisitionDeltaMs: round(median(direct.flatMap((d) => (d.acquisition === null ? [] : [d.acquisition])))) });
      }
    }
    const direct = diffs.filter((d) => d.cohort === "direct");
    const totals = direct.map((d) => d.total), acquisitions = direct.flatMap((d) => (d.acquisition === null ? [] : [d.acquisition]));
    const dTotal = median(totals), dAcq = median(acquisitions), imposed = median(direct.map((d) => d.imposed));
    const pTotal = signTestP(totals), pAcq = signTestP(acquisitions);
    const tolerance = imposed === null ? null : CRITERIA.couplingToleranceFraction * imposed;
    const slower = (/** @type {number | null} */ d, /** @type {number | null} */ p) => d !== null && d > 0 && p !== null && p < CRITERIA.significance;
    const near = (/** @type {number | null} */ a, /** @type {number | null} */ b) => a !== null && b !== null && tolerance !== null && Math.abs(a - b) <= tolerance;
    const checks = {
      endToEndSlower: slower(dTotal, pTotal),
      acquisitionSlower: slower(dAcq, pAcq),
      acquisitionMatchesImposedDelay: imposed !== null && imposed > 0 && near(dAcq, imposed),
      endToEndMatchesAcquisition: near(dTotal, dAcq),
    };
    const coupled = Object.values(checks).every(Boolean);
    const negativeControls = NEGATIVE_CONTROLS.map((cohort) => {
      const xs = diffs.filter((d) => d.cohort === cohort).map((d) => d.total);
      if (!xs.length) issue("invalid", "missing-negative-control", `delay${delayMs}: no matched undelayed ${cohort} runs, so a run-wide shift cannot be ruled out`);
      const base = median(controls.filter((s) => s.cohort === cohort).map((s) => s.responseMs));
      const dx = median(xs);
      const drift = base && dx !== null ? dx / base : null;
      if (drift !== null && Math.abs(drift) > CRITERIA.noiseFraction) issue("inconclusive", "negative-control-drift", `delay${delayMs} files moved undelayed ${cohort} by ${(drift * 100).toFixed(1)}% of its control median`);
      return { cohort, matched: xs.length, medianDeltaMs: round(median(xs)), driftFraction: drift === null ? null : Math.round(drift * 1000) / 1000, signTestP: pValue(signTestP(xs)) };
    });
    // Per-batch verdicts on the delayed cohort; a verdict that flips across batches is inconclusive.
    const byBatch = [...groupBy(samples.filter((s) => s.cohort === "direct" && (s.delayMs === 0 || s.delayMs === delayMs)), (s) => String(s.batch))].map(([, xs]) => {
      const c = xs.filter((s) => s.delayMs === 0).map((s) => s.responseMs), t = xs.filter((s) => s.delayMs === delayMs).map((s) => s.responseMs);
      const [cm, tm, cp, tp] = [median(c), median(t), nearestRankP95(c), nearestRankP95(t)];
      return { batch: xs[0].batch, controlMedianMs: round(cm), candidateMedianMs: round(tm), controlP95Ms: round(cp), candidateP95Ms: round(tp),
        medianVerdict: cm === null || tm === null ? "unknown" : verdict(tm - cm, cm), p95Verdict: cp === null || tp === null ? "unknown" : verdict(tp - cp, cp) };
    }).sort((a, b) => a.batch - b.batch);
    for (const key of /** @type {const} */ (["medianVerdict", "p95Verdict"]))
      if (new Set(byBatch.map((b) => b[key])).size > 1) issue("inconclusive", "verdict-flip", `delay${delayMs} direct ${key.replace("Verdict", "")} verdict differs across batches (${byBatch.map((b) => b[key]).join(" vs ")}); expand to 50 paired observations per batch`);
    const orders = new Set(pairRows.map((p) => p.order));
    if (orders.size < 2) issue("inconclusive", "order-not-alternated", `delay${delayMs}: every pair ran ${[...orders][0] ?? "unpaired"}; alternate order to rule out drift`);
    const cacheImbalance = ["control", "candidate"].map((side) => JSON.stringify(Object.fromEntries([...groupBy(samples.filter((s) => s.cohort === "direct" && s.delayMs === (side === "control" ? 0 : delayMs)), (s) => s.cache)].sort().map(([k, xs]) => [k, xs.length]))));
    if (cacheImbalance[0] !== cacheImbalance[1]) issue("warning", "cache-imbalance", `delay${delayMs} direct server cache states differ: control ${cacheImbalance[0]} vs candidate ${cacheImbalance[1]}`);
    return {
      delayMs, predictedSpan: CRITERIA.predictedSpan, pairs: pairRows.sort((a, b) => a.batch - b.batch || a.pair - b.pair),
      direct: {
        matched: totals.length, medianDeltaMs: round(dTotal), minDeltaMs: round(totals.length ? Math.min(...totals) : null),
        maxDeltaMs: round(totals.length ? Math.max(...totals) : null), positive: totals.filter((d) => d > 0).length,
        signTestP: pValue(pTotal), imposedDelayMs: round(imposed), toleranceMs: round(tolerance),
        transmission: dTotal === null || !imposed ? null : round4(dTotal / imposed),
        acquisitionMatched: acquisitions.length, medianAcquisitionDeltaMs: round(dAcq), acquisitionSignTestP: pValue(pAcq),
        acquisitionTransmission: dAcq === null || !imposed ? null : round4(dAcq / imposed), checks, coupled,
      },
      negativeControls, byBatch,
    };
  });
  if (!controlOnly && !intervention.length) issue("inconclusive", "no-intervention", "no delayed candidate run files; causal attribution is untested");
  for (const i of intervention) if (!i.direct.coupled)
    issue("inconclusive", "not-coupled", `delay${i.delayMs}: texture acquisition and end-to-end time not shown to move with the imposed delay (failed: ${Object.entries(i.direct.checks).filter(([, ok]) => !ok).map(([k]) => k).join(", ")})`);

  const unique = [...new Map(issues.map((x) => [`${x.level}|${x.code}|${x.message}`, x])).values()]
    .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  const worst = unique.reduce((w, x) => Math.max(w, LEVELS.indexOf(x.level)), 0);
  return {
    schema: "tour-entry-report/v2",
    status: unique.some((x) => x.level !== "warning") ? LEVELS[worst] : "valid",
    command, generatorSha256, controlOnly, criteria: CRITERIA, profile,
    inputs: {
      runs: order.map((f) => ({ file: f.file, sha256: f.sha256, label: f.label, order: order.indexOf(f) + 1, count: f.count, cohorts: f.cohorts, samples: f.samples.length, failures: f.failures.length })),
      spans: spanSummary,
    },
    issues: unique, variants, batches, intervention, noise,
    samples: samples.sort((a, b) => a.runId.localeCompare(b.runId, "en", { numeric: true })).map((s) => ({
      runId: s.runId, cohort: s.cohort, withheldMs: s.withheldMs, cache: s.cache, responseMs: round1(s.responseMs),
      dragToFrameMs: round1(s.dragToFrameMs), ttfbMs: round(s.ttfbMs), serverHeaderMs: round(s.serverHeaderMs),
      roomsToFirstPanoramaRequestMs: round(s.roomsToFirstPanoramaRequestMs),
      textureAcquisitionMs: round(s.textureAcquisitionMs), ssrConnectionMs: round(s.ssrConnectionMs),
      panoramaRequestsBeforeInput: s.panoramaRequestsBeforeInput, panoramaCompletedBeforeInput: s.panoramaCompletedBeforeInput,
      panoramaInFlightAtInput: s.panoramaInFlightAtInput, warmPanoramaTransfers: s.warmPanoramaTransfers, beforeStart: s.beforeStart,
      segments: s.segments.map((x) => ({ stage: x.stage, atMs: round1(x.atMs), ms: round1(x.ms) })),
    })),
  };
}
/** @param {number | null} x */
const round4 = (x) => (x === null ? null : Math.round(x * 10000) / 10000);
/** Three significant digits, so small p-values stay visible. @param {number | null} p */
const pValue = (p) => (p === null ? null : Number(p.toPrecision(3)));

/** @param {ReturnType<typeof buildReport>} r */
export function renderMarkdown(r) {
  const f = (/** @type {number | null | undefined} */ x) => (x === null || x === undefined ? "–" : x.toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const row = (/** @type {unknown[]} */ cells) => `| ${cells.join(" | ")} |`;
  const table = (/** @type {string[]} */ head, /** @type {unknown[][]} */ rows) =>
    [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
  const cache = (/** @type {Record<string, number>} */ c) => Object.entries(c).map(([k, n]) => `${k} ${n}`).join(", ");
  const out = [
    `# Tour entry benchmark report`,
    ``,
    `**Status: ${r.status}.** Generated by \`${r.command}\` (generator sha256 \`${r.generatorSha256.slice(0, 12)}\`).`,
    ``,
    `Revision \`${r.profile.revision}\`, ${r.profile.browser}, renderer ${r.profile.renderer ?? "unrecorded"}, Node ${r.profile.node}, ${r.profile.platform}/${r.profile.arch}. ` +
      `${r.profile.width}×${r.profile.height} DPR ${r.profile.dpr}, CPU ${r.profile.cpuFactor}×, ${r.profile.downMbps} Mbps down, ${r.profile.rttMs} ms RTT. ` +
      `Seed ${r.profile.seed}; lock \`${String(r.profile.lockSha256).slice(0, 12)}\`, asset \`${String(r.profile.assetSha256).slice(0, 12)}\`, scene seed \`${String(r.profile.sceneSeedSha256).slice(0, 12)}\`.`,
    ``,
    `## Issues`,
    ``,
    r.issues.length ? r.issues.map((x) => `- **${x.level}** \`${x.code}\`: ${x.message}`).join("\n") : "None.",
    ``,
    `## Variants (all batches pooled)`,
    ``,
    `Navigation or trusted click to the first rendered frame with a changed camera after a trusted drag. Median; nearest-rank p95.`,
    ``,
    table(["Variant", "Cohort", "n", "Failures", "Median ms", "p95 ms", "Drag→frame median", "Drag→frame p95", "Texture acquisition median", "Server cache"],
      r.variants.map((v) => [v.variant, v.cohort, v.n, v.failures, f(v.responseMs.median), f(v.responseMs.p95),
        f(v.dragToFrameMs.median), f(v.dragToFrameMs.p95), f(v.textureAcquisitionMs.median), cache(v.cache)])),
    ``,
    `## Server timing: native request vs data layer`,
    ``,
    `The document's Server-Timing header reports elapsed time on the server from receipt of the request to response headers (\`serverHeaderMs\`). ` +
      `Data layer: the SSR villa read (getVilla) inside that response; its Convex round trip splits into connection/transport ` +
      `(round trip − server completion) and server completion, whose uncached handler time covers query and database work.`,
    ``,
    table(["Variant", "Cohort", "Native req→headers median", "SSR read median", "SSR round trip median", "Connection/transport median", "Convex completions"],
      r.variants.map((v) => [v.variant, v.cohort, f(v.serverHeaderMs.median), f(v.ssrDurationMs.median), f(v.ssrTransportMs.median),
        f(v.ssrConnectionMs.median), Object.entries(v.convex).map(([fn, c]) =>
          `${fn}: ${c.completions - c.cached} fresh ${f(c.completionMs.median)} ms (handler ${f(c.handlerMs.median)} ms), ${c.cached} cached ${f(c.cachedCompletionMs.median)} ms`).join("; ") || "–"])),
    ``,
    `## Server cache: miss vs hit`,
    ``,
    table(["Variant", "Cohort", "Server cache", "n", "Median ms", "p95 ms"],
      r.variants.flatMap((v) => Object.entries(v.responseMsByCache).map(([state, d]) => [v.variant, v.cohort, state, d.n, f(d.median), f(d.p95)]))),
    ``,
    `## Paired intervention`,
    ``,
    r.intervention.length ? r.intervention.map((i) => [
      `**${i.delayMs} ms withheld from the first panorama request (direct entry).** Predicted span: ${i.predictedSpan}. ` +
        `Paired by batch, pair and run index (${i.direct.matched} pairs, imposed Δ median ${f(i.direct.imposedDelayMs)} ms, tolerance ±${f(i.direct.toleranceMs)} ms). ` +
        `End-to-end Δ median ${f(i.direct.medianDeltaMs)} ms ` +
        `(range ${f(i.direct.minDeltaMs)} to ${f(i.direct.maxDeltaMs)}, ${i.direct.positive}/${i.direct.matched} slower, sign test p=${i.direct.signTestP ?? "–"}), ` +
        `transmission ${i.direct.transmission ?? "–"} of the imposed delay. Texture acquisition Δ median ${f(i.direct.medianAcquisitionDeltaMs)} ms ` +
        `(${i.direct.acquisitionMatched} pairs, p=${i.direct.acquisitionSignTestP ?? "–"}, transmission ${i.direct.acquisitionTransmission ?? "–"}). ` +
        `Checks: ${Object.entries(i.direct.checks).map(([k, ok]) => `${k} ${ok ? "✓" : "✗"}`).join(", ")}. ` +
        `**${i.direct.coupled ? "Texture acquisition and end-to-end time moved with the imposed delay." : "Not shown to move with the imposed delay."}**`,
      ``,
      table(["Pair", "Order", "Matched", "Δ end-to-end median", "Δ acquisition median"],
        i.pairs.map((p) => [`batch${p.batch}-pair${p.pair}`, p.order, p.matched, f(p.medianDeltaMs), f(p.medianAcquisitionDeltaMs)])),
      ``,
      table(["Batch", "Control median", "Candidate median", "Median verdict", "Control p95", "Candidate p95", "p95 verdict"],
        i.byBatch.map((b) => [b.batch, f(b.controlMedianMs), f(b.candidateMedianMs), b.medianVerdict, f(b.controlP95Ms), f(b.candidateP95Ms), b.p95Verdict])),
      ``,
      i.negativeControls.length ? `Negative controls (undelayed cohorts in the same files): ` +
        i.negativeControls.map((n) => `${n.cohort} Δ median ${f(n.medianDeltaMs)} ms (${n.driftFraction === null ? "–" : (n.driftFraction * 100).toFixed(1) + "%"} of control, p=${n.signTestP ?? "–"})`).join("; ") + "." : "",
    ].join("\n")).join("\n\n") : r.controlOnly ? "Control-only baseline. No causal intervention was run." : "No delayed candidate runs.",
    ``,
    `## Control noise and convergence`,
    ``,
    table(["Cohort", "Control median by batch", "Spread", "Cumulative median in run order"],
      r.noise.map((n) => [n.cohort, n.byBatch.map((b) => `batch${b.batch}: ${f(b.medianMs)} (n=${b.n})`).join(", "),
        n.spreadFraction === null ? "–" : `${(n.spreadFraction * 100).toFixed(1)}%`, n.convergence.map((c) => `${f(c.medianMs)} (n=${c.n})`).join(" → ")])),
    ``,
    `## Run files`,
    ``,
    table(["Order", "BENCH_BATCH", "Cohort", "n / expected", "Failures", "Median ms", "p95 ms", "Server cache"],
      r.batches.map((b) => [r.inputs.runs.find((x) => x.label === b.label)?.order ?? "–", b.label, b.cohort, `${b.n} / ${b.expected}`, b.failures,
        f(b.responseMs.median), f(b.responseMs.p95), cache(b.cache)])),
    ``,
    `## Critical path`,
    ``,
    `Each run's interval is partitioned at its observed milestones, so overlapping work is attributed once to the milestone that ended the wait. ` +
      `Medians of segments need not sum to the median total. \`drag_started\` includes harness wait between scene readiness and the automated drag. ` +
      `\`first_panorama_response_end\` is the first panorama response end in the interval, omitted from a run with any cache-served (warm) panorama transfer. ` +
      `\`texture_available\` marks texture acquisition (fetched and handed to the renderer), not GPU decode.`,
    ``,
    ...r.variants.flatMap((v) => [
      `**${v.variant} · ${v.cohort}** (panorama network busy ${f(v.panoramaNetworkMs.median)} ms, script network ${f(v.scriptNetworkMs.median)} ms; ` +
        `panorama requests before input: ${f(v.panoramaRequestsBeforeInput.median)} total, ${f(v.panoramaCompletedBeforeInput.median)} completed, ` +
        `${f(v.panoramaInFlightAtInput.median)} still in flight; ${v.warmPanoramaTransfers} warm panorama transfer(s))`,
      ``,
      table(["Ended by", "Present", "Median at ms", "Median segment ms", "p95 segment ms"],
        v.criticalPath.map((c) => [c.stage, `${c.present}/${v.n}`, f(c.medianAtMs), f(c.medianSegmentMs), f(c.p95SegmentMs)])),
      ``,
    ]),
    `## Inputs`,
    ``,
    ...r.inputs.runs.map((x) => `- \`${x.file}\` ${x.label}: ${x.samples} samples, ${x.failures} failures, sha256 \`${x.sha256}\``),
    ...r.inputs.spans.map((x) => `- \`${x.file}\` spans: ${x.runs} runs, sha256 \`${x.sha256}\``),
    ``,
    `Criteria: noise > ${r.criteria.noiseFraction * 100}% between repeated control medians is inconclusive; ` +
      `≥ ${r.criteria.minObservationsPerVariantCohort} observations per variant and cohort across ≥ ${r.criteria.minBatches} batches; ` +
      `missing click or reopen negative controls are invalid; coupling (tolerance ${r.criteria.couplingToleranceFraction * 100}% of the imposed delay): ${r.criteria.coupling} ` +
      `Raw per-run samples are in the JSON report.`,
    ``,
  ];
  return out.join("\n");
}

/** @param {string[]} argv @param {string} cwd */
export function main(argv, cwd = process.cwd()) {
  const { values } = parseArgs({ args: argv, options: {
    "control-only": { type: "boolean" },
    runs: { type: "string" }, spans: { type: "string", multiple: true }, json: { type: "string" }, md: { type: "string" },
  } });
  if (!values.runs) throw new ReportInputError(["--runs <dir> is required"]);
  const rel = (/** @type {string} */ p) => path.relative(cwd, path.resolve(cwd, p)) || ".";
  const dir = path.resolve(cwd, values.runs);
  const spanPaths = (values.spans ?? []).map((p) => path.resolve(cwd, p));
  const runs = readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
    .map((name) => path.join(dir, name)).filter((p) => !spanPaths.includes(p))
    .map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));
  const spans = spanPaths.map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));
  const command = ["node scripts/bench/tour-entry-report.mjs", ...(values["control-only"] ? ["--control-only"] : []), `--runs ${rel(dir)}`, ...spanPaths.map((p) => `--spans ${rel(p)}`),
    ...(values.json ? [`--json ${rel(values.json)}`] : []), ...(values.md ? [`--md ${rel(values.md)}`] : [])].join(" ");
  const report = buildReport({ runs, spans, command, controlOnly: values["control-only"], generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url), "utf8")) });
  const markdown = renderMarkdown(report);
  if (values.json) writeFileSync(path.resolve(cwd, values.json), JSON.stringify(report, null, 2) + "\n");
  if (values.md) writeFileSync(path.resolve(cwd, values.md), markdown);
  else process.stdout.write(markdown);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = main(process.argv.slice(2));
    if (report.status !== "valid") console.error(`Report status: ${report.status} (${report.issues.filter((x) => x.level !== "warning").length} issue(s))`);
    process.exitCode = report.status === "valid" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
