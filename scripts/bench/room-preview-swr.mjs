#!/usr/bin/env node
// Read-only pilot for the native room cache. The cold prime is separate from the
// three probes. Local mode also verifies the loopback Convex proxy read count.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { MARKER, namespace, parseCurlOutput, roomPreviewCookies, vercelRegions } from "./room-preview-lib.mjs";

const { values } = parseArgs({ options: {
  local: { type: "boolean", default: false },
  deployment: { type: "string" },
  scope: { type: "string" },
  region: { type: "string", default: "iad1" },
  out: { type: "string" },
} });
const vercel = process.env.VERCEL_BIN ?? "vercel";
const roomPath = "/rooms/pool-villa?tour=1";
const key = namespace("swr-pilot");
const expireWaitMs = 65_000;
const refreshWaitMs = 5_000;
if (!values.out || values.local === Boolean(values.deployment)) {
  throw Error("Set --out and either --local or --deployment dpl_… --scope <team>");
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 3_000_000, timeout: 30_000 });
  } catch {
    throw Error("The SWR pilot could not read the requested room response");
  }
}

/** @param {string | undefined} value */
function loopback(value) {
  if (!value) throw Error("The disposable local harness must provide both app and proxy URLs");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.port || url.username || url.password || url.search || url.hash) {
    throw Error("The local pilot accepts only isolated loopback origins");
  }
  return url;
}

const control = values.local ? loopback(process.env.START_VILLA_CACHE_STUDY_CONTROL) : undefined;
const app = values.local ? loopback(process.env.E2E_BASE_URL) : undefined;
if (control && (!/^\/study\/[a-z0-9-]{36}$/.test(control.pathname) || process.env.E2E_MODE !== "integration")) {
  throw Error("The local pilot requires the harness-issued disposable proxy capability");
}
if (!values.local) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(values.deployment ?? "") || !/^[a-z0-9-]+$/.test(values.scope ?? "")) {
    throw Error("Hosted SWR evidence requires an immutable deployment ID and verified team scope");
  }
  const info = JSON.parse(run(vercel, ["api", `/v13/deployments/${values.deployment}`, "--scope", values.scope ?? "", "--raw"]).toString());
  if (info.name !== "360-tour" || info.readyState !== "READY" ||
      (info.target && info.target !== "preview") || JSON.stringify(info.regions) !== JSON.stringify([values.region])) {
    throw Error("SWR pilot requires a READY 360-tour Preview in the expected region");
  }
}

/** @returns {Promise<number | null>} */
async function detailReads() {
  if (!control) return null;
  const response = await fetch(control, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw Error("The local read counter is unavailable");
  const { mode, detailReads } = await response.json();
  if (mode !== "healthy" || !Number.isSafeInteger(detailReads)) throw Error("The local pilot requires a healthy disposable backend");
  return detailReads;
}

const observations = /** @type {{phase: string, status: number, cache: string | null, storage: string | null,
  namespaceMatched: boolean, ttfbMs: number, detailReads: number | null}[]} */ ([]);
const initialReads = await detailReads();
const report = { mode: values.local ? "local" : "hosted-preview", expireWaitMs, refreshWaitMs, initialReads, observations };
writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });

/** @param {string} phase @param {"hit" | "miss" | "stale"} expected @param {number | undefined} expectedFetches */
async function probe(phase, expected, expectedFetches) {
  const args = ["--silent", "--show-error", "--compressed", "--include", "--max-time", "20",
    "--header", `X-Villa-Bench-Namespace: ${key}`, "--write-out",
    `${MARKER}%{http_code} %{time_starttransfer} %{time_pretransfer} %{time_total}`];
  const raw = app
    ? run("curl", [...args, new URL(roomPath, app).href])
    : run(vercel, ["curl", roomPath, "--deployment", values.deployment ?? "", "--scope", values.scope ?? "", "--", ...args]);
  const { status, headers, ttfbMs } = parseCurlOutput(raw);
  const cache = headers.get("x-villa-cache") ?? null;
  const storage = headers.get("x-villa-cache-storage") ?? null;
  const namespaceMatched = headers.get("x-villa-cache-namespace") === key;
  const reads = await detailReads();
  observations.push({ phase, status, cache, storage, namespaceMatched, ttfbMs, detailReads: reads });
  writeFileSync(values.out ?? "", JSON.stringify(report, null, 2) + "\n");
  const cacheControl = headers.get("cache-control") ?? "";
  const origin = app || (headers.get("x-vercel-cache") === "MISS" && vercelRegions(headers.get("x-vercel-id")).fn === values.region);
  if (status !== 200 || cache !== expected || storage !== (app ? "local" : "shared") || !namespaceMatched ||
      !origin || !cacheControl.includes("private") || !cacheControl.includes("no-store") ||
      roomPreviewCookies(headers.get("set-cookie")).setsOtherCookie) {
    throw Error(`SWR pilot ${phase} did not return a verified ${expected}`);
  }
  if (expectedFetches !== undefined && initialReads !== null && reads !== initialReads + expectedFetches) {
    throw Error(`SWR pilot ${phase} produced an unexpected number of Convex reads`);
  }
}

await probe("cold-prime", "miss", 1);
const primed = performance.now();
await probe("fresh-hit", "hit", 1);
await delay(Math.max(0, expireWaitMs - (performance.now() - primed)));
await probe("expired-stale", "stale", undefined);
await delay(refreshWaitMs);
await probe("refreshed-hit", "hit", 2);
console.log("SWR pilot passed: cold prime, fresh hit, nonblocking stale response, refreshed hit.");
