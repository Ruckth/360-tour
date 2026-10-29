import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: { "process.env": "{}" },
  resolve: {
    alias: [
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
