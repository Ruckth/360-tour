import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: { "process.env": "{}" },
  optimizeDeps: {
    entries: ["tests/browser/*.html"],
    // Checkout's resort-time formatter must be ready before parallel fixture pages load.
    // Discovering it later replaces shared chunks and reloads in-flight accessibility scans.
    include: ["@date-fns/tz"],
  },
  resolve: {
    alias: [
      {
        find: "@/lib/react/convex",
        replacement: path.resolve("tests/browser/optional-convex-mock.ts"),
      },
      {
        find: "convex/react",
        replacement: path.resolve("tests/browser/convex-mock.ts"),
      },
      { find: "@", replacement: path.resolve("src") },
      {
        find: /^convex\/(?!server$|values$|browser$|react$)(.*)$/,
        replacement: path.resolve("convex/$1"),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 4319, strictPort: true },
});
