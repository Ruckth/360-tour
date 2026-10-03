#!/usr/bin/env node
// Deterministic demo server for Playwright. It never runs, syncs or deploys Convex:
// the backend URL and Clerk key are forced to "placeholder", so the app runs disconnected.
//   E2E_SERVER=prod (default): `next build`, then `next start`. NEXT_PUBLIC_* values are inlined at
//   build time, so this rebuilds .next with the placeholder configuration.
//   E2E_SERVER=dev: `next dev` (faster to start, compiles routes on demand).
//   E2E_SKIP_BUILD=1 reuses an existing placeholder build in .next.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.env.E2E_SERVER ?? "prod";
const port = process.env.PORT ?? process.env.E2E_PORT ?? "3000";
const distDir = ".next";
const next = path.join(root, "node_modules", ".bin", "next");

const env = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: "placeholder",
  PUBLIC_CONVEX_URL: "placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "placeholder",
  NEXT_TELEMETRY_DISABLED: "1",
  PORT: port,
};
// Nothing in the demo server may reach a configured deployment or third-party service.
for (const key of [
  "CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SERVER_SECRET", "CLERK_SECRET_KEY",
  "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "NEXT_PUBLIC_POSTHOG_KEY",
]) delete env[key];

if (mode !== "prod" && mode !== "dev") {
  console.error(`E2E_SERVER must be "prod" or "dev", got "${mode}"`);
  process.exit(2);
}

// The marker proves the existing build used the placeholder configuration, not a real backend URL.
const marker = path.join(root, distDir, "e2e-demo-build");
if (mode === "prod" && !(process.env.E2E_SKIP_BUILD === "1" && existsSync(marker))) {
  const build = spawnSync(next, ["build"], { cwd: root, env, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  writeFileSync(marker, "NEXT_PUBLIC_CONVEX_URL=placeholder\n");
}

const server = spawn(next, mode === "prod" ? ["start", "-p", port] : ["dev", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
