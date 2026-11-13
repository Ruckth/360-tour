import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_COMPONENT_PORT ?? 4319);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  workers: 2,
  outputDir: "test-results/components",
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite --config tests/browser/vite.config.ts --port ${port} --strictPort`,
    url: `${baseURL}/tests/browser/index.html`,
    reuseExistingServer: false,
  },
});
