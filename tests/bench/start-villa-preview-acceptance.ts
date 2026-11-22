// Blocking-refresh hosted villa acceptance (measured on 508d1ca5). Setup, isolation and teardown
// live in villa-preview-target.ts; the SWR variant is start-villa-preview-swr-acceptance.ts.
import assert from "node:assert/strict";
import { room, runVillaAcceptance, workersSeen, type Observation } from "./villa-preview-target.ts";

const ttlMs = 60_000;
const backoffMs = 30_000;
// Any non-recovery answer: the cache fix also reports `unconfirmed` and `bypass` storage states.
const fresh = (o: Observation) => ["miss", "hit", "unconfirmed", "bypass"].includes(o.cache ?? "");
const readError = (o: Observation) => o.cache?.includes("read-error") ?? false;

await runVillaAcceptance("dedicated-villa-outage-acceptance", { ttlMs, backoffMs }, async (t, stage) => {
  const { get, record, poll, names, runId } = t;
  stage("healthy");
  const healthy = await record("healthy", await get(room));
  assert(healthy.status === 200 && healthy.content === "seeded");

  stage("edit");
  const editAt = performance.now();
  await t.setName(names.edited);
  const edit = await poll(room, false, (o) => o.content === "edited", (o) => o.status === 200 && o.content === "seeded", 3_000, ttlMs + 30_000);
  await record("edit-visible", edit.result, { elapsedMs: Math.round(performance.now() - editAt), seen: edit.seen });

  stage("outage-after-expiry");
  await t.setName(names.recovered);
  const outage = await poll(room, true, readError, (o) => o.status === 200 && o.content === "edited" && fresh(o), 5_000, ttlMs + 30_000);
  const warm = await record("warm-outage", outage.result, { seen: outage.seen });
  assert(warm.status === 200 && warm.content === "edited" && warm.cache === "stale; read-error");
  const outageAt = performance.now();
  const cold = await record("cold-outage-backoff", await get(`/rooms/villa-acceptance-${runId}-cold`, true));
  assert(cold.status === 503 && cold.retryAfter === "30" && cold.held === warm.held);

  stage("recovery");
  const recovery = await poll(room, false, (o) => o.content === "recovered" && fresh(o),
    (o) => o.status === 200 && o.content === "edited" && o.cache === "stale; backoff", 2_000, backoffMs + 20_000);
  await record("recovered", recovery.result, { sinceOutageMs: Math.round(performance.now() - outageAt), seen: recovery.seen });

  stage("archive");
  const archiveAt = performance.now();
  await t.setStatus("archived");
  const archive = await poll(room, false, (o) => o.status === 404, (o) => o.status === 200 && o.content === "recovered", 3_000, ttlMs + 30_000);
  await record("archived", archive.result, { elapsedMs: Math.round(performance.now() - archiveAt), seen: archive.seen });

  stage("archived-outage-after-expiry");
  const archivedOutage = await poll(room, true, readError, (o) => o.status === 404 && fresh(o), 5_000, ttlMs + 30_000);
  const absent = await record("archived-outage", archivedOutage.result, { seen: archivedOutage.seen });
  assert.equal(absent.status, 404, "an archived villa must stay absent during an outage after expiry");
  const absentAt = performance.now();

  stage("archived-recovery");
  const archivedRecovery = await poll(room, false, fresh, (o) => o.status === 404, 2_000, backoffMs + 20_000);
  const stillAbsent = await record("archived-recovered", archivedRecovery.result, { sinceOutageMs: Math.round(performance.now() - absentAt), seen: archivedRecovery.seen });
  assert.equal(stillAbsent.status, 404);

  stage("reactivate");
  const reactivateAt = performance.now();
  await t.setStatus("active");
  const reactivate = await poll(room, false, (o) => o.status === 200 && o.content === "recovered", (o) => o.status === 404, 3_000, ttlMs + 30_000);
  await record("reactivated", reactivate.result, { elapsedMs: Math.round(performance.now() - reactivateAt), seen: reactivate.seen });

  stage("authoritative-miss");
  await record("authoritative-miss", await get(`/rooms/villa-acceptance-${runId}-missing`));

  const worker = workersSeen(t);
  const sameWorker = worker.size === 1 && !worker.has(null) && !worker.has("null");
  // Process-local recovery counts only when one warm worker answered every request.
  return { processes: t.processes.size, firstReadInFreshNamespace: healthy.cache, sameWorker, passed: sameWorker };
});
