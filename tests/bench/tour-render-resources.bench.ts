import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { verifySoftwareWebGLRenderer } from "./tour-mobile-profile";

type Counters = { allocated: number; deleted: number; live: number; losses: number; restorations: number };
type Probe = { contexts: Counters[]; frames: number; yaw: number; room: string };

declare global {
  interface Window {
    __tourResources: Probe;
  }
}

/** Observe the application's actual GL handles without retaining textures or contexts. */
function installProbe() {
  sessionStorage.setItem("seaview-demo-disclaimer-dismissed", "true");
  const probe: Probe = { contexts: [], frames: 0, yaw: 0, room: "" };
  window.__tourResources = probe;
  window.__tourBench = {
    mark() {},
    frame(yaw, room) {
      probe.frames++;
      probe.yaw = yaw;
      probe.room = room;
    },
  };
  const contexts = new WeakMap<WebGL2RenderingContext, { counts: Counters; textures: WeakSet<WebGLTexture> }>();
  function observe(gl: WebGL2RenderingContext) {
    let state = contexts.get(gl);
    if (state) return state;
    const counts = { allocated: 0, deleted: 0, live: 0, losses: 0, restorations: 0 };
    state = { counts, textures: new WeakSet() };
    contexts.set(gl, state);
    probe.contexts.push(counts);
    gl.canvas.addEventListener("webglcontextlost", () => {
      counts.losses++;
      counts.live = 0;
      const current = contexts.get(gl);
      if (current) current.textures = new WeakSet();
    });
    gl.canvas.addEventListener("webglcontextrestored", () => { counts.restorations++; });
    return state;
  }
  const gl = WebGL2RenderingContext.prototype;
  const create = gl.createTexture;
  const remove = gl.deleteTexture;
  gl.createTexture = function () {
    const texture = create.call(this);
    if (texture) {
      const { counts, textures } = observe(this);
      textures.add(texture);
      counts.allocated++;
      counts.live++;
    }
    return texture;
  };
  gl.deleteTexture = function (texture) {
    const state = contexts.get(this);
    if (texture && state?.textures.delete(texture)) {
      state.counts.deleted++;
      state.counts.live--;
    }
    remove.call(this, texture);
  };
}

async function luminance(page: Page) {
  const png = await page.getByTestId("tour-viewer").locator("canvas").screenshot();
  return page.evaluate(async (bytes) => {
    const image = new Image();
    image.src = "data:image/png;base64," + bytes;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (64 * 64 * 3);
  }, png.toString("base64"));
}

test("tour draws, restores its panorama and releases textures across ten reopens", async ({ page, browser }) => {
  const out = process.env.BENCH_TOUR_RESOURCES_OUT;
  test.skip(!out, "Opt in on a seeded local production build.");
  const target = new URL(process.env.E2E_BASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
  const renderer = await verifySoftwareWebGLRenderer(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(installProbe);
  await page.goto("/rooms/pool-villa");
  const viewer = page.getByTestId("tour-viewer");
  const open = page.getByRole("button", { name: /Explore (in )?360/i }).first();
  const cycles = [];
  let idleFrames = 0;
  let idleMs = 0;
  let restoredBrightness = 0;
  let initialBrightness = 0;
  const live = () => page.evaluate(() => window.__tourResources.contexts.reduce((sum, c) => sum + c.live, 0));
  const state = () => page.evaluate(() => window.__tourResources);
  for (let cycle = 0; cycle <= 10; cycle++) {
    const before = await state();
    await open.click();
    await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
    await expect(viewer).toHaveAttribute("data-scene-status", "ready");
    await expect.poll(async () => (await state()).frames).toBeGreaterThan(before.frames);
    if (cycle === 0) {
      await expect.poll(() => luminance(page)).toBeGreaterThan(20);
      initialBrightness = await luminance(page);
      // Let the first texture upload and the overlay settle before observing idle draw rate.
      await page.waitForTimeout(1_500);
      const start = await page.evaluate(() => ({ frames: window.__tourResources.frames, at: performance.now() }));
      await page.waitForTimeout(3_000);
      const end = await page.evaluate(() => ({ frames: window.__tourResources.frames, at: performance.now() }));
      idleFrames = end.frames - start.frames;
      idleMs = end.at - start.at;
      expect(idleFrames * 1_000 / idleMs).toBeLessThanOrEqual(1);

      const canvas = viewer.locator("canvas");
      const lossControl = await canvas.evaluateHandle((node: HTMLCanvasElement) => {
        const ext = node.getContext("webgl2")?.getExtension("WEBGL_lose_context");
        if (!ext) throw new Error("The benchmark requires a loss-capable WebGL2 context");
        return ext;
      });
      try {
        await lossControl.evaluate(ext => ext.loseContext());
        await expect.poll(async () => (await state()).contexts.some(c => c.losses > 0)).toBe(true);
        await lossControl.evaluate(ext => ext.restoreContext());
      } finally {
        await lossControl.dispose();
      }
      await expect.poll(async () => (await state()).contexts.some(c => c.restorations > 0)).toBe(true);
      // No user input between restoration and the check for a painted panorama.
      await expect.poll(() => luminance(page), { timeout: 8_000 }).toBeGreaterThan(initialBrightness * 0.7);
      restoredBrightness = await luminance(page);
      const baseline = await state();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Tour canvas disappeared after restoring its context");
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => Math.abs((await state()).yaw - baseline.yaw)).toBeGreaterThan(0.005);
      expect((await state()).room).toBe("pv-living");
    }
    const openHandles = await live();
    expect(openHandles).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    // R3F releases its context asynchronously after unmount. Check each old context, even when
    // a later open creates another one. A leaked context with live textures fails here.
    await expect.poll(live, { timeout: 6_000 }).toBe(0);
    cycles.push({ cycle, openHandles, afterClose: await live() });
  }
  await writeFile(out!, JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    renderer, idleFrames, idleMs, initialBrightness, restoredBrightness, cycles, contexts: (await state()).contexts,
  }, null, 2) + "\n", { mode: 0o600 });
});

