// Export the measured interval of a Chromium trace without request data, URLs,
// page content, script arguments or stack traces. The input stays local.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error("Usage: node scripts/bench/tour-trace.mjs <chrome.json> <trace.json.gz>");

const events = JSON.parse(readFileSync(input, "utf8")).traceEvents;
const lastFrame = events.find((e) => e.name === "tour_bench:drag_changed_frame");
const navigation = lastFrame && events.find((e) =>
  e.name === "navigationStart" && e.pid === lastFrame.pid && e.tid === lastFrame.tid && e.ts < lastFrame.ts);
if (!navigation) throw Error("Trace needs main-frame navigation and the first frame after a trusted drag");

const names = new Set([
  "navigationStart", "firstPaint", "firstContentfulPaint", "ParseHTML", "EvaluateScript",
  "ResourceSendRequest", "ResourceReceiveResponse", "ResourceFinish", "EventDispatch",
  "Paint", "PaintImage", "RasterTask", "DrawFrame", "CompositeLayers", "ImageDecodeTask",
  "Decode Image", "Decode LazyPixelRef", "GpuImageDecodeCache::DecodeImage", "ImageUploadTask",
  "GpuImageDecodeCache::UploadImage", "GPUTask", "Display::DrawAndSwap",
  "tour_bench:room_hydrated", "tour_bench:viewer_module_start", "tour_bench:viewer_module_ready",
  "tour_bench:viewer_mounted", "tour_bench:rooms_resolved", "tour_bench:texture_request_start",
  "tour_bench:texture_available", "tour_bench:first_scene_drawn", "tour_bench:drag_started",
  "tour_bench:drag_changed_frame",
]);
const traceEvents = events
  .filter((e) => names.has(e.name) && ["X", "I", "i", "R"].includes(e.ph) &&
    e.ts >= navigation.ts && e.ts <= lastFrame.ts)
  .map((e) => ({
    name: e.name, cat: e.cat, ph: e.ph, ts: e.ts - navigation.ts, pid: e.pid, tid: e.tid,
    ...(e.ph === "X" ? { dur: e.dur } : { s: "t" }),
  }));
writeFileSync(output, gzipSync(JSON.stringify({ traceEvents })), { flag: "wx" });
console.log(`Exported ${traceEvents.length} timestamped observations from the direct-entry smoke.`);
