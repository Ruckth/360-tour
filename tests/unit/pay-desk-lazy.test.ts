import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/*
 * Dormant payments cost cashiers no initial JavaScript: with paymentsMode "direct" the checkout
 * loads none of the attempt flow. Everything below is reachable only through import() (in attempts
 * mode, or when a recovery, pause or reload screen shows). Walks the static, non-type imports.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ATTEMPT_ONLY = ["PayDeskPanel", "PayRecovery", "PayDeskNotices", "pay-desk-attempts", "pay-desk-rules", "pay-desk-copy", "pay-desk-tab", "pay-desk-problem"];

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) try { readFileSync(candidate); return candidate; } catch { /* a directory */ }
  }
  return null;
}

function staticGraph(entries: string[]) {
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(root, entry));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // Static imports and re-exports, skipping `import type` / `export type` (erased at build).
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      const next = resolveImport(file, match[1]);
      if (next && next.startsWith(join(root, "src"))) queue.push(next);
    }
  }
  return [...seen].map((file) => file.slice(root.length + 1));
}

it("keeps the pay panel and attempt flow out of the checkout's initial JavaScript", () => {
  const graph = staticGraph(["src/app/admin/checkout/page.tsx", "src/components/checkout/convex-backend.ts"]);
  expect(graph).toContain("src/components/checkout/OrderPanel.tsx");
  expect(graph).not.toContain("src/components/checkout/PayPanel.tsx");
  expect(graph).toContain("src/components/checkout/pay-desk-backend.ts");
  const leaked = graph.filter((file) => ATTEMPT_ONLY.some((name) => file.endsWith(`/checkout/${name}.ts`) || file.endsWith(`/checkout/${name}.tsx`)));
  expect(leaked).toEqual([]);
});
