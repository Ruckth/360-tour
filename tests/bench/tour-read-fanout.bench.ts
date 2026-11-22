import { writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { ConvexClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { localBackend, signedInBackend } from "../e2e/backend";

type Rooms = FunctionReturnType<typeof api.catalog.properties.getTourRooms>;
type Detail = FunctionReturnType<typeof api.catalog.publicProperties.getBySlug>;

test("distinguishes Convex tour re-evaluations from delivered guest state", async ({ page }) => {
  const output = process.env.BENCH_TOUR_FANOUT_OUT;
  test.skip(!output, "Run on a dedicated seeded local integration backend.");
  const http = localBackend();
  const endpoint = new URL(process.env.BENCH_SPAN_ENDPOINT!);
  expect(["localhost", "127.0.0.1"]).toContain(endpoint.hostname);
  expect(endpoint.protocol).toBe("http:");
  const backend = process.env.NEXT_PUBLIC_CONVEX_URL!;
  const args = { slug: "pool-villa" };
  await clerkSetup({ dotenv: false });
  await setupClerkTestingToken({ page });
  const staff = await signedInBackend(page);
  const original = await http.query(api.catalog.publicProperties.getBySlug, args);
  if (!original) throw new Error("Missing seeded villa");
  const propertyId = original.villa._id;
  const staffView = await staff.query(api.catalog.adminProperties.get, { propertyId });
  const scene = staffView?.rooms[0];
  if (!scene) throw new Error("Missing seeded tour scenes");
  const results = [];
  async function observeWindow(window: "start" | "finish", runId: string) {
    const response = await fetch(endpoint.href + "/" + window, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }),
    });
    expect(response.ok).toBe(true);
  }
  // A second subscription acknowledges a property edit that leaves getTourRooms unchanged.
  // Its callbacks are kept separate from the one live tour subscription per guest.
  try {
    for (const count of [1, 10]) {
      const peers = Array.from({ length: count }, () => new ConvexClient(backend));
      const audit = new ConvexClient(backend);
      const observations = peers.map(() => ({ updates: 0, value: undefined as Rooms | undefined }));
      let detail: Detail | undefined;
      const errors: Error[] = [];
      try {
        for (const action of ["open", "price", "description", "scene"] as const) {
          const id = "tour-reads-" + count + "-" + action;
          const before = observations.map(row => row.updates);
          await observeWindow("start", id);
          const started = performance.now();
          if (action === "open") {
            audit.onUpdate(api.catalog.publicProperties.getBySlug, args, value => { detail = value; }, error => errors.push(error));
            peers.forEach((peer, i) => {
              peer.onUpdate(api.catalog.properties.getTourRooms, args, value => {
                observations[i].updates++;
                observations[i].value = value;
              }, error => errors.push(error));
            });
            await expect.poll(() => Boolean(detail) && observations.every(row => row.value?.length)).toBe(true);
          } else if (action === "price") {
            const price = original.villa.pricePerNight + count;
            await staff.mutation(api.catalog.properties.update, { propertyId, pricePerNight: price });
            await expect.poll(() => detail?.villa.pricePerNight).toBe(price);
          } else if (action === "description") {
            const description = "Measured room description " + count;
            await staff.mutation(api.catalog.properties.update, { propertyId, description });
            await expect.poll(() => detail?.villa.description).toBe(description);
          } else {
            const name = "Measured scene " + count;
            await staff.mutation(api.catalog.properties.updateRoom, { roomId: scene._id, name });
            await expect.poll(() => observations.every(row => row.value?.some(room => room.name === name))).toBe(true);
          }
          const observedMs = performance.now() - started;
          await wait(300);
          await observeWindow("finish", id);
          const updates = observations.map((row, i) => row.updates - before[i]);
          expect(errors).toHaveLength(0);
          expect(updates).toEqual(Array.from({ length: count }, () => ["open", "scene"].includes(action) ? 1 : 0));
          results.push({ id, count, action, updates, observedMs });
        }
      } finally {
        await Promise.all([audit, ...peers].map(peer => peer.close()));
      }
    }
  } finally {
    await clerk.signOut({ page });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(output!, JSON.stringify({ revision, results }) + "\n", { mode: 0o600 });
  }
});
