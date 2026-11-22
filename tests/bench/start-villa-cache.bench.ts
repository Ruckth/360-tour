import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

function localOrigin(value: string | undefined) {
  if (!value) throw new Error("Expected a URL from the isolated integration harness");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.port || url.username || url.password) throw new Error("Villa cache study requires a disposable local server");
  return url;
}

test("Start villa cache shows committed edits, recovers from an outage, and respects archive", async ({ page }) => {
  const controlUrl = process.env.START_VILLA_CACHE_STUDY_CONTROL;
  test.skip(!controlUrl, "Run with START_VILLA_CACHE_STUDY=1 in the isolated --start harness");
  test.setTimeout(120_000);
  if (process.env.E2E_MODE !== "integration") throw new Error("Expected the seeded integration profile");
  const app = localOrigin(process.env.E2E_BASE_URL);
  const convex = localOrigin(process.env.NEXT_PUBLIC_CONVEX_URL);
  const control = localOrigin(controlUrl);
  if (!/^\/study\/[0-9a-f-]{36}$/.test(control.pathname)) throw new Error("Expected the harness study capability");
  const out = process.env.START_VILLA_CACHE_STUDY_OUT;
  if (!out) throw new Error("Set START_VILLA_CACHE_STUDY_OUT to a new private JSON path");
  const observations: object[] = [];
  const report = { fixture: "demo-resort", clock: "runner-monotonic-ms", observations };
  writeFileSync(out, JSON.stringify(report), { flag: "wx", mode: 0o600 });

  function record(phase: string, data: object) {
    observations.push({ phase, ...data });
    writeFileSync(out!, JSON.stringify(report, null, 2) + "\n");
  }

  async function proxy(mode?: "healthy" | "timeout") {
    const response = await fetch(control, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Cannot control the isolated read proxy");
    return response.json() as Promise<{ mode: string; detailReads: number; timedOutReads: number }>;
  }

  const room = "/rooms/pool-villa";
  const edited = "Cache Study Published Edit";
  const recovery = "Cache Study Recovered Edit";
  async function document(path: string) {
    const start = performance.now();
    const response = await fetch(new URL(path, app), { signal: AbortSignal.timeout(10_000), redirect: "error" });
    const html = await response.text();
    return {
      status: response.status,
      durationMs: performance.now() - start,
      cache: response.headers.get("x-villa-cache"),
      retryAfter: response.headers.get("retry-after"),
      edited: html.includes(edited),
      recovered: html.includes(recovery),
    };
  }

  await clerkSetup({ dotenv: false });
  await setupClerkTestingToken({ page });
  await page.goto(room);
  const owner = process.env.E2E_OWNER_EMAIL;
  if (!owner) throw new Error("Expected a run-owned Clerk test admin");
  await clerk.signIn({ page, emailAddress: owner });
  const write = new ConvexHttpClient(convex.origin, { logger: false });
  const read = new ConvexHttpClient(convex.origin, { logger: false });
  const fixture = await read.query(api.catalog.publicProperties.getBySlug, { slug: "pool-villa" });
  if (!fixture) throw new Error("Expected the active demo pool villa fixture");
  async function asOwner() {
    const token = await page.evaluate(() => window.Clerk.session?.getToken({ template: "convex" }));
    if (!token) throw new Error("No authenticated test owner session");
    write.setAuth(token);
  }
  async function setName(name: string) {
    await asOwner();
    await write.mutation(api.catalog.properties.update, { propertyId: fixture!.villa._id, name });
  }

  try {
    await proxy("healthy");
    record("warm", { ...(await document(room)), ...(await proxy()) });
    const editStart = performance.now();
    await setName(edited);
    await expect.poll(async () => (await document(room)).edited, { timeout: 10_000 }).toBe(true);
    record("authorized-edit", { elapsedMs: performance.now() - editStart, ...(await document(room)), ...(await proxy()) });

    const beforeOutage = await proxy("timeout");
    await setName(recovery);
    let warmOutage = await document(room);
    if ((await proxy()).timedOutReads === beforeOutage.timedOutReads) {
      await expect.poll(async () => {
        warmOutage = await document(room);
        return (await proxy()).timedOutReads;
      }, { timeout: 12_000 }).toBeGreaterThan(beforeOutage.timedOutReads);
    }
    record("warm-outage", { ...warmOutage, ...(await proxy()) });
    expect(warmOutage).toMatchObject({ status: 200, edited: true, recovered: false });

    const coldOutage = await document("/rooms/cache-study-unknown-villa");
    record("cold-outage", { ...coldOutage, ...(await proxy()) });
    expect(coldOutage.status).toBe(503);

    await proxy("healthy");
    const restoredAt = performance.now();
    await expect.poll(async () => (await document(room)).recovered, { timeout: 40_000, intervals: [1_000] }).toBe(true);
    record("recovered", { elapsedMs: performance.now() - restoredAt, ...(await document(room)), ...(await proxy()) });

    await asOwner();
    await write.mutation(api.catalog.adminProperties.setStatus, { propertyId: fixture.villa._id, status: "archived" });
    await expect.poll(async () => (await document(room)).status, { timeout: 10_000 }).toBe(404);
    record("archived", { ...(await document(room)), ...(await proxy()) });
    await proxy("timeout");
    const archivedOutage = await document(room);
    record("archived-outage", { ...archivedOutage, ...(await proxy()) });
    expect(archivedOutage.status).toBe(404);

    await proxy("healthy");
    await asOwner();
    await write.mutation(api.catalog.adminProperties.setStatus, { propertyId: fixture.villa._id, status: "active" });
    await expect.poll(async () => (await document(room)).recovered, { timeout: 10_000 }).toBe(true);
    const reactivated = await document(room);
    record("reactivated", { ...reactivated, ...(await proxy()) });
    expect(reactivated).toMatchObject({ status: 200, recovered: true });
  } finally {
    await proxy("healthy");
  }
});
