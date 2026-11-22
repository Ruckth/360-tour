#!/usr/bin/env node
// Operator-run room Preview parity comparator (docs/plans/tanstack-bun-performance.html, phase 2).
//
//   node scripts/bench/room-preview-parity.mjs --control dpl_A --candidate dpl_B \
//     --scope <team> --region iad1 [--slug pool-villa --locale en] [--preflight-only]
//
// Both arms must be immutable, READY, non-production deployments of one project, in the same
// region, with the Preview-only villa cache instrumentation:
//   response X-Villa-Cache: hit|stale|miss|bypass|unconfirmed|recovery   (set from whether the detail read ran)
//   request  X-Villa-Bench-Namespace: [a-z0-9-]{8,48} (added to the detail cache key)
//   response X-Villa-Cache-Namespace: <echo>
// Controlled hits prime a fresh namespace and are measured while its entry is younger than
// --fresh-hit-ms; each controlled miss uses a new namespace. The natural replay sends one seeded
// schedule to both arms with a fresh per-arm namespace, counting hit and stale as cache hits.
// Edge cache headers (x-vercel-cache) never classify a sample; edge-served responses are rejected.
//
// Auth: `vercel curl` with the operator's CLI login (default), or --transport bypass, which reads
// VERCEL_PROTECTION_BYPASS from the environment and hands it to curl on stdin. Neither the secret,
// raw headers, HTML, request ids nor namespaces are written to the report.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CLASSES, MARKER, documentFacts, edgeServed, evaluateGates, factMismatches, linkAlternates, namespace,
  naturalHitUncertainty, naturalSchedule, parseCurlOutput, rejectReason, roomCacheObservation, roomCandidateFacts, roomPath, roomPreviewCookies, summarize, textDiff, vercelRegions,
} from "./room-preview-lib.mjs";

const { values: args } = parseArgs({
  options: {
    control: { type: "string" },
    candidate: { type: "string" },
    scope: { type: "string" },
    region: { type: "string" },
    slug: { type: "string", default: "pool-villa" },
    locale: { type: "string", default: "en" },
    samples: { type: "string", default: "100" },
    "cadence-ms": { type: "string", default: "1000" },
    "fresh-hit-ms": { type: "string", default: "40000" },
    "natural-requests": { type: "string", default: "100" },
    "natural-mean-gap-ms": { type: "string", default: "20000" },
    "natural-max-gap-ms": { type: "string", default: "90000" },
    "natural-seed": { type: "string", default: "20261122" },
    "skip-natural": { type: "boolean", default: false },
    "natural-only": { type: "boolean", default: false },
    "canonical-origin": { type: "string" },
    "require-shared-candidate": { type: "boolean", default: false },
    "cache-header": { type: "string", default: "x-villa-cache" },
    "namespace-header": { type: "string", default: "x-villa-bench-namespace" },
    "namespace-echo-header": { type: "string", default: "x-villa-cache-namespace" },
    "ignore-text": { type: "string", multiple: true, default: [] },
    transport: { type: "string", default: "vercel" },
    vercel: { type: "string", default: process.env.VERCEL_BIN ?? "vercel" },
    out: { type: "string", default: "output/tour-perf/room-preview" },
    "preflight-only": { type: "boolean", default: false },
  },
});

