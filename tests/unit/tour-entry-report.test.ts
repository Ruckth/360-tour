import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  median,
  nearestRankP95,
  renderMarkdown,
  matchPanoramaRequests,
  ReportInputError,
  signTestP,
  unionMs,
} from "../../scripts/bench/tour-entry-report.mjs";

type Kind = "direct" | "click" | "reopen";
type RunFileData = {
  metadata: Record<string, unknown>;
  count: number;
  samples: ReturnType<typeof sample>[];
  failures: { kind: Kind; run: number; error: string }[];
};
type SpanRun = { runId: string; ssr: Record<string, unknown>[]; convex: Record<string, unknown>[] };

const metadata = {
  revision: "abc123", browser: "140.0", node: "v22.0.0", platform: "darwin", arch: "arm64", width: 390, height: 844,
  dpr: 2, cpuFactor: 4, rttMs: 150, downMbps: 1.6, lockSha256: "lock", assetSha256: "asset", seed: "demo-resort",
  sceneSeedSha256: "scene", renderer: "ANGLE (Apple, Metal)",
};

function sample(label: string, run: number, kind: Kind, delay: number, origin: number, jitter: number) {
  const start = kind === "direct" ? 0 : 5000;
  const texture = 600 + (kind === "direct" ? delay : 0) + jitter;
  const at = (offset: number) => start + offset;
  const stages: Record<string, number> = {
    tour_open_requested: at(10), viewer_module_start: at(300), viewer_module_ready: at(900), viewer_mounted: at(1000),
    texture_request_start: at(1100), rooms_resolved: at(1300), texture_available: at(1100 + texture),
    first_scene_drawn: at(1200 + texture),
  };
  if (kind === "click") stages.room_hydrated = 1200;
  const gestureAt = at(1350 + texture), changedFrameAt = gestureAt + 40;
  return {
    runId: `${label}-${run}-${kind}`, kind, withheldMs: kind === "direct" ? delay : 0, routeCache: null, start,
    serverHeaderMs: kind === "direct" ? 120 : null,
    timeOrigin: origin, ttfb: 400, responseMs: changedFrameAt - start, dragToFrameMs: 40, gestureAt, changedFrameAt,
    room: "living", stages,
    images: [{ path: "/tour/a-2048.webp", start: at(1100), end: at(1050 + texture), encodedBytes: 1, transferBytes: 1 }] as
      { path: string; start: number; end: number; encodedBytes: number; transferBytes: number }[],
    scripts: [{ path: "/_next/static/chunks/viewer.js", start: at(300), end: at(800), transferBytes: 1, encodedBytes: 1 },
      { path: "/_next/static/chunks/three.js", start: at(500), end: at(900), transferBytes: 1, encodedBytes: 1 }],
    startedImages: [{ path: "/tour/a-2048.webp", start: at(1100) }],
  };
}

/** Two batches × two pairs × 5 runs, alternating control/candidate order, 1 s withheld from direct entry. */
function fixture(edit?: (files: Map<string, RunFileData>, spans: SpanRun[]) => void) {
  const files = new Map<string, RunFileData>();
  const spans: SpanRun[] = [];
  let clock = 1_000_000;
  for (const batch of [1, 2])
    for (const pair of [1, 2])
      for (const delay of pair === 1 ? [0, 1000] : [1000, 0]) {
        const label = `batch${batch}-pair${pair}-delay${delay}`;
        const samples = [];
        for (let run = 1; run <= 5; run++)
          for (const kind of ["direct", "click", "reopen"] as const) {
            samples.push(sample(label, run, kind, delay, clock++, run * 10 + batch * 5));
            spans.push({
              runId: `${label}-${run}-${kind}`,
              ssr: [{ operation: "getVilla", cache: "hit", recovery: null, durationMs: 3, transportMs: null }],
              convex: [{ function: "catalog/properties:getTourRooms", cached: false, outcome: "success", executionMs: 4, handlerMs: 3 }],
            });
          }
        files.set(label, { metadata: { ...metadata }, count: 5, samples, failures: [] });
      }
  edit?.(files, spans);
  return {
    runs: [...files].map(([label, data]) => ({ file: `output/tour-perf/runs/${label}.json`, text: JSON.stringify(data) })),
    spans: [{ file: "output/tour-perf/spans.json", text: JSON.stringify({ version: 1, runs: spans }) }],
    command: "node scripts/bench/tour-entry-report.mjs --runs output/tour-perf/runs --spans output/tour-perf/spans.json",
  };
}

