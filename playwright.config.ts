import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const ci = Boolean(process.env.CI);

export default defineConfig({
  outputDir: "test-results/integration",
  globalSetup: "./tests/e2e/require-local.ts",
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
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  workers: 2,
  projects: [
    { name: "clerk-setup", testMatch: /auth.setup.ts/ },
    {
      name: "chromium",
      dependencies: ["clerk-setup"],
      testIgnore: /auth.setup.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
