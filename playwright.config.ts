import { defineConfig, devices } from "@playwright/test";

/**
 * Two explicit modes:
 * - demo (default): Playwright starts scripts/e2e-server.mjs, a disconnected demo build with
 *   placeholder Convex/Clerk configuration. It never runs or deploys Convex.
 * - integration: E2E_MODE=integration with E2E_BASE_URL pointing at an already running,
 *   explicitly configured environment. Playwright starts nothing.
 */
const integration = process.env.E2E_MODE === "integration";
if (integration && !process.env.E2E_BASE_URL) {
  throw new Error("E2E_MODE=integration requires E2E_BASE_URL for an already running server");
}
const e2ePort = Number(process.env.E2E_PORT ?? 3000);
const baseURL = integration ? process.env.E2E_BASE_URL! : `http://localhost:${e2ePort}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: ci ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: ci ? "retain-on-failure" : "off",
  },
  webServer: integration
    ? undefined
    : {
        command: "node scripts/e2e-server.mjs",
        env: { PORT: String(e2ePort) },
        url: baseURL,
        reuseExistingServer: false,
        // Production mode builds first; the build takes about a minute on a laptop.
        timeout: 300_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
