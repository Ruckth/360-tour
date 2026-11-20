import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await test("checkout rejects a gzip delta over 10 KiB even when Brotli passes", (t) => {
  const script = fileURLToPath(new URL("./route-js-size.mjs", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "checkout-gzip-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const next = join(root, ".next");
  mkdirSync(join(root, "messages"));
  writeFileSync(join(root, "messages", "en.json"), "{}");
  const routes = ["/[locale]/(home)", "/[locale]/rooms/[id]", "/admin/properties/[id]", "/admin/checkout"];
  for (const route of routes) {
    const dir = join(next, "server", "app", route);
    mkdirSync(dir, { recursive: true });
    const entryJSFiles = { [`[project]/src/app${route}/page`]: [route === "/admin/checkout" ? "checkout.js" : "shell.js"] };
    writeFileSync(join(dir, "page_client-reference-manifest.js"), `self.__RSC_MANIFEST = ${JSON.stringify({
      [`${route}/page`]: { entryJSFiles },
    })};`);
  }
  writeFileSync(join(next, "build-manifest.json"), JSON.stringify({ rootMainFiles: ["shell.js"] }));
  writeFileSync(join(next, "shell.js"), "shared shell");
  const chunk = randomBytes(128 * 1024);
  const report = join(root, "report.json");
  const run = () => spawnSync(process.execPath, [script, root, "--check-budgets", "--json", report], { encoding: "utf8" });
  writeFileSync(join(next, "checkout.js"), Buffer.concat(Array(4).fill(chunk)));
  assert.equal(run().status, 0);
  // Brotli can reuse this block, which is wider than gzip's sliding window.
  writeFileSync(join(next, "checkout.js"), Buffer.concat(Array(5).fill(chunk)));
  const result = run();
  const checkout = JSON.parse(readFileSync(report, "utf8")).results.find(row => row.route === "/admin/checkout");
  assert.ok(checkout.brotli < 534 * 1024);
  assert.ok(checkout.gzip > 536_206 + 10 * 1024);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /maximum delta 10240 bytes/);
});
