import { defineConfig, devices } from "@playwright/test";

/**
 * Local benchmarks (not part of `pnpm test:e2e`). Point BENCH_BASE_URL at an already running
 * demo production server, e.g. `E2E_PORT=3300 node scripts/e2e-server.mjs` for this checkout or
 * `next start` in a clean baseline checkout built with placeholder settings. Nothing here starts,
 * syncs or deploys Convex. Results are written to BENCH_OUT (JSON).
 */
// Inside scripts/local-integration.mjs the harness's own server (E2E_BASE_URL) is the default.
const baseURL = process.env.BENCH_BASE_URL ?? process.env.E2E_BASE_URL;

// Fix Chromium onto software WebGL (ANGLE SwiftShader) so macOS/Linux runs do not silently
// switch between hardware Metal/Vulkan and software rendering across hosts or sessions.
const SOFTWARE_WEBGL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

export default defineConfig({
  testDir: "./tests/bench",
  testMatch: /.*\.bench\.ts$/,
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: SOFTWARE_WEBGL_ARGS,
    },
  },
});
