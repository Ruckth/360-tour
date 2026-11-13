import { defineConfig } from "@playwright/test";

/*
 * Config for the measured click audits (docs/reviews/ux-audit/click-audit.md, final-audit.md).
 * Files end in .audit.ts so the normal browser run (playwright.booking.config.ts) skips them.
 *   BOOKING_UI_PORT=4361 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts final
 */
const port = process.env.BOOKING_UI_PORT ?? "4319";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.audit.ts",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: `http://127.0.0.1:${port}`, timezoneId: "Asia/Bangkok" },
  webServer: {
    command: "pnpm exec vite --config tests/browser/vite.config.ts",
    url: `http://127.0.0.1:${port}/tests/browser/index.html`,
    reuseExistingServer: true,
    cwd: "../../..",
  },
});
