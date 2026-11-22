import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, expect, type Browser, type CDPSession, type Page } from "@playwright/test";
import { MOBILE_PROFILE, newMobilePage, PANORAMA, verifySoftwareWebGLRenderer } from "./tour-mobile-profile";

type Frame = { seq: number; at: number; yaw: number; roomId: string };
type InstrumentedWindow = Window & {
  __tourBench: {
    mark: (name: string) => void;
    frame: (yaw: number, roomId: string) => void;
  };
  __tourSample: {
    stages: Record<string, number>;
    frameSeq: number;
    last: Frame | null;
    origin: Frame | null;
    moved: Frame | null;
    gesture: number | null;
    opened: number | null;
  };
};

type Cohort = "direct" | "click" | "reopen";

const COHORTS: readonly Cohort[] = ["direct", "click", "reopen"];
const VILLA_PATH = "/rooms/pool-villa";
const EXPECTED_FIRST_ROOM = "pv-living";
const EXPECTED_FIRST_PANORAMA = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const EXPECTED_NEIGHBOR_PREFETCH_PANORAMA = "/tour/panoramas/v1/pool-villa-pool-2048.webp";
const ALLOWED_PANORAMAS_BEFORE_GESTURE = new Set([EXPECTED_FIRST_PANORAMA, EXPECTED_NEIGHBOR_PREFETCH_PANORAMA]);
const START = process.env.BENCH_FRONTEND === "start";
const APP_CHUNK = START ? /^\/assets\/[^?#]+\.js(?:\?|$)/ : /^\/_next\/static\/chunks\/[^?#]+\.js(?:\?|$)/;

const CHROME_TRACE_CATEGORIES = [
  "-*",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "loading",
  "toplevel",
  "v8.execute",
  "blink",
  "cc",
  "skia",
  "gpu",
  "gpu.service",
  "disabled-by-default-gpu.service",
];

function instrument() {
  performance.setResourceTimingBufferSize(2000);
  const w = window as unknown as InstrumentedWindow;
  const sample = (w.__tourSample = {
    stages: {} as Record<string, number>,
    frameSeq: 0,
    last: null as Frame | null,
    origin: null as Frame | null,
    moved: null as Frame | null,
    gesture: null as number | null,
    opened: null as number | null,
  });
  w.__tourBench = {
    // Production reports `texture_available` (image loaded/available before GPU upload), plus lifecycle stages.
    mark(name) {
      if (sample.stages[name] === undefined) {
        sample.stages[name] = performance.now();
        performance.mark(`tour_bench:${name}`);
      }
    },
    frame(yaw, roomId) {
      sample.frameSeq += 1;
      const frame: Frame = { seq: sample.frameSeq, yaw, roomId, at: performance.now() };
      sample.last = frame;
      if (sample.stages.first_scene_drawn === undefined) {
        sample.stages.first_scene_drawn = frame.at;
        performance.mark("tour_bench:first_scene_drawn");
      }
      if (
        sample.origin !== null &&
        sample.gesture !== null &&
        sample.origin.roomId === roomId &&
        frame.seq > sample.origin.seq &&
        Math.abs(yaw - sample.origin.yaw) > 0.001 &&
        sample.moved === null
      ) {
        sample.moved = frame;
        performance.mark("tour_bench:drag_changed_frame");
      }
    },
  };
  addEventListener(
    "click",
    (e) => {
      if (
        e.isTrusted &&
        sample.opened === null &&
        e.target instanceof Element &&
        /Explore (in )?360/i.test(e.target.closest("button")?.textContent ?? "")
      ) {
        sample.opened = performance.now();
        performance.mark("tour_bench:explore_clicked");
      }
    },
    true,
  );
  addEventListener(
    "touchstart",
    (e) => {
      if (e.isTrusted && e.target instanceof HTMLCanvasElement && sample.gesture === null) {
        sample.origin = sample.last;
        sample.gesture = performance.now();
        performance.mark("tour_bench:drag_started");
      }
    },
    { capture: true, passive: true },
  );
}

function preloadViewerChunks(paths: string[]) {
  if (!paths.length || window !== window.top) return;
  const addLinks = () => {
    const head = document.head;
    if (!head) return false;
    for (const href of paths) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "script";
      link.href = href;
      head.append(link);
    }
    return true;
  };
  if (addLinks()) return;
  const observer = new MutationObserver(() => {
    if (addLinks()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}

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

async function waitForScene(page: Page, expectedRoom: string) {
  await page.waitForFunction(
    (targetRoom) => {
      const viewer = document.querySelector('[data-testid="tour-viewer"]');
      const requested = viewer?.getAttribute("data-requested-room");
      const shown = viewer?.getAttribute("data-shown-room");
      return (
        requested === targetRoom &&
        shown === targetRoom &&
        viewer?.getAttribute("data-scene-status") === "ready" &&
        (window as unknown as InstrumentedWindow).__tourSample.last?.roomId === targetRoom &&
        document.elementFromPoint(190, 390) instanceof HTMLCanvasElement
      );
    },
    expectedRoom,
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

type MeasureOptions = {
  runId: string;
  withheldMs?: number;
  traceFile?: string;
  chromeTraceFile?: string;
  preloadPaths?: string[];
};

async function measure(
  browser: Browser,
  kind: Cohort,
  { runId, withheldMs = 0, traceFile, chromeTraceFile, preloadPaths }: MeasureOptions,
) {
  const { context, page, cdp } = await newMobilePage(browser, kind !== "reopen", instrument);
  const requests: { path: string; wallMs: number }[] = [];
  const scriptRequests = new Map<string, { url: URL; wallMs: number; initiator: string }>();
  const scriptTransfers = new Map<string, number>();
  const cachedScripts = new Set<string>();
  const scriptEncoding = new Map<string, string>();
  const observeScripts = START || Boolean(preloadPaths);
  if (observeScripts) {
    cdp.on("Network.loadingFinished", (event) => {
      if (scriptRequests.has(event.requestId)) scriptTransfers.set(event.requestId, event.encodedDataLength);
    });
    cdp.on("Network.requestServedFromCache", (event) => cachedScripts.add(event.requestId));
    cdp.on("Network.responseReceived", (event) => {
      if (event.response.fromDiskCache) cachedScripts.add(event.requestId);
      if (START && scriptRequests.has(event.requestId)) {
        const encoding = Object.entries(event.response.headers)
          .find(([name]) => name.toLowerCase() === "content-encoding")?.[1];
        scriptEncoding.set(event.requestId, typeof encoding === "string" ? encoding : "identity");
      }
    });
  }
  cdp.on("Network.requestWillBeSent", (event) => {
    if (PANORAMA.test(event.request.url)) {
      requests.push({
        path: new URL(event.request.url).pathname,
        wallMs: event.wallTime * 1000,
      });
    } else if (observeScripts && APP_CHUNK.test(new URL(event.request.url).pathname)) {
      scriptRequests.set(event.requestId, {
        url: new URL(event.request.url),
        wallMs: event.wallTime * 1000,
        initiator: event.initiator.type,
      });
    }
  });
  let spanOpen = false;
  async function openSpan() {
    await spanBoundary("start", runId);
    spanOpen = true;
  }
  async function closeSpan() {
    if (!spanOpen) return;
    spanOpen = false;
    await spanBoundary("finish", runId);
  }
  let chromeTracing = false;
  async function stopChromeTrace() {
    if (!chromeTracing || !chromeTraceFile) return;
    chromeTracing = false;
    const buffer = await browser.stopTracing();
    mkdirSync(path.dirname(chromeTraceFile), { recursive: true, mode: 0o700 });
    writeFileSync(chromeTraceFile, buffer, { mode: 0o600 });
  }
  let delayed = false;
  try {
    if (preloadPaths) await page.addInitScript(preloadViewerChunks, preloadPaths);
    if (traceFile)
      await context.tracing.start({
        screenshots: false,
        snapshots: false,
        sources: false,
      });
    if (chromeTraceFile) {
      await browser.startTracing(page, {
        screenshots: false,
        categories: CHROME_TRACE_CATEGORIES,
      });
      chromeTracing = true;
    }
    // Enable the same interception in both arms of the cold direct-entry experiment,
    // scoped strictly to the seeded mobile first-scene panorama.
    if (kind === "direct")
      await page.route(PANORAMA, async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (!delayed && pathname === EXPECTED_FIRST_PANORAMA) {
          delayed = true;
          if (withheldMs > 0) await delay(withheldMs);
        }
        await route.continue();
      });
    const direct = kind === "direct";
    if (direct) await openSpan();
    const documentResponse = await page.goto(VILLA_PATH + (direct ? "?tour=1" : ""), {
      waitUntil: direct ? "commit" : "load",
    });
    const routeCache = START ? null : ((await documentResponse?.headerValue("x-nextjs-cache")) ?? null);
    const documentEncoding = START
      ? (await documentResponse?.headerValue("content-encoding")) ?? "identity" : undefined;
    const explore = page.getByRole("button", { name: /Explore (in )?360/i }).first();
    if (kind === "reopen") {
      await explore.tap();
      await waitForScene(page, EXPECTED_FIRST_ROOM);
      await page.getByTestId("tour-viewer").getByRole("button", { name: "Close" }).first().click();
      await page.getByTestId("tour-viewer").waitFor({ state: "detached" });
      await page.evaluate(() => {
        const s = (window as unknown as InstrumentedWindow).__tourSample;
        s.last = s.origin = s.moved = null;
        s.gesture = s.opened = null;
        s.frameSeq = 0;
        s.stages = {};
        performance.clearResourceTimings();
      });
      requests.length = 0;
    }
    if (!direct) {
      await openSpan();
      await explore.tap();
    }
    await waitForScene(page, EXPECTED_FIRST_ROOM);
    await drag(cdp);
    await page.waitForFunction(() => Boolean((window as unknown as InstrumentedWindow).__tourSample.moved), undefined, {
      timeout: 10_000,
    });
    const data = await page.evaluate(
      ({ direct, pattern, startFrontend }) => {
        const s = (window as unknown as InstrumentedWindow).__tourSample;
        const start = direct ? 0 : s.opened;
        if (start === null || !s.moved || s.gesture === null || !s.origin)
          throw Error("Missing trusted input or render observation");
        if (!(s.moved.seq > s.origin.seq)) {
          throw Error(`Frame sequence did not increment during gesture (origin=${s.origin.seq}, moved=${s.moved.seq})`);
        }
        const viewer = document.querySelector('[data-testid="tour-viewer"]');
        const requestedRoom = viewer?.getAttribute("data-requested-room") ?? null;
        const shownRoom = viewer?.getAttribute("data-shown-room") ?? null;
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
            path: new URL(r.name).pathname + new URL(r.name).search,
            start: r.startTime,
            end: r.responseEnd,
            initiator: r.initiatorType,
            transferBytes: r.transferSize,
            encodedBytes: r.encodedBodySize,
            ...(startFrontend && { decodedBytes: r.decodedBodySize }),
          }));
        return {
          start,
          origin: location.origin,
          timeOrigin: performance.timeOrigin,
          ttfb: navigation.responseStart,
          ...(startFrontend && {
            documentEncodedBytes: navigation.encodedBodySize,
            documentDecodedBytes: navigation.decodedBodySize,
          }),
          serverHeaderMs: direct ? (navigation.serverTiming.find((entry) => entry.name === "ssr")?.duration ?? null) : null,
          scripts,
          responseMs: s.moved.at - start,
          dragToFrameMs: s.moved.at - s.gesture,
          gestureAt: s.gesture,
          changedFrameAt: s.moved.at,
          originFrameSeq: s.origin.seq,
          changedFrameSeq: s.moved.seq,
          drawnFrames: s.frameSeq,
          room: s.moved.roomId,
          requestedRoom,
          shownRoom,
          stages: s.stages,
          images,
        };
      },
      { direct, pattern: PANORAMA.source, startFrontend: START },
    );
    await closeSpan();
    await stopChromeTrace();
    await verifyPanorama(page, cdp);
    const startedImages = requests
      .map((r) => ({ path: r.path, start: r.wallMs - data.timeOrigin }))
      .filter((r) => r.start >= data.start && r.start <= data.changedFrameAt);
    expect(data.requestedRoom, "requested room must equal seeded first scene").toBe(EXPECTED_FIRST_ROOM);
    expect(data.shownRoom, "shown room must equal seeded first scene").toBe(EXPECTED_FIRST_ROOM);
    expect(data.room, "drawn frame room must equal seeded first scene").toBe(EXPECTED_FIRST_ROOM);
    expect(data.originFrameSeq, "at least one frame must be drawn before gesture").toBeGreaterThan(0);
    expect(data.changedFrameSeq, "frame sequence must increment during gesture").toBeGreaterThan(data.originFrameSeq);
    const startedBeforeGesture = startedImages.filter((r) => r.start <= data.gestureAt);
    expect(
      startedBeforeGesture.filter((r) => !ALLOWED_PANORAMAS_BEFORE_GESTURE.has(r.path)),
      "no alternate rendition or foreign panorama may be fetched before gesture",
    ).toEqual([]);
    expect(
      data.images
        .filter((r) => r.start >= data.start && r.start <= data.gestureAt)
        .filter((r) => !ALLOWED_PANORAMAS_BEFORE_GESTURE.has(r.path)),
      "no alternate rendition or foreign panorama resource may load before gesture",
    ).toEqual([]);
    if (kind !== "reopen") {
      expect(startedBeforeGesture[0]?.path, "first fetched panorama must be seeded mobile 2048 first scene").toBe(
        EXPECTED_FIRST_PANORAMA,
      );
      expect(
        data.images.some((r) => r.path === EXPECTED_FIRST_PANORAMA),
        "seeded mobile 2048 first-scene panorama resource must complete",
      ).toBe(true);
    }
    if (direct) expect(delayed).toBe(true);
    const { origin, ...timings } = data;
    const startedScripts = Array.from(scriptRequests)
      .filter(([, request]) => request.url.origin === origin)
      .map(([id, r]) => ({
        path: r.url.pathname + r.url.search,
        start: r.wallMs - timings.timeOrigin,
        initiator: r.initiator,
        transferBytes: scriptTransfers.get(id) ?? null,
        servedFromCache: cachedScripts.has(id),
        ...(START && { contentEncoding: scriptEncoding.get(id) ?? null }),
      }))
      .filter((r) => r.start >= timings.start && r.start <= timings.changedFrameAt);
    return {
      kind,
      withheldMs,
      routeCache,
      ...(START && { documentEncoding }),
      ...timings,
      startedImages,
      startedScripts,
    };
  } finally {
    try {
      await closeSpan();
    } finally {
      try {
        await stopChromeTrace();
      } finally {
        try {
          if (traceFile) {
            mkdirSync(path.dirname(traceFile), { recursive: true, mode: 0o700 });
            await context.tracing.stop({ path: traceFile });
            chmodSync(traceFile, 0o600);
          }
        } finally {
          await context.close();
        }
      }
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

async function benchmarkMetadata(browser: Browser) {
  const renderer = await verifySoftwareWebGLRenderer(browser);
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    ...(START && {
      frontend: "start",
      assetEncoding: process.env.BENCH_START_WIRE_GZIP === "1" ? "gzip" : "identity",
    }),
    browser: browser.version(),
    renderer,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    width: MOBILE_PROFILE.width,
    height: MOBILE_PROFILE.height,
    dpr: MOBILE_PROFILE.dpr,
    cpuFactor: MOBILE_PROFILE.cpuFactor,
    rttMs: MOBILE_PROFILE.rttMs,
    downMbps: MOBILE_PROFILE.downMbps,
    upKbps: MOBILE_PROFILE.upKbps,
    downloadBytesPerSec: MOBILE_PROFILE.downloadThroughput,
    uploadBytesPerSec: MOBILE_PROFILE.uploadThroughput,
    expectedFirstRoom: EXPECTED_FIRST_ROOM,
    expectedFirstPanorama: EXPECTED_FIRST_PANORAMA,
    lockSha256: digest("bun.lock"),
    assetSha256: digest("public/tour/panoramas/v1/pool-villa-living-2048.webp"),
    seed: "demo-resort",
    sceneSeedSha256: digest("convex/maintenance/seeds/rooms.ts"),
  };
}

test("tour entry to first responsive frame", async ({ browser }) => {
  const count = Number(process.env.BENCH_RUNS ?? 5);
  const extra = Number(process.env.BENCH_IMAGE_DELAY_MS ?? 0);
  expect(Number.isInteger(count) && count > 0).toBe(true);
  expect(Number.isFinite(extra) && extra >= 0).toBe(true);
  test.setTimeout(count * COHORTS.length * 240_000 + 60_000);
  const samples: (Awaited<ReturnType<typeof measure>> & { runId: string })[] = [];
  const failures: { kind: Cohort; run: number; error: string }[] = [];
  const metadata = await benchmarkMetadata(browser);
  const out = process.env.BENCH_OUT;
  const save = () => {
    if (!out) return;
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, JSON.stringify({ metadata, count, samples, failures }, null, 2) + "\n", { mode: 0o600 });
  };
  for (let run = 1; run <= count; run++) {
    for (const kind of COHORTS) {
      const runId = [process.env.BENCH_BATCH ?? "baseline", run, kind].join("-");
      try {
        const trace = run === 1 && kind === "direct" && process.env.BENCH_TRACE_PATH;
        const chromeTrace = run === 1 && kind === "direct" && process.env.BENCH_CHROME_TRACE_PATH;
        const sample = await measure(browser, kind, {
          runId,
          withheldMs: kind === "direct" ? extra : 0,
          traceFile: trace ? path.resolve(trace) : undefined,
          chromeTraceFile: chromeTrace ? path.resolve(chromeTrace) : undefined,
        });
        samples.push({ runId, ...sample });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ kind, run, error: message });
        console.error(`bench-sample-failed ${runId}:`, message);
      } finally {
        save();
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${count * COHORTS.length} benchmark sample(s) failed: ` +
        failures.map((f) => `run ${f.run} ${f.kind}: ${f.error}`).join("; "),
    );
  }
});

test("tour viewer chunk preload experiment", async ({ browser }) => {
  test.skip(process.env.BENCH_VIEWER_PROBE !== "1", "Enable with BENCH_VIEWER_PROBE=1");
  const count = Number(process.env.BENCH_RUNS ?? 5);
  expect(Number.isInteger(count) && count > 0).toBe(true);
  const out = process.env.BENCH_VIEWER_OUT ?? process.env.BENCH_OUT;
  if (!out) throw Error("Set BENCH_VIEWER_OUT to a new private JSON path");
  test.setTimeout((2 * count + 2) * 240_000 + 60_000);

  const metadata = await benchmarkMetadata(browser);
  type Arm = "discovery" | "control" | "preload" | "restored-control";
  type Sample = Awaited<ReturnType<typeof measure>>;
  const samples: { runId: string; pair: number | null; arm: Arm; timing: Sample }[] = [];
  const failures: { runId: string; error: string }[] = [];
  let chunkPaths: string[] = [];
  const save = (initial = false) => {
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    const observed = samples.map((sample) => ({
      ...sample,
      viewerChunks: chunkPaths.map((chunkPath) => {
        const requests = sample.timing.startedScripts.filter((request) => request.path === chunkPath);
        const resources = sample.timing.scripts.filter((resource) => resource.path === chunkPath);
        const transferred = requests.filter((request) => (request.transferBytes ?? 0) > 0);
        return {
          path: chunkPath,
          requests,
          resources,
          duplicateRequests: Math.max(0, requests.length - 1),
          duplicateTransfers: Math.max(0, transferred.length - 1),
        };
      }),
    }));
    writeFileSync(out, JSON.stringify({ metadata, count, chunkPaths, samples: observed, failures }, null, 2) + "\n", {
      flag: initial ? "wx" : "w",
      mode: 0o600,
    });
  };
  save(true);
  const run = async (arm: Arm, pair: number | null): Promise<Sample | null> => {
    const runId = [process.env.BENCH_BATCH ?? "viewer", pair, arm].filter((part) => part !== null).join("-");
    try {
      const timing = await measure(browser, "direct", {
        runId,
        preloadPaths: arm === "preload" ? chunkPaths : [],
      });
      samples.push({ runId, pair, arm, timing });
      return timing;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ runId, error: message });
      console.error(`bench-viewer-sample-failed ${runId}:`, message);
      return null;
    } finally {
      save();
    }
  };
  const discovery = await run("discovery", null);
  if (!discovery) {
    throw new Error(`Viewer chunk discovery failed: ${failures.map((f) => `${f.runId}: ${f.error}`).join("; ")}`);
  }
  const start = discovery.stages.viewer_module_start;
  const ready = discovery.stages.viewer_module_ready;
  expect(ready).toBeGreaterThan(start);
  chunkPaths = [
    ...new Set(
      discovery.scripts
        .filter((script) => APP_CHUNK.test(script.path) && script.start >= start && script.end <= ready)
        .map((script) => script.path),
    ),
  ];
  expect(chunkPaths.length, "control must observe late viewer chunk requests").toBeGreaterThan(0);
  save();
  for (let pair = 1; pair <= count; pair++) {
    const arms: Arm[] = pair % 2 ? ["control", "preload"] : ["preload", "control"];
    for (const arm of arms) await run(arm, pair);
  }
  await run("restored-control", null);
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} viewer preload sample(s) failed: ` +
        failures.map((f) => `${f.runId}: ${f.error}`).join("; "),
    );
  }
});
