import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, expect, type Browser, type CDPSession, type Page } from "@playwright/test";
import { newMobilePage, PANORAMA } from "./tour-mobile-profile";

type Frame = { at: number; yaw: number; roomId: string };
type InstrumentedWindow = Window & {
  __tourBench: {
    mark: (name: string) => void;
    frame: (yaw: number, roomId: string) => void;
  };
  __tourSample: {
    stages: Record<string, number>;
    last: Frame | null;
    origin: Frame | null;
    moved: Frame | null;
    gesture: number | null;
    opened: number | null;
  };
};

function instrument() {
  performance.setResourceTimingBufferSize(2000);
  const w = window as unknown as InstrumentedWindow;
  const sample = (w.__tourSample = {
    stages: {} as Record<string, number>,
    last: null as Frame | null,
    origin: null as Frame | null,
    moved: null as Frame | null,
    gesture: null as number | null,
    opened: null as number | null,
  });
  w.__tourBench = {
    mark(name) {
      sample.stages[name] ??= performance.now();
    },
    frame(yaw, roomId) {
      const frame = { yaw, roomId, at: performance.now() };
      sample.last = frame;
      if (sample.origin?.roomId === roomId && sample.gesture !== null && Math.abs(yaw - sample.origin.yaw) > 0.001)
        sample.moved ??= frame;
    },
  };
  addEventListener(
    "click",
    (e) => {
      if (
        e.isTrusted &&
        e.target instanceof Element &&
        /Explore (in )?360/i.test(e.target.closest("button")?.textContent ?? "")
      ) {
        sample.opened = performance.now();
      }
    },
    true,
  );
  addEventListener(
    "touchstart",
    (e) => {
      if (e.isTrusted && e.target instanceof HTMLCanvasElement) {
        sample.origin = sample.last;
        sample.gesture = performance.now();
      }
    },
    { capture: true, passive: true },
  );
}

type Cohort = "direct" | "click" | "reopen";

async function drag(cdp: CDPSession) {
  for (const [type, x] of [
    ["touchStart", 190],
    ["touchMove", 212],
    ["touchMove", 244],
    ["touchEnd", 0],
  ] as const) {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x ? [{ x, y: 390 }] : [],
    });
  }
}

async function waitForScene(page: Page) {
  await page.waitForFunction(
    () => {
      const viewer = document.querySelector('[data-testid="tour-viewer"]');
      const room = viewer?.getAttribute("data-shown-room");
      return (
        room &&
        room === viewer?.getAttribute("data-requested-room") &&
        viewer?.getAttribute("data-scene-status") === "ready" &&
        room === (window as unknown as InstrumentedWindow).__tourSample.last?.roomId &&
        document.elementFromPoint(190, 390) instanceof HTMLCanvasElement
      );
    },
    undefined,
    { timeout: 60_000, polling: "raf" },
  );
}

// Validate a second drag outside the timed interval. Compare composited center pixels,
// where a blank canvas, transient overlay or missing render would invalidate the sample.
async function verifyPanorama(page: Page, cdp: CDPSession) {
  const clip = { x: 110, y: 320, width: 160, height: 120 };
  const before = await page.screenshot({ clip });
  await drag(cdp);
  await expect
    .poll(
      async () => {
        const after = await page.screenshot({ clip });
        return page.evaluate(
          async ([first, second]) => {
            const pixels = async (encoded: string) => {
              const image = new Image();
              image.src = "data:image/png;base64," + encoded;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = 80;
              canvas.height = 60;
              const ctx = canvas.getContext("2d")!;
              ctx.drawImage(image, 0, 0, 80, 60);
              return ctx.getImageData(0, 0, 80, 60).data;
            };
            const [a, b] = await Promise.all([pixels(first), pixels(second)]);
            let changed = 0,
              visible = 0;
            for (let i = 0; i < a.length; i += 4) {
              if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 18) changed++;
              if (a[i] + a[i + 1] + a[i + 2] > 45 && b[i] + b[i + 1] + b[i + 2] > 45) visible++;
            }
            return Math.min(changed, visible) / (a.length / 4);
          },
          [before.toString("base64"), after.toString("base64")],
        );
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0.05);
}

