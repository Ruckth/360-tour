// Controlled villa outage on a disposable Start Preview built with START_VILLA_FAULT_FIXTURE=1.
// See docs/plans/benchmarks/start-villa-cache-study.md. Only anonymous GETs; no backend writes.
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const privateFile = (name) => {
  const path = process.env[name];
  if (!path) throw new Error(`Set ${name}`);
  if (statSync(path).mode & 0o077) throw new Error(`${name} must be mode 600`);
  return readFileSync(path, "utf8");
};
const target = JSON.parse(privateFile("VILLA_OUTAGE_TARGET"));
const app = new URL(target.app);
if (app.protocol !== "https:" || !app.hostname.endsWith(".vercel.app") || app.pathname !== "/" || target.isolation !== "dedicated-villa-outage-fixture") {
  throw new Error("Expected the dedicated immutable fixture origin");
}
const token = privateFile("VILLA_OUTAGE_TOKEN_FILE").trim();
const jwt = privateFile("E2E_PREVIEW_VERCEL_COOKIE_JAR").split("\n")
  .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
  .find((f) => f.length === 7 && f[0] === app.hostname && f[3] === "TRUE" && f[5] === "_vercel_jwt" && (f[4] === "0" || Number(f[4]) * 1000 > Date.now()))?.[6];
if (!jwt) throw new Error("No exact-host _vercel_jwt in the cookie jar");
const out = process.env.VILLA_OUTAGE_OUT;
if (!out) throw new Error("Set VILLA_OUTAGE_OUT to a new JSON path");

const room = "/rooms/pool-villa";
const unknown = () => `/rooms/villa-outage-${randomUUID().slice(0, 8)}`;
const processes = new Map();
const observations = [];
const clock = performance.now();
const report = { fixture: "isolated QA Convex, anonymous pool-villa", commit: target.commit, clock: "runner-monotonic-ms", observations };
writeFileSync(out, JSON.stringify(report), { flag: "wx", mode: 0o600 });

async function get(path, faulted) {
  const start = performance.now();
  const response = await fetch(new URL(path, app), {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { cookie: `_vercel_jwt=${jwt}`, ...(faulted && { "x-villa-fault-token": token }) },
  });
  const html = await response.text();
  const header = (name) => response.headers.get(name);
  const id = header("x-villa-fault-process");
  if (id && !processes.has(id)) processes.set(id, `P${processes.size + 1}`);
  const [upstream, held] = (header("x-villa-fault-ledger") ?? "").match(/\d+/g)?.map(Number) ?? [];
  return {
    atMs: Math.round(start - clock),
    status: response.status,
    durationMs: Math.round((performance.now() - start) * 10) / 10,
    cache: header("x-villa-cache"),
    retryAfter: header("retry-after"),
    process: id ? processes.get(id) : null,
    faultActive: header("x-villa-fault-active") === "1",
    upstream,
    held,
    title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null,
  };
}

function record(phase, data, extra = {}) {
  observations.push({ phase, ...data, ...extra });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(phase, data.status, data.cache, data.durationMs, data.process, `upstream=${data.upstream} held=${data.held}`);
  return data;
}

async function poll(path, faulted, done, { every, timeout }) {
  const start = performance.now();
  const seen = [];
  while (true) {
    const result = await get(path, faulted);
    seen.push(`${result.cache}@${result.process}`);
    if (done(result)) return { result, polls: seen.length, seen, elapsedMs: Math.round(performance.now() - start) };
    if (performance.now() - start > timeout) throw new Error(`Timed out polling ${faulted ? "faulted" : "healthy"} reads: ${seen.join(",")}`);
    await sleep(every);
  }
}

const first = record("healthy", await get(room, false));
record("healthy-repeat", await get(room, false));
if (first.status !== 200 || !first.title) throw new Error("Expected the healthy villa");

// The fresh read happens only after the 60 s runtime-cache entry expires.
const outage = await poll(room, true, (r) => r.cache?.includes("read-error") || r.status !== 200, { every: 5_000, timeout: 80_000 });
const warm = record("warm-outage", outage.result, { polls: outage.polls, seen: outage.seen, sameTitleAsHealthy: outage.result.title === first.title });
const backoff = record("cold-outage-backoff", await get(unknown(), true));

// Healthy reads resume, but this process keeps serving last-good data until its 30 s backoff ends.
const recovered = await poll(room, false, (r) => r.status === 200 && (r.cache === "miss" || r.cache === "hit"), { every: 2_000, timeout: 45_000 });
record("recovered", recovered.result, { polls: recovered.polls, seen: recovered.seen, elapsedMs: recovered.elapsedMs, sameTitleAsHealthy: recovered.result.title === first.title });
const missing = unknown();
const miss = record("authoritative-miss", await get(missing, false));
record("authoritative-miss-repeat", await get(missing, false));
// Outside backoff, an unknown slug has no saved data, so a held read must answer 503.
const coldHeld = record("cold-outage-held-read", await get(unknown(), true));

const warmLeg = [first, warm, backoff, recovered.result, miss];
const affinity = new Set([...warmLeg.map((o) => o.process), ...recovered.seen.map((s) => s.split("@")[1])]);
report.summary = {
  processes: processes.size,
  warmProcessVerified: affinity.size === 1 && !affinity.has("null"),
  passed: warm.status === 200 && warm.cache === "stale; read-error" && warm.title === first.title &&
    observations.every((o) => !o.phase.startsWith("cold") || (o.status === 503 && o.retryAfter === "30")) &&
    coldHeld.held > miss.held && recovered.result.title === first.title &&
    observations.filter((o) => o.phase.startsWith("authoritative")).every((o) => o.status === 404),
};
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary));
