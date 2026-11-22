import { readFileSync, writeFileSync } from "node:fs";
import { access, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { localBackend } from "../e2e/backend";

type Sample = { operation: string; concurrency: number; batch: number; elapsedMs: number; success: boolean };

// Both isolated backends finish preparing before either takes a timed sample.
// The arms reverse order on each batch and never issue timed calls simultaneously.
async function pairedCadence() {
  const dir = process.env.BENCH_CATALOG_PAIR_DIR;
  const arm = process.env.BENCH_CATALOG_ARM;
  if (!dir && !arm) return;
  if (!dir || (arm !== "control" && arm !== "candidate") || !(await stat(dir)).isDirectory()) {
    throw new Error("Both arms require a new shared local coordination directory");
  }
  const other = arm === "control" ? "candidate" : "control";
  const marker = (n: number, side: string, event: string) => join(dir, n + "-" + side + "-" + event);
  async function waitFor(file: string) {
    const deadline = Date.now() + 180_000;
    for (;;) {
      try { await access(file); return; } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      if (Date.now() >= deadline) throw new Error("Peer benchmark missed its collection window");
      await delay(10);
    }
  }
  return {
    async begin(n: number) {
      await writeFile(marker(n, arm, "ready"), "", { flag: "wx" });
      await waitFor(marker(n, other, "ready"));
      const first = n % 2 === 0 ? "control" : "candidate";
      if (arm !== first) await waitFor(marker(n, other, "done"));
    },
    async end(n: number) { await writeFile(marker(n, arm, "done"), "", { flag: "wx" }); },
  };
}

test("seeded catalog reads under edits and staff checkout and inbox controls", async ({ page }) => {
  const out = process.env.BENCH_CATALOG_OUT;
  test.skip(!out, "Opt in through the disposable seeded integration harness.");
  const app = new URL(process.env.E2E_BASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(app.hostname);
  expect(app.protocol).toBe("http:");
  const cadence = await pairedCadence();
  const reader = localBackend();
  const writer = localBackend();
  await clerkSetup({ dotenv: false });
  await setupClerkTestingToken({ page });
  await page.goto(new URL("/admin/chats", app).href);
  await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
  async function renew() {
    const token = await page.evaluate(() => window.Clerk.session?.getToken({ template: "convex" }));
    if (!token) throw new Error("The run-owned Clerk test session is required");
    writer.setAuth(token);
  }
  await renew();
  const villa = await reader.query(api.catalog.publicProperties.getBySlug, { slug: "pool-villa" });
  if (!villa) throw new Error("The normal seeded demo resort is required");
  const draft = await writer.mutation(api.catalog.adminProperties.create, { name: "Catalog measurement", slug: "catalog-cost-fixture" });
  const fields = {
    rating: 5, authorName: "Fixture guest", authorCity: "", authorCountry: "", verified: true,
    title: "Review fixture", date: "2026-09-01", body: "Our room had a private terrace. ".repeat(8),
  };
  let reviewId: Id<"reviews"> | undefined;
  for (let i = 0; i < 200; i++) {
    if (i % 50 === 0) await renew();
    const id = await writer.mutation(api.catalog.adminReviews.create, {
      ...fields, propertyId: i % 5 === 0 ? draft : villa.villa._id, title: "Stay " + i,
    });
    if (i === 199) reviewId = id;
  }
  if (!reviewId) throw new Error("Fixture review missing");
  const targetReview = reviewId;
  const endpoint = new URL(process.env.BENCH_SPAN_ENDPOINT!);
  expect(["127.0.0.1", "localhost"]).toContain(endpoint.hostname);
  expect(endpoint.protocol).toBe("http:");
  async function mark(window: "start" | "finish", runId: string) {
    const result = await fetch(endpoint.href + "/" + window, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }),
    });
    expect(result.ok).toBe(true);
  }
  // The initial fixture uses 100 reads per concurrency. The expanded paired run also needs
  // enough independent writes to estimate its p95 (10 parallel reads share one edit).
  const repeats = process.env.BENCH_CATALOG_BATCHES;
  const batchesPerLoad = repeats === undefined ? undefined : Number(repeats);
  if (batchesPerLoad !== undefined && (!Number.isInteger(batchesPerLoad) || batchesPerLoad < 100 || batchesPerLoad > 500)) {
    throw new Error("BENCH_CATALOG_BATCHES must be an integer from 100 to 500");
  }
  const batchesByConcurrency = { 1: batchesPerLoad ?? 100, 10: batchesPerLoad ?? 10 };
  const samples: Sample[] = [];
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Only revision-identifiable application, backend and harness code may enter a timed report.
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "convex", "src", "scripts", "tests/bench", "bun.lock"]);
  const versions = {
    node: process.version, system: process.platform, arch: process.arch,
    convexClient: JSON.parse(readFileSync("node_modules/convex/package.json", "utf8")).version as string,
  };
  const lockSha = createHash("sha256").update(readFileSync("bun.lock")).digest("hex");
  let sequence = 0;
  let epoch = 0;
  const persist = () => writeFileSync(out!, JSON.stringify({ revision, lockSha, versions, fixtureReviews: 200, editCadenceMs: 350, batchesByConcurrency, paired: Boolean(cadence), samples }) + "\n", { mode: 0o600 });
  async function time<T>(operation: string, concurrency: number, batch: number, task: () => Promise<T>) {
    const t0 = performance.now();
    try {
      const value = await task();
      samples.push({ operation, concurrency, batch, elapsedMs: performance.now() - t0, success: true });
      return value;
    } catch (error) {
      samples.push({ operation, concurrency, batch, elapsedMs: performance.now() - t0, success: false });
      persist();
      throw error;
    }
  }
  expect((await writer.query(api.pos.orders.listOpenOrders, { paginationOpts: { numItems: 20, cursor: null } })).page.length).toBeGreaterThan(0);
  expect((await writer.query(api.messaging.adminChat.listSessions, { empty: "non_empty" })).sessions.length).toBeGreaterThan(0);
  const staffControls = [
    { name: "checkout", query: async () => writer.query(api.pos.orders.listOpenOrders, { paginationOpts: { numItems: 20, cursor: null } }) },
    { name: "inbox", query: async () => writer.query(api.messaging.adminChat.listSessions, { empty: "non_empty" }) },
  ] as const;
  try {
    for (const concurrency of [1, 10] as const) {
      const batches = batchesByConcurrency[concurrency];
      for (let batch = 0; batch < batches; batch++) {
        if (batch % 20 === 0) await renew();
        const runId = "catalog-" + concurrency + "-" + batch;
        await cadence?.begin(epoch);
        await mark("start", runId);
        const started = performance.now();
        const title = "Measured stay " + ++sequence;
        await time("review-write", concurrency, batch, () => writer.mutation(
          api.catalog.adminReviews.update, { ...fields, reviewId: targetReview, title },
        ));
        for (const phase of ["post-edit", "warm"]) {
          const responses = await Promise.all(Array.from({ length: concurrency }, () =>
            time("featured-" + phase, concurrency, batch, () => reader.query(api.catalog.publicProperties.featuredReviews, { limit: 6 }))));
          expect(responses.every(rows => rows.length === 6 && rows.some(row => row.title === title))).toBe(true);
        }
        for (const op of staffControls) {
          await Promise.all(Array.from({ length: concurrency }, () => time(op.name, concurrency, batch, async () => { await op.query(); })));
        }
        await mark("finish", runId);
        await cadence?.end(epoch++);
        persist();
        await delay(Math.max(0, 350 - (performance.now() - started)));
      }
    }
  } finally {
    persist();
    await clerk.signOut({ page });
  }
});
