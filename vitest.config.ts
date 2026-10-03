import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "convex/**/*.test.ts"],
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
