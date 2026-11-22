import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clerkRuntime } from "../../scripts/clerk-runtime.mjs";
import { expect, it } from "vitest";

// @clerk/nextjs and @clerk/react must share one @clerk/shared implementation. When they resolve
// separate copies (Bun nested two byte-identical 4.12.2 copies after the dev-only @clerk/testing
// claimed the top-level slot with 4.44.0), Next bundles Clerk's runtime twice into every page:
// about 26 KB gzip on /admin/checkout, which failed its budget. The exact @clerk/shared pin in
// package.json keeps the version they both require shared. Bump it together with Clerk. Worktree
// setup recovers inherited installs that still hold the old nested copies (scripts/clerk-runtime.mjs).
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Exact, ^ or ~ range check, enough for the ranges Clerk declares. */
function satisfies(version: string, range: string) {
  const parse = (value: string) => value.split(".").map(Number);
  const match = range.match(/^([~^]?)(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error(`Unsupported range ${range}`);
  const [operator, floor] = [match[1], parse(match[2])];
  const actual = parse(version);
  const atLeast = actual[0] !== floor[0] ? actual[0] > floor[0]
    : actual[1] !== floor[1] ? actual[1] > floor[1] : actual[2] >= floor[2];
  if (operator === "") return version === match[2];
  if (operator === "~") return atLeast && actual[0] === floor[0] && actual[1] === floor[1];
  return atLeast && actual[0] === floor[0];
}

it("resolves one shared Clerk runtime for both production importers at the version they require", () => {
  const pinned = manifest.dependencies["@clerk/shared"];
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const resolved = clerkRuntime(root);
  if (!resolved) throw new Error("Install dependencies before running this test");
  for (const row of resolved) {
    expect(satisfies(row.version, row.required), `${row.importer} requires ${row.required}, resolves ${row.version}`).toBe(true);
    expect(row.version, `${row.importer} resolves the pinned @clerk/shared`).toBe(pinned);
  }
  expect(resolved[0].sharedDir, "both importers resolve the same implementation").toBe(resolved[1].sharedDir);
});
