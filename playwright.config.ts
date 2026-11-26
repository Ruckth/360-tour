import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
const ci = Boolean(process.env.CI);
const setup = /auth\.setup\.ts$/;
const desktop = { ...devices["Desktop Chrome"] };
// These specs use seeded inventory or their own browser/guest state. The chat
// transcript tests stay serial because their fixtures sign in through Clerk.
const anonymousSpecs = [
  "admin-chat",
  "chat-launcher",
  "chat-server",
  "hero-reduced-motion",
  "home-money",
  "home-quick-booking",
  "public-chat",
  "service-catalog",
  "tour-loading",
  "villa-tour",
].map((name) => `**/${name}.spec.ts`);

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
  workers: ci ? 3 : 2,
  projects: [
    { name: "clerk-setup", testMatch: setup },
    {
      name: "chromium",
      dependencies: ["clerk-setup"],
      testIgnore: ci ? [setup, ...anonymousSpecs] : [setup],
      use: desktop,
      // CI signs into the shared Clerk test tenant, which other runners also use.
      workers: ci ? 1 : undefined,
    },
    ...(ci ? [{
      name: "chromium-anonymous",
      // Both Chromium projects start in the same phase after the one setup test.
      dependencies: ["clerk-setup"],
      testMatch: anonymousSpecs,
      use: desktop,
      workers: 2,
    }] : []),
  ],
});
