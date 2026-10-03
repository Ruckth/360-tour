import { defineConfig, devices } from "@playwright/test";

/**
 * Local benchmarks (not part of `pnpm test:e2e`). Point BENCH_BASE_URL at an already running
 * demo production server, e.g. `E2E_PORT=3300 node scripts/e2e-server.mjs` for this checkout or
 * `next start` in a clean baseline checkout built with placeholder settings. Nothing here starts,
 * syncs or deploys Convex. Results are written to BENCH_OUT (JSON).
 */
const baseURL = process.env.BENCH_BASE_URL;
if (!baseURL) throw new Error("BENCH_BASE_URL is required (an already running demo server)");

export default defineConfig({
  testDir: "./tests/bench",
  testMatch: /.*\.bench\.ts$/,
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL, ...devices["Desktop Chrome"] },
});
