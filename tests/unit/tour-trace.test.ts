import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";

it("shares only named timing events inside the measured gesture window", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tour-trace-"));
  try {
    const event = (name: string, ts: number) => ({
      name, ts, pid: 4, tid: 7, ph: "I", cat: "blink.user_timing", args: { url: "private-input-value" },
    });
    const input = path.join(directory, "raw.json");
    const output = path.join(directory, "public.json.gz");
    writeFileSync(input, JSON.stringify({ traceEvents: [
      event("DrawFrame", 98), event("navigationStart", 100), event("private-input-value", 102),
      event("ImageDecodeTask", 104), event("tour_bench:drag_changed_frame", 110), event("Paint", 111),
    ] }));
    execFileSync(process.execPath, ["scripts/bench/tour-trace.mjs", input, output]);
    const text = gunzipSync(readFileSync(output)).toString();
    expect(text).not.toContain("private-input-value");
    expect(JSON.parse(text).traceEvents.map((e: { name: string; ts: number }) => [e.name, e.ts])).toEqual([
      ["navigationStart", 0], ["ImageDecodeTask", 4], ["tour_bench:drag_changed_frame", 10],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
