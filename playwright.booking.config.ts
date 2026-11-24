import { defineConfig } from "@playwright/test";
import { bookingUIPort } from './scripts/worktree-ports.mjs';

const port = bookingUIPort(process.cwd());
const baseURL = `http://127.0.0.1:${port}`;
// Screenshot capture specs skip themselves unless a CAPTURE_* variable is set.
// Leave them out of normal runs so they do not pile into one CI shard.
const capturing = Object.keys(process.env).some((name) => name.startsWith("CAPTURE_") && name !== "CAPTURE_SCREENSHOTS");

export default defineConfig({
  // Independent component cases can run concurrently within each CI shard.
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  outputDir: "test-results/components",
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  testIgnore: capturing ? [] : ["**/*screenshots*.spec.ts"],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run vite --config tests/browser/vite.config.ts --port ${port} --strictPort`,
    url: `${baseURL}/tests/browser/index.html`,
    reuseExistingServer: false,
  },
});
