import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8");

function stepScript(name: string) {
  const step = workflow.split(/^      - name: /m).find(block => block.startsWith(`${name}\n`));
  const script = step?.match(/^        run: \|\n([\s\S]*)/m)?.[1];
  if (!script) throw new Error(`Missing shell step: ${name}`);
  return script.replace(/^          /gm, "");
}

function run(script: string, env: Record<string, string>) {
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    encoding: "utf8",
  });
}

it("keeps PR verification unprivileged and never uploads authenticated artifacts", () => {
  expect(workflow).toMatch(/^  pull_request:/m);
  expect(workflow).not.toMatch(/^\s*pull_request_target:/m);
  expect(workflow).toMatch(/^permissions:\n  contents: read\n/m);
  expect(workflow).not.toMatch(/uses:.*upload-artifact/);
  const jobs = workflow.split(/^  (?=\w+:\n    )/m).slice(1);
  const secretJobs = jobs.filter(job => job.includes("secrets."));
  expect(secretJobs.map(job => job.split(":")[0]).sort()).toEqual(["devcheck", "integration_start"]);
  for (const job of secretJobs) {
    expect(job).toContain("run: bash .github/scripts/require-clerk-test.sh");
  }
});

it("fails Clerk preflight for forks, missing fields and live tenant keys", () => {
  const script = readFileSync(new URL("../../.github/scripts/require-clerk-test.sh", import.meta.url), "utf8");
  const env = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_offline_fixture",
    CLERK_SECRET_KEY: "sk_test_offline_fixture",
    CLERK_JWT_ISSUER_DOMAIN: "https://tenant.clerk.accounts.dev",
  };
  expect(run(script, env).status).toBe(0);
  expect(run(script, {}).status).not.toBe(0);
  for (const key of Object.keys(env)) expect(run(script, { ...env, [key]: "" }).status).not.toBe(0);
  for (const mutation of [
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_offline_fixture" },
    { CLERK_SECRET_KEY: "sk_live_offline_fixture" },
  ]) expect(run(script, { ...env, ...mutation }).status).not.toBe(0);
});

it("requires every parallel job and propagates failure, cancellation and skips through the verify check", () => {
  const gate = workflow.split(/^  verify:/m)[1];
  expect(gate).toMatch(/^    name: verify$/m);
  expect(gate).toMatch(/^    if: always\(\)$/m);
  const dependencies = gate.match(/^    needs: \[(.*)\]$/m)?.[1].split(", ").sort();
  const jobNames = [...workflow.split("\njobs:\n")[1].matchAll(/^  (\w+):\n    /gm)].map(match => match[1]).filter(name => name !== "verify").sort();
  expect(dependencies).toEqual(jobNames);
  expect(jobNames).toEqual(["components", "devcheck", "guards", "integration_start", "static", "unit"]);
  const results = Object.fromEntries(jobNames.map(name => [name, { result: "success" }]));
  const script = stepScript("Require every job to succeed");
  expect(run(script, { NEEDS_JSON: JSON.stringify(results) }).status).toBe(0);
  for (const name of jobNames) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(run(script, { NEEDS_JSON: JSON.stringify({ ...results, [name]: { result } }) }).status).toBe(1);
    }
  }
});

it("runs only the Start frontend: E2E, route tree, all four budgets and the persistent dev check", () => {
  const job = (name: string) => workflow.split(new RegExp(`^  ${name}:\\n`, "m"))[1]?.split(/^  \w+:\n    /m)[0] ?? "";
  expect(workflow).not.toMatch(/\.next\/cache|next\.config|test:e2e:start|bench:routes:start|--check-budgets|FRONTEND=next/);
  const start = job("integration_start");
  expect(start).toContain("run: bun run test:e2e\n");
  expect(start).toContain("run: git diff --exit-code -- src/start-app/routeTree.gen.ts");
  expect(start).toContain("run: bun run bench:routes\n");
  // The only job that saves the Convex binary cache; devcheck restores it.
  expect(start).toMatch(/uses: actions\/cache@v4\n        with:\n          # Only binaries/);
  expect(job("devcheck")).toContain("run: bun run test:dev");
  expect(job("devcheck")).toContain("LOCAL_DEV_SKIP_TYPECHECK: '1'");
  expect(job("components")).toContain("run: bun run test:booking-ui --shard=${{ matrix.shard }}/8");
  // Checkpoint history readers run in guards (scripts/vitest-projects.mjs), the only full-history checkout.
  expect(job("guards")).toContain("fetch-depth: 0");
  expect(job("guards")).toContain("run: bun run test:guards");
  expect(job("unit")).toContain("--project unit --project dom --project convex");
});
