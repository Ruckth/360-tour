#!/usr/bin/env node
// Fresh anonymous Convex deployment and real Clerk test-tenant authentication. No shared deploys.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { testUsers } from "./e2e-clerk.mjs";
import { localConvexCache } from './local-convex-cache.mjs';
import { startBenchSpans } from "./local-bench-spans.mjs";
import { startVillaCacheProxy } from "./bench/start-villa-cache-proxy.mjs";
import {
  disabledServices,
  requireLocalBackend,
  createPrivateOutput,
} from "./local-integration-config.mjs";

process.umask(0o077); // Local deployment credentials and authenticated test artifacts stay private.
const root = process.cwd();
const supplied = { ...process.env };
const start = process.argv.slice(2, process.argv.includes("--") ? process.argv.indexOf("--") : undefined).includes("--start");
const villaStudyEnabled = supplied.START_VILLA_CACHE_STUDY === "1";
const villaSwrPilot = supplied.START_VILLA_CACHE_SWR_PILOT === "1";
if (villaSwrPilot && !villaStudyEnabled) throw new Error("The local SWR pilot requires the disposable villa cache study");
if (villaStudyEnabled && !start) throw new Error("The villa cache study requires --start");
// Opt-in file contains only Clerk test values, never inherited Convex/provider credentials.
try {
  const contents = await fs.readFile(path.join(root, ".env.e2e.local"), "utf8");
  for (const line of contents.split("\n")) {
    const match =
      /^(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY|CLERK_JWT_ISSUER_DOMAIN)=(.*)$/.exec(
        line,
      );
    if (match && !supplied[match[1]])
      supplied[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const privateValues = () => [
  supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  supplied.CLERK_SECRET_KEY,
  supplied.CLERK_JWT_ISSUER_DOMAIN,
];
function privateError(error) {
  let message = "";
  const output = createPrivateOutput((line) => {
    message += line;
  }, privateValues());
  output.write(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  output.end();
  return new Error(message);
}
await fs.mkdir(path.join(root, "output"), { recursive: true, mode: 0o700 });
const work = await fs.mkdtemp(path.join(root, "output", "local-e2e-"));
await fs.chmod(work, 0o700);
const home = path.join(work, "home"),
  project = path.join(work, "backend");
await fs.mkdir(home, { mode: 0o700 });
await localConvexCache(home);
await fs.mkdir(project, { mode: 0o700 });
await fs.cp(path.join(root, "convex"), path.join(project, "convex"), {
  recursive: true,
});
// Install this authenticated fixture helper only in the fresh disposable backend copy.
if (supplied.BENCH_ROOM_RENAME_FIRST === "1") {
  await fs.writeFile(path.join(project, "convex", "maintenance", "roomRenameBenchmarkFixture.ts"), `
    import { v } from "convex/values";
    import { adminMutation } from "../auth/model";
    export const clearCertificate = adminMutation({
      args: { roomId: v.id("tourScenes") },
      handler: async (ctx, { roomId }) => {
        const room = await ctx.db.get(roomId);
        const villa = room && await ctx.db.get(room.propertyId);
        if (villa?.status !== "draft" || !["rename-2", "rename-50"].includes(villa.slug))
          throw new Error("Require the local room rename fixture");
        await ctx.db.patch(roomId, { ordinaryTourCertified: undefined });
      },
    });
  `, { flag: "wx", mode: 0o600 });
}
await fs.copyFile(
  path.join(root, "package.json"),
  path.join(project, "package.json"),
);
await fs.symlink(
  path.join(root, "node_modules"),
  path.join(project, "node_modules"),
  "dir",
);
const port = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
let fixedRenamePorts;
if (supplied.BENCH_ROOM_RENAME_PORTS) {
  const items = supplied.BENCH_ROOM_RENAME_PORTS.split(",");
  fixedRenamePorts = items.map(Number);
  if (items.length !== 3 || new Set(fixedRenamePorts).size !== 3 ||
      items.some((item) => !/^[0-9]+$/.test(item)) ||
      fixedRenamePorts.some((candidate) => candidate < 1024 || candidate > 65535)) {
    throw new Error("BENCH_ROOM_RENAME_PORTS must be three distinct unprivileged cloud,site,app ports");
  }
  // Probe the loopback bindings before starting any process. The real listeners still bind
  // normally and fail if another process takes a port before startup.
  for (const candidate of fixedRenamePorts) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(candidate, "127.0.0.1", () => server.close(resolve));
    });
  }
}
const [cloud, site, app] = fixedRenamePorts ?? [await port(), await port(), await port()];
const component = await port();
const url = requireLocalBackend(`http://127.0.0.1:${cloud}`),
  baseURL = `http://localhost:${app}`;
const env = {
  ...disabledServices,
  PATH: supplied.PATH,
  HOME: home,
  LANG: "en_US.UTF-8",
  PLAYWRIGHT_BROWSERS_PATH:
    supplied.PLAYWRIGHT_BROWSERS_PATH ??
    path.join(
      supplied.XDG_CACHE_HOME ??
        path.join(
          homedir(),
          ...(process.platform === "darwin"
            ? ["Library", "Caches"]
            : [".cache"]),
        ),
      "ms-playwright",
    ),
  CI: supplied.CI ?? "",
  CONVEX_AGENT_MODE: "anonymous",
  CONVEX_TELEMETRY_DISABLED: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_CONVEX_URL: url,
  VITE_CONVEX_URL: url,
  VITE_CONVEX_SITE_URL: `http://127.0.0.1:${site}`,
  VITE_CLERK_PUBLISHABLE_KEY: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  VITE_SITE_URL: baseURL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_PUBLISHABLE_KEY: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: supplied.CLERK_SECRET_KEY,
  CLERK_JWT_ISSUER_DOMAIN: supplied.CLERK_JWT_ISSUER_DOMAIN,
  E2E_BASE_URL: baseURL,
  E2E_START_ADMIN_IDENTITY: start ? "1" : "",
  E2E_COMPONENT_PORT: String(component),
  BOOKING_UI_PORT: String(component),
  E2E_MODE: "integration",
  E2E_CHAT_LOCAL: "1",
  E2E_SEED_FILE: path.join(work, "seed.json"),
  VITEST_MAX_WORKERS: supplied.VITEST_MAX_WORKERS ?? "4",
  ...(supplied.HEAVY_HELD === "1" && { HEAVY_HELD: "1" }),
};
const children = [];
let cleanupSessions = async () => {};
let benchSpans;
let villaStudy;
async function launch(command, args, cwd = root, childEnv = env, log) {
  const fd = log ? await fs.open(path.join(work, log), "w", 0o600) : null;
  const child = spawn(command, args, {
    cwd,
    env: childEnv,
    stdio: fd ? ["ignore", fd.fd, fd.fd] : ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
  if (!fd) {
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      const output = createPrivateOutput(
        (line) => destination.write(line),
        privateValues(),
      );
      stream.setEncoding("utf8");
      stream.on("data", output.write);
      stream.on("end", output.end);
    }
  }
  if (fd) await fd.close();
  children.push(child);
  return child;
}
async function run(command, args, cwd = root, childEnv = env) {
  const child = await launch(command, args, cwd, childEnv);
  const code = await child.done;
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}
async function until(fn, label, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function stop() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    await Promise.race([child.done, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
}
let cleanup;
function finalize() {
  return (cleanup ??= (async () => {
    await stop();
    await benchSpans?.close();
    await villaStudy?.close();
    await cleanupSessions().catch((error) => {
      throw privateError(error);
    });
  })());
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void finalize().finally(() => process.exit(1));
  });
try {
  // Acquire external test identities inside the same lifetime that guarantees their cleanup.
  const provisioned = await testUsers(supplied).catch((error) => {
    throw privateError(error);
  });
  const { users } = provisioned;
  cleanupSessions = provisioned.cleanupSessions;
  Object.assign(env, {
    E2E_OWNER_EMAIL: users.owner.email,
    E2E_CASHIER_EMAIL: users.cashier.email,
    E2E_NONSTAFF_EMAIL: users.nonstaff.email,
  });
  await launch(
    process.execPath,
    [
      path.join(root, "node_modules/convex/bin/main.js"),
      "dev",
      "--local-cloud-port",
      String(cloud),
      "--local-site-port",
      String(site),
      ...(supplied.BENCH_ROOM_RENAME_DASHBOARD_FREE === "1" ? [
        // --until-success skips the anonymous dashboard prelude. Its startup command
        // keeps the backend alive and exits if the Convex CLI process goes away.
        "--until-success", "--start",
        "exec node -e 'const owner = process.ppid; setInterval(() => { try { process.kill(owner, 0) } catch { process.exit(0) } }, 250)'",
      ] : []),
      "--typecheck",
      "disable",
      "--tail-logs",
      "disable",
    ],
    project,
    env,
    "backend.log",
  );
  const configPath = path.join(project, ".convex/local/default/config.json");
  let config;
  await until(async () => {
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf8"));
      return true;
    } catch {
      return false;
    }
  }, "local backend config");
  await fs.chmod(configPath, 0o600);
  if (villaStudyEnabled) {
    villaStudy = await startVillaCacheProxy(url);
    env.VITE_CONVEX_URL = villaStudy.proxyUrl;
  }
  await until(async () => {
    try {
      const response = await fetch(url + "/api/update_environment_variables", {
        method: "POST",
        headers: {
          Authorization: `Convex ${config.adminKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          changes: [
            {
              name: "CLERK_JWT_ISSUER_DOMAIN",
              value: env.CLERK_JWT_ISSUER_DOMAIN,
            },
            { name: "ADMIN_EMAILS", value: users.owner.email },
            ...(villaStudy ? [
              { name: "START_VILLA_INVALIDATION_ORIGIN", value: `http://127.0.0.1:${app}` },
              { name: "START_VILLA_INVALIDATION_SECRET", value: villaStudy.secret },
            ] : []),
          ],
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, "local backend authentication configuration");
  await until(
    async () =>
      (await fs.readFile(path.join(work, "backend.log"), "utf8")).includes(
        "Convex functions ready",
      ),
    "Convex deployment",
  );
  // Admin credentials are used only for the empty seed/import; no browser or acceptance client gets them.
  const seeder = new ConvexHttpClient(url);
  seeder.setAdminAuth(config.adminKey);
  const seeded = await seeder.mutation(
    makeFunctionReference("maintenance/seed:seedAll"),
    { scenario: "demo-resort" },
  );
  await fs.writeFile(env.E2E_SEED_FILE, JSON.stringify(seeded), {
    mode: 0o600,
  });
  const grants = [
    {
      email: users.cashier.email,
      role: "cashier",
      tokenIdentifier: `${env.CLERK_JWT_ISSUER_DOMAIN.replace(/\/$/, "")}|${users.cashier.id}`,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedByEmail: "system:e2e-seed",
    },
  ];
  const grantFile = path.join(work, "staff-grants.json");
  await fs.writeFile(grantFile, JSON.stringify(grants), { mode: 0o600 });
  const seedEnv = path.join(work, "seed.env");
  await fs.writeFile(
    seedEnv,
    `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
  await run(
    process.execPath,
    [
      path.join(root, "node_modules/convex/bin/main.js"),
      "import",
      "--env-file",
      seedEnv,
      "--table",
      "staffGrants",
      "--append",
      grantFile,
    ],
    project,
  );
  await fs.rm(seedEnv);
  console.log(
    "Fresh local backend seeded; dedicated Clerk test identities ready.",
  );
  const verify = process.argv.includes("--verify");
  if (verify || !start) await run("bun", ["run", verify ? "verify" : "build"]);
  if (start) {
    await run("bun", ["run", "build:start"], root, {
      ...env,
      ...(supplied.BENCH_START_WIRE_GZIP === "1" && { BENCH_START_WIRE_GZIP: "1" }),
    });
    const server = supplied.BENCH_SPANS_OUT
      ? ["--import", "./scripts/local-bench-next-timing.mjs", ".output/server/index.mjs"]
      : [".output/server/index.mjs"];
    await launch(process.execPath, server, root, {
      ...env, PORT: String(app), HOST: "127.0.0.1",
      START_VILLA_INVALIDATION_SECRET: villaStudy?.secret ?? "",
      ...(villaSwrPilot && { VERCEL_ENV: "preview", VILLA_BENCH_NAMESPACE: "1" }),
      ...(supplied.BENCH_SPANS_OUT && { BENCH_LOCAL_SSR: "1", BENCH_START_PORT: String(app) }),
    }, "start.log");
  } else if (supplied.BENCH_SPANS_OUT) {
    await launch(process.execPath, [
      "--import", "./scripts/local-bench-next-timing.mjs",
      "./node_modules/next/dist/bin/next", "start", "-p", String(app),
    ], root, { ...env, BENCH_LOCAL_SSR: "1", BENCH_NEXT_PORT: String(app) }, "next.log");
  } else {
    await launch("bun", ["run", "next", "start", "-p", String(app)], root, { ...env, BENCH_LOCAL_SSR: "" }, "next.log");
  }
  await until(async () => {
    try {
      return (await fetch(baseURL + (start ? "/rooms/pool-villa" : "/admin/chats"))).ok;
    } catch {
      return false;
    }
  }, start ? "TanStack Start server" : "Next server");
  if (verify) await run("bun", ["run", "test:booking-ui"]);
  const separator = process.argv.indexOf("--");
  const command =
    separator < 0
      ? ["bun", "run", "playwright", "test"]
      : process.argv.slice(separator + 1);
  if (supplied.BENCH_SPANS_OUT) {
    benchSpans = await startBenchSpans({
      out: path.resolve(root, supplied.BENCH_SPANS_OUT),
      backendUrl: url,
      adminKey: config.adminKey,
      nextLog: path.join(work, start ? "start.log" : "next.log"),
    });
  }
  await run(command[0], command.slice(1), root, {
    ...env,
    ...(benchSpans && { BENCH_SPAN_ENDPOINT: benchSpans.endpoint }),
    ...(start && {
      BENCH_FRONTEND: "start",
      ...(supplied.BENCH_START_WIRE_GZIP === "1" && { BENCH_START_WIRE_GZIP: "1" }),
    }),
    ...(villaStudy && { START_VILLA_CACHE_STUDY_CONTROL: villaStudy.controlUrl }),
  });
} finally {
  await finalize();
}
