import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { isRendererModule } from "../../scripts/bench/start-route-js-manifest.mjs";

it("allows the server-rendered tour intro and keeps every renderer dependency in the budget check", () => {
  const intro = "/repo/src/components/tour/TourIntro.tsx?client";
  expect(isRendererModule(intro)).toBe(false);
  for (const renderer of [
    "/repo/src/components/tour/TourViewer.tsx",
    "/repo/src/components/tour/TourCanvas.tsx",
    "/repo/node_modules/three/build/three.module.js",
    "/repo/node_modules/@react-three/fiber/dist/react-three-fiber.js",
    "/repo/node_modules/@react-three/drei/core/Html.js",
  ]) {
    expect([intro, renderer].some(isRendererModule)).toBe(true);
  }
});

const script = fileURLToPath(new URL("../../scripts/bench/start-route-js-size.mjs", import.meta.url));
const routeIds = ["/{-$locale}/", "/{-$locale}/rooms/$id", "/admin/properties/$id", "/admin/checkout/"];
const roomId = "/{-$locale}/rooms/$id";
const canary = "[villas] runtime cache read failed";

interface ManifestRoute {
  filePath?: string;
  children?: string[];
  preloads?: string[];
  scripts?: { attrs: { type: string; src: string } }[];
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "start-route-budget-"));
  function write(file: string, contents: string | Buffer) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }

  const languageSample = "A locale sample long enough to detect a whole dictionary compiled into JavaScript";
  write("messages/en.json", JSON.stringify({ key: languageSample }));
  const asset = (name: string, contents: string | Buffer) => write(`.output/public/assets/${name}.js`, contents);
  const graph = (roomImports: string[] = [], includeRenderer = true) => {
    const files = Object.fromEntries(["entry", "room", "renderer", "shared", "checkout"].map(name => [
      `assets/${name}.js`, {
        imports: name === "entry" ? ["assets/shared.js"] : name === "room" ? roomImports : [],
        dynamicImports: name === "room" ? ["assets/renderer.js"] : [],
        renderer: includeRenderer && name === "renderer",
      },
    ]));
    write("output/start-route-js/client-entry.js.json", JSON.stringify(files));
  };
  const manifest = (ids: string[]) => {
    const routes: Record<string, ManifestRoute> = {
      __root__: {
        children: ids,
        preloads: ["/assets/entry.js"],
        scripts: [{ attrs: { type: "module", src: "/assets/entry.js" } }],
      },
    };
    for (const id of ids) {
      routes[id] = { filePath: "route.tsx" };
      if (id === roomId) routes[id].preloads = ["/assets/room.js", "/assets/shared.js"];
      if (id === "/admin/checkout/") routes[id].preloads = ["/assets/checkout.js"];
    }
    write(".output/server/_tanstack-start-manifest_v-fixture.mjs",
      `export const tsrStartManifest = () => (${JSON.stringify({ routes })});`);
  };

  asset("entry", "client entry");
  asset("shared", languageSample);
  asset("room", "room module");
  asset("renderer", "lazy three renderer");
  asset("checkout", "checkout module");
  graph();
  manifest(routeIds);
  write(".output/server/server.mjs", canary);
  return {
    root, write, asset, graph, manifest, languageSample,
    run: (...args: string[]) => spawnSync(process.execPath, [script, "--project-dir", root, ...args], { encoding: "utf8" }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

it("counts each preloaded or static chunk once and reports dictionaries and deferred imports", () => {
  const { root, languageSample, cleanup, run } = fixture();
  try {
    const report = join(root, "room-report.json");
    const result = run("--route", "room", "--json", report);
    expect(result.status, result.stderr).toBe(0);
    const buffers = ["client entry", languageSample, "room module"].map(text => Buffer.from(text));
    const raw = buffers.reduce((total, file) => total + file.length, 0);
    const gzip = buffers.reduce((total, file) => total + gzipSync(file, { level: 9 }).length, 0);
    const brotli = buffers.reduce((total, file) => total + brotliCompressSync(file).length, 0);
    expect(result.stdout).toContain(`${roomId}\t/[locale]/rooms/[id]\t/rooms/pool-villa\t3\t${raw}\t${gzip}\t${brotli}\ten`);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({
      results: [{ deferred: ["assets/renderer.js"], rendererChunks: [] }],
      errors: [],
    });
  } finally {
    cleanup();
  }
});

it("requires all budget entries by default and catches empty chunks, renderer leaks and both byte ceilings", () => {
  const { asset, cleanup, graph, manifest, run } = fixture();
  try {
    manifest([roomId]);
    expect(run().stderr).toContain("Missing Start route entry");
    manifest(routeIds);
    const staticCheck = run();
    expect(staticCheck.status, staticCheck.stderr).toBe(0);
    expect(staticCheck.stdout).toContain("/admin/properties/$id");
    expect(run("--browser-origin", "http://localhost").stderr).toContain("Pass --property-id");
    const full = run("--property-id", "seeded-id");
    expect(full.status, full.stderr).toBe(0);
    expect(full.stdout).toContain("/admin/properties/seeded-id");

    asset("room", "");
    expect(run("--route", "room").stderr).toContain("Empty Start client chunk");
    asset("room", "room module");

    graph(["assets/renderer.js"]);
    expect(run("--route", "room").stderr).toContain("ordinary room loads the heavy renderer");
    graph();

    asset("room", randomBytes(286 * 1024));
    expect(run("--route", "room").stderr).toContain("Brotli bytes");
    asset("checkout", randomBytes(546_430));
    const oversize = run("--route", "checkout");
    expect(oversize.status).toBe(1);
    expect(oversize.stderr).toContain("gzip bytes");
    expect(oversize.stderr).not.toContain("Brotli bytes");
  } finally {
    cleanup();
  }
});

it("requires the canary in server output and catches leaks even in unrelated client assets", () => {
  const { asset, cleanup, run, write } = fixture();
  try {
    expect(run("--route", "room", "--sentinel", "extra-test-marker").stderr).toContain("sentinel 2 is missing");
    write(".output/server/server.mjs", `${canary} extra-test-marker`);
    expect(run("--route", "room", "--sentinel", "extra-test-marker").status).toBe(0);
    asset("not-in-manifest", "extra-test-marker");
    const leaked = run("--route", "room", "--sentinel", "extra-test-marker");
    expect(leaked.stderr).toContain("sentinel 2 leaked");
    expect(leaked.stderr).not.toContain("extra-test-marker");
    write(".output/server/server.mjs", "no canary");
    expect(run("--route", "room").stderr).toContain("sentinel 1 is missing");
  } finally {
    cleanup();
  }
});

it("requires matching browser chunks and confines the renderer to the direct-tour load", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { compareBrowserChunks } from ${JSON.stringify(pathToFileURL(script).href)};
    const row = { key: "room", chunks: ["entry.js"] };
    const graph = {
      "entry.js": { imports: [], dynamicImports: ["renderer.js"] },
      "renderer.js": { imports: [], dynamicImports: [], renderer: true },
    };
    const compare = (files, tour) => compareBrowserChunks(row, files, graph, tour);
    console.log(JSON.stringify([
      compare(["entry.js"], false),
      compare(["entry.js", "renderer.js"], true),
      compare(["entry.js", "renderer.js"], false),
      compare(["entry.js"], true),
      compare(["unrelated.js"], false),
    ]));
  `], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    [],
    [],
    [expect.stringContaining("Ordinary room requested the heavy renderer")],
    [expect.stringContaining("Direct tour never loaded the heavy renderer")],
    [expect.stringContaining("Missing initial browser chunks"), expect.stringContaining("Unexpected initial browser chunks")],
  ]);
});

it("splits browser JavaScript into the static graph and dynamic loads, checking same-build bytes", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { summarizeBrowserObservation, checkBrowserBudget } from ${JSON.stringify(pathToFileURL(script).href)};
    const graph = {
      "entry.js": { imports: ["shared.js"], dynamicImports: ["lazy.js", "renderer.js"] },
      "shared.js": { imports: [], dynamicImports: [] },
      "lazy.js": { imports: [], dynamicImports: [] },
      "renderer.js": { imports: [], dynamicImports: [], renderer: true },
    };
    const raw = { "entry.js": 100, "shared.js": 50, "lazy.js": 30, "renderer.js": 900 };
    const measure = chunks => chunks.reduce((t, c) => ({ raw: t.raw + raw[c], gzip: t.gzip + raw[c] / 2, brotli: t.brotli + raw[c] / 4 }), { raw: 0, gzip: 0, brotli: 0 });
    const timing = (chunk, extra = {}) => ({ transferSize: raw[chunk] / 2 + 300, encodedBodySize: raw[chunk] / 2, decodedBodySize: raw[chunk], encoding: "gzip", ...extra });
    const observe = (chunks, extra = {}) => ({
      chunks, requests: Object.fromEntries(chunks.map(c => [c, 1])), failed: [], thirdPartyScripts: { "clerk.browser.js": 1 },
      resources: Object.fromEntries(chunks.map(c => [c, timing(c)])), ready: "fixture", readyMs: 5, ...extra,
    });
    const checkout = { key: "checkout", nextRoute: "/admin/checkout", chunks: ["entry.js", "shared.js"] };
    const home = { key: "home", nextRoute: "/[locale]/(home)", chunks: ["entry.js", "shared.js"] };
    const ok = summarizeBrowserObservation(home, observe(["entry.js", "lazy.js", "shared.js"]), graph, measure);
    const bad = summarizeBrowserObservation(home, observe(["entry.js", "shared.js", "lazy.js"], {
      requests: { "entry.js": 2, "shared.js": 1, "lazy.js": 1 },
      failed: ["lazy.js"],
      resources: {
        "entry.js": timing("entry.js", { decodedBodySize: 99 }),
        "shared.js": timing("shared.js", { encoding: "identity", encodedBodySize: 49, transferSize: 0, fromDiskCache: true }),
      },
    }), graph, measure);
    const three = summarizeBrowserObservation(checkout, observe(["entry.js", "shared.js", "renderer.js"]), graph, measure);
    console.log(JSON.stringify({ ok, bad, three, budget: checkBrowserBudget(home, ok) }));
  `], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const { ok, bad, three, budget } = JSON.parse(result.stdout);
  expect(ok).toMatchObject({
    static: { files: ["entry.js", "shared.js"], chunks: 2, raw: 150, decoded: 150, encoded: 75, transfer: 675, wire: 2, cache: 0, encodings: { gzip: 2 } },
    dynamic: { files: ["lazy.js"], chunks: 1, raw: 30, decoded: 30, wire: 1 },
    duplicates: [], failed: [], rendererChunks: [], thirdPartyScripts: { "clerk.browser.js": 1 }, errors: [],
  });
  expect(budget).toEqual([]);
  expect(bad.errors).toEqual([
    "Duplicate JavaScript requests: entry.js",
    "Failed JavaScript: lazy.js",
    "entry.js: browser decoded 99 bytes, local build has 100 (not the same build?)",
    "shared.js: identity response of 49 bytes, local build has 50",
    "No ResourceTiming entry for lazy.js",
  ]);
  expect(bad.static).toMatchObject({ wire: 1, cache: 1 });
  expect(three.errors).toEqual(["Checkout requested the heavy renderer: renderer.js"]);
  expect(three.dynamic.files).toEqual(["renderer.js"]);
});
