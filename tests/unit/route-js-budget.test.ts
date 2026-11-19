import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/bench/route-js-size.mjs", import.meta.url));
const guestRoutes = ["/[locale]/(home)", "/[locale]/rooms/[id]"];
const editor = "/admin/properties/[id]";
const checkout = "/admin/checkout";

it("checks the complete built routes and fails when an entry disappears or exceeds the byte budget", () => {
  const root = mkdtempSync(join(tmpdir(), "route-budget-"));
  const build = join(root, ".next");
  const check = () => spawnSync(process.execPath, [script, root, "--check-budgets"], { encoding: "utf8" });
  const manifest = (route: string, chunks: string[]) => {
    const file = join(build, "server/app", route, "page_client-reference-manifest.js");
    mkdirSync(dirname(file), { recursive: true });
    const entryJSFiles = { [`[project]/src/app${route}/page`]: chunks };
    writeFileSync(file, `self.__RSC_MANIFEST = ${JSON.stringify({ [`${route}/page`]: { entryJSFiles } })};`);
  };
  try {
    mkdirSync(join(root, "messages"));
    mkdirSync(build);
    writeFileSync(join(build, "build-manifest.json"), JSON.stringify({ rootMainFiles: ["shell.js"] }));
    writeFileSync(join(build, "shell.js"), "shared shell");
    for (const route of [...guestRoutes, checkout]) manifest(route, ["shell.js"]);
    expect(check().status).toBe(1);
    manifest(editor, []);
    expect(check().status).toBe(1);
    writeFileSync(join(build, "editor.js"), "small editor");
    manifest(editor, ["editor.js"]);
    expect(check().status).toBe(0);
    writeFileSync(join(build, "editor.js"), randomBytes(550 * 1024));
    expect(check().status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