const int = (/** @type {string} */ name, min = 1) => {
  const value = Number(args[/** @type {keyof typeof args} */ (name)]);
  if (!Number.isSafeInteger(value) || value < min) throw Error(`--${name} must be an integer ≥ ${min}`);
  return value;
};
if (!args.control || !args.candidate || !args.scope || !args.region) {
  throw Error("Required: --control <dpl>, --candidate <dpl>, --scope <team>, --region <label such as iad1>");
}
if (!["vercel", "bypass"].includes(/** @type {string} */ (args.transport))) throw Error("--transport is vercel or bypass");
const header = (/** @type {string} */ name) => {
  const value = /** @type {string} */ (args[/** @type {keyof typeof args} */ (name)]).toLowerCase();
  if (!/^x-[a-z0-9-]+$/.test(value)) throw Error(`--${name} must be an x- header name`);
  return value;
};
const canonicalOrigin = args["canonical-origin"] && new URL(args["canonical-origin"]);
if (canonicalOrigin && (canonicalOrigin.protocol !== "https:" || canonicalOrigin.origin !== args["canonical-origin"])) {
  throw Error("--canonical-origin must be a verified public HTTPS origin without a path");
}
if (args["natural-only"] && args["skip-natural"]) throw Error("Select only one of --natural-only and --skip-natural");
const config = {
  naturalOnly: args["natural-only"],
  samples: int("samples"),
  cadenceMs: int("cadence-ms", 0),
  freshHitMs: int("fresh-hit-ms"),
  naturalRequests: int("natural-requests"),
  naturalMeanGapMs: int("natural-mean-gap-ms"),
  naturalMaxGapMs: int("natural-max-gap-ms"),
  naturalSeed: int("natural-seed"),
  canonicalOrigin: canonicalOrigin ? canonicalOrigin.origin : null,
  requireSharedCandidate: args["require-shared-candidate"],
  cacheHeader: header("cache-header"),
  namespaceHeader: header("namespace-header"),
  namespaceEchoHeader: header("namespace-echo-header"),
  path: roomPath(/** @type {string} */ (args.slug), /** @type {string} */ (args.locale)),
  locale: /** @type {string} */ (args.locale),
  region: /** @type {string} */ (args.region),
};
const bypass = args.transport === "bypass" ? process.env.VERCEL_PROTECTION_BYPASS : undefined;
if (args.transport === "bypass" && !/^[\w-]{16,}$/.test(bypass ?? "")) throw Error("Set VERCEL_PROTECTION_BYPASS for --transport bypass");
const loading = (() => {
  try {
    return JSON.parse(readFileSync(`messages/${config.locale}.json`, "utf8")).Villa.loadingVilla;
  } catch {
    return undefined;
  }
})();
const ignoreTexts = [...(loading ? [loading] : []), .../** @type {string[]} */ (args["ignore-text"])];
const cleanCwd = mkdtempSync(path.join(tmpdir(), "room-preview-"));
process.on("exit", () => rmSync(cleanCwd, { recursive: true, force: true }));
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<{ code: number | null, stdout: Buffer, stderr: string }>} */
function run(/** @type {string} */ command, /** @type {string[]} */ argv, stdin = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: cleanCwd, stdio: ["pipe", "pipe", "pipe"] });
    /** @type {Buffer[]} */
    const out = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr: err }); });
    child.stdin.end(stdin);
  });
}

/** Read-only deployment metadata via the operator's CLI login. */
async function inspect(/** @type {string} */ deployment) {
  if (!/^(dpl_[A-Za-z0-9]+|[a-z0-9-]+\.vercel\.app)$/.test(deployment)) throw Error("Deployments must be dpl_ ids or immutable *.vercel.app hosts");
  const result = await run(/** @type {string} */ (args.vercel), ["api", `/v13/deployments/${deployment}`, "--scope", /** @type {string} */ (args.scope), "--raw"]);
  if (result.code) throw Error(`vercel api failed for ${deployment} (exit ${result.code})`);
  const data = JSON.parse(result.stdout.toString("utf8"));
  return { id: data.id, projectId: data.projectId, target: data.target ?? "preview", readyState: data.readyState, regions: data.regions ?? [], host: data.url };
}

async function preflight() {
  const [control, candidate] = await Promise.all([inspect(/** @type {string} */ (args.control)), inspect(/** @type {string} */ (args.candidate))]);
  const problems = [];
  if (control.id === candidate.id) problems.push("control and candidate are the same deployment");
  if (control.projectId !== candidate.projectId) problems.push("deployments belong to different projects");
  for (const [arm, info] of Object.entries({ control, candidate })) {
    if (info.target === "production") problems.push(`${arm} is a production deployment`);
    if (info.readyState !== "READY") problems.push(`${arm} is ${info.readyState}`);
    if (!info.regions.includes(config.region)) problems.push(`${arm} regions ${info.regions.join(",") || "unknown"} exclude ${config.region}`);
    if (!/\.vercel\.app$/.test(info.host ?? "")) problems.push(`${arm} has no immutable deployment host`);
  }
  if (JSON.stringify(control.regions) !== JSON.stringify(candidate.regions)) problems.push("deployments use different function regions");
  if (problems.length) throw Error("Preflight refused: " + problems.join("; "));
  return { control, candidate };
}

/**
 * One timed GET of the room document on the immutable deployment host (never an alias).
 * @param {{ id: string, host: string }} deployment
 * @param {string | undefined} ns
 */
