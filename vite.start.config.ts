import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { startRouteJsManifest } from "./scripts/bench/start-route-js-manifest.mjs";
import { startTourModulePreloads } from "./scripts/start-tour-module-preloads";
import { nitro } from "nitro/vite";
import { vercelImages } from "./src/platform/image-config";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const publicKeys = [
  "CLERK_PUBLISHABLE_KEY", "CONVEX_SITE_URL", "CONVEX_URL",
  "POSTHOG_HOST", "POSTHOG_KEY", "SENTRY_DSN", "SITE_URL",
] as const;

function rejectNextImports(): Plugin {
  return {
    name: "start-framework-boundary",
    enforce: "pre",
    resolveId(source, importer) {
      if (/^(next(?:\/|$)|next-intl(?:\/|$)|@(?:clerk|sentry)\/nextjs(?:\/|$))/.test(source)) {
        this.error(`Start cannot load ${source} from ${importer}`);
      }
    },
  };
}

// Private source-map upload, as in the Next build: only with SENTRY_AUTH_TOKEN (plus SENTRY_ORG/
// SENTRY_PROJECT, and SENTRY_URL for a self-hosted server). The official plugin emits hidden client
// and final Nitro server maps with debug IDs, uploads them and deletes them, so no map or
// sourceMappingURL is published. Loaded only then: importing it changes the plain build.
const sentryUploadPlugins: Plugin[] = process.env.SENTRY_AUTH_TOKEN
  ? (await import("@sentry/tanstackstart-react/vite")).sentryTanstackStart({
    sentryUrl: process.env.SENTRY_URL,
    telemetry: false,
    autoInstrumentMiddleware: false,
    buildTimeInstrumentation: false,
  })
  : [];

export default defineConfig(({ mode }) => {
  // Only the named public values can be substituted into the browser graph.
  const env = { ...loadEnv(mode, process.cwd(), ["VITE_", "NEXT_PUBLIC_"]), ...process.env };
  const vercel = process.env.VERCEL === "1" || process.env.NITRO_PRESET === "vercel";
  const define: Record<string, string> = {};
  for (const key of publicKeys) {
    const value = env[`VITE_${key}`] ?? env[`NEXT_PUBLIC_${key}`];
    define[`import.meta.env.VITE_${key}`] = JSON.stringify(value) ?? "undefined";
    define[`process.env.NEXT_PUBLIC_${key}`] = JSON.stringify(value) ?? "undefined";
  }
  define["import.meta.env.VITE_VERCEL_IMAGE_OPTIMIZATION"] = JSON.stringify(vercel ? "1" : "0");
  return {
    envPrefix: [],
    define,
    // The Start stylesheet only needs app classes. Browser fixtures use their own Vite config.
    css: { postcss: { plugins: [tailwindcss({ base: here("./src") })] } },
    resolve: {
      alias: [
        { find: /^tailwindcss$/, replacement: here("./node_modules/tailwindcss/index.css") },
        { find: /^convex\/(shared|_generated)\//, replacement: here("./convex/") + "$1/" },
        // Disposable Preview outage fixture only; see docs/plans/benchmarks/start-villa-cache-study.md.
        ...(process.env.START_VILLA_FAULT_FIXTURE === "1" && vercel
          ? [{ find: "@/lib/server/villa-read-fault", replacement: here("./src/lib/server/villa-read-fault.fixture.ts") }]
          : []),
        { find: "@", replacement: here("./src") },
      ],
    },
    plugins: [
      rejectNextImports(),
      tanstackStart({ srcDirectory: "src/start-app" }),
      startRouteJsManifest(),
      startTourModulePreloads(),
      react(),
      nitro({
        preset: vercel ? "vercel" : "node-server",
        // Match Next's local wire encoding only in the isolated Start tour benchmark.
        ...(!vercel && process.env.BENCH_START_WIRE_GZIP === "1" && {
          compressPublicAssets: { gzip: true },
        }),
        vercel: {
          functions: { runtime: (process.env.START_SSR_RUNTIME || "bun") === "bun" ? "bun1.4.x" : "nodejs22.x" },
          config: {
            version: 3,
            images: vercelImages,
            routes: [{
              src: "/(.*)\\.(png|jpg|jpeg|webp|avif|gif|svg|ico|mp4|woff2|ttf|otf)$",
              headers: { "cache-control": "public, max-age=31536000, immutable" },
              continue: true,
            }],
          },
        },
        routeRules: {
          "/display": { headers: { "referrer-policy": "no-referrer", "cache-control": "no-store", "x-robots-tag": "noindex" } },
          "/garden-image.jpg": { redirect: { to: "/garden-image.webp", status: 308 } },
          "/videos/hero-left.mp4": { redirect: { to: "/videos/hero-left-v2.mp4", status: 308 } },
          "/videos/hero-right.mp4": { redirect: { to: "/videos/hero-right-v2.mp4", status: 308 } },
          ...Object.fromEntries(["/assets/**", "/videos/**", "/fonts/**", "/contact/**"].map((pattern) =>
            [pattern, { headers: { "cache-control": "public, max-age=31536000, immutable" } }])),
        },
      }),
      // Source-map handling is the only difference in a credentialed build (see above).
      ...sentryUploadPlugins,
    ],
  };
});
