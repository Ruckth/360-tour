import { defineConfig, devices } from "@playwright/test";

// The local integration harness supplies its seeded production build via E2E_BASE_URL.
// BENCH_BASE_URL selects an already-running benchmark target.
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