async function request(deployment, ns) {
  // curl default Accept: an explicit text/html Accept triggers the Clerk handshake redirect.
  const curl = ["--silent", "--show-error", "--compressed", "--include", "--output", "-", "--max-time", "35", "--connect-timeout", "10",
    "--write-out", `${MARKER}%{http_code} %{time_starttransfer} %{time_pretransfer} %{time_total}`,
    ...(ns ? ["--header", `${config.namespaceHeader}: ${ns}`] : [])];
  const result = bypass
    ? await run("curl", ["--config", "-", ...curl, `https://${deployment.host}${config.path}`], `header = "x-vercel-protection-bypass: ${bypass}"\n`)
    : await run(/** @type {string} */ (args.vercel), ["curl", config.path, "--deployment", deployment.id, "--scope", /** @type {string} */ (args.scope), "--", ...curl]);
  if (result.code) return null;
  try {
    return parseCurlOutput(result.stdout);
  } catch {
    return null;
  }
}

/** @type {Record<string, unknown> & { texts?: string[] } | null} */
let reference = null;
const rejections = /** @type {Record<string, Record<string, number>>} */ ({ control: {}, candidate: {} });
/** @type {{ missing: number, extra: number, missingSample: string[], extraSample: string[] } | null} */
let firstTextDiff = null;
let factMismatchCount = 0;
let acceptedCanonicalAdditions = 0;
let regionMismatchCount = 0;
/** @type {Record<string, unknown>[]} */
const samples = [];

/**
 * Measure, verify and record one response.
 * @param {"control" | "candidate"} arm
 * @param {{ id: string, host: string }} deployment
 * @param {"warmup" | "prime" | "hit" | "miss" | "natural"} phase
 * @param {string | undefined} ns
 */
async function measure(arm, deployment, phase, ns) {
  const startedMs = performance.now();
  const response = await request(deployment, ns);
  const completedMs = performance.now();
  if (!response) {
    rejections[arm].transport = (rejections[arm].transport ?? 0) + 1;
    samples.push({ arm, phase, verdict: "transport" });
    return null;
  }
  const html = /text\/html/.test(response.headers.get("content-type") ?? "") ? response.body : "";
  const { texts, ...facts } = { ...documentFacts(html, ignoreTexts), linkAlternates: linkAlternates(response.headers.get("link")) };
  if (!reference && arm === "control" && response.status === 200) {
    if (facts.lang !== config.locale || !facts.title || !facts.h1.length) throw Error(`Control reference is not a ${config.locale} room document`);
    reference = { ...facts, texts };
  }
  const matched = reference && arm === "candidate" && response.status === 200
    ? roomCandidateFacts(facts, reference, { path: config.path, origin: config.canonicalOrigin })
    : null;
  if (matched?.addedCanonical) acceptedCanonicalAdditions++;
  /** @type {string[]} */
  const mismatches = matched?.mismatches ?? (reference ? factMismatches(facts, reference) : ["reference"]);
  if (mismatches.includes("contentDigest") && !firstTextDiff && reference?.texts) firstTextDiff = textDiff(texts, reference.texts);
  const regions = vercelRegions(response.headers.get("x-vercel-id"));
  const namespaceEcho = response.headers.get(config.namespaceEchoHeader);
  const observation = roomCacheObservation(response.headers.get(config.cacheHeader),
    phase === "natural" && arm === "control"
      ? { html, witness: response.headers.get("x-villa-bench-request-id"), namespaceEcho, namespace: ns }
      : undefined);
  const sample = {
    status: response.status,
    cache: observation.cache,
    edgeCache: response.headers.get("x-vercel-cache"),
    namespaceEcho,
    fnRegion: regions.fn,
    mismatches: response.status === 200 ? mismatches : [],
    ...roomPreviewCookies(response.headers.get("set-cookie")),
    cacheStorage: response.headers.get("x-villa-cache-storage") ?? null,
    privateNoStore: /(?:^|,| )private(?:,| |$)/i.test(response.headers.get("cache-control") ?? "") &&
      /(?:^|,| )no-store(?:,| |$)/i.test(response.headers.get("cache-control") ?? ""),
  };
  const expect = phase === "hit" ? "hit" : phase === "natural" ? "natural" : "miss";
  const reason = phase === "warmup"
    ? (response.status === 200 ? null : `status-${response.status}`)
    : rejectReason(sample, { expect, namespace: ns ?? "", region: config.region }) ??
      (sample.setsOtherCookie ? "set-cookie" : !sample.privateNoStore ? "cache-control" :
        config.requireSharedCandidate && arm === "candidate" && sample.cacheStorage !== "shared" ? "process-local-cache" : null);
  if (reason?.startsWith("facts:")) factMismatchCount++;
  if (reason === "region") regionMismatchCount++;
  if (reason) rejections[arm][reason] = (rejections[arm][reason] ?? 0) + 1;
  samples.push({
    arm, phase, verdict: reason ?? "ok", status: response.status, cache: sample.cache, edgeCache: sample.edgeCache ?? null,
    cacheStorage: sample.cacheStorage,
    cacheObservationSource: observation.source,
    ...(phase === "natural" && { startedMs, completedMs }),
    setsLocaleCookie: sample.setsLocaleCookie, setsOtherCookie: sample.setsOtherCookie, privateNoStore: sample.privateNoStore,
    roomHtmlStreamed: /\bhidden\s+id="S:/.test(html),
    edgeRegion: regions.edge, fnRegion: regions.fn, ttfbMs: response.ttfbMs, waitMs: response.waitMs, totalMs: response.totalMs,
  });
  return reason ? null : { ...sample, ttfbMs: response.ttfbMs, waitMs: response.waitMs };
}

