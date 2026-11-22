#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as fs from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { getDocumentSize } from "convex/values";
import { localConvexCache } from "../local-convex-cache.mjs";

process.umask(0o077);
const [outputPath, generatedPath] = process.argv.slice(2);
if (!outputPath || !generatedPath) throw new Error("Pass new private report and generated API paths");
const root = process.cwd();
const work = await fs.mkdtemp(join(tmpdir(), "tour-certificate-local-"));
const project = join(work, "backend");
const home = join(work, "home");
const cli = join(root, "node_modules/convex/bin/main.js");
const env = {
  PATH: process.env.PATH, HOME: home, CONVEX_AGENT_MODE: "anonymous", CONVEX_TELEMETRY_DISABLED: "1",
};
const owner = "tour-recovery@example.invalid";
const issuer = "https://example.invalid";
let backend;

async function port() {
  const server = createServer();
  return await new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address !== "string");
      server.close(() => resolvePort(address.port));
    });
  });
}

function command(args, name) {
  const log = join(work, name + ".log");
  return fs.open(log, "w", 0o600).then(async (fd) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: project, env, detached: true, stdio: ["ignore", fd.fd, fd.fd],
    });
    const done = new Promise((finish, reject) => {
      child.once("error", reject);
      child.once("exit", finish);
    });
    await fd.close();
    return { child, done, log };
  });
}

async function run(args, name) {
  const task = await command(args, name);
  assert.equal(await task.done, 0, `${name} failed (private log ${task.log})`);
}

// Native local deployments enforce the 4 MiB/s write rate even after CLI import.
async function afterWriteQuota(task) {
  for (let attempt = 0; ; attempt++) {
    try { return await task(); }
    catch (error) {
      if (attempt >= 4 || !(error instanceof Error) || !error.message.includes('"TooManyWrites"')) throw error;
      await sleep(1250);
    }
  }
}

async function waitFor(action) {
  for (let i = 0; i < 240; i++) {
    const result = await action().catch(() => undefined);
    if (result) return result;
    await sleep(250);
  }
  throw new Error("Timed out waiting for local deployment");
}