function inputProblems(input: Parameters<typeof buildReport>[0]) {
  try {
    buildReport(input);
  } catch (error) {
    if (error instanceof ReportInputError) return error.problems.join("\n");
    throw error;
  }
  throw new Error("expected unusable input");
}

function drop(files: Map<string, RunFileData>, spans: SpanRun[], label: string) {
  files.delete(label);
  spans.splice(0, spans.length, ...spans.filter((s) => !s.runId.startsWith(label + "-")));
}

const codes = (report: ReturnType<typeof buildReport>) => report.issues.map((x) => `${x.level}:${x.code}`);

describe("tour entry report statistics", () => {
  it("uses midpoint medians, nearest-rank p95, an exact sign test and overlap-free unions", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(nearestRankP95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19);
    expect(nearestRankP95(Array.from({ length: 10 }, (_, i) => i + 1))).toBe(10);
    expect(nearestRankP95([])).toBeNull();
    expect(signTestP(Array(20).fill(1))).toBeCloseTo(2 / 2 ** 20, 12);
    expect(signTestP([1, -1, 0])).toBe(1);
    expect(unionMs([[0, 10], [5, 15], [20, 30], [-5, 2]], 0, 25)).toBe(20);
  });

  it("summarizes a balanced, alternated experiment and quantifies the coupled intervention", () => {
    const input = fixture();
    const report = buildReport(input);
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("valid");
    const control = report.variants.find((v) => v.variant === "control" && v.cohort === "direct")!;
    const delayed = report.variants.find((v) => v.variant === "delay1000" && v.cohort === "direct")!;
    expect([control.n, delayed.n]).toEqual([20, 20]);
    expect(control.cache).toEqual({ "ssr-hit": 20 });
    expect(delayed.responseMs.median! - control.responseMs.median!).toBe(1000);
    const [effect] = report.intervention;
    expect(effect.direct).toMatchObject({ matched: 20, medianDeltaMs: 1000, medianAcquisitionDeltaMs: 1000, imposedDelayMs: 1000,
      toleranceMs: 200, transmission: 1, acquisitionTransmission: 1, positive: 20, coupled: true });
    expect(Object.values(effect.direct.checks).every(Boolean)).toBe(true);
    expect(control.serverHeaderMs.median).toBe(120);
    expect(control.convex["catalog/properties:getTourRooms"]).toMatchObject({ completions: 20, cached: 0 });
    expect(control.convex["catalog/properties:getTourRooms"].handlerMs.median).toBe(3);
    expect(report.profile.renderer).toBe("ANGLE (Apple, Metal)");
    // The first panorama response end is a critical-path milestone ahead of texture availability.
    expect(control.criticalPath.map((c) => c.stage)).toEqual(expect.arrayContaining(["first_panorama_response_end", "texture_available"]));
    expect(control).toMatchObject({ warmPanoramaTransfers: 0 });
    expect(control.panoramaCompletedBeforeInput.median).toBe(1);
    expect(control.panoramaInFlightAtInput.median).toBe(0);
    expect(effect.pairs.map((p) => p.order)).toEqual(["control-first", "candidate-first", "control-first", "candidate-first"]);
    expect(effect.negativeControls.map((n) => n.medianDeltaMs)).toEqual([0, 0]);
    expect(report.noise.every((n) => n.spreadFraction! <= 0.05)).toBe(true);
    // Overlapping script downloads count once, and the partition sums to the measured interval.
    for (const s of report.samples) expect(s.segments.reduce((sum, x) => sum + x.ms, 0)).toBeCloseTo(s.responseMs, 0);
    const click = report.samples.find((s) => s.runId === "batch1-pair1-delay0-1-click")!;
    expect(click.beforeStart).toEqual(["document_first_byte", "room_hydrated"]);
    expect(control.scriptNetworkMs.median).toBe(600);
    expect(JSON.stringify(buildReport(fixture()))).toBe(JSON.stringify(report));
    const shuffled = { ...input, runs: [...input.runs].reverse() };
    expect(JSON.stringify(buildReport(shuffled))).toBe(JSON.stringify(report));
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("**Status: valid.**");
    expect(markdown).toContain(input.command);
    expect(markdown).toContain("Texture acquisition and end-to-end time moved with the imposed delay.");
    expect(markdown).toContain("Server timing: native request vs data layer");
    expect(markdown).not.toContain("texture_decoded");
  });

  it("rejects mismatched builds, wrong delays, missing or foreign spans and missing cache data", () => {
    expect(inputProblems(fixture((files) => { files.get("batch2-pair1-delay0")!.metadata.lockSha256 = "other"; })))
      .toMatch(/lockSha256 differ/);
    expect(inputProblems(fixture((files) => { files.get("batch1-pair1-delay1000")!.samples[0].withheldMs = 500; })))
      .toMatch(/imposes 1000 ms on direct entry only/);
    expect(inputProblems(fixture((_, spans) => { spans.shift(); }))).toMatch(/no span run for batch1-pair1-delay0-1-direct/);
    expect(inputProblems(fixture((_, spans) => { spans.push({ runId: "baseline-1-direct", ssr: [], convex: [] }); })))
      .toMatch(/matches no run file sample/);
    expect(inputProblems(fixture((_, spans) => { spans[0].ssr = []; }))).toMatch(/no cache data for batch1-pair1-delay0-1-direct/);
    expect(inputProblems(fixture((files) => { files.get("batch1-pair1-delay0")!.samples[0].responseMs += 50; })))
      .toMatch(/internally inconsistent/);
    const wrongFile = fixture();
    expect(inputProblems({ ...wrongFile, runs: [...wrongFile.runs, { file: "spans.json", text: wrongFile.spans[0].text }] }))
      .toMatch(/not a tour-open-interaction run file/);
    expect(inputProblems({ ...fixture(), spans: [] })).toMatch(/cache state cannot be established/);
    expect(inputProblems(fixture((files) => { files.get("batch2-pair1-delay0")!.metadata.renderer = "SwiftShader"; })))
      .toMatch(/renderer differ/);
  });

  it("reports failures, missing controls, single batches, noise and unalternated order instead of crediting a gain", () => {
    const failed = buildReport(fixture((files) => {
      const file = files.get("batch2-pair2-delay0")!;
      file.samples = file.samples.slice(0, 14);
      file.failures = [{ kind: "reopen", run: 5, error: "Timeout at http://127.0.0.1:3000/rooms in /Users/someone/360-tour/x.ts\nstack" }];
    }));
    expect(failed.status).toBe("invalid");
    expect(codes(failed)).toEqual(expect.arrayContaining(["invalid:failed-open", "invalid:incomplete", "invalid:unbalanced-pair"]));
    const message = failed.issues.find((x) => x.code === "failed-open")!.message;
    expect(message).toContain("Timeout at <url> in <path>");
    expect(JSON.stringify(failed)).not.toMatch(/127\.0\.0\.1|\/Users\/|timeOrigin|chunks\/viewer/);

    const missing = buildReport(fixture((files, spans) => drop(files, spans, "batch1-pair2-delay0")));
    expect(codes(missing)).toContain("invalid:missing-control");

    const single = buildReport(fixture((files, spans) => {
      for (const label of [...files.keys()]) if (label.startsWith("batch2")) drop(files, spans, label);
    }));
    expect(single.status).toBe("inconclusive");
    expect(codes(single)).toEqual(expect.arrayContaining(["inconclusive:noise-unmeasured", "inconclusive:underpowered"]));

    const noisy = buildReport(fixture((files) => {
      for (const s of files.get("batch2-pair1-delay0")!.samples.concat(files.get("batch2-pair2-delay0")!.samples)) {
        s.responseMs += 400;
        s.changedFrameAt += 400;
        s.gestureAt += 400;
      }
    }));
    expect(codes(noisy)).toContain("inconclusive:noisy-control");

    const sameOrder = buildReport(fixture((files) => {
      for (const s of files.get("batch1-pair2-delay1000")!.samples) s.timeOrigin += 10_000_000;
      for (const s of files.get("batch2-pair2-delay1000")!.samples) s.timeOrigin += 10_000_000;
    }));
    expect(codes(sameOrder)).toContain("inconclusive:order-not-alternated");
  });

  it("runs as a CLI: ignores private traces, writes both reports and exits 2 without output on unusable input", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tour-entry-report-"));
    try {
      const input = fixture();
      mkdirSync(path.join(root, "runs"));
      for (const run of input.runs) writeFileSync(path.join(root, "runs", path.basename(run.file)), run.text);
      writeFileSync(path.join(root, "runs", "trace.zip"), "private");
      writeFileSync(path.join(root, "spans.json"), input.spans[0].text);
      const script = path.resolve("scripts/bench/tour-entry-report.mjs");
      const cli = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
      const ok = cli("--runs", "runs", "--spans", "spans.json", "--json", "report.json", "--md", "report.md");
      expect(ok.status, ok.stderr).toBe(0);
      const report = JSON.parse(readFileSync(path.join(root, "report.json"), "utf8"));
      expect(report.command).toBe("node scripts/bench/tour-entry-report.mjs --runs runs --spans spans.json --json report.json --md report.md");
      expect(report.status).toBe("valid");
      expect(readFileSync(path.join(root, "report.md"), "utf8")).toContain("Server cache: miss vs hit");
      const bad = cli("--runs", "runs", "--json", "missing-spans.json");
      expect(bad.status).toBe(2);
      expect(bad.stderr).toMatch(/no span file given/);
      expect(() => readFileSync(path.join(root, "missing-spans.json"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not credit coupling when movement is negative, off the imposed delay, or computed from empty samples", () => {
    // Both end-to-end and acquisition significantly *faster* by about the delay: the old |Δtotal − Δspan| rule passed this.
    const shift = (files: Map<string, RunFileData>, by: (s: ReturnType<typeof sample>) => number) => {
      for (const [label, file] of files) if (label.endsWith("delay1000"))
        for (const s of file.samples) if (s.kind === "direct") {
          const d = by(s);
          s.stages.texture_available += d; s.stages.first_scene_drawn += d;
          s.gestureAt += d; s.changedFrameAt += d; s.responseMs += d;
          s.images[0].end += d;
        }
    };
    const negative = buildReport(fixture((files) => shift(files, () => -2000)));
    expect(negative.intervention[0].direct.checks).toMatchObject({ endToEndSlower: false, acquisitionSlower: false });
    expect(negative.intervention[0].direct.coupled).toBe(false);
    expect(codes(negative)).toContain("inconclusive:not-coupled");

    // Acquisition and end-to-end move together and significantly, but by 1.5× the imposed delay.
    const offDelay = buildReport(fixture((files) => shift(files, () => 500)));
    expect(offDelay.intervention[0].direct.checks).toEqual({
      endToEndSlower: true, acquisitionSlower: true, acquisitionMatchesImposedDelay: false, endToEndMatchesAcquisition: true,
    });
    expect(offDelay.intervention[0].direct.coupled).toBe(false);

    // No texture_available stage anywhere: no acquisition samples, so nothing is credited and nothing throws.
    const empty = buildReport(fixture((files) => {
      for (const file of files.values()) for (const s of file.samples) delete s.stages.texture_available;
    }));
    expect(empty.intervention[0].direct).toMatchObject({ acquisitionMatched: 0, medianAcquisitionDeltaMs: null, acquisitionTransmission: null, coupled: false });
    expect(empty.variants[0].textureAcquisitionMs).toMatchObject({ n: 0, median: null });
    expect(() => renderMarkdown(empty)).not.toThrow();
  });

  it("invalidates direct-only files and missing negative-control cohorts", () => {
    const directOnly = buildReport(fixture((files, spans) => {
      for (const [label, file] of files) if (label.endsWith("delay1000")) {
        file.samples = file.samples.filter((s) => s.kind === "direct");
        spans.splice(0, spans.length, ...spans.filter((s) => !s.runId.startsWith(label) || s.runId.endsWith("-direct")));
      }
    }));
    expect(directOnly.status).toBe("invalid");
    expect(codes(directOnly)).toEqual(expect.arrayContaining(["invalid:missing-cohort", "invalid:missing-negative-control"]));
    expect(directOnly.issues.find((x) => x.code === "missing-cohort")!.message).toMatch(/delay1000 click: no observations|no click or reopen runs/);
    expect(directOnly.intervention[0].negativeControls.map((n) => [n.cohort, n.matched])).toEqual([["click", 0], ["reopen", 0]]);
  });

  it("splits panorama requests into completed and in flight at input, keeping same-path repeats apart", () => {
    const images = [
      { path: "/a.webp", start: 100, end: 400, transferBytes: 10, encodedBytes: 10 },
      { path: "/a.webp", start: 500, end: 900, transferBytes: 0, encodedBytes: 10 },
    ];
    const started = [{ path: "/a.webp", start: 101 }, { path: "/a.webp", start: 499 }, { path: "/a.webp", start: 950 }, { path: "/b.webp", start: 200 }];
    expect(matchPanoramaRequests(images, started)).toEqual([
      { start: 100, end: 400, warm: false },
      { start: 200, end: null, warm: false },
      { start: 500, end: 900, warm: true },
      { start: 950, end: null, warm: false },
    ]);

    const report = buildReport(fixture((files) => {
      for (const file of files.values()) for (const s of file.samples) {
        const first = s.images[0];
        // A repeat of the same path starts before input and ends after it, plus one that never completes.
        s.images.push({ ...first, start: s.gestureAt - 50, end: s.gestureAt + 20 });
        s.startedImages.push({ path: first.path, start: s.gestureAt - 50 }, { path: first.path, start: s.gestureAt - 10 });
      }
    }));
    const control = report.variants.find((v) => v.variant === "control" && v.cohort === "direct")!;
    expect(control.panoramaCompletedBeforeInput.median).toBe(1);
    expect(control.panoramaInFlightAtInput.median).toBe(2);
    expect(control.panoramaRequestsBeforeInput.median).toBe(3);
    const warm = buildReport(fixture((files) => {
      for (const file of files.values()) for (const s of file.samples) s.images[0].transferBytes = 0;
    }));
    const warmControl = warm.variants.find((v) => v.variant === "control" && v.cohort === "direct")!;
    expect(warmControl.warmPanoramaTransfers).toBe(20);
    expect(warmControl.criticalPath.map((c) => c.stage)).not.toContain("first_panorama_response_end");
  });

  it("separates SSR connection/transport from Convex completion and handler time", () => {
    const report = buildReport(fixture((_, spans) => {
      for (const s of spans) {
        s.ssr = [{ operation: "getVilla", cache: "miss", recovery: null, durationMs: 90, transportMs: 70 }];
        s.convex.push({ function: "catalog/publicProperties:getBySlug", cached: false, outcome: "success", executionMs: 25, handlerMs: 20 });
      }
    }));
    const control = report.variants.find((v) => v.variant === "control" && v.cohort === "direct")!;
    expect(control.ssrConnectionMs.median).toBe(45);
    expect(control.convex["catalog/publicProperties:getBySlug"]).toMatchObject({ completions: 20, cached: 0 });
    expect(control.convex["catalog/publicProperties:getBySlug"].completionMs.median).toBe(25);
    expect(control.convex["catalog/publicProperties:getBySlug"].handlerMs.median).toBe(20);
  });
});
