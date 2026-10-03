import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Local synthetic benchmarks only; never part of `pnpm test:unit`.
export default defineConfig({
  test: {
    include: ["tests/bench/**/*.vitest.ts"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(dirname, "src") },
      {
        find: /^convex\/(?!server$|values$|react$|react-clerk$|browser$)(.*)$/,
        replacement: path.resolve(dirname, "convex/$1"),
      },
    ],
  },
});