async function controlled(/** @type {Record<"control" | "candidate", { id: string, host: string }>} */ deployments) {
  const arms = /** @type {const} */ (["control", "candidate"]);
  /** @type {Record<string, Record<string, { ttfbMs: number, waitMs: number }[]>>} */
  const verified = { control: { hit: [], miss: [] }, candidate: { hit: [], miss: [] } };
  const attempts = { control: { hit: 0, miss: 0 }, candidate: { hit: 0, miss: 0 } };
  const maxAttempts = Math.ceil(config.samples * 1.5);
  /** @type {Record<string, { ns: string, primedAt: number } | null>} */
  const hitKey = { control: null, candidate: null };
  const pending = () => arms.some((arm) => CLASSES.some((kind) => verified[arm][kind].length < config.samples && attempts[arm][kind] < maxAttempts));
  for (let round = 0; pending(); round++) {
    const classes = round % 2 ? [...CLASSES].reverse() : CLASSES;
    for (const kind of classes) {
      for (const arm of round % 4 < 2 ? arms : [...arms].reverse()) {
        if (verified[arm][kind].length >= config.samples || attempts[arm][kind] >= maxAttempts) continue;
        attempts[arm][kind]++;
        let ns;
        if (kind === "hit") {
          const key = hitKey[arm];
          if (!key || Date.now() - key.primedAt > config.freshHitMs) {
            const fresh = { ns: namespace(`hit-${arm.slice(0, 4)}`), primedAt: Date.now() };
            hitKey[arm] = (await measure(arm, deployments[arm], "prime", fresh.ns)) ? fresh : null;
            await sleep(config.cadenceMs);
            if (!hitKey[arm]) continue;
          }
          ns = /** @type {{ ns: string }} */ (hitKey[arm]).ns;
        } else {
          ns = namespace(`miss-${arm.slice(0, 4)}`);
        }
        const sample = await measure(arm, deployments[arm], kind, ns);
        if (sample) verified[arm][kind].push(sample);
        await sleep(config.cadenceMs);
      }
    }
    process.stdout.write(`\rcontrolled: ${arms.map((arm) => `${arm} hit ${verified[arm].hit.length} miss ${verified[arm].miss.length}`).join(" | ")}   `);
  }
  process.stdout.write("\n");
  return Object.fromEntries(CLASSES.map((kind) => [kind, { control: summarize(verified.control[kind]), candidate: summarize(verified.candidate[kind]) }]));
}

async function natural(/** @type {Record<"control" | "candidate", { id: string, host: string }>} */ deployments) {
  const gaps = naturalSchedule(config.naturalSeed, config.naturalRequests, config.naturalMeanGapMs, config.naturalMaxGapMs);
  const ns = { control: namespace("nat-cont"), candidate: namespace("nat-cand") };
  const tally = { control: { hits: 0, verified: 0, total: 0 }, candidate: { hits: 0, verified: 0, total: 0 } };
  for (const [index, gap] of gaps.entries()) {
    await sleep(gap);
    /** @type {("control" | "candidate")[]} */
    const order = index % 2 ? ["candidate", "control"] : ["control", "candidate"];
    await Promise.all(order.map(async (arm, offset) => {
      await sleep(offset * 50); // Keep the alternation without delaying the second arm by a whole response.
      const sample = await measure(arm, deployments[arm], "natural", ns[arm]);
      tally[arm].total++;
      if (sample) {
        tally[arm].verified++;
        if (sample.cache === "hit" || sample.cache === "stale") tally[arm].hits++;
      }
    }));
    process.stdout.write(`\rnatural: ${index + 1}/${gaps.length}   `);
  }
  process.stdout.write("\n");
  const rate = (/** @type {{ hits: number, verified: number, total: number }} */ t) => ({
    requests: t.total, verified: t.verified, hits: t.hits,
    rate: t.verified ? t.hits / t.verified : null,
    unverifiedShare: t.total ? (t.total - t.verified) / t.total : 1,
  });
  return { control: rate(tally.control), candidate: rate(tally.candidate) };
}

