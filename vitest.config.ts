import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testProjects } from "./scripts/vitest-projects.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS || 4),
    projects: Object.entries(testProjects(dirname)).map(([name, include]) => ({
      extends: true,
      test: {
        name,
        include,
        environment: name === "dom" ? "happy-dom" : name === "convex" ? "edge-runtime" : "node",
        setupFiles: name === "unit" ? [] : ["./tests/unit/convex-components.ts"],
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