try {
  await fs.mkdir(project, { mode: 0o700 });
  await fs.mkdir(home, { mode: 0o700 });
  await localConvexCache(home);
  await fs.cp(join(root, "convex"), join(project, "convex"), { recursive: true });
  await fs.copyFile(join(root, "package.json"), join(project, "package.json"));
  await fs.symlink(join(root, "node_modules"), join(project, "node_modules"), "dir");
  const cloud = await port(), site = await port();
  const url = `http://127.0.0.1:${cloud}`;
  backend = await command(["dev", "--local-cloud-port", String(cloud), "--local-site-port", String(site),
    "--typecheck", "disable", "--tail-logs", "disable"], "backend");
  const config = await waitFor(async () => JSON.parse(await fs.readFile(join(project, ".convex/local/default/config.json"), "utf8")));
  const headers = { Authorization: `Convex ${config.adminKey}`, "content-type": "application/json" };
  async function vars(changes) {
    const res = await fetch(url + "/api/update_environment_variables", { method: "POST", headers, body: JSON.stringify({ changes }) });
    return res.ok;
  }
  await waitFor(() => vars([{ name: "CLERK_JWT_ISSUER_DOMAIN", value: issuer }, { name: "ADMIN_EMAILS", value: owner }]));
  await waitFor(async () => (await fs.readFile(backend.log, "utf8")).includes("Convex functions ready"));
  const operator = new ConvexHttpClient(url);
  operator.setAdminAuth(config.adminKey);
  await operator.mutation(makeFunctionReference("maintenance/seed:seedAll"), { scenario: "demo-resort" });
  const admin = new ConvexHttpClient(url);
  admin.setAdminAuth(config.adminKey, { issuer, subject: "room-certificate-smoke", email: owner, emailVerified: true });
  const anonymous = new ConvexHttpClient(url);
  const detail = (slug) => anonymous.query(makeFunctionReference("catalog/publicProperties:getBySlug"), { slug });
  const read = (propertyId) => admin.query(makeFunctionReference("catalog/adminProperties:get"), { propertyId });
  const grow = (roomId, name) => afterWriteQuota(() => admin.mutation(makeFunctionReference("catalog/properties:updateRoom"), { roomId, name }));
  const pool = (await detail("pool-villa")).villa._id;
  const garden = (await detail("garden-suite")).villa._id;
  const penthouse = (await detail("penthouse")).villa._id;
  const before = (await read(pool)).rooms[0];
  const near = (await read(penthouse)).rooms[0];
  assert.equal(before.ordinaryTourCertified, true);
  assert.equal(near.ordinaryTourCertified, true);
  assert(await vars([{ name: "ARCH_RESET_PAUSED", value: "1" }]));
  const selection = join(work, "local.env");
  await fs.writeFile(selection, `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`, { mode: 0o600 });
  const snapshot = join(work, "before.zip");
  await run(["export", "--env-file", selection, "--path", snapshot], "export");
  const snapshotSha256 = createHash("sha256").update(await fs.readFile(snapshot)).digest("hex");
  const rows = Array.from({ length: 49 }, (_, i) => ({
    propertyId: pool, slug: `old-writer-${i}`, name: i < 3 ? "x".repeat(600_000) : "Small",
    imagePath: "/fixture.webp", hotspots: [],
  }));
  // The garden is an ordinary, wide room set. It forces pagination by bytes during the repair.
  rows.push(...Array.from({ length: 8 }, (_, i) => ({
    propertyId: garden, slug: `restored-large-${i}`, name: "x".repeat(900_000),
    imagePath: "/fixture.webp", hotspots: [], ordinaryTourCertified: true,
  })));
  const partial = join(work, "partial.json");
  await fs.writeFile(partial, JSON.stringify(rows) + "\n", { mode: 0o600 });
  await run(["import", "--env-file", selection, "--table", "tourScenes", "--append", partial], "partial-import");
  await assert.rejects(grow(before._id, "x".repeat(350_000)), /temporarily unavailable/);
  const repair = makeFunctionReference("maintenance/tourCertificates:page");
  let checkPointRejected = false;
  async function sweep(mode, propertyId) {
    let cursor = null, checkpoint = null, scanned = 0, certified = 0, cleared = 0, pages = 0, shortNonterminal = 0;
    for (;;) {
      const args = { targetOrigin: url, snapshotSha256, mode, cursor, checkpoint, ...(propertyId && { propertyId }) };
      const result = await afterWriteQuota(() => operator.mutation(repair, args));
      pages++;
      scanned += result.scanned;
      certified += result.certified;
      cleared += result.cleared;
      if (!result.isDone && result.scanned < 8) shortNonterminal++;
      if (result.isDone) return { pages, scanned, certified, cleared, shortNonterminal };
      if (!checkPointRejected) {
        await assert.rejects(afterWriteQuota(() => operator.mutation(repair, { ...args, cursor: result.cursor, checkpoint: "b".repeat(64) })), /checkpoint mismatch/);
        checkPointRejected = true;
      }
      ({ cursor, checkpoint } = result);
    }
  }
  await assert.rejects(afterWriteQuota(() => operator.mutation(repair, {
    targetOrigin: "https://wrong.convex.cloud", snapshotSha256, mode: "check", cursor: null, checkpoint: null,
  })), /target mismatch/);
  const gardenInspection = await sweep("check", garden);
  assert.equal(gardenInspection.scanned, 10);
  assert(gardenInspection.shortNonterminal > 0, "Expected native byte-budget truncation");
  const scoped = await sweep("clear", pool);
  assert.equal(scoped.scanned, 51);
  assert.equal(scoped.cleared, 2);
  assert.equal((await sweep("check", pool)).certified, 0);
  const wholeBefore = await sweep("check");
  assert.equal(wholeBefore.certified, 11);
  const wholeClear = await sweep("clear");
  assert.equal(wholeClear.cleared, 11);
  assert.equal((await sweep("check")).certified, 0);

  assert(await vars([{ name: "ARCH_RESET_PAUSED", value: "0" }]));
  await assert.rejects(grow(before._id, "x".repeat(350_000)), /exceed its safe size limit/);
  assert.equal((await anonymous.query(makeFunctionReference("catalog/properties:getTourRooms"), { slug: "pool-villa" })).length, 50);
  // Re-certify a short edit, then prove a subsequent valid near-limit edit drops the marker.
  await grow(near._id, near.name + " test");
  const nearCertified = (await read(penthouse)).rooms[0];
  assert.equal(nearCertified.ordinaryTourCertified, true);
  const exact = "x".repeat(1024 * 1024 - getDocumentSize({ ...nearCertified, name: "", ordinaryTourCertified: undefined }));
  await grow(near._id, exact);
  const final = (await read(penthouse)).rooms[0];
  assert.equal(final.ordinaryTourCertified, undefined);
  assert.equal(getDocumentSize(final), 1024 * 1024);
  await fs.copyFile(join(project, "convex/_generated/api.d.ts"), resolve(generatedPath), fs.constants.COPYFILE_EXCL);
  await fs.writeFile(resolve(outputPath), JSON.stringify({
    snapshotSha256, scoped, gardenInspection, wholeBefore, wholeClear, guardedAfterRepair: true,
    exactDocumentBytes: getDocumentSize(final), ordinaryCertificateRemoved: true,
    localOnly: true, earlierWriterSimulation: "uncertified native snapshot append",
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} finally {
  if (backend && backend.child.exitCode === null && backend.child.signalCode === null) {
    process.kill(-backend.child.pid, "SIGTERM");
    if (await Promise.race([backend.done.then(() => true), sleep(5000, false)]) === false) {
      process.kill(-backend.child.pid, "SIGKILL");
      await backend.done;
    }
  }
}