async function measure(browser: Browser, kind: Cohort, withheldMs: number, traceFile?: string) {
  const { context, page, cdp } = await newMobilePage(browser, kind !== "reopen", instrument);
  const requests: { path: string; wallMs: number }[] = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    if (PANORAMA.test(event.request.url))
      requests.push({
        path: new URL(event.request.url).pathname,
        wallMs: event.wallTime * 1000,
      });
  });
  let delayed = false;
  try {
    if (traceFile)
      await context.tracing.start({
        screenshots: false,
        snapshots: false,
        sources: false,
      });
    // Enable the same interception in both arms of the cold direct-entry experiment.
    if (kind === "direct")
      await page.route(PANORAMA, async (route) => {
        if (!delayed) {
          delayed = true;
          if (withheldMs > 0) await delay(withheldMs);
        }
        await route.continue();
      });
    const villaPath = "/rooms/pool-villa";
    const direct = kind === "direct";
    const documentResponse = await page.goto(villaPath + (direct ? "?tour=1" : ""), {
      waitUntil: direct ? "commit" : "load",
    });
    const routeCache = (await documentResponse?.headerValue("x-nextjs-cache")) ?? null;
    const explore = page.getByRole("button", { name: /Explore (in )?360/i }).first();
    if (kind === "reopen") {
      await explore.tap();
      await waitForScene(page);
      await page.getByTestId("tour-viewer").getByRole("button", { name: "Close" }).first().click();
      await page.getByTestId("tour-viewer").waitFor({ state: "detached" });
      await page.evaluate(() => {
        const s = (window as unknown as InstrumentedWindow).__tourSample;
        s.last = s.origin = s.moved = null;
        s.gesture = s.opened = null;
        s.stages = {};
        performance.clearResourceTimings();
      });
      requests.length = 0;
    }
    if (!direct) await explore.tap();
    await waitForScene(page);
    await drag(cdp);
    await page.waitForFunction(() => Boolean((window as unknown as InstrumentedWindow).__tourSample.moved), undefined, {
      timeout: 10_000,
    });
    const data = await page.evaluate(
      ({ direct, pattern }) => {
        const s = (window as unknown as InstrumentedWindow).__tourSample;
        const start = direct ? 0 : s.opened;
        if (start === null || !s.moved || s.gesture === null || !s.origin)
          throw Error("Missing trusted input or render observation");
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const images = performance
          .getEntriesByType("resource")
          .filter((e) => new RegExp(pattern).test(e.name))
          .map((e) => {
            const r = e as PerformanceResourceTiming;
            return {
              path: new URL(r.name).pathname,
              start: r.startTime,
              end: r.responseEnd,
              encodedBytes: r.encodedBodySize,
              transferBytes: r.transferSize,
            };
          });
        const scripts = performance
          .getEntriesByType("resource")
          .map((entry) => entry as PerformanceResourceTiming)
          .filter((r) => {
            const url = new URL(r.name);
            return (
              url.origin === location.origin &&
              url.pathname.endsWith(".js") &&
              r.responseEnd >= start &&
              r.startTime <= s.moved!.at
            );
          })
          .map((r) => ({
            path: new URL(r.name).pathname,
            start: r.startTime,
            end: r.responseEnd,
            transferBytes: r.transferSize,
            encodedBytes: r.encodedBodySize,
          }));
        return {
          start,
          timeOrigin: performance.timeOrigin,
          ttfb: navigation.responseStart,
          scripts,
          responseMs: s.moved.at - start,
          dragToFrameMs: s.moved.at - s.gesture,
          gestureAt: s.gesture,
          changedFrameAt: s.moved.at,
          room: s.moved.roomId,
          stages: s.stages,
          images,
        };
      },
      { direct, pattern: PANORAMA.source },
    );
    await verifyPanorama(page, cdp);
    const startedImages = requests
      .map((r) => ({ path: r.path, start: r.wallMs - data.timeOrigin }))
      .filter((r) => r.start >= data.start && r.start <= data.changedFrameAt);
    if (direct) expect(delayed).toBe(true);
    return { kind, withheldMs, routeCache, ...data, startedImages };
  } finally {
    try {
      if (traceFile) await context.tracing.stop({ path: traceFile });
    } finally {
      await context.close();
    }
  }
}

async function spanBoundary(action: "start" | "finish", runId: string) {
  const endpoint = process.env.BENCH_SPAN_ENDPOINT;
  if (!endpoint) return;
  const res = await fetch(endpoint + "/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) throw Error("Cannot " + action + " benchmark span window: " + res.status);
}

test("tour entry to first responsive frame", async ({ browser }) => {
  const count = Number(process.env.BENCH_RUNS ?? 5);
  const extra = Number(process.env.BENCH_IMAGE_DELAY_MS ?? 0);
  expect(Number.isInteger(count) && count > 0).toBe(true);
  expect(Number.isFinite(extra) && extra >= 0).toBe(true);
  const kinds: Cohort[] = process.env.BENCH_DIRECT_ONLY === "1" ? ["direct"] : ["direct", "click", "reopen"];
  test.setTimeout(count * kinds.length * 240_000 + 60_000);
  const samples: (Awaited<ReturnType<typeof measure>> & { runId: string })[] = [];
  const failures: { kind: Cohort; run: number; error: string }[] = [];
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const metadata = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    browser: browser.version(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    width: 390,
    height: 844,
    dpr: 2,
    cpuFactor: 4,
    rttMs: 150,
    downMbps: 1.6,
    lockSha256: digest("pnpm-lock.yaml"),
    assetSha256: digest("public/tour/panoramas/v1/pool-villa-living-2048.webp"),
    seed: "demo-resort",
    sceneSeedSha256: digest("convex/maintenance/seeds/rooms.ts"),
  };
  const out = process.env.BENCH_OUT;
  for (let run = 1; run <= count; run++) {
    for (const kind of kinds) {
      const runId = [process.env.BENCH_BATCH ?? "baseline", run, kind].join("-");
      await spanBoundary("start", runId);
      try {
        const trace = run === 1 && kind === "direct" && process.env.BENCH_TRACE_PATH;
        const sample = await measure(
          browser,
          kind,
          kind === "direct" ? extra : 0,
          trace ? path.resolve(trace) : undefined,
        );
        samples.push({ runId, ...sample });
      } catch (e) {
        failures.push({
          kind,
          run,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        await spanBoundary("finish", runId);
        if (out)
          writeFileSync(out, JSON.stringify({ metadata, count, samples, failures }, null, 2) + "\n", { mode: 0o600 });
      }
    }
  }
});
