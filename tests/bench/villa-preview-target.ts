// Shared setup for hosted villa cache acceptance on a dedicated `perf-phase2-{outage,swr}-validation`
// Vercel + Convex Preview built with START_VILLA_FAULT_FIXTURE=1. See "Hosted authenticated
// acceptance" in docs/plans/benchmarks/start-villa-cache-study.md. Writes go only to that freshly
// seeded Convex Preview; teardown restores the fixture villa, the owner grant and Clerk users.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { clerkClient as createClerkClient } from "@clerk/tanstack-react-start/server";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseEnv, promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { testUsers } from "../../scripts/e2e-clerk.mjs";

const run = promisify(execFile);
const workingRoot = path.resolve(import.meta.dirname, "../..");
// Disposable, run-owned names only; `perf-phase2-start-validation` (admin acceptance) never matches.
const previewNames = /^perf-phase2-(outage|swr)-validation(-[2-9])?$/;
// Shared, production, room latency and admin acceptance backends are never valid targets.
const deniedBackends = ["wary-toad-189", "optimistic-turtle-573", "posh-blackbird-279"];
export const room = "/rooms/pool-villa";
const seededName = "Tideglass Pool Residence";
const coldSlug = "garden-suite";
const coldName = "Mossbell Garden Suite";

async function readPrivate(file: string) {
  const descriptor = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await descriptor.stat();
    assert(stats.isFile() && (stats.mode & 0o777) === 0o600 && stats.size < 128_000, "private files must be mode 600");
    return await descriptor.readFile("utf8");
  } finally {
    await descriptor.close();
  }
}

function httpsOrigin(raw: unknown, hostname: RegExp) {
  assert(typeof raw === "string");
  const url = new URL(raw);
  assert(url.protocol === "https:" && url.origin === raw && hostname.test(url.hostname));
  return url.origin;
}

export type Content = "seeded" | "edited" | "recovered" | "other" | "absent";
export type Observation = {
  atMs: number; status: number; durationMs: number; cache: string | null; retryAfter: string | null;
  process: string | null; faultActive: boolean; content: Content;
  /** Process-cumulative fixture counts: all allowlisted reads, and `getBySlug` reads only. */
  upstream?: number; held?: number; detail?: number; detailHeld?: number;
};

export type VillaTarget = Awaited<ReturnType<typeof openVillaTarget>>;

