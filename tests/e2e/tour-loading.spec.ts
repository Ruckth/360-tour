import { expect, test, type Page, type Request } from "@playwright/test";
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
  const viewer = page.getByTestId("tour-viewer");
  await expect(viewer.getByText("1/2 rooms explored")).toBeVisible({ timeout: 20_000 });
  // The bottom-right "next room" control is the last Pool Area button (a hotspot and the
  // previous-room control share the name in a two-room tour).
  const nextRoomButton = viewer.getByRole("button", { name: "Pool Area", exact: true }).last();
  await expect(nextRoomButton).toBeVisible();

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
  await expect(viewer.getByText("2/2 rooms explored")).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByRole("button", { name: "Living Area", exact: true }).last()).toBeVisible();
});

// --- Navigation readiness: the outgoing room stays on screen until the incoming one is ACTUALLY ready.

/** Mean RGB brightness (0–255) of the tour canvas as composited on screen. ~0 = empty panorama. */
async function canvasBrightness(page: Page): Promise<number> {
  const png = await page.getByTestId("tour-viewer").locator("canvas").screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (data.length / 4) / 3;
  }, png.toString("base64"));
}

/** Hold every request for `name` until `release()`; optionally fail them while `failing` is set. */
async function controlPanorama(page: Page, name: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const state = { hold: true, failing: false, requests: 0 };
  await page.route(`**/${name}*`, async (route) => {
    state.requests += 1;
    if (state.failing) return route.fulfill({ status: 503, body: "unavailable" });
    if (state.hold) await released;
    return route.continue();
  });
  return {
    state,
    release: () => {
      state.hold = false;
      release();
    },
  };
}

async function openPoolTour(page: Page) {
  const poolCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Tideglass Pool Residence" }) });
  await poolCard.getByRole("button", { name: "Explore 360" }).click();
  const viewer = page.getByTestId("tour-viewer");
  await expect(viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  // Wait out the intro → tour fade so the panorama is fully painted before measuring it.
  await expect.poll(() => canvasBrightness(page), { timeout: 10_000 }).toBeGreaterThan(20);
  return viewer;
}

test("navigation keeps the outgoing room on screen and locked until the incoming panorama is ready", async ({
  page,
}) => {
  const pool = await controlPanorama(page, POOL_POOL);
  await page.goto("/");
  const viewer = await openPoolTour(page);
  await expect(viewer.getByText("1/2 rooms explored")).toBeVisible();
  const before = await canvasBrightness(page);

  await viewer.getByRole("button", { name: "Pool Area", exact: true }).last().click();

  // Requested pool, but the living room is still the one on screen; nothing completes while the
  // pool image is held — well past the 0.4s crossfade.
  await expect(viewer).toHaveAttribute("data-requested-room", "pv-pool");
  await expect(viewer).toHaveAttribute("data-scene-status", "pending");
  await page.waitForTimeout(1_200);
  await expect(viewer).toHaveAttribute("data-scene-status", "pending");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  await expect(viewer.getByText("1/2 rooms explored")).toBeVisible();
  // Incoming hotspots stay hidden and navigation is locked while pending.
  await expect(viewer.getByTestId("tour-hotspot")).toHaveCount(0);
  const navButtons = viewer.getByRole("button", { name: "Living Area", exact: true });
  await expect(navButtons.last()).toHaveAttribute("aria-disabled", "true");
  await navButtons.last().click({ force: true }); // ignored while locked
  await expect(viewer).toHaveAttribute("data-requested-room", "pv-pool");
  // The outgoing panorama is still painted (not an empty black sphere).
  expect(await canvasBrightness(page)).toBeGreaterThan(before * 0.5);

  // Record status changes so the crossfade is proven to run (not skip) after the idle pending wait.
  await viewer.evaluate((node) => {
    const log: Array<{ status: string | null; at: number }> = [];
    (window as unknown as { __tourStatusLog: typeof log }).__tourStatusLog = log;
    new MutationObserver(() =>
      log.push({ status: node.getAttribute("data-scene-status"), at: performance.now() }),
    ).observe(node, { attributes: true, attributeFilter: ["data-scene-status"] });
  });
  pool.release();
  await expect(viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool");
  await expect(viewer.getByText("2/2 rooms explored")).toBeVisible();
  const log = await page.evaluate(
    () => (window as unknown as { __tourStatusLog: Array<{ status: string; at: number }> }).__tourStatusLog,
  );
  const crossfadeAt = log.find((entry) => entry.status === "crossfade")?.at;
  const readyAt = log.find((entry) => entry.status === "ready")?.at;
  expect(crossfadeAt).toBeDefined();
  expect(readyAt).toBeDefined();
  // 0.4s fade: the first frame after idling must not jump straight to the end.
  expect(readyAt! - crossfadeAt!).toBeGreaterThan(300);
  await expect(viewer.getByTestId("tour-hotspot")).toHaveCount(1);
  await expect(navButtons.last()).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => canvasBrightness(page)).toBeGreaterThan(20);
});

test("a failed navigation keeps the previous room, retries, and the tour reopens cleanly", async ({
  page,
}) => {
  const pool = await controlPanorama(page, POOL_POOL);
  pool.state.failing = true;
  pool.release();
  await page.goto("/");
  let viewer = await openPoolTour(page);
  const before = await canvasBrightness(page);

  await viewer.getByRole("button", { name: "Pool Area", exact: true }).last().click();
  const alert = viewer.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-scene-status", "failed");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  // The previous room is still painted behind the (80% black) error overlay.
  expect(await canvasBrightness(page)).toBeGreaterThan(before * 0.1);

  // Retry while the network is still failing, then once it recovers.
  const failedRequests = pool.state.requests;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toBeVisible();
  await expect.poll(() => pool.state.requests).toBeGreaterThan(failedRequests);
  pool.state.failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool");
  await expect(viewer.getByText("2/2 rooms explored")).toBeVisible();

  // Close and reopen: a fresh tour loads its first room again (nothing disposed is reused).
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  viewer = await openPoolTour(page);
  await viewer.getByRole("button", { name: "Pool Area", exact: true }).last().click();
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool", { timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-scene-status", "ready");
});
