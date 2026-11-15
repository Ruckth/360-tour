import path from "node:path";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { testProjects } from "./scripts/vitest-projects.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const maxWorkers = Math.min(availableParallelism(), Number(process.env.VITEST_MAX_WORKERS || (process.env.CI ? 4 : 2)));

export default defineConfig({
  plugins: [{
    name: "worker-ceilings",
    configureVitest({ project }) {
      // Vitest applies VITEST_MAX_WORKERS after project config, overriding guards' limit.
      // Enforce both ceilings after resolution while preserving the inherited environment.
      project.config.maxWorkers = project.name === "guards" ? 1 : maxWorkers;
    },
  }],
  test: {
    // Treat the requested value as a ceiling, including on smaller CI runners.
    maxWorkers,
    projects: Object.entries(testProjects(dirname)).map(([name, include]) => ({
      extends: true,
      test: {
        name,
        include,
        environment: name === "dom" ? "happy-dom" : name === "convex" ? "edge-runtime" : "node",
        setupFiles: ["dom", "convex"].includes(name) ? ["./tests/unit/convex-components.ts"] : [],
        ...(name === "guards" ? { testTimeout: 60_000, fileParallelism: false, maxWorkers: 1 } : {}),
        // Bundle next-intl for Next.js subpath imports in proxy integration tests.
        server: { deps: { inline: ["next-intl"] } },
      },
    })),
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(dirname, "src") },
      {
        find: /^convex\/(?!server$|values$|browser$|react$|react-clerk$)(.*)$/,
        replacement: path.resolve(dirname, "convex/$1"),
      },
    ],
  },
});