const started = new Date();
const deployments = await preflight();
console.log(`Preflight ok: one project, non-production, READY, regions ${deployments.control.regions.join(",")}.`);
if (args["preflight-only"]) process.exit(0);
for (const arm of /** @type {const} */ (["control", "candidate", "control", "candidate"])) {
  await measure(arm, deployments[arm], "warmup", undefined);
  await sleep(config.cadenceMs);
}
if (!reference) throw Error("Control warm-up did not return a 200 room document");
const outDir = path.resolve(/** @type {string} */ (args.out));
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const file = path.join(outDir, `room-preview-${started.toISOString().replace(/[:.]/g, "-")}.json`);
const partial = file + ".partial";
const classes = config.naturalOnly ? null : await controlled(deployments);
if (classes) writeFileSync(partial, JSON.stringify({ kind: "controlled-only", config, classes, samples, rejections }, null, 2) + "\n", { mode: 0o600 });
const naturalResult = args["skip-natural"] ? null : await natural(deployments);
const { verdict, gates } = evaluateGates(
  { classes: /** @type {never} */ (classes), natural: naturalResult, factMismatches: factMismatchCount, regionMismatches: regionMismatchCount },
  { samples: config.samples },
);
const originResponses = Object.fromEntries(["control", "candidate"].map((arm) => [
  arm,
  Object.fromEntries(["warmup", "prime", "hit", "miss", "natural"].map((phase) => [
    phase,
    samples.filter((sample) => sample.arm === arm && sample.phase === phase && sample.fnRegion === config.region &&
      !edgeServed(typeof sample.edgeCache === "string" ? sample.edgeCache : undefined)).length,
  ])),
]));
const candidateNaturalUncertainty = naturalResult && naturalHitUncertainty(samples
  .filter((sample) => sample.arm === "candidate" && sample.phase === "natural")
  .map((sample) => ({
    eligible: sample.verdict === "ok",
    cache: sample.cache,
    startedMs: Number(sample.startedMs),
    completedMs: Number(sample.completedMs),
  })));
const referenceFacts = { .../** @type {Record<string, unknown>} */ (reference), texts: undefined };
const report = {
  kind: "room-preview-parity",
  startedAt: started.toISOString(),
  finishedAt: new Date().toISOString(),
  verdict,
  gates,
  deployments: Object.fromEntries(Object.entries(deployments).map(([arm, info]) => [arm, { id: info.id, target: info.target, regions: info.regions }])),
  config: { ...config, transport: args.transport, ignoreTextCount: ignoreTexts.length },
  reference: referenceFacts,
  firstTextDiff,
  acceptedCanonicalAdditions,
  classes,
  natural: naturalResult,
  candidateNaturalUncertainty,
  rejections,
  originResponses,
  samples,
  caveats: [
    "The controlled-only checkpoint is retained until the separate natural replay completes.",
    "TTFB is curl time_starttransfer from a fresh connection per request; waitMs subtracts connection and TLS setup.",
    "Controlled classes and Start natural classes require a Preview response header. Next natural also accepts a matching request-bound server document observation. Edge cache headers never classify.",
    "Natural hit rate counts fresh and nonblocking stale cache responses. Outage recovery counts as a known non-hit.",
    "Anonymous requests with curl default Accept, no cookies and no redirects followed.",
    "An added Start canonical is accepted only for the expected room path and configured public origin. The original Next reference remains recorded.",
    "Instrumented samples must be private/no-store; the only permitted response cookie is Next’s locale preference.",
  ],
};
writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
if (classes) rmSync(partial);
for (const gate of gates) console.log(`${gate.pass === true ? "PASS" : gate.pass === false ? "FAIL" : "----"} ${gate.gate}: ${gate.detail}`);
console.log(`Verdict: ${verdict}. Report: ${path.relative(process.cwd(), file)}`);
process.exitCode = verdict === "pass" ? 0 : verdict === "fail" ? 1 : 2;
