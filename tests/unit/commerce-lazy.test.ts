import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/*
 * Dormant commerce screens cost cashiers no initial JavaScript: the commerce view mappers, the
 * History sheet's field changes and the approval item's request mapper load only with the screens
 * that read them (import()).
 * Walks the static, non-type imports from the checkout entry.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LAZY_ONLY = ["commerce-readers.ts", "EditHistory.tsx", "history-changes.ts", "TargetApproval.tsx", "approval-readers.ts"];

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function staticGraph(entries: string[]) {
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(root, entry));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // Static imports and re-exports, skipping `import type` / `export type` (erased at build).
    for (const match of readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      const next = resolveImport(file, match[1]);
      if (next && next.startsWith(join(root, "src"))) queue.push(next);
    }
  }
  return [...seen].map((file) => file.slice(root.length + 1));
}

it("keeps commerce mappers, History field changes and approval details out of the checkout's initial JavaScript", () => {
  const graph = staticGraph(["src/components/checkout/AdminCheckoutPage.tsx", "src/components/checkout/convex-backend.ts"]);
  expect(graph).toContain("src/components/checkout/backend.tsx");
  expect(graph.filter((file) => LAZY_ONLY.some((name) => file.endsWith(`/checkout/${name}`)))).toEqual([]);
});