/** Validates the private target, then provisions a run-owned owner on the dedicated Preview. */
async function openVillaTarget(isolation: string, extraReport: Record<string, unknown>) {
  const env = process.env;
  assert.equal(env.E2E_PREVIEW_QA_OPT_IN, "disposable-test-only");
  assert(!env.DEBUG && !env.PWDEBUG && !env.CLERK_TESTING_DEBUG);
  const targetFile = env.VILLA_ACCEPTANCE_TARGET;
  const vercel = env.E2E_PREVIEW_VERCEL_BIN;
  const out = env.VILLA_ACCEPTANCE_OUT;
  const expectedSha = env.VILLA_ACCEPTANCE_EXPECT_SHA;
  assert(targetFile && path.isAbsolute(targetFile) && vercel && path.isAbsolute(vercel) && out, "set the target, Vercel CLI and output paths");
  assert.match(expectedSha ?? "", /^[a-f0-9]{40}$/, "set VILLA_ACCEPTANCE_EXPECT_SHA to the full source SHA");
  const target = JSON.parse(await readPrivate(targetFile));
  const previewName: string = target.previewName;
  assert.match(previewName, previewNames);
  assert.equal(target.isolation, isolation);
  assert.equal(target.commit, expectedSha, "the deployment must be built from the requested SHA");
  assert.match(target.deploymentId, /^dpl_[A-Za-z0-9]+$/);
  assert.match(target.scope, /^[a-z0-9-]+$/);
  assert.match(target.marker, /^[a-f0-9]{32}$/);
  assert.match(target.convexProjectAnchor, /^dev:[a-z0-9-]+$/);
  const app = httpsOrigin(target.app, /^[a-z0-9-]+\.vercel\.app$/);
  const backend = httpsOrigin(target.backend, /^[a-z0-9-]+\.convex\.cloud$/);
  assert(!deniedBackends.some((name) => backend.includes(name)), "refusing a shared or reserved backend");
  const token = (await readPrivate(env.VILLA_OUTAGE_TOKEN_FILE ?? "")).trim();
  assert.match(token, /^[a-f0-9]{64}$/);

  const runId = randomUUID().slice(0, 8);
  const names = { edited: `Outage Acceptance Edit ${runId}`, recovered: `Outage Acceptance Recovered ${runId}` };
  const processes = new Map<string, string>();
  const observations: Record<string, unknown>[] = [];
  const report: Record<string, unknown> = { previewName, commit: target.commit, clock: "runner-monotonic-ms", ...extraReport, observations };
  await writeFile(out, JSON.stringify(report), { flag: "wx", mode: 0o600 });
  const clock = performance.now();

  const testTenant = parseEnv(await readPrivate(path.join(homedir(), ".config/360-tour/.env.e2e.local")));
  const clerkEnv = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: testTenant.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: testTenant.CLERK_SECRET_KEY,
    CLERK_JWT_ISSUER_DOMAIN: testTenant.CLERK_JWT_ISSUER_DOMAIN?.replace(/\/$/, ""),
  };
  assert(clerkEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") && clerkEnv.CLERK_SECRET_KEY?.startsWith("sk_test_"));
  const clerk = createClerkClient({ secretKey: clerkEnv.CLERK_SECRET_KEY, publishableKey: clerkEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });

  const work = await mkdtemp(path.join(path.dirname(targetFile), "villa-acceptance-"));
  const selector = path.join(work, "convex.env");
  await writeFile(selector, `CONVEX_DEPLOYMENT=${target.convexProjectAnchor}\n`, { mode: 0o600 });
  const cleanEnv: NodeJS.ProcessEnv = { PATH: env.PATH, HOME: homedir(), NODE_ENV: "test", CI: "1", NO_COLOR: "1", VERCEL_TELEMETRY_DISABLED: "1" };
  const isolated = { cwd: workingRoot, env: cleanEnv, timeout: 90_000, maxBuffer: 24_000_000 };
  const convex = async (args: string[]) => (await run(process.execPath, [
    "node_modules/convex/bin/main.js", ...args, "--env-file", selector, "--preview-name", previewName,
  ], isolated)).stdout;
  const getEnv = async () => parseEnv(await convex(["env", "list", "--include-values"]));
  const ownerGrants = async (): Promise<Array<{ email: string; claimed: boolean }>> => JSON.parse(await convex(["run", "auth/owners:listOwners", "{}"]));
  const vercelRun = async (args: string[]) => (await run(vercel, args, { ...isolated, cwd: work })).stdout;

  let jwt = "";
  async function get(pathname: string, faulted = false): Promise<Observation> {
    const start = performance.now();
    const response = await fetch(new URL(pathname, app), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { cookie: `_vercel_jwt=${jwt}`, ...(faulted && { "x-villa-fault-token": token }) },
    });
    const html = await response.text();
    const header = (name: string) => response.headers.get(name);
    const id = header("x-villa-fault-process");
    if (id && !processes.has(id)) processes.set(id, `P${processes.size + 1}`);
    const ledger = Object.fromEntries((header("x-villa-fault-ledger") ?? "").split(";").map((part) => part.split("=")).map(([k, v]) => [k, Number(v)]));
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    return {
      atMs: Math.round(start - clock),
      status: response.status,
      durationMs: Math.round((performance.now() - start) * 10) / 10,
      cache: header("x-villa-cache"),
      retryAfter: header("retry-after"),
      process: id ? processes.get(id)! : null,
      faultActive: header("x-villa-fault-active") === "1",
      content: response.status === 404 ? "absent"
        : title.startsWith(names.edited) ? "edited" : title.startsWith(names.recovered) ? "recovered" : title.startsWith(seededName) ? "seeded" : "other",
      upstream: ledger.upstream, held: ledger.held, detail: ledger.detail, detailHeld: ledger.detailHeld,
    };
  }

  async function save() {
    await writeFile(out!, JSON.stringify(report, null, 2) + "\n");
  }
  async function record(phase: string, data: Observation, extra: Record<string, unknown> = {}) {
    observations.push({ phase, ...data, ...extra });
    await save();
    console.log(phase, data.status, data.cache, data.content, data.durationMs, data.process, `detail=${data.detail} detailHeld=${data.detailHeld}`);
    return data;
  }
  const label = (o: Observation) => `${o.status}:${o.cache}:${o.content}:${o.durationMs}@${o.process}`;

  /** Polls until `done`; every intermediate response must satisfy `allowed`. */
  async function poll(pathname: string, faulted: boolean, done: (o: Observation) => boolean, allowed: (o: Observation) => boolean, every: number, timeout: number) {
    const start = performance.now();
    const seen: string[] = [];
    while (true) {
      const result = await get(pathname, faulted);
      seen.push(label(result));
      if (done(result)) return { result, seen, elapsedMs: Math.round(performance.now() - start) };
      assert(allowed(result), `unexpected response while polling: ${seen.at(-1)}`);
      assert(performance.now() - start < timeout, `timed out polling: ${seen.join(",")}`);
      await sleep(every);
    }
  }

  // --- control-plane identity, protection, fresh backend and fixture checks ---
  const deployment = JSON.parse(await vercelRun(["api", `/v13/deployments/${target.deploymentId}`, "--scope", target.scope, "--raw"]));
  assert.equal(deployment.id, target.deploymentId);
  assert.equal(`https://${deployment.url}`, app);
  assert.equal(deployment.readyState, "READY");
  assert.equal(deployment.target ?? "preview", "preview");
  assert.equal(deployment.meta?.villaOutageAcceptance, target.marker);
  assert.equal(deployment.meta?.githubCommitSha, expectedSha);
  assert.equal(deployment.meta?.githubCommitRef, previewName);
  assert(!(deployment.alias ?? []).length, "the deployment must have no aliases");

  const jar = path.join(work, "protect.cookies");
  await writeFile(jar, "", { flag: "wx", mode: 0o600 });
  await vercelRun(["curl", "/robots.txt", "--deployment", target.deploymentId, "--scope", target.scope, "--",
    "--silent", "--show-error", "--fail", "--max-time", "30", "--header", "x-vercel-set-bypass-cookie: true", "--cookie-jar", jar, "--output", "/dev/null"]);
  const host = new URL(app).hostname;
  jwt = (await readPrivate(jar)).split(/\r?\n/).map((line) => line.split("\t"))
    .find((f) => f[0] === `#HttpOnly_${host}` && f[3] === "TRUE" && f[5] === "_vercel_jwt")?.[6] ?? "";
  assert(jwt, "no exact-host protection cookie");
  const anonymous = await fetch(new URL(room, app), { redirect: "manual" });
  assert(anonymous.status === 401 || (anonymous.status >= 300 && anonymous.status < 400), "the deployment must stay protected");

  const publicClient = new ConvexHttpClient(backend, { logger: false });
  const [linked, pool, garden] = await Promise.all([
    convex(["run", "catalog/publicProperties:getBySlug", '{"slug":"pool-villa"}']),
    publicClient.query(api.catalog.publicProperties.getBySlug, { slug: "pool-villa" }),
    publicClient.query(api.catalog.publicProperties.getBySlug, { slug: coldSlug }),
  ]);
  assert(pool && JSON.parse(linked).villa._id === pool.villa._id, "manifest backend must be the named preview");
  assert.equal(pool.villa.name, seededName, "expected the freshly seeded fixture villa");
  // Teardown restores the name, so only an unedited seed proves this backend is unused.
  assert.equal(pool.villa.contentEditedAt, null, "the fixture villa was already edited; use a new preview name");
  const villaId: Id<"properties"> = pool.villa._id;
  // A second seeded villa whose cache key this run never reads before archiving it (cold negative).
  assert(garden && garden.villa.name === coldName && garden.villa.contentEditedAt === null, "expected the unedited seeded cold villa");
  const coldId: Id<"properties"> = garden.villa._id;
  const runtime = await getEnv();
  assert.equal(runtime.CLERK_JWT_ISSUER_DOMAIN?.replace(/\/$/, ""), clerkEnv.CLERK_JWT_ISSUER_DOMAIN);
  // Without push invalidation, visibility measures the real TTL and no edit reaches another origin.
  assert(!runtime.START_VILLA_INVALIDATION_ORIGIN && !runtime.START_VILLA_INVALIDATION_SECRET, "push invalidation must be off");
  const existingOwners = await ownerGrants();
  assert(existingOwners.some((grant) => grant.claimed), "Claim a Preview owner grant before running temporary owner QA");

  const inert = await get(`/rooms/villa-acceptance-${runId}-inert`);
  assert(inert.status === 404 && !inert.faultActive && inert.process, "fault fixture must be present and inert without its token");
  const provider = await fetch(new URL(room, app), { headers: { cookie: `_vercel_jwt=${jwt}` }, redirect: "manual" });
  assert.equal(provider.headers.get("x-start-provider-isolation"), "verified");
  await provider.arrayBuffer();

  // --- run-owned owner, granted only on this Preview ---
  const provisioned = await testUsers(clerkEnv);
  const owner = provisioned.users.owner;
  assert(!existingOwners.some((grant) => grant.email === owner.email));
  await writeFile(path.join(work, "recovery.json"), JSON.stringify({ addedOwner: owner.email }), { flag: "wx", mode: 0o600 });
  let session: { id: string };
  try {
    session = await clerk.sessions.createSession({ userId: owner.id });
  } catch (error) {
    await provisioned.cleanupSessions().catch(() => {});
    throw error;
  }
  const writer = new ConvexHttpClient(backend, { logger: false });
  const asOwner = async () => writer.setAuth((await clerk.sessions.getToken(session.id, "convex")).jwt);
  let mutated = false;
  const setName = async (name: string) => {
    await asOwner();
    mutated = true;
    await writer.mutation(api.catalog.properties.update, { propertyId: villaId, name });
  };
  let coldArchived = false;
  /** Archives (or restores) the second villa; teardown always reactivates it. */
  const setColdStatus = async (status: "active" | "archived") => {
    await asOwner();
    coldArchived = true;
    await writer.mutation(api.catalog.adminProperties.setStatus, { propertyId: coldId, status });
  };
  const setStatus = async (status: "active" | "archived") => {
    await asOwner();
    mutated = true;
    await writer.mutation(api.catalog.adminProperties.setStatus, { propertyId: villaId, status });
  };
  // Teardown removes only this run's owner entry, so it also covers a partial grant.
  try {
    await convex(["run", "auth/owners:grantOwner", JSON.stringify({ email: owner.email })]);
    await asOwner();
    await writer.mutation(api.auth.staffAccess.claimInvite, {});
  } catch (error) {
    await teardown();
    throw error;
  }

  /** Restores the fixture villa, then the owner grant, then removes run-owned users. */
  async function teardown() {
    let failed = false;
    if (coldArchived) {
      try {
        await setColdStatus("active");
      } catch { failed = true; }
    }
    if (mutated) {
      try {
        await setStatus("active");
        await setName(seededName);
      } catch { failed = true; }
    }
    try {
      await convex(["run", "auth/owners:revokeOwner", JSON.stringify({ email: owner.email })]);
    } catch { failed = true; }
    try { await provisioned.cleanupSessions(); } catch { failed = true; }
    if (!failed) await rm(work, { recursive: true });
    return failed ? "failed" : "passed";
  }

  return { coldPath: `/rooms/${coldSlug}`, setColdStatus, clock, runId, names, report, observations, processes, get, record, poll, label, save, setName, setStatus, teardown };
}

