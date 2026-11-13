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
import {
  disabledServices,
  requireLocalBackend,
  createPrivateOutput,
} from "./local-integration-config.mjs";

process.umask(0o077); // Local deployment credentials and authenticated test artifacts stay private.
const root = process.cwd();
const supplied = { ...process.env };
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
await localConvexCache(root, home);
await fs.mkdir(project, { mode: 0o700 });
await fs.cp(path.join(root, "convex"), path.join(project, "convex"), {
  recursive: true,
});
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
const cloud = await port(),
  site = await port(),
  app = await port(),
  component = await port();
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
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_PUBLISHABLE_KEY: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: supplied.CLERK_SECRET_KEY,
  CLERK_JWT_ISSUER_DOMAIN: supplied.CLERK_JWT_ISSUER_DOMAIN,
  E2E_BASE_URL: baseURL,
  E2E_COMPONENT_PORT: String(component),
  E2E_MODE: "integration",
  E2E_CHAT_LOCAL: "1",
  E2E_SEED_FILE: path.join(work, "seed.json"),
  VITEST_MAX_WORKERS: supplied.VITEST_MAX_WORKERS ?? "4",
};
const children = [];
let cleanupSessions = async () => {};
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
      "--local",
      "--local-cloud-port",
      String(cloud),
      "--local-site-port",
      String(site),
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
  await run("pnpm", [verify ? "verify" : "build"]);
  await launch(
    "pnpm",
    ["exec", "next", "start", "-p", String(app)],
    root,
    env,
    "next.log",
  );
  await until(async () => {
    try {
      return (await fetch(baseURL + "/admin/chats")).ok;
    } catch {
      return false;
    }
  }, "Next server");
  if (verify) await run("pnpm", ["test:booking-ui"]);
  const separator = process.argv.indexOf("--");
  const command =
    separator < 0
      ? ["pnpm", "exec", "playwright", "test"]
      : process.argv.slice(separator + 1);
  await run(command[0], command.slice(1));
} finally {
  await finalize();
}
