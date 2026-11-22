// Stale-while-revalidate hosted villa acceptance (Start SWR from 10730a5c) on a dedicated Preview. Decisions use the
// fault fixture's per-process `getBySlug` ledger, not cache header wording, so the same assertions
// hold whatever the SWR implementation reports. An immediate stale response alone never counts as
// a failed refresh: failure needs a later tokenless request that still shows the old content and
// starts no detail read (backoff), plus the newer committed edit staying hidden until backoff ends.
import assert from "node:assert/strict";
import { room, runVillaAcceptance, sleep, type Observation } from "./villa-preview-target.ts";

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const freshMs = num("VILLA_SWR_FRESH_MS", 60_000);
const backoffMs = num("VILLA_SWR_BACKOFF_MS", 30_000);
/** Stated latency budget for a stale answer, reported as a distribution (runner RTT included). */
const immediateMs = num("VILLA_SWR_IMMEDIATE_MS", 2_000);
/**
 * Causal bound under a held read: a response that waited on it cannot finish before the 3 s
 * origin deadline (plus RTT), whereas a cold start or idle wake only adds time without a read.
 */
const causalMs = 3_000;
const burstSize = num("VILLA_SWR_BURST", 3);
const holdSettleMs = 5_000; // fixture hold (4 s) plus margin
/** A refresh stays in flight until its write or republish settles (at most 5 s), plus margin. */
const settleMs = 5_500;
/**
 * Origin `getBySlug` reads per refresh (aea4cc51): changed content reads, rotates the key's
 * generation, then reads again before publishing (2); unchanged content extends freshness (1);
 * a refresh held past the deadline fails before any rotation (1); backoff reads nothing (0).
 * A key's first 404 (2822f6a5) reads null, rotates, then publishes from a read started after the
 * rotation (2); a cached answer reads nothing (0). Positive misses never rotate.
 */
const expectedReads = { changed: 2, unchanged: 1, failed: 1, backoff: 0, coldNegative: 2, cached: 0, bypass: 1 } as const;
/** Storage bypass window after an unreadable generation (villa-runtime-cache VILLA_STORAGE_RETRY_MS). */
const VILLA_STORAGE_RETRY_MS = 5_000;
const window = freshMs + 30_000;