test("capture the desktop panorama, hotspot and text at fixed detail levels", async ({ page, browser }) => {
  const out = process.env.BENCH_TOUR_DESKTOP_OUT;
  test.skip(!out, "Opt in on a seeded local production build.");
  expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.E2E_BASE_URL!).hostname);
  const renderer = await verifySoftwareWebGLRenderer(browser);
  const viewport = { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(installProbe);
  const living = "/pool-villa-living.webp";
  const entry = "/tour/panoramas/v1/pool-villa-living-4096.webp";
  const transfers: string[] = [];
  page.on("response", (response) => {
    const asset = new URL(response.url()).pathname;
    if (response.ok() && (asset === living || asset === entry)) transfers.push(asset);
  });
  await page.goto("/rooms/pool-villa?tour=1");
  const viewer = page.getByTestId("tour-viewer");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living", { timeout: 20_000 });
  await expect(viewer).toHaveAttribute("data-scene-status", "ready");
  await expect(viewer.getByText("1/2 rooms explored")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const hotspot = viewer.getByTestId("tour-hotspot");
  await expect(hotspot).toBeVisible();
  // Turn toward the seeded pool doorway before comparing screen positions or readable text.
  await page.mouse.move(800, 420);
  await page.mouse.down();
  await page.mouse.move(510, 420, { steps: 12 });
  await page.mouse.up();
  await expect(hotspot).toBeInViewport({ ratio: 1, timeout: 10_000 });
  await expect.poll(async () => {
    const yaw = await page.evaluate(() => window.__tourResources.yaw);
    await page.waitForTimeout(350);
    return Math.abs(yaw - await page.evaluate(() => window.__tourResources.yaw));
  }).toBeLessThan(0.00001);
  await mkdir(out!, { recursive: true, mode: 0o700 });
  const captures = [];
  for (const level of ["entry", "full"]) {
    if (level === "entry") {
      expect(transfers).toEqual([entry]);
    } else {
      await viewer.getByRole("button", { name: "Show full detail" }).click();
      await expect(viewer.getByRole("button", { name: "Full detail shown" })).toBeVisible({ timeout: 20_000 });
      expect(transfers).toEqual([entry, living]);
    }
    await expect.poll(() => luminance(page)).toBeGreaterThan(20);
    // Keep the cursor off the controls and allow the overlay to reach its final opacity.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    const image = await viewer.screenshot({ path: path.join(out!, level + ".png"), animations: "disabled" });
    const label = await hotspot.evaluate((node: HTMLButtonElement) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const effectiveFontPx = parseFloat(style.fontSize) * width / node.offsetWidth;
      return { x, y, width, height, effectiveFontPx, text: node.textContent, font: style.font, color: style.color };
    });
    captures.push({ level, sha256: createHash("sha256").update(image).digest("hex"), label });
  }
  await writeFile(path.join(out!, "desktop.json"), JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    renderer, viewport, transfers, captures,
  }, null, 2) + "\n", { mode: 0o600 });
  const entryLabel = captures[0].label;
  const fullLabel = captures[1].label;
  for (const key of ["text", "font", "color"] as const) expect(fullLabel[key]).toBe(entryLabel[key]);
  for (const key of ["width", "height", "effectiveFontPx"] as const) {
    expect(fullLabel[key]).toBeCloseTo(entryLabel[key], 2);
  }
  // Orbit damping can advance the projected anchor slightly on the texture upload frame.
  expect(Math.hypot(fullLabel.x - entryLabel.x, fullLabel.y - entryLabel.y)).toBeLessThanOrEqual(2);
  expect(captures[0].label.effectiveFontPx).toBeGreaterThanOrEqual(11.9);
  expect(captures[0].label.height).toBeGreaterThanOrEqual(32);
});
