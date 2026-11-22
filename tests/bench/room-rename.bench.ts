import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { makeFunctionReference, type PaginationResult } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { localBackend } from "../e2e/backend";

const clearCertificate = makeFunctionReference<"mutation", { roomId: Doc<"tourScenes">["_id"] }, null>(
  "maintenance/roomRenameBenchmarkFixture:clearCertificate",
);
const history = makeFunctionReference<"query", {
  entityType: "room"; entityId: string; paginationOpts: { numItems: number; cursor: null };
}, PaginationResult<Doc<"recordChanges">>>("settings/recordHistory:list");

async function waitFor(file: string) {
  const expires = Date.now() + 480_000;
  for (;;) {
    try { await access(file); return; } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    if (Date.now() >= expires) throw new Error("Matched benchmark missed a synchronization marker");
    await delay(20);
  }
}

test("authenticated growing room rename at 2 and 50 scenes", async ({ page }) => {
  const output = process.env.BENCH_ROOM_RENAME_OUT;
  test.skip(!output, "Enable in both isolated integration harnesses.");
  test.setTimeout(720_000);
  const dir = process.env.BENCH_ROOM_RENAME_PAIR_DIR!;
  const arm = process.env.BENCH_ROOM_RENAME_ARM;
  if ((arm !== "control" && arm !== "candidate") || !(await stat(dir)).isDirectory()) {
    throw new Error("Both arms need a fresh shared coordination directory");
  }
  const repeats = Number(process.env.BENCH_ROOM_RENAME_REPEATS ?? 100);
  expect(Number.isInteger(repeats) && repeats >= 100 && repeats <= 250).toBe(true);
  const blockSize = Number(process.env.BENCH_ROOM_RENAME_BLOCK ?? 1);
  expect(Number.isInteger(blockSize) && blockSize >= 1 && blockSize <= 10 && repeats % (2 * blockSize) === 0).toBe(true);
  const other = arm === "control" ? "candidate" : "control";
  const app = new URL(process.env.E2E_BASE_URL!);
  const endpoint = new URL(process.env.BENCH_SPAN_ENDPOINT!);
  for (const url of [app, endpoint]) {
    expect(url.protocol).toBe("http:");
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  }
  const writer = localBackend();
  await clerkSetup({ dotenv: false });
  await setupClerkTestingToken({ page });
  await page.goto(new URL("/admin/chats", app).href);
  await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });

  async function renew() {
    const token = await page.evaluate(() => window.Clerk.session?.getToken({ template: "convex" }));
    if (!token) throw new Error("The run-owned Clerk session is required");
    writer.setAuth(token);
  }
  function marker(name: string) { return join(dir, name); }
  async function mark(phase: "start" | "finish", runId: string) {
    const result = await fetch(endpoint.href + "/" + phase, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }),
    });
    expect(result.ok).toBe(true);
  }

  const edit = api.catalog.properties.updateRoom;
  const sizes = [2, 50] as const;
  const shortName = "Living";
  const fixtures = new Map<number, Doc<"tourScenes">["_id"]>();
  const checked = createHash("sha256");
  await renew();
  for (const count of sizes) {
    const propertyId = await writer.mutation(api.catalog.adminProperties.create, {
      name: "Room rename fixture", slug: `rename-${count}`,
    });
    for (let i = 1; i <= count; i++) {
      if (i % 20 === 0) await renew();
      const id = await writer.mutation(api.catalog.adminProperties.createRoom, {
        propertyId, name: i === 1 ? shortName : `Fixture room ${i}`,
        slug: `room-${i}`, imagePath: "/fixture-panorama.webp",
      });
      if (i === 1) fixtures.set(count, id);
    }
    const editor = await writer.query(api.catalog.adminProperties.get, { propertyId });
    expect(editor?.rooms.length).toBe(count);
    checked.update(JSON.stringify(editor?.rooms.map(({ slug, name, imagePath }) => ({ slug, name, imagePath }))));
  }

  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "convex", "src", "scripts", "tests/bench", "bun.lock"]);
  await writeFile(marker(`fixture-${arm}-ready`), "", { flag: "wx" });
  await waitFor(marker("release"));
  const samples: { phase: "steady" | "first-uncertified"; rooms: number; repeat: number; elapsedMs: number }[] = [];
  const phases = process.env.BENCH_ROOM_RENAME_FIRST === "1"
    ? [{ phase: "steady", n: repeats }, { phase: "first-uncertified", n: 10 }] as const
    : [{ phase: "steady", n: repeats }] as const;
  const environment = {
    revision, repeats, blockSize, node: process.version, arch: process.arch, platform: process.platform,
    lockSha: createHash("sha256").update(await readFile("bun.lock")).digest("hex"),
    convexClient: JSON.parse(await readFile("node_modules/convex/package.json", "utf8")).version,
    localPorts: { app: Number(app.port), convex: Number(new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).port) },
  };
  const persist = (status: "running" | "complete" | "incomplete", flag = "w") => writeFile(output!, JSON.stringify({
    ...environment, status, verifiedResponseSha256: checked.copy().digest("hex"), samples,
  }) + "\n", { flag, mode: 0o600 });
  await persist("running", "wx");
  let status: "complete" | "incomplete" = "incomplete";
  try {
    for (const { phase, n } of phases) {
      for (let repeat = 0; repeat < n; repeat++) {
        for (const count of (repeat % 2 === 0 ? sizes : [...sizes].reverse())) {
          const roomId = fixtures.get(count)!;
          const runId = `catalog-rename-${phase}-${count}-${repeat}`;
          const slot = (owner: string, phase: string) => marker(`${runId}-${owner}-${phase}`);
          if (repeat % 20 === 0) await renew();
          await writeFile(slot(arm, "ready"), "", { flag: "wx" });
          await waitFor(slot(other, "ready"));
          const first = Math.floor(repeat / blockSize) % 2 === 0 ? "control" : "candidate";
          if (arm !== first) await waitFor(slot(other, "done"));

          await writer.mutation(edit, { roomId, name: shortName });
          if (phase === "first-uncertified") await writer.mutation(clearCertificate, { roomId });
          const name = `Living room renamed ${String(repeat).padStart(3, "0")}`;
          await mark("start", runId);
          const started = performance.now();
          const response = await writer.mutation(edit, { roomId, name });
          samples.push({ phase, rooms: count, repeat, elapsedMs: performance.now() - started });
          await mark("finish", runId);
          const audit = await writer.query(history, { entityType: "room", entityId: roomId, paginationOpts: { numItems: 1, cursor: null } });
          const { kind, before, after } = audit.page[0];
          const fields = { slug: "room-1", imagePath: "/fixture-panorama.webp", hotspots: [] };
          expect(response).toBeNull();
          expect({ kind, before, after }).toEqual({
            kind: "updated", before: { ...fields, name: shortName, propertyId: expect.any(String) },
            after: { ...fields, name, propertyId: expect.any(String) },
          });
          checked.update(JSON.stringify({ phase, count, repeat, before: { ...fields, name: shortName }, after: { ...fields, name } }));
          await persist("running");
          await writeFile(slot(arm, "done"), "", { flag: "wx" });
        }
      }
    }
    status = "complete";
  } finally {
    await persist(status);
    await clerk.signOut({ page });
  }
});
