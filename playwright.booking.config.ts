import { defineConfig } from "@playwright/test";

// Parallel worktrees each pick their own port: BOOKING_UI_PORT=4331 pnpm test:booking-ui
const port = process.env.BOOKING_UI_PORT ?? "4319";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --config tests/browser/vite.config.ts",
    url: `http://127.0.0.1:${port}/tests/browser/index.html`,
    reuseExistingServer: false,
  },
});
