#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [directory, mode = "compare"] = process.argv.slice(2);
if (!directory) throw new Error("Pass the extracted room-rename archive directory");
const keys = ["httpMs", "handlerMs", "executionMs", "executionLessHandlerMs", "httpLessExecutionMs"];

function arm(name) {
  const metadata = JSON.parse(readFileSync(join(directory, name, "samples.json"), "utf8"));
  const { samples, blockSize = 1 } = metadata;
  assert(Number.isInteger(blockSize) && blockSize >= 1);
  const spans = JSON.parse(readFileSync(join(directory, name, "spans.json"), "utf8")).runs;
  const windows = new Map(spans.map((run) => [run.runId, run]));
  const result = new Map(samples.map((sample) => {
    const { phase, rooms, repeat, elapsedMs } = sample;
    const runId = ["catalog-rename", phase, rooms, repeat].filter((field) => field !== undefined).join("-");
    const window = windows.get(runId);
    assert(window && window.convex.length === 1 && !window.ssr.length && !window.http.length, "Missing or mixed timing window");
    const span = window.convex[0];
    assert(span.function === "catalog/properties:updateRoom" && span.outcome === "success" && !span.cached);
    assert([span.handlerMs, span.executionMs, elapsedMs].every(Number.isFinite));
    return [`${phase ?? "steady"}/${rooms}/${repeat}`, {
      httpMs: elapsedMs,
      handlerMs: span.handlerMs,
      executionMs: span.executionMs,
      executionLessHandlerMs: span.executionMs - span.handlerMs,
      httpLessExecutionMs: elapsedMs - span.executionMs,
    }];
  }));
  return { result, blockSize, metadata };
}

function summarize(values) {
  assert(values.length && values.every(Number.isFinite));
  const sorted = values.toSorted((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
  return { n: sorted.length, median, p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}

const before = arm("control");
const after = arm("candidate");
const { result: control, blockSize } = before;
const { result: candidate } = after;
assert.equal(blockSize, after.blockSize);
if (mode === "aa" || mode === "ab") {
  assert.equal(before.metadata.verifiedResponseSha256, after.metadata.verifiedResponseSha256, "Different fixture or audit responses");
  for (const runtime of ["node", "platform", "arch", "repeats", "lockSha", "convexClient"]) assert.equal(before.metadata[runtime], after.metadata[runtime]);
  for (const metadata of [before.metadata, after.metadata]) {
    assert(metadata.status === undefined || metadata.status === "complete", "Retain incomplete evidence outside the decision");
    for (const rooms of [2, 50]) {
      const samples = metadata.samples.filter((sample) => (sample.phase ?? "steady") === "steady" && sample.rooms === rooms);
      assert.equal(samples.length, metadata.repeats, "Incomplete steady phase");
      assert.equal(new Set(samples.map((sample) => sample.repeat)).size, metadata.repeats, "Duplicate repeats");
    }
  }
  assert.equal(before.metadata.revision === after.metadata.revision, mode === "aa", "Wrong revision pairing for mode");
} else if (mode !== "compare") {
  throw new Error("Choose compare, aa or ab");
}
assert.equal(control.size, candidate.size);
const groups = ["steady", "first-uncertified"].flatMap((phase) => [2, 50].flatMap((rooms) => {
  const prefix = `${phase}/${rooms}/`;
  const pairs = [...control.keys()].filter((key) => key.startsWith(prefix));
  if (!pairs.length) return [];
  const measure = (group, entries) => ({
    phase, rooms, group,
    metrics: Object.fromEntries(keys.map((metric) => {
      const a = entries.map((key) => control.get(key)[metric]);
      const b = entries.map((key) => candidate.get(key)[metric]);
      return [metric, { control: summarize(a), candidate: summarize(b), pairedDelta: summarize(b.map((value, index) => value - a[index])) }];
    })),
  });
  const all = [measure("all", pairs)];
  if (pairs.length < 100) return all;
  const mid = pairs.length / 2;
  return [...all,
    measure("first-half", pairs.slice(0, mid)),
    measure("second-half", pairs.slice(mid)),
    measure("control-first", pairs.filter((_, i) => Math.floor(i / blockSize) % 2 === 0)),
    measure("candidate-first", pairs.filter((_, i) => Math.floor(i / blockSize) % 2 === 1)),
    ...(blockSize > 1 ? Array.from({ length: Math.ceil(pairs.length / blockSize) }, (_, i) =>
      measure(`block-${i + 1}`, pairs.slice(i * blockSize, (i + 1) * blockSize))) : []),
  ];
}));
if (mode === "compare") {
  console.log(JSON.stringify(groups, null, 2));
} else {
  const percentage = (metric, statistic) => 100 * (metric.candidate[statistic] / metric.control[statistic] - 1);
  const gate = groups.filter(({ phase, group }) => phase === "steady" && group === "all").map(({ rooms, metrics }) => {
    const p95Percent = percentage(metrics.httpMs, "p95");
    const medianPercent = percentage(metrics.httpMs, "median");
    return { rooms, p95Percent, medianPercent,
      passed: mode === "aa" ? Math.abs(p95Percent) <= 5 && Math.abs(medianPercent) <= 3 : p95Percent <= 5 };
  });
  console.log(JSON.stringify({ mode, blockSize, passed: gate.every((fixture) => fixture.passed), gate, groups }, null, 2));
}
