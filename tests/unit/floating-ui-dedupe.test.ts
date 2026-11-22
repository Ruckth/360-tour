import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SHARED_RUNTIMES, resolvePackageDir, sharedRuntime } from "../../scripts/shared-runtimes.mjs";

// Both Radix Popper versions (the top-level one and the copy nested under @radix-ui/react-tooltip)
// must share one @floating-ui/react-dom and its dom/core/utils tree. Bun had nested an identical
// copy under each, so admin and checkout pages bundled Floating UI twice. The exact
// @floating-ui/react-dom pin in package.json keeps it shared. Worktree setup recovers inherited
// installs that still hold the nested copies (scripts/shared-runtimes.mjs).
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rule = SHARED_RUNTIMES.find((runtime) => runtime.shared === "@floating-ui/react-dom")!;

it("resolves one Floating UI implementation for both Radix Popper versions at the pinned version", () => {
  const pinned = manifest.dependencies["@floating-ui/react-dom"];
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  const rows = sharedRuntime(root, rule);
  if (!rows) throw new Error("Install dependencies before running this test");
  expect(new Set(rows.map((row) => row.importer)).size).toBe(2);
  for (const row of rows) expect(row.version, `${row.importer} resolves the pinned @floating-ui/react-dom`).toBe(pinned);
  expect(rows[0].sharedDir, "both poppers resolve the same implementation").toBe(rows[1].sharedDir);
  // The dom layer follows from the shared react-dom.
  const dom = rows.map((row) => resolvePackageDir(row.sharedDir, "@floating-ui/dom"));
  expect(dom[0]).toBeDefined();
  expect(dom[0]).toBe(dom[1]);
});
