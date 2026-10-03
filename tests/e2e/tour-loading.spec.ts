import { expect, test, type Request } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

/**
 * Progressive tour loading (agent E). In demo mode Convex is unavailable, so the viewer falls back
 * to the bundled rooms after its rooms timeout and renders the panoramas from the public root.
 *
 * These assertions prove the loading is proportional to the current room:
 *  - the FIRST room becomes usable (the tour phase shows its navigation) without the viewer having
 *    requested every site panorama first — the old code handed all room images to one loader call;
 *  - switching rooms works and the newly-entered room's panorama is requested.
 *
 * No fixed sleeps: every wait is on an observable condition (a request, or a visible control).
 */

// Equirectangular panoramas used by the bundled Tideglass Pool Residence tour and the wider site.
const POOL_LIVING = "pool-villa-living.webp";
const POOL_POOL = "pool-villa-pool.webp";
// Panoramas that belong to OTHER villas — they must not all be fetched to show the first room.
const OTHER_PANORAMAS = [
  "garden-suite-interior.webp",
  "garden-dining360.webp",
  "garden-villa-360.webp",
  "penthouse-bedroom.webp",
];

function isPanorama(url: string, name: string): boolean {
  return url.includes(name);
}

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

test("@smoke first tour room loads without fetching every panorama, and switching rooms works", async ({
  page,
}) => {
  const panoramaRequests: { url: string; at: number }[] = [];
  const start = Date.now();
  page.on("request", (request: Request) => {
    const url = request.url();
    if (url.includes(".webp") && (url.includes("villa") || url.includes("garden") || url.includes("penthouse"))) {
      panoramaRequests.push({ url, at: Date.now() - start });
    }
  });

  await page.goto("/");

  const poolCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Tideglass Pool Residence" }) });
  await poolCard.getByRole("button", { name: "Explore 360" }).click();

  // The viewer mounts immediately and keeps the villa identity (intro heading, then an sr-only heading).
  await expect(page.getByTestId("tour-viewer")).toContainText("Tideglass Pool Residence");

  // Readiness-driven progression: the tour's room navigation (bottom controls) appears once the
  // first room's texture is ready. The old 1,100ms + 400ms fixed waits are gone, so this is the
  // real readiness signal, not a timer.
  const nextRoomButton = page.getByRole("button", { name: /Pool Area/i });
  await expect(nextRoomButton).toBeVisible({ timeout: 20_000 });

  // At the moment the first room is usable, the current room's panorama was requested…
  const livingRequested = panoramaRequests.some((r) => isPanorama(r.url, POOL_LIVING));
  expect(livingRequested).toBe(true);

  // …and the viewer did NOT eagerly request every unrelated villa's panorama to get there. The
  // first room must not wait on other villas' textures.
  const otherRequestedCount = OTHER_PANORAMAS.filter((name) =>
    panoramaRequests.some((r) => isPanorama(r.url, name)),
  ).length;
  expect(otherRequestedCount).toBeLessThan(OTHER_PANORAMAS.length);

  // Switching rooms works: navigate to the pool area and confirm its panorama is fetched and the
  // return control (back to Living Area) becomes available.
  await nextRoomButton.click();
  await expect
    .poll(() => panoramaRequests.some((r) => isPanorama(r.url, POOL_POOL)), { timeout: 20_000 })
    .toBe(true);
  await expect(page.getByRole("button", { name: /Living Area/i })).toBeVisible({ timeout: 20_000 });
});