await runVillaAcceptance("dedicated-villa-outage-acceptance", { mode: "swr", freshMs, backoffMs, immediateMs, causalMs, burstSize }, async (t, stage) => {
  const { get, record, names, runId } = t;
  let worker: string | null = null;
  let detail = 0;
  let detailHeld = 0;
  const unknown = (tag: string) => `/rooms/villa-acceptance-${runId}-${tag}-${Math.random().toString(36).slice(2, 8)}`;

  /** One warm worker must answer everything; counters only ever move forward. */
  let leg = "setup";
  let lastEnd: number | undefined;
  const timings: { leg: string; durationMs: number; gapMs: number | null; faulted: boolean; cache: string | null }[] = [];
  t.report.timings = timings; // retained even when an assertion fails
  function observe(o: Observation) {
    // Gap since this runner's previous response ended: a long gap marks a possible idle wake.
    timings.push({ leg, durationMs: o.durationMs, gapMs: lastEnd === undefined ? null : Math.max(0, Math.round(o.atMs - lastEnd)), faulted: o.faultActive, cache: o.cache });
    lastEnd = Math.max(lastEnd ?? 0, o.atMs + o.durationMs);
    assert(o.process && o.detail !== undefined && o.detailHeld !== undefined, "fixture ledger missing");
    worker ??= o.process;
    assert.equal(o.process, worker, `worker changed (${worker} -> ${o.process}); process-local legs are inconclusive`);
    detail = Math.max(detail, o.detail);
    detailHeld = Math.max(detailHeld, o.detailHeld);
    return o;
  }
  const one = async (path: string, faulted = false) => observe(await get(path, faulted));
  const snapshot = () => ({ detail, detailHeld });
  const trace = (os: Observation[]) => os.map(t.label);
  /** performance.now() at which an observation's request started. */
  const clockAt = (o: Observation) => t.clock + o.atMs;
  const originReads: Record<string, unknown>[] = [];
  t.report.originReads = originReads;
  /**
   * Asserts the reads one transition caused. With a `starter`, that response must have started
   * exactly one read and the runner then sent nothing until it checked again, so any second read
   * is the same refresh's post-rotation re-read, never a parallel refresh.
   */
  function expectReads(transition: string, kind: keyof typeof expectedReads, base: { detail: number }, starter?: Observation) {
    const actual = detail - base.detail;
    const startedByStarter = starter ? starter.detail! - base.detail : undefined;
    originReads.push({ transition, kind, expected: expectedReads[kind], actual, startedByStarter });
    assert.equal(actual, expectedReads[kind], `${transition}: expected ${expectedReads[kind]} origin detail reads (${kind}), saw ${actual}`);
    if (starter) assert.equal(startedByStarter, 1, `${transition}: the refresh-starting response must start exactly one read`);
  }
  /** Single requests until `done` (checked after the ledger update); others must pass `allowed`. */
  async function pollOne(path: string, done: (o: Observation) => boolean, allowed: (o: Observation) => boolean, every: number, timeout: number) {
    const start = performance.now();
    const seen: string[] = [];
    while (true) {
      const result = await one(path);
      seen.push(t.label(result));
      if (done(result)) return { result, seen, elapsedMs: Math.round(performance.now() - start) };
      assert(allowed(result), `unexpected response while polling: ${seen.at(-1)}`);
      assert(performance.now() - start < timeout, `timed out polling: ${seen.join(",")}`);
      await sleep(every);
    }
  }

  /**
   * Single requests until the ledger shows a new detail (or held detail) read. The refresh starts
   * synchronously inside a request, so `result` is the response that started it. Every response
   * must pass `allowed`; with `nonblocking` none may reach the held read's 3 s deadline.
   * Requests are sequential: concurrent bursts can be routed to a second (cold) instance.
   */
  async function untilRead(path: string, faulted: boolean, allowed: (o: Observation) => boolean, every: number, nonblocking: boolean) {
    const base = snapshot();
    const seen: string[] = [];
    const start = performance.now();
    while (true) {
      const result = await one(path, faulted);
      seen.push(t.label(result));
      assert(allowed(result), `unexpected response: ${t.label(result)}`);
      if (nonblocking) assert(result.durationMs < causalMs, `a response waited on the held origin read: ${t.label(result)}`);
      if ((faulted ? detailHeld - base.detailHeld : detail - base.detail) > 0) return { result, seen, base };
      assert(performance.now() - start < window, `no refresh within ${window} ms: ${seen.join(",")}`);
      await sleep(every);
    }
  }

  /**
   * Back-to-back follow-ups after the request that started a held refresh. One that finished
   * before that request's start + 3 s reached the worker while the refresh was still in flight
   * (it cannot fail earlier), so it shows coalescing rather than backoff.
   */
  async function followUps(path: string, starter: Observation, allowed: (o: Observation) => boolean) {
    const rows: Observation[] = [];
    for (let i = 0; i < burstSize; i += 1) {
      const o = await one(path, true);
      assert(allowed(o) && o.durationMs < causalMs, `follow-up during held refresh: ${t.label(o)}`);
      rows.push(o);
    }
    const inFlight = rows.filter((o) => o.atMs + o.durationMs < starter.atMs + causalMs).length;
    assert(inFlight >= 1, `no follow-up landed inside the held refresh: ${trace(rows)}`);
    return { rows, inFlight };
  }

  const step = (name: string) => { leg = name; stage(name); };
  step("healthy");
  const healthy = await record("healthy", await one(room));
  assert(healthy.status === 200 && healthy.content === "seeded");
  await sleep(2_000); // let any refresh this read started settle before the edit commits

  // 1. Real edit: stale served immediately while one coalesced read refreshes, then fresh.
  step("edit-swr");
  const editAt = performance.now();
  await t.setName(names.edited);
  const editBase = snapshot();
  const trigger = await untilRead(room, false, (o) => o.status === 200 && (o.content === "seeded" || o.content === "edited"), 3_000, true);
  // The refresh starts synchronously inside the request, so the response that started the one
  // coalesced read carries it in its ledger and must still show the old content.
  const refreshing = trigger.result;
  assert.equal(refreshing.content, "seeded", `the refresh-starting response must be stale: ${t.label(refreshing)}`);
  await record("edit-stale-while-revalidate", refreshing, { sinceWriteMs: Math.round(clockAt(refreshing) - editAt), seen: trigger.seen });
  await sleep(settleMs); // quiet: no request can start another refresh
  const editFresh = await one(room);
  assert(editFresh.status === 200 && editFresh.content === "edited", `edit not fresh after its refresh: ${t.label(editFresh)}`);
  expectReads("edit refresh", "changed", editBase, refreshing);
  const editSinceWriteMs = Math.round(performance.now() - editAt);
  assert(editSinceWriteMs <= freshMs + 15_000, `edit took ${editSinceWriteMs} ms to become fresh`);
  await record("edit-fresh", editFresh, { sinceWriteMs: editSinceWriteMs, sinceRefreshMs: Math.round(performance.now() - clockAt(refreshing)), originDetailReads: detail - editBase.detail });

  // 2. Held refresh: immediate stale, one coalesced held read, then proof the refresh failed.
  step("held-refresh");
  await t.setName(names.recovered);
  const heldOk = (o: Observation) => o.status === 200 && o.content === "edited";
  const held = await untilRead(room, true, heldOk, 5_000, true);
  const heldFollow = await followUps(room, held.result, heldOk);
  await record("held-stale-while-revalidate", held.result, { followUps: trace(heldFollow.rows), followUpsInFlight: heldFollow.inFlight, seen: held.seen });
  await sleep(holdSettleMs);
  const warmFallback = await one(room, true);
  assert(warmFallback.status === 200 && warmFallback.content === "edited" && warmFallback.durationMs < causalMs, `warm fallback: ${t.label(warmFallback)}`);
  const beforeTokenless = snapshot();
  const failedRefresh = await one(room);
  assert(failedRefresh.status === 200 && failedRefresh.content === "edited", `newer edit visible or fallback lost: ${t.label(failedRefresh)}`);
  expectReads("tokenless request in backoff", "backoff", beforeTokenless);
  assert.equal(detailHeld - held.base.detailHeld, 1, "exactly one coalesced held refresh");
  expectReads("held refresh incl. in-flight follow-ups", "failed", held.base, held.result);
  await record("warm-fallback-after-failed-refresh", warmFallback, { heldDetailReads: detailHeld - held.base.detailHeld });
  await record("tokenless-in-backoff", failedRefresh, { newDetailReads: 0, sinceHeldRefreshMs: Math.round(performance.now() - clockAt(held.result)) });

  // 3. Global backoff: a brand-new slug without the token answers 503 without reading, for ~30 s.
  step("global-backoff");
  const beforeCold = snapshot();
  const cold = await one(unknown("cold"));
  assert(cold.status === 503 && /^\d+$/.test(cold.retryAfter ?? "") && Number(cold.retryAfter) <= backoffMs / 1000, `cold unknown: ${t.label(cold)} retry-after=${cold.retryAfter}`);
  expectReads("new unknown slug in backoff", "backoff", beforeCold);
  await record("cold-unknown-in-backoff", cold);
  // Only unknown slugs probe the backoff: a room request here could start the room's refresh
  // inside the loop and blur which transition caused which origin read.
  const backoffSeen: string[] = [];
  let backoffEnd: Observation;
  while (true) {
    const probe = await one(unknown("probe"));
    backoffSeen.push(t.label(probe));
    if (probe.status === 404) { backoffEnd = probe; break; }
    assert.equal(probe.status, 503, `unknown slug during backoff: ${t.label(probe)}`);
    assert(performance.now() - clockAt(held.result) < backoffMs + 20_000, "backoff did not end");
    await sleep(2_000);
  }
  const backoffEndedMs = Math.round(clockAt(backoffEnd) - clockAt(held.result));
  assert(backoffEndedMs >= backoffMs - 2_000 && backoffEndedMs <= backoffMs + 12_000, `backoff ended ${backoffEndedMs} ms after the held refresh`);
  await record("backoff-ended", backoffEnd, { sinceHeldRefreshMs: backoffEndedMs, seen: backoffSeen });
  await sleep(settleMs); // the probe's fenced 404 settles before the room is asked again
  const beforeRecovery = snapshot();
  const roomRefresh = await one(room);
  assert(roomRefresh.status === 200 && roomRefresh.content === "edited", `room refresh after backoff must start stale: ${t.label(roomRefresh)}`);
  await sleep(settleMs); // quiet: no request can start another refresh
  const recovered = await one(room);
  assert(recovered.status === 200 && recovered.content === "recovered", `newer edit not visible after recovery: ${t.label(recovered)}`);
  expectReads("room refresh after backoff", "changed", beforeRecovery, roomRefresh);
  await record("recovered", recovered, { refreshingResponse: t.label(roomRefresh), sinceBackoffEndMs: Math.round(clockAt(recovered) - clockAt(backoffEnd)) });

  // 4. Archive: 404 from first observation onwards, including a failed held refresh and recovery.
  step("archive");
  const archiveAt = performance.now();
  await t.setStatus("archived");
  const beforeArchive = snapshot();
  const archived = await pollOne(room, (o) => o.status === 404, (o) => o.status === 200 && o.content === "recovered", 3_000, window);
  expectReads("archive refresh", "changed", beforeArchive);
  await record("archived", archived.result, { sinceWriteMs: Math.round(performance.now() - archiveAt), seen: archived.seen });
  // A cached absence is served stale too: immediate 404s while its held refresh fails.
  const archivedHeld = await untilRead(room, true, (o) => o.status === 404, 5_000, true);
  const archivedFollow = await followUps(room, archivedHeld.result, (o) => o.status === 404);
  await record("archived-held-refresh", archivedHeld.result, { followUps: trace(archivedFollow.rows), followUpsInFlight: archivedFollow.inFlight, seen: archivedHeld.seen });
  await sleep(holdSettleMs);
  const archivedFallback = await one(room, true);
  const beforeArchivedTokenless = snapshot();
  const archivedTokenless = await one(room);
  assert(archivedFallback.status === 404 && archivedTokenless.status === 404, "archived villa resurfaced during the outage");
  expectReads("tokenless archived request in backoff", "backoff", beforeArchivedTokenless);
  assert.equal(detailHeld - archivedHeld.base.detailHeld, 1, "exactly one coalesced held archived refresh");
  expectReads("held archived refresh incl. in-flight follow-ups", "failed", archivedHeld.base, archivedHeld.result);
  await record("archived-fallback", archivedFallback);
  await record("archived-tokenless-in-backoff", archivedTokenless, { newDetailReads: 0 });
  const afterBackoff = snapshot();
  const archivedRecovery = await pollOne(room, () => detail > afterBackoff.detail, (o) => o.status === 404, 2_000, backoffMs + 20_000);
  await sleep(settleMs);
  const archivedRefreshed = await one(room);
  assert(archivedRecovery.result.status === 404 && archivedRefreshed.status === 404, "archived villa resurfaced after recovery");
  expectReads("archived refresh after backoff", "unchanged", afterBackoff, archivedRecovery.result);
  await record("archived-recovered", archivedRefreshed, { sinceHeldRefreshMs: Math.round(performance.now() - clockAt(archivedHeld.result)), seen: archivedRecovery.seen });

  // 5. Reactivation: at most the refreshing response is stale 404; after the refresh, the latest edit.
  step("reactivate");
  const reactivateAt = performance.now();
  await t.setStatus("active");
  const reactivateBase = snapshot();
  const refresh = await pollOne(room, (o) => o.status === 200 || detail > reactivateBase.detail, (o) => o.status === 404, 3_000, window);
  // Exactly the refresh-starting response may be the stale absence; the next one is the villa.
  // Causal by ledger: this response started the one read and still answered with the stale absence.
  assert.equal(refresh.result.status, 404, `reactivation refresh must start from a stale 404: ${t.label(refresh.result)}`);
  await sleep(settleMs); // quiet: no request can start another refresh
  const reactivated = await one(room);
  assert(reactivated.status === 200 && reactivated.content === "recovered", `reactivation must show the latest edit: ${t.label(reactivated)}`);
  expectReads("reactivation refresh", "changed", reactivateBase, refresh.result);
  await record("reactivated", reactivated, { refreshingResponse: t.label(refresh.result), sinceWriteMs: Math.round(performance.now() - reactivateAt), seen: refresh.seen });

  // 6. Cold negatives: the first 404 on an empty key is fenced (2 reads), its repeat is cached.
  /**
   * When storage cannot read a generation back, the source bypasses the cache for 5 s with one
   * uncached read (`bypass`). That response is recorded and must be a 404 with exactly one read;
   * the same still-empty key is then retried once after the window, where the fenced contract
   * must hold. A second bypass fails the run.
   */
  async function coldNegative(phase: string, path: string) {
    for (let attempt = 1; ; attempt += 1) {
      const before = snapshot();
      const first = await one(path);
      assert.equal(first.status, 404, `${phase} must be absent: ${t.label(first)}`);
      await sleep(settleMs);
      if (first.cache === "bypass") {
        expectReads(`${phase}, storage bypass (attempt ${attempt})`, "bypass", before);
        await record(`${phase}-storage-bypass`, first, { attempt });
        assert.equal(attempt, 1, `${phase}: storage bypassed twice`);
        await sleep(VILLA_STORAGE_RETRY_MS);
        continue;
      }
      expectReads(`${phase}, first 404`, "coldNegative", before);
      const afterFirst = snapshot();
      const repeat = await one(path);
      assert.equal(repeat.status, 404, `${phase} repeat: ${t.label(repeat)}`);
      expectReads(`${phase}, repeat`, "cached", afterFirst);
      await record(phase, first, { attempt });
      await record(`${phase}-repeat`, repeat);
      return;
    }
  }
  step("cold-archive");
  await t.setColdStatus("archived");
  await coldNegative("cold-archive", t.coldPath);
  step("authoritative-miss");
  await coldNegative("authoritative-miss", unknown("missing"));

  const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const distribution = Object.fromEntries([...new Set(timings.map((x) => x.leg))].map((name) => {
    const rows = timings.filter((x) => x.leg === name);
    const sorted = rows.map((x) => x.durationMs).sort((a, b) => a - b);
    return [name, {
      n: sorted.length, minMs: sorted[0], p50Ms: pct(sorted, 0.5), p95Ms: pct(sorted, 0.95), maxMs: sorted.at(-1),
      overBudget: rows.filter((x) => x.durationMs >= immediateMs).map((x) => ({ durationMs: x.durationMs, gapMs: x.gapMs, faulted: x.faulted, cache: x.cache })),
    }];
  }));
  const over = timings.filter((x) => x.durationMs >= immediateMs);
  // `observe` already failed the run on any worker change during the exercise.
  return {
    processes: t.processes.size, sameWorker: true, passed: true, originReads,
    budget: { limitMs: immediateMs, responses: timings.length, met: over.length === 0, overBudget: over.length, overBudgetAfterIdleOver20s: over.filter((x) => (x.gapMs ?? Infinity) > 20_000).length },
    distribution,
  };
});
