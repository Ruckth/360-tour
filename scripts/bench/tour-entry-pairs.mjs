#!/usr/bin/env node
// Run inside the seeded integration harness, against its already-built server.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    pairs: { type: "string", default: "10" },
    "delay-ms": { type: "string", default: "1000" },
    "control-only": { type: "boolean" },
  },
});
if (!values.out || !process.env.E2E_BASE_URL || !process.env.BENCH_SPAN_ENDPOINT) {
  throw Error("Run through local-integration with BENCH_SPANS_OUT and --out pointing to a new directory");
}
const pairs = Number(values.pairs);
const delayMs = Number(values["delay-ms"]);
if (!Number.isSafeInteger(pairs) || pairs < 1 || !Number.isSafeInteger(delayMs) || delayMs < 1) {
  throw Error("--pairs and --delay-ms must be positive integers");
}

const out = path.resolve(values.out);
mkdirSync(out, { mode: 0o700 });
for (let batch = 1; batch <= 2; batch++) {
  for (let pair = 1; pair <= pairs; pair++) {
    // Reverse the order across pairs and again across batches.
    const delays = values["control-only"] ? [0] : (batch + pair) % 2 === 0 ? [0, delayMs] : [delayMs, 0];
    for (const withheld of delays) {
      const name = `batch${batch}-pair${pair}-delay${withheld}`;
      console.log(name);
      const runFile = path.join(out, name + ".json");
      const result = spawnSync("bun", ["run", "bench:browser", "tour-open-interaction", "--grep", "tour entry to first responsive frame"], {
        stdio: "inherit",
        env: {
          ...process.env,
          BENCH_RUNS: "1",
          BENCH_BATCH: name,
          BENCH_IMAGE_DELAY_MS: String(withheld),
          BENCH_TRACE_PATH: "",
          BENCH_CHROME_TRACE_PATH: "",
          BENCH_OUT: runFile,
        },
      });
      if (result.error) throw result.error;
      if (result.signal || !existsSync(runFile)) throw Error(`Benchmark process did not finish writing ${name}`);
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
