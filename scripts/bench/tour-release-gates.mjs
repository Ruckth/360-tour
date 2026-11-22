#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COHORTS, median, nearestRankP95 } from "./tour-entry-report.mjs";

const FIRST_ROOM = "pv-living";
const FIRST_PANORAMA = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const groupsPerBatch = 50;
const limits = { directMedianMs: 6758.5, directP95Ms: 8975.5, reopenMedianMs: 222.5 };

/** @param {unknown} value */
function at(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @typedef {{path: string, start: number}} ImageStart
 * @typedef {ImageStart & {end: number, transferBytes: number}} ImageResource
 * @typedef {{
 *   kind: string, start: number, stages: Record<string, number>, gestureAt: number, changedFrameAt: number,
 *   requestedRoom: string | null, shownRoom: string | null, room: string,
 *   startedImages: ImageStart[], images: ImageResource[], pendingImagesAtOpen?: ImageStart[],
 * }} UsableSample
 * @typedef {UsableSample & {
 *   runId: string, withheldMs: number, responseMs: number, documentEncoding: string,
 *   startedScripts: {contentEncoding?: string, transferBytes?: number}[],
 * }} RawSample
 * @typedef {{count: number, metadata?: Record<string, unknown>, samples: RawSample[], failures: {kind: string}[]}} RawRun
 * @typedef {{revision: string, frontend: string, assetEncoding: string, renderer: string, seed: string,
 *   width: number, height: number, dpr: number, cpuFactor: number, rttMs: number, downMbps: number}} Profile
 * @typedef {{schema: string, controlOnly: boolean, status: string, profile: Profile,
 *   inputs: {runs: {file: string, sha256: string}[]}}} Report
 */

/**
 * CDP starts include unfinished requests. Resource Timing separately confirms the selected image completed,
 * including a cache hit, and can expose a request which was not captured by CDP.
 * @param {UsableSample} sample
 */
export function checkUsableBoundary(sample) {
  const cutoff = sample.stages?.first_usable_frame;
  const draw = sample.stages?.first_scene_drawn;
  if (![sample.start, draw, cutoff, sample.gestureAt, sample.changedFrameAt].every(at) ||
      !(sample.start <= draw && draw <= cutoff && cutoff <= sample.gestureAt && sample.gestureAt < sample.changedFrameAt)) {
    return { valid: false, reason: "missing or out-of-order usable boundary" };
  }
  if ([sample.requestedRoom, sample.shownRoom, sample.room].some((room) => room !== FIRST_ROOM)) {
    return { valid: false, reason: "unexpected first room" };
  }
  /** @param {ImageStart} request */
  const before = (request) => request.start >= sample.start && request.start <= cutoff;
  const starts = sample.startedImages.filter(before);
  const resources = sample.images.filter(before);
  if ([...starts, ...resources, ...(sample.pendingImagesAtOpen ?? [])]
    .some((request) => request.path !== FIRST_PANORAMA)) {
    return { valid: false, reason: "another panorama started through usable boundary" };
  }
  if (sample.pendingImagesAtOpen?.length) {
    return { valid: false, reason: "first panorama was still pending when the open began" };
  }
  if (sample.kind === "reopen") {
    // No network transfer is necessary after the same-tab prime. A cache-served first image is also valid.
    if (starts.length <= 1 && resources.length <= 1 &&
        resources.every((request) => request.end <= cutoff && request.transferBytes === 0) &&
        (starts.length === 0 || resources.length === 1)) return { valid: true };
    return { valid: false, reason: "reopen did not reuse the first panorama" };
  }
  if (starts.length === 1 && resources.length === 1 && resources[0].end <= cutoff) return { valid: true };
  return { valid: false, reason: "expected one completed first panorama through usable boundary" };
}

/**
 * @param {RawSample[]} samples
 * @param {string} cohort
 * @param {number} expected
 */
function summarize(samples, cohort, expected) {
  const selected = samples.filter((sample) => sample.kind === cohort);
  const values = selected.map((sample) => sample.responseMs);
  const middle = median(values);
  const p95 = nearestRankP95(values);
  const failed = expected - selected.length;
  const budgetPassed = cohort === "direct" ? middle !== null && middle <= limits.directMedianMs &&
    p95 !== null && p95 <= limits.directP95Ms : cohort === "reopen" ? middle !== null && middle <= limits.reopenMedianMs : true;
  return { cohort, expected, n: selected.length, failed, medianMs: middle, p95Ms: p95, budgetPassed };
}

/** Apply the frozen Stage A budgets to the preregistered Stage E measurement.
 * @param {string} reportPath
 * @param {string} runs
 */
export function assessTourRelease(reportPath, runs) {
  const report = /** @type {Report} */ (JSON.parse(readFileSync(reportPath, "utf8")));
  assert.equal(report.schema, "tour-entry-report/v2");
  assert.equal(report.controlOnly, true, "Use a measured, intervention-free candidate.");
  const profile = report.profile;
  assert.equal(profile.frontend, "start");
  assert.equal(profile.assetEncoding, "gzip");
  assert.deepEqual([profile.width, profile.height, profile.dpr, profile.cpuFactor, profile.rttMs, profile.downMbps],
    [390, 844, 2, 4, 150, 1.6], "Profile differs from the frozen mobile device.");
  assert.equal(profile.seed, "demo-resort");
  assert.match(profile.renderer, /SwiftShader/i);

  const files = new Set(readdirSync(runs).filter((name) => name.endsWith(".json")));
  const rawRuns = new Map(report.inputs.runs.map(({ file, sha256 }) => {
    const name = basename(file);
    const bytes = readFileSync(join(runs, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, "Raw timing file differs from the report.");
    return [name, /** @type {RawRun} */ (JSON.parse(bytes.toString()))];
  }));
  const revision = profile.revision;
  const eligible = rawRuns.size > 0 && [...rawRuns.values()].every(({ metadata }) =>
    metadata?.usableBoundary === "dom-canvas-v1" && !metadata.functionalPixelProbe);
  if (!eligible) return {
    revision, status: "ineligible", limits,
    reason: "The inputs do not contain the independent timed Stage E usable boundary.",
  };

  const issues = [];
  const batches = [1, 2].map((batch) => {
    const samples = [];
    for (let group = 1; group <= groupsPerBatch; group += 1) {
      const label = `batch${batch}-pair${group}-delay0`;
      const filename = label + ".json";
      if (!files.delete(filename) || !rawRuns.has(filename)) {
        issues.push({ label, reason: "missing group" });
        continue;
      }
      const data = rawRuns.get(filename);
      if (!data || data.count !== 1 || data.metadata?.revision !== revision ||
          data.metadata?.frontend !== "start" || data.metadata.assetEncoding !== "gzip") {
        issues.push({ label, reason: "wrong production measurement mode" });
        continue;
      }
      for (const kind of COHORTS) {
        const matches = data.samples.filter((sample) => sample.kind === kind);
        if (matches.length !== 1 || matches[0].runId !== `${label}-1-${kind}` ||
            matches[0].withheldMs !== 0 || !at(matches[0].responseMs) ||
            data.failures.some((failure) => failure.kind === kind)) {
          issues.push({ label, kind, reason: "failed, missing or duplicate open" });
          continue;
        }
        const sample = matches[0];
        const boundary = checkUsableBoundary(sample);
        if (!Array.isArray(sample.pendingImagesAtOpen)) issues.push({ label, kind, reason: "missing pending request observations" });
        if (!boundary.valid) issues.push({ label, kind, reason: boundary.reason });
        if (kind === "direct" && sample.startedImages.some(({ path }) => !/-\d+\.webp$/.test(path))) {
          issues.push({ label, kind, reason: "master panorama transferred during direct entry" });
        }
        if (sample.documentEncoding !== "identity" || (kind === "direct" &&
          !sample.startedScripts.some((script) => script.contentEncoding === "gzip" && (script.transferBytes ?? 0) > 0))) {
          issues.push({ label, kind, reason: "wire response encodings did not match the Stage D fixture" });
        }
        samples.push(sample);
      }
    }
    return { batch, samples };
  });
  if (files.size) issues.push({ reason: "unexpected run groups", count: files.size });
  const breakdown = batches.map(({ batch, samples }) => ({
    batch, cohorts: COHORTS.map((kind) => summarize(samples, kind, groupsPerBatch)),
  }));
  const pooled = COHORTS.map((kind) => summarize(batches.flatMap(({ samples }) => samples), kind, groupsPerBatch * 2));
  const splitCohorts = COHORTS.filter((kind) => {
    const rows = breakdown.flatMap(({ cohorts }) => cohorts.filter(({ cohort }) => cohort === kind));
    const medianLimit = kind === "direct" ? limits.directMedianMs : limits.reopenMedianMs;
    return kind !== "click" && (
      new Set(rows.map(({ medianMs }) => medianMs !== null && medianMs <= medianLimit)).size > 1 ||
      (kind === "direct" && new Set(rows.map(({ p95Ms }) => p95Ms !== null && p95Ms <= limits.directP95Ms)).size > 1)
    );
  });
  const complete = breakdown.every(({ cohorts }) => cohorts.every(({ failed }) => failed === 0)) &&
    !issues.some(({ reason }) => reason === "unexpected run groups");
  const status = !complete || report.status !== "valid" || splitCohorts.length ? "inconclusive" :
    issues.length || !pooled.every(({ budgetPassed }) => budgetPassed) || !breakdown.every(({ cohorts }) =>
      cohorts.every(({ budgetPassed }) => budgetPassed)) ? "fail" : "pass";
  return { schema: "tour-entry-release/v1", revision, status, limits, batches: breakdown, pooled, splitCohorts, issues };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [reportPath, runs] = process.argv.slice(2);
  if (!reportPath || !runs) throw Error("Pass the shared Start report JSON and its original run directory");
  const report = assessTourRelease(reportPath, runs);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
}
