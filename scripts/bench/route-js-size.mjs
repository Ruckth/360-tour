#!/usr/bin/env node
// Reports the initial client JavaScript each App Router page loads, from a completed `next build`.
// Usage: node scripts/bench/route-js-size.mjs [projectDir] [--json out.json] [--routes /a,/b]
// Reads only build output: .next/build-manifest.json and each page_client-reference-manifest.js.
// Initial JS = rootMainFiles + the page's entryJSFiles (layouts + page). Lazy chunks
// (next/dynamic, import()) are excluded, which is the point: they load on demand.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const jsonOut = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
const routesIndex = args.indexOf("--routes");
const routeFilter = routesIndex >= 0 ? new Set(args[routesIndex + 1].split(",")) : undefined;
const projectDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--json" && args[index - 1] !== "--routes") ?? ".");
const nextDir = path.join(projectDir, ".next");

const buildManifest = JSON.parse(fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
const rootMainFiles = buildManifest.rootMainFiles ?? [];

/**
 * A locale dictionary counts as bundled when a chunk contains one of that locale's three longest
 * message strings (first 40 chars). Language-switcher labels alone never match these markers.
 */
const messagesDir = path.join(projectDir, "messages");
const LOCALE_MARKERS = Object.fromEntries(
  fs.readdirSync(messagesDir).filter((file) => file.endsWith(".json")).map((file) => {
    const strings = [];
    (function collect(value) {
      if (typeof value === "string") strings.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    })(JSON.parse(fs.readFileSync(path.join(messagesDir, file), "utf8")));
    strings.sort((left, right) => right.length - left.length);
    return [file.replace(/\.json$/, ""), strings.slice(0, 3).map((value) => value.slice(0, 40))];
  }),
);
const LOCALE_SCRIPTS = Object.fromEntries(
  Object.entries(LOCALE_MARKERS).map(([locale, markers]) => [
    locale,
    { test: (text) => markers.some((marker) => text.includes(marker) || text.includes(JSON.stringify(marker).slice(1, -1))) },
  ]),
);

const fileCache = new Map();
function chunkInfo(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  const full = path.join(nextDir, file);
  const source = fs.readFileSync(full);
  const text = source.toString("utf8");
  const info = {
    raw: source.length,
    gzip: zlib.gzipSync(source, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(source).length,
    scripts: Object.entries(LOCALE_SCRIPTS).filter(([, re]) => re.test(text)).map(([name]) => name),
  };
  fileCache.set(file, info);
  return info;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page_client-reference-manifest.js") out.push(full);
  }
  return out;
}

const results = [];
for (const manifestFile of walk(path.join(nextDir, "server", "app"))) {
  const sandbox = { self: {} };
  sandbox.globalThis = sandbox.self;
  vm.runInNewContext(fs.readFileSync(manifestFile, "utf8"), sandbox);
  const manifests = sandbox.self.__RSC_MANIFEST ?? {};
  for (const [route, manifest] of Object.entries(manifests)) {
    const routeName = route.replace(/\/page$/, "") || "/";
    if (routeFilter && !routeFilter.has(routeName)) continue;
    const files = new Set(rootMainFiles);
    for (const entryFiles of Object.values(manifest.entryJSFiles ?? {})) for (const file of entryFiles) files.add(file);
    let raw = 0, gzip = 0, brotli = 0;
    const scripts = new Set();
    for (const file of files) {
      const info = chunkInfo(file);
      raw += info.raw; gzip += info.gzip; brotli += info.brotli;
      for (const script of info.scripts) scripts.add(script);
    }
    results.push({ route: routeName, chunks: files.size, raw, gzip, brotli, localeScripts: [...scripts].sort() });
  }
}

results.sort((left, right) => left.route.localeCompare(right.route));
const kib = (bytes) => (bytes / 1024).toFixed(1);
console.log("route\tchunks\traw KiB\tgzip KiB\tbrotli KiB\tlocale dictionaries in initial JS");
for (const row of results) {
  console.log(`${row.route}\t${row.chunks}\t${kib(row.raw)}\t${kib(row.gzip)}\t${kib(row.brotli)}\t${row.localeScripts.join(",") || "-"}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify({ projectDir, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
