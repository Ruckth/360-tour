import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assessTourRelease } from "../../scripts/bench/tour-release-gates.mjs";

const workspaces: string[] = [];
afterEach(() => {
  for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture({ neighbor = false, flip = false, legacy = false, omit = false } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "tour-release-"));
  workspaces.push(workspace);
  const runs = join(workspace, "runs");
  mkdirSync(runs);
  const current = { path: "/tour/panoramas/v1/pool-villa-living-2048.webp", start: 100 };
  const pool = { path: "/tour/panoramas/v1/pool-villa-pool-2048.webp", start: neighbor ? 220 : 270 };
  const inputs = [];
  for (const batch of [1, 2]) {
    for (let group = 1; group <= 50; group++) {
      const label = `batch${batch}-pair${group}-delay0`;
      const filename = label + ".json";
      const samples = ["direct", "click", "reopen"].map((kind) => ({
        kind, runId: `${label}-1-${kind}`, withheldMs: 0, start: 0,
        room: "pv-living", requestedRoom: "pv-living", shownRoom: "pv-living",
        responseMs: kind === "reopen" ? 200 : flip && kind === "direct" && batch === 2 && group >= 48 ? 9100 : 6000,
        gestureAt: 255, changedFrameAt: 300, documentEncoding: "identity",
        stages: { first_scene_drawn: 200, ...(legacy ? {} : { first_usable_frame: 250 }) },
        pendingImagesAtOpen: [],
        startedImages: kind === "reopen" ? [] : [current, pool],
        images: kind === "reopen" ? [] : [{ ...current, end: 180, transferBytes: 123 }],
        startedScripts: [{ contentEncoding: "gzip", transferBytes: 123 }],
      }));
      const failure = omit && batch === 1 && group === 47;
      const raw = JSON.stringify({
        count: 1, metadata: {
          revision: "phase-e", frontend: "start", assetEncoding: "gzip",
          ...(legacy ? {} : { usableBoundary: "dom-canvas-v1" }),
        },
        samples: failure ? samples.slice(1) : samples,
        failures: failure ? [{ kind: "direct" }] : [],
      });
      writeFileSync(join(runs, filename), raw);
      inputs.push({ file: filename, sha256: createHash("sha256").update(raw).digest("hex") });
    }
  }
  const report = {
    schema: "tour-entry-report/v2", controlOnly: true, status: "valid",
    profile: { frontend: "start", assetEncoding: "gzip", renderer: "SwiftShader", revision: "phase-e",
      seed: "demo-resort", width: 390, height: 844, dpr: 2, cpuFactor: 4, rttMs: 150, downMbps: 1.6 },
    inputs: { runs: inputs },
  };
  const file = join(workspace, "report.json");
  writeFileSync(file, JSON.stringify(report));
  return { runs, file, assess: () => assessTourRelease(file, runs) };
}

it("counts a pending neighbor between the first draw and the independently usable frame", () => {
  expect(fixture().assess().status).toBe("pass");
  const result = fixture({ neighbor: true }).assess();
  expect(result.status).toBe("fail");
  expect(result.issues).toHaveLength(200);
  expect(result.issues?.[0].reason).toBe("another panorama started through usable boundary");
});

it("keeps a split tail verdict inconclusive and reports raw nearest-rank p95 by batch", () => {
  const result = fixture({ flip: true }).assess();
  expect(result.status).toBe("inconclusive");
  expect(result.splitCohorts).toEqual(["direct"]);
  expect(result.batches?.[1].cohorts[0].p95Ms).toBe(9100);
  expect(result.pooled?.[0].p95Ms).toBe(6000);
});

it("retains a recorded failure in the exact matrix", () => {
  const result = fixture({ omit: true }).assess();
  expect(result.status).toBe("inconclusive");
  expect(result.batches?.[0].cohorts[0]).toMatchObject({ expected: 50, n: 49, failed: 1 });
});

it("labels historic first-draw inputs ineligible through the release CLI", () => {
  const input = fixture({ legacy: true });
  const result = spawnSync(process.execPath, ["scripts/bench/tour-release-gates.mjs", input.file, input.runs], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout).status).toBe("ineligible");
});

it("rejects a run file that differs from the completed report", () => {
  const input = fixture();
  writeFileSync(join(input.runs, "batch1-pair1-delay0.json"), "{}");
  expect(input.assess).toThrow("Raw timing file differs from the report");
});
