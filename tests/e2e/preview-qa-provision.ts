import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv, promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { testUsers } from "../../scripts/e2e-clerk.mjs";

const run = promisify(execFile);
const workingRoot = import.meta.dirname && path.resolve(import.meta.dirname, "../..");
const previewPrefix = "perf-phase2-start-validation";
const providerKeys = [
  "AI_API_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OWNER_NOTIFICATION_EMAIL",
  "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "FACEBOOK_ACCESS_TOKEN", "FACEBOOK_APP_SECRET",
  "FACEBOOK_VERIFY_TOKEN", "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_VERIFY_TOKEN",
  "META_APP_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST",
  "VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST", "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "VITE_SENTRY_DSN",
] as const;
const testTenantFields = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_JWT_ISSUER_DOMAIN"] as const;
const roles = ["owner", "cashier", "nonstaff"] as const;
const observations: Record<string, unknown> = {};
let stage = "target";

async function readPrivate(file: string) {
  const descriptor = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await descriptor.stat();
    assert(stats.isFile() && (stats.mode & 0o777) === 0o600 && stats.size < 128_000);
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

async function main() {
  assert.equal(process.env.E2E_PREVIEW_QA_OPT_IN, "disposable-test-only");
  assert(workingRoot && !process.env.DEBUG && !process.env.PWDEBUG && !process.env.CLERK_TESTING_DEBUG);
  const stagingFile = process.env.E2E_PREVIEW_QA_PROVISION;
  const vercel = process.env.E2E_PREVIEW_VERCEL_BIN;
  assert(stagingFile && path.isAbsolute(stagingFile) && vercel && path.isAbsolute(vercel));
  const staging = JSON.parse(await readPrivate(stagingFile));
  assert.match(staging.commit, /^[a-f0-9]{40}$/);
  const previewName = staging.previewName;
  assert(previewName === previewPrefix || previewName === `${previewPrefix}-${staging.commit.slice(0, 12)}`);
  assert.equal(staging.isolation, "dedicated-vercel-convex-preview");
  assert.equal(staging.freshlySeeded, true);
  assert.equal(staging.providerDispatchDisabled, true);
  assert.equal(staging.frontendProviderOverridesBlank, true);
  assert.match(staging.convexProjectAnchor, /^dev:[a-z0-9-]+$/);
  assert.match(staging.scope, /^[a-z0-9-]+$/);
  assert.match(staging.deploymentId, /^dpl_[A-Za-z0-9]+$/);
  const app = httpsOrigin(staging.app, /^[a-z0-9-]+\.vercel\.app$/);
  const backend = httpsOrigin(staging.backend, /^[a-z0-9-]+\.convex\.cloud$/);
  const testTenant = parseEnv(await readPrivate(path.join(homedir(), ".config/360-tour/.env.e2e.local")));
  const clerkEnv = Object.fromEntries(testTenantFields.map((key) => [key, testTenant[key]]));
  const publishableKey = clerkEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  assert(publishableKey && publishableKey.startsWith("pk_test_"));
  assert(clerkEnv.CLERK_SECRET_KEY?.startsWith("sk_test_"));
  const issuer = httpsOrigin(clerkEnv.CLERK_JWT_ISSUER_DOMAIN?.replace(/\/$/, ""), /^[a-z0-9.-]+\.clerk\.accounts\.dev$/);
  assert.equal(Buffer.from(publishableKey.slice(8), "base64").toString(), new URL(issuer).host + "$");
  clerkEnv.CLERK_JWT_ISSUER_DOMAIN = issuer;
  const work = await mkdtemp(path.join(path.dirname(stagingFile), "preview-qa-"));
  const selector = path.join(work, "convex.env");
  await writeFile(selector, `CONVEX_DEPLOYMENT=${staging.convexProjectAnchor}\n`, { mode: 0o600 });
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: homedir(), NODE_ENV: "test", CI: "1", NO_COLOR: "1", VERCEL_TELEMETRY_DISABLED: "1",
  };
  const isolated = { cwd: workingRoot, env: cleanEnv, timeout: 90_000, maxBuffer: 24_000_000 };
  const convex = async (args: string[]) => (await run(process.execPath, [
    "node_modules/convex/bin/main.js", ...args, "--env-file", selector, "--preview-name", previewName,
  ], isolated)).stdout;
  const getEnv = async () => parseEnv(await convex(["env", "list", "--include-values"]));
  const ownerGrants = async (): Promise<Array<{ email: string }>> => JSON.parse(await convex(["run", "auth/owners:listOwners", "{}"]));
  const vercelRun = async (args: string[]) => (await run(vercel, args, { ...isolated, cwd: work })).stdout;
  const curl = async (route: string, options: string[] = []) => vercelRun([
    "curl", route, "--deployment", staging.deploymentId, "--scope", staging.scope,
    "--", "--silent", "--show-error", "--fail", "--max-time", "30", ...options,
  ]);

  let provisioned: Awaited<ReturnType<typeof testUsers>> | undefined;
  let addedOwner: string | undefined;
  try {
    stage = "immutable-preview";
    const deployment = JSON.parse(await vercelRun(["inspect", staging.deploymentId, "--scope", staging.scope, "--json"]));
    assert.equal(deployment.id, staging.deploymentId);
    assert.equal(`https://${deployment.url}`, app);
    assert.equal(deployment.readyState ?? deployment.state, "READY");
    assert.equal(deployment.target, "preview");
    const metadata = JSON.parse(await vercelRun(["api", `/v13/deployments/${staging.deploymentId}`, "--scope", staging.scope, "--raw"]));
    assert.equal(metadata.id, staging.deploymentId);
    assert.equal(`https://${metadata.url}`, app);
    assert.equal(metadata.meta?.phase2Validation, "isolated");
    assert.equal(metadata.meta?.githubCommitSha, staging.commit);
    assert.equal(metadata.meta?.githubCommitRef, previewName);

    stage = "provider-and-backend";
    const providerStatus = await curl("/rooms/pool-villa", [
      "--output", "/dev/null", "--write-out", "%{http_code} %header{x-start-provider-isolation}",
    ]);
    assert.equal(providerStatus.trim(), "200 verified");
    const runtime = await getEnv();
    assert.equal(runtime.CLERK_JWT_ISSUER_DOMAIN?.replace(/\/$/, ""), issuer);
    assert(providerKeys.every((key) => !runtime[key]?.trim()));
    const publicClient = new ConvexHttpClient(backend, { logger: false });
    const [linkedPool, pool, garden] = await Promise.all([
      convex(["run", "catalog/publicProperties:getBySlug", '{"slug":"pool-villa"}']),
      publicClient.query(api.catalog.publicProperties.getBySlug, { slug: "pool-villa" }),
      publicClient.query(api.catalog.publicProperties.getBySlug, { slug: "garden-suite" }),
    ]);
    assert(pool && garden && JSON.parse(linkedPool).villa._id === pool.villa._id);
    assert.equal(pool.villa.name, "Tideglass Pool Residence");
    assert.equal(garden.villa.name, "Mossbell Garden Suite");
    const html = await curl("/rooms/pool-villa");
    const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9_.-]+\.js/g) ?? [])];
    assert(assets.length > 0);
    const sources = await Promise.all(assets.slice(0, 16).map((asset) => curl(asset)));
    assert(sources.some((source) => source.includes(backend)));
    assert(sources.some((source) => source.includes(publishableKey)));

    stage = "protection";
    const cookieJar = path.join(work, "protect.cookies");
    await writeFile(cookieJar, "", { flag: "wx", mode: 0o600 });
    await curl("/robots.txt", [
      "--header", "x-vercel-set-bypass-cookie: true", "--cookie-jar", cookieJar, "--output", "/dev/null",
    ]);
    const cookieHost = new URL(app).hostname;
    assert((await readPrivate(cookieJar)).split(/\r?\n/).some((line) => {
      const parts = line.split("\t");
      return parts[0] === `#HttpOnly_${cookieHost}` && parts[1] === "FALSE" && parts[2] === "/" &&
        parts[3] === "TRUE" && parts[5] === "_vercel_jwt" && Boolean(parts[6]);
    }));

    stage = "run-owned-users";
    provisioned = await testUsers(clerkEnv);
    const emails = Object.fromEntries(roles.map((role) => [role, provisioned!.users[role].email]));
    const existingOwners = await ownerGrants();
    assert(existingOwners.length > 0, "Provision a Preview owner before running temporary owner QA");
    assert(!existingOwners.some((grant) => grant.email === emails.owner));
    const journal = path.join(work, "recovery.json");
    await writeFile(journal, JSON.stringify({ addedOwner: emails.owner }), { flag: "wx", mode: 0o600 });
    addedOwner = emails.owner;
    await convex(["run", "auth/owners:grantOwner", JSON.stringify({ email: addedOwner })]);

    const targetPath = path.join(work, "target.json");
    await writeFile(targetPath, JSON.stringify({ ...staging, ownerGrantsAreRunOwned: true, emails }), { flag: "wx", mode: 0o600 });
    const browserEnv = {
      ...cleanEnv, ...clerkEnv, E2E_PREVIEW_QA_OPT_IN: "disposable-test-only",
      E2E_PREVIEW_QA_TARGET: targetPath, E2E_PREVIEW_VERCEL_COOKIE_JAR: cookieJar,
      E2E_PREVIEW_QA_PROVISION_CASHIER: "1",
    };
    for (const mode of ["checkout-read-only", "isolated-fixtures"]) {
      stage = mode;
      let output: string;
      let failed = false;
      try {
        ({ stdout: output } = await run(process.execPath, ["tests/e2e/preview-qa.ts"], {
          ...isolated, timeout: 240_000, env: { ...browserEnv, E2E_PREVIEW_QA_MODE: mode },
        }));
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? "";
        failed = true;
      }
      const report = JSON.parse(output.trim().split(/\r?\n/).at(-1) ?? "");
      const accepted = ["target", "setup", "checkout-read-only", "auth", "booking", "chat", "live-tour", "cleanup"];
      observations[mode] = Object.fromEntries(Object.entries(report.stages as Record<string, unknown>)
        .filter(([key, val]) => accepted.includes(key) && (val === "pass" || val === "fail")));
      assert(!failed && report.status === "passed");
    }
  } finally {
    let cleanupFailed = false;
    if (addedOwner !== undefined) {
      try { await convex(["run", "auth/owners:revokeOwner", JSON.stringify({ email: addedOwner })]); }
      catch { cleanupFailed = true; }
    }
    try { await provisioned?.cleanupSessions(); }
    catch { cleanupFailed = true; }
    if (!cleanupFailed) await rm(work, { recursive: true });
    observations.teardown = cleanupFailed ? "failed" : "passed";
    assert(!cleanupFailed);
  }
}

try {
  await main();
  console.log(JSON.stringify({ status: "passed", observations }));
} catch {
  console.log(JSON.stringify({ status: "failed", stage, observations }));
  process.exitCode = 1;
}
