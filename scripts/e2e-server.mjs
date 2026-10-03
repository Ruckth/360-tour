#!/usr/bin/env node
// Deterministic demo server for Playwright. It never runs, syncs or deploys Convex:
// the backend URL and Clerk key are forced to "placeholder", so the app runs disconnected.
//   E2E_SERVER=prod (default): `next build`, then `next start`. NEXT_PUBLIC_* values are inlined at
//   build time, so this rebuilds .next with the placeholder configuration.
//   E2E_SERVER=dev: `next dev` (faster to start, compiles routes on demand).
//   E2E_SKIP_BUILD=1 reuses an existing placeholder build in .next.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReuseDemoBuild, createDemoEnv, demoBuildStamp } from "./demo-server-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.env.E2E_SERVER ?? "prod";
const port = process.env.PORT ?? process.env.E2E_PORT ?? "3000";
const distDir = ".next";
const next = path.join(root, "node_modules", ".bin", "next");

const env = createDemoEnv(process.env, port);

if (mode !== "prod" && mode !== "dev") {
  console.error(`E2E_SERVER must be "prod" or "dev", got "${mode}"`);
  process.exit(2);
}

// Bind the placeholder configuration to this exact build. A subsequent normal build cannot reuse
// the old marker, even when Next leaves unrelated files in the output directory.
const marker = path.join(root, distDir, "e2e-demo-build");
const buildIdPath = path.join(root, distDir, "BUILD_ID");
/** @param {string} file */
const readOptional = (file) => existsSync(file) ? readFileSync(file, "utf8") : null;
if (mode === "prod" && !(process.env.E2E_SKIP_BUILD === "1" &&
  canReuseDemoBuild(readOptional(marker), readOptional(buildIdPath)))) {
  rmSync(marker, { force: true });
  const build = spawnSync(next, ["build"], { cwd: root, env, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  writeFileSync(marker, demoBuildStamp(readFileSync(buildIdPath, "utf8")));
}

const server = spawn(next, mode === "prod" ? ["start", "-p", port] : ["dev", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