/**
 * Runs `exercise` against the dedicated target and always tears down. The exercise returns
 * its summary; `passed` must be set by the exercise itself.
 */
export async function runVillaAcceptance(
  isolation: string,
  extraReport: Record<string, unknown>,
  exercise: (target: VillaTarget, stage: (name: string) => void) => Promise<Record<string, unknown> & { passed: boolean }>,
) {
  let stage = "target";
  let target: VillaTarget | undefined;
  let summary: Record<string, unknown>;
  try {
    target = await openVillaTarget(isolation, extraReport);
    summary = await exercise(target, (name) => { stage = name; });
  } catch (error) {
    summary = { passed: false, stage, processes: target?.processes.size, error: error instanceof Error ? error.message.slice(0, 400) : "error" };
  }
  const teardown = target ? await target.teardown() : "not-provisioned";
  if (target) {
    target.report.summary = summary;
    target.report.teardown = teardown;
    await target.save();
  }
  console.log(JSON.stringify(summary), teardown);
  if (!summary.passed || teardown === "failed") process.exitCode = 1;
}

/** Every process seen in recorded observations and their polling traces. */
export function workersSeen(target: VillaTarget) {
  return new Set(target.observations.flatMap((o) => [o.process, ...((o.seen as string[] | undefined) ?? []).map((s) => s.split("@")[1])]));
}

export { sleep };
