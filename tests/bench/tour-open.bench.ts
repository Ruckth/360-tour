import { writeFileSync } from "node:fs";
import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * 360 tour opening benchmark on a fixed mobile profile (390x844, DPR 2, touch), with Chrome
 * DevTools CPU (4x) and network (~1.6 Mbps down, 150 ms RTT) throttling. Each cold run uses a new
 * browser context with the HTTP cache disabled; each warm run reopens the tour in the same page.
 *
 * Measured in the page (performance.now()):
 * - clickToUsableMs: click on "Explore 360" -> the tour controls ("rooms explored") render.
 * - panoramaBytesBeforeUsable / panoramaRequestsBeforeUsable: equirectangular images whose
 *   resource timing finished before the tour became usable (encodedBodySize, includes cache hits);
 *   panoramaTransferBytesBeforeUsable counts only bytes transferred over the network.
 * - idleDrawCallsPerSecond: WebGL draw calls during 2 s without interaction, 1 s after usable.
 *
 * Headless Chromium renders WebGL in software (SwiftShader), so absolute times are a local
 * development benchmark, not a device or production measurement.
 */

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const VILLA_PATH = process.env.BENCH_VILLA_PATH ?? "/rooms/pool-villa";
const PANORAMA = /(pool-villa-living|pool-villa-pool|garden-suite-interior|garden-dining360|garden-villa-360|penthouse-bedroom)\.(webp|jpe?g)/;

type Sample = {
  kind: "cold" | "warm";
  clickToUsableMs: number;
  panoramaRequestsBeforeUsable: number;
  panoramaBytesBeforeUsable: number;
  /** Bytes actually transferred (0 for HTTP cache hits). */
  panoramaTransferBytesBeforeUsable: number;
  panoramaNamesBeforeUsable: string[];
  idleDrawCallsPerSecond: number;
};

const INSTRUMENT = () => {
  const w = window as unknown as { __draws: number };
  w.__draws = 0;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"] as const) {
      const original = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      if (typeof original !== "function") continue;
      (proto as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
        w.__draws++;
        return original.apply(this, args);
      };
    }
  }
};

async function throttle(context: BrowserContext, page: Page, disableCache: boolean) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: disableCache });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

async function newMobilePage(browser: Browser, disableCache: boolean) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => sessionStorage.setItem("seaview-demo-disclaimer-dismissed", "true"));
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  page.on("requestfailed", (request) => {
    if (PANORAMA.test(request.url())) console.error("panorama-request-failed", new URL(request.url()).pathname, request.failure()?.errorText);
  });
  page.on("response", (response) => {
    if (PANORAMA.test(response.url()) && response.status() >= 400) console.error("panorama-http-error", new URL(response.url()).pathname, response.status());
  });
  await throttle(context, page, disableCache);
  return { context, page };
}

/** Clicks Explore 360 from inside the page and resolves when the tour controls render. */
async function openTour(page: Page, kind: Sample["kind"]): Promise<Sample> {
  const result = await page.evaluate(async (panoramaSource) => {
    const panorama = new RegExp(panoramaSource);
    const button = [...document.querySelectorAll("button")].find((node) => /Explore (in )?360/i.test(node.textContent ?? ""));
    if (!button) throw new Error("Explore 360 button not found");
    performance.clearResourceTimings();
    const start = performance.now();
    button.click();
    const usableAt = await new Promise<number>((resolve, reject) => {
      const deadline = start + 120_000;
      const check = () => {
        const viewer = document.querySelector('[data-testid="tour-viewer"]');
        if (viewer?.querySelector('[role="alert"]')) return reject(new Error("panorama load failed before readiness"));
        if (viewer && /rooms explored/i.test(viewer.textContent ?? "")) return resolve(performance.now());
        if (performance.now() > deadline) return reject(new Error("tour never became usable"));
        requestAnimationFrame(check);
      };
      check();
    });
    const panoramas = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
      (entry) => panorama.test(entry.name) && entry.responseEnd > 0 && entry.responseEnd <= usableAt,
    );
    return {
      clickToUsableMs: usableAt - start,
      panoramaRequestsBeforeUsable: panoramas.length,
      panoramaBytesBeforeUsable: panoramas.reduce((sum, entry) => sum + (entry.encodedBodySize || entry.transferSize), 0),
      panoramaTransferBytesBeforeUsable: panoramas.reduce((sum, entry) => sum + entry.transferSize, 0),
      panoramaNamesBeforeUsable: panoramas.map((entry) => new URL(entry.name).pathname),
    };
  }, PANORAMA.source);

  await page.waitForTimeout(1_000); // let entry animations and damping settle
  const before = await page.evaluate(() => (window as unknown as { __draws: number }).__draws);
  await page.waitForTimeout(2_000);
  const after = await page.evaluate(() => (window as unknown as { __draws: number }).__draws);
  return { kind, ...result, idleDrawCallsPerSecond: (after - before) / 2 };
}

async function closeTour(page: Page) {
  await page.getByTestId("tour-viewer").getByRole("button", { name: "Close" }).first().click();
  await page.getByTestId("tour-viewer").waitFor({ state: "detached" });
}

function summarize(samples: Sample[]) {
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return { median: Math.round(median), min: Math.round(sorted[0]), max: Math.round(sorted.at(-1)!) };
  };
  return {
    runs: samples.length,
    clickToUsableMs: stats(samples.map((s) => s.clickToUsableMs)),
    panoramaBytesBeforeUsable: stats(samples.map((s) => s.panoramaBytesBeforeUsable)),
    panoramaTransferBytesBeforeUsable: stats(samples.map((s) => s.panoramaTransferBytesBeforeUsable)),
    panoramaRequestsBeforeUsable: stats(samples.map((s) => s.panoramaRequestsBeforeUsable)),
    idleDrawCallsPerSecond: stats(samples.map((s) => s.idleDrawCallsPerSecond)),
  };
}

test("tour open: cold and warm, mobile profile", async ({ browser }) => {
  test.setTimeout(RUNS * 120_000 + 60_000);
  const samples: Sample[] = [];
  for (let run = 0; run < RUNS; run++) {
    const { context, page } = await newMobilePage(browser, true);
    await page.goto(VILLA_PATH, { waitUntil: "load" });
    samples.push(await openTour(page, "cold"));
    console.log("tour-sample", run + 1, samples.at(-1));
    await context.close();
  }
  {
    const { context, page } = await newMobilePage(browser, false);
    await page.goto(VILLA_PATH, { waitUntil: "load" });
    await openTour(page, "cold"); // primes the cache; not recorded
    for (let run = 0; run < RUNS; run++) {
      await closeTour(page);
      samples.push(await openTour(page, "warm"));
      console.log("tour-warm-sample", run + 1, samples.at(-1));
    }
    await context.close();
  }
  const output = {
    baseURL: test.info().project.use.baseURL,
    villaPath: VILLA_PATH,
    profile: "390x844 DPR2 touch, CPU 4x, 1.6 Mbps/150 ms RTT, headless Chromium (SwiftShader WebGL)",
    measuredAt: new Date().toISOString(),
    cold: summarize(samples.filter((s) => s.kind === "cold")),
    warm: summarize(samples.filter((s) => s.kind === "warm")),
    samples,
  };
  console.log(JSON.stringify({ cold: output.cold, warm: output.warm }, null, 2));
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${JSON.stringify(output, null, 2)}\n`);
});
