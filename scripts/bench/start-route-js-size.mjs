#!/usr/bin/env node
// Build Start first, then run this script with --route room for the room slice.
// Omit --route to enforce all four comparison budgets. Add --browser-origin (and --auth inside
// scripts/local-integration.mjs for the staff routes) to cross-check a real browser load.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { clientGraphPath } from "./start-route-js-manifest.mjs";

const project = fileURLToPath(new URL("../..", import.meta.url));
// A literal only the server-side villa runtime cache logs (src/lib/server/villa-runtime-cache.ts).
const canary = "[villas] runtime cache read failed";
const jsFile = /\.(?:m?js|cjs)$/;
const checkoutGzipBytes = 536_206 + 10_240;

const budgets = {
  home: { route: "/{-$locale}/", next: "/[locale]/(home)", path: "/", brotliKiB: 285 },
  room: { route: "/{-$locale}/rooms/$id", next: "/[locale]/rooms/[id]", path: "/rooms/pool-villa", brotliKiB: 285 },
  property: { route: "/admin/properties/$id", next: "/admin/properties/[id]", path: "/admin/properties/$id", brotliKiB: 430 },
  checkout: { route: "/admin/checkout/", next: "/admin/checkout", path: "/admin/checkout", brotliKiB: 534 },
};

function filesIn(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name));
}

function chunkName(asset) {
  if (typeof asset !== "string" || !/^\/?[\w.$@-]+(?:\/[\w.$@-]+)*$/.test(asset)
      || asset.split("/").includes("..") || !jsFile.test(asset)) {
    throw new Error(`Invalid Start JavaScript asset ${JSON.stringify(asset)}`);
  }
  return asset.replace(/^\//, "");
}

function chunkClosure(seeds, graph, includeDynamic = false) {
  const chunks = new Set();
  const pending = seeds.map(chunkName);
  while (pending.length) {
    const name = pending.pop();
    if (chunks.has(name)) continue;
    const chunk = graph[name];
    if (!chunk) throw new Error(`Missing client chunk in Vite graph: ${name}`);
    chunks.add(name);
    pending.push(...chunk.imports.map(chunkName));
    if (includeDynamic) pending.push(...chunk.dynamicImports.map(chunkName));
  }
  return [...chunks].sort();
}

function routeAssets(routes, id) {
  function find(current, ancestors) {
    const route = routes[current];
    if (!route) return; // Server-only routes can appear in children without a client manifest entry.
    if (ancestors.includes(current)) throw new Error(`Cyclic Start route manifest at ${current}`);
    const chain = [...ancestors, current];
    if (current === id) return chain;
    for (const child of route.children ?? []) {
      const found = find(child, chain);
      if (found) return found;
    }
  }

  const chain = find("__root__", []);
  if (!chain || !routes[id].filePath) throw new Error(`Missing Start route entry: ${id}`);
  return chain.flatMap(current => [
    ...(routes[current].preloads ?? []),
    ...(routes[current].scripts ?? []).flatMap(script => script.attrs?.src ? [script.attrs.src] : []),
  ]);
}

function localeMarkers(projectDir) {
  return Object.fromEntries(readdirSync(join(projectDir, "messages"))
    .filter(file => file.endsWith(".json"))
    .map(file => {
      const strings = [];
      JSON.parse(readFileSync(join(projectDir, "messages", file), "utf8"), (_key, value) => {
        if (typeof value === "string" && value.length >= 40) strings.push(value);
        return value;
      });
      strings.sort((left, right) => right.length - left.length);
      return [file.slice(0, -5), strings.slice(0, 3).map(value => value.slice(0, 40))];
    }));
}

export async function measureStartRoutes({
  projectDir = project, vercel = false, routeKeys = Object.keys(budgets), propertyId, sentinel,
} = {}) {
  const publicDir = join(projectDir, vercel ? ".vercel/output/static" : ".output/public");
  const serverDir = join(projectDir, vercel ? ".vercel/output/functions/__server.func" : ".output/server");
  const serverFiles = filesIn(serverDir).filter(file => jsFile.test(file));
  const manifestFiles = serverFiles.filter(file => /^_tanstack-start-manifest_v-.+\.mjs$/.test(basename(file)));
  if (manifestFiles.length !== 1) throw new Error(`Expected one TanStack Start manifest in ${serverDir}, found ${manifestFiles.length}`);
  const { tsrStartManifest } = await import(pathToFileURL(manifestFiles[0]).href);
  const { routes } = tsrStartManifest();
  const entryScripts = routes.__root__?.scripts?.filter(script => script.attrs?.type === "module" && script.attrs.src) ?? [];
  if (entryScripts.length !== 1) throw new Error("Expected one client entry script in the TanStack Start manifest");
  const entry = chunkName(entryScripts[0].attrs.src);
  const graphSource = readFileSync(clientGraphPath(projectDir, entry), "utf8");
  const graph = JSON.parse(graphSource);
  const build = {
    manifest: basename(manifestFiles[0]),
    entry,
    graphSha256: createHash("sha256").update(graphSource).digest("hex").slice(0, 16),
  };
  const markers = localeMarkers(projectDir);

  const sentinels = sentinel === undefined ? [canary] : [canary, sentinel];
  for (const [index, marker] of sentinels.entries()) {
    if (!marker) throw new Error("The additional sentinel must be a nonempty literal");
    if (!serverFiles.some(file => readFileSync(file, "utf8").includes(marker))) {
      throw new Error(`Server-only sentinel ${index + 1} is missing from built server JavaScript`);
    }
  }
  for (const file of filesIn(publicDir).filter(file => jsFile.test(file))) {
    const source = readFileSync(file, "utf8");
    const leaked = sentinels.findIndex(marker => source.includes(marker));
    if (leaked !== -1) throw new Error(`Server-only sentinel ${leaked + 1} leaked into ${file}`);
  }

  const sizes = new Map();
  function measure(chunks) {
    const row = { raw: 0, gzip: 0, brotli: 0 };
    const localeScripts = new Set();
    for (const chunk of chunks) {
      if (!sizes.has(chunk)) {
        const source = readFileSync(join(publicDir, chunk));
        const text = source.toString("utf8");
        if (source.length === 0) throw new Error(`Empty Start client chunk: ${chunk}`);
        sizes.set(chunk, {
          raw: source.length,
          gzip: gzipSync(source, { level: 9 }).length,
          brotli: brotliCompressSync(source).length,
          locales: Object.entries(markers)
            .filter(([, prefixes]) => prefixes.some(prefix => text.includes(prefix) || text.includes(JSON.stringify(prefix).slice(1, -1))))
            .map(([locale]) => locale),
        });
      }
      const size = sizes.get(chunk);
      row.raw += size.raw;
      row.gzip += size.gzip;
      row.brotli += size.brotli;
      for (const locale of size.locales) localeScripts.add(locale);
    }
    return { ...row, localeScripts: [...localeScripts].sort() };
  }

  const results = routeKeys.map(key => {
    const budget = budgets[key];
    if (!budget) throw new Error(`Unknown Start comparison route: ${key}`);
    const chunks = chunkClosure(routeAssets(routes, budget.route), graph);
    if (!chunks.includes(entry)) throw new Error(`Missing initial client entry for ${budget.route}`);
    const initial = new Set(chunks);
    const deferred = [...new Set(chunks.flatMap(name => graph[name].dynamicImports.map(chunkName)))]
      .filter(name => !initial.has(name)).sort();
    return {
      key,
      route: budget.route,
      nextRoute: budget.next,
      path: key === "property" && propertyId ? budget.path.replace("$id", encodeURIComponent(propertyId)) : budget.path,
      chunks,
      deferred,
      rendererChunks: chunks.filter(name => graph[name].renderer),
      ...measure(chunks),
    };
  });

  // Verify every graph chunk exists in the chosen artifact before accepting browser observations.
  for (const name of Object.keys(graph).map(chunkName)) {
    if (!existsSync(join(publicDir, name))) throw new Error(`Missing built Start client chunk: ${name}`);
  }
  return { results, graph, measure, build };
}

export function checkStartBudgets(results) {
  const errors = [];
  for (const row of results) {
    const limit = budgets[row.key].brotliKiB * 1024;
    if (row.brotli <= 0 || row.brotli > limit) {
      errors.push(`${row.nextRoute}: ${row.brotli} Brotli bytes, expected 1–${limit}`);
    }
    if (row.key === "checkout" && (row.gzip <= 0 || row.gzip > checkoutGzipBytes)) {
      errors.push(`${row.nextRoute}: ${row.gzip} gzip bytes, expected 1–${checkoutGzipBytes}`);
    }
    if (row.key === "room" && row.rendererChunks.length) {
      errors.push(`${row.path}: ordinary room loads the heavy renderer in ${row.rendererChunks.join(", ")}`);
    }
  }
  return errors;
}

export function compareBrowserChunks(row, observed, graph, directTour) {
  const errors = [];
  const files = new Set(observed);
  const reachable = new Set(chunkClosure(row.chunks, graph, true));
  const missing = row.chunks.filter(chunk => !files.has(chunk));
  const unexpected = observed.filter(chunk => !reachable.has(chunk));
  if (missing.length) errors.push(`Missing initial browser chunks: ${missing.join(", ")}`);
  if (unexpected.length) errors.push(`Unexpected initial browser chunks: ${unexpected.join(", ")}`);
  const rendererChunks = observed.filter(chunk => graph[chunk]?.renderer);
  if (row.key === "room") {
    if (!directTour && rendererChunks.length) errors.push(`Ordinary room requested the heavy renderer: ${rendererChunks.join(", ")}`);
    if (directTour && !rendererChunks.length) errors.push("Direct tour never loaded the heavy renderer");
  }
  if (row.key === "checkout" && rendererChunks.length) errors.push(`Checkout requested the heavy renderer: ${rendererChunks.join(", ")}`);
  return errors;
}

/**
 * Splits a browser observation into the static initial graph (the route's manifest closure) and
 * JavaScript loaded dynamically after it, so nothing is counted twice, and checks each observed
 * chunk's ResourceTiming bytes against the same build's local file: decoded bytes must equal the
 * emitted file, and identity-encoded bytes must equal it on the wire too.
 * @param {{ key: string, nextRoute: string, chunks: string[] }} row
 * @param {{ chunks: string[], requests: Record<string, number>, failed: string[],
 *   resources: Record<string, { transferSize: number, encodedBodySize: number, decodedBodySize: number,
 *   encoding: string, fromDiskCache?: boolean, fromPrefetchCache?: boolean, fromServiceWorker?: boolean }>,
 *   thirdPartyScripts: Record<string, number>, ready: string, readyMs: number }} observation
 * @param {Record<string, { imports: string[], dynamicImports: string[], renderer?: boolean }>} graph
 * @param {(chunks: string[]) => { raw: number, gzip: number, brotli: number }} measure
 */
export function summarizeBrowserObservation(row, observation, graph, measure, directTour = false) {
  const errors = compareBrowserChunks(row, observation.chunks, graph, directTour);
  const initial = new Set(row.chunks);
  const known = observation.chunks.filter(chunk => Object.hasOwn(graph, chunk));
  const reachable = new Set(chunkClosure(row.chunks, graph, true));
  const sets = {
    static: known.filter(chunk => initial.has(chunk)),
    dynamic: known.filter(chunk => !initial.has(chunk) && reachable.has(chunk)),
  };
  const duplicates = Object.entries(observation.requests).filter(([, count]) => count > 1).map(([chunk]) => chunk);
  if (duplicates.length) errors.push(`Duplicate JavaScript requests: ${duplicates.join(", ")}`);
  if (observation.failed.length) errors.push(`Failed JavaScript: ${observation.failed.join(", ")}`);
  function totals(chunks) {
    const local = measure(chunks);
    const row = { chunks: chunks.length, raw: local.raw, gzip: local.gzip, brotli: local.brotli, decoded: 0, encoded: 0, transfer: 0, wire: 0, cache: 0, encodings: {} };
    for (const chunk of chunks) {
      const timing = observation.resources[chunk];
      if (!timing) {
        errors.push(`No ResourceTiming entry for ${chunk}`);
        continue;
      }
      const file = measure([chunk]);
      if (timing.decodedBodySize !== file.raw) errors.push(`${chunk}: browser decoded ${timing.decodedBodySize} bytes, local build has ${file.raw} (not the same build?)`);
      if (timing.encoding === "identity" && timing.encodedBodySize !== file.raw) errors.push(`${chunk}: identity response of ${timing.encodedBodySize} bytes, local build has ${file.raw}`);
      row.decoded += timing.decodedBodySize;
      row.encoded += timing.encodedBodySize;
      row.transfer += timing.transferSize;
      // Fresh contexts should fetch everything over the wire; any cache answer is reported.
      if (timing.transferSize > 0 && !timing.fromDiskCache && !timing.fromPrefetchCache && !timing.fromServiceWorker) row.wire++;
      else row.cache++;
      row.encodings[timing.encoding] = (row.encodings[timing.encoding] ?? 0) + 1;
    }
    return row;
  }
  return {
    ready: observation.ready,
    readyMs: observation.readyMs,
    static: { ...totals(sets.static), files: sets.static },
    dynamic: { ...totals(sets.dynamic), files: sets.dynamic },
    duplicates,
    failed: observation.failed,
    rendererChunks: known.filter(chunk => graph[chunk]?.renderer),
    thirdPartyScripts: observation.thirdPartyScripts,
    errors,
  };
}

/** The standard ceilings applied to the browser's observed static graph (same rule as the manifest). */
export function checkBrowserBudget(row, summary, directTour = false) {
  return checkStartBudgets([{ ...row, brotli: summary.static.brotli, gzip: summary.static.gzip, rendererChunks: directTour ? [] : summary.rendererChunks.filter(chunk => summary.static.files.includes(chunk)) }]);
}

const SEEDED_PROPERTY = "Tideglass Pool Residence";

async function main() {
  const { values } = parseArgs({ options: {
    "project-dir": { type: "string" },
    route: { type: "string", multiple: true },
    vercel: { type: "boolean" },
    json: { type: "string" },
    sentinel: { type: "string" },
    "property-id": { type: "string" },
    "browser-origin": { type: "string" },
    auth: { type: "boolean" },
  } });
  const routeKeys = values.route ?? Object.keys(budgets);
  const staffRoutes = routeKeys.some(key => key === "property" || key === "checkout");
  if (values["browser-origin"] && routeKeys.includes("property") && !values["property-id"] && !values.auth) {
    throw new Error("Pass --property-id with the seeded property ID, or --auth inside the local integration harness, for browser observation");
  }
  let session;
  let browser;
  const errors = [];
  const observations = [];
  try {
    if (values["browser-origin"]) {
      const { launchBrowser, signInOnce } = await import("./start-route-js-browser.mjs");
      browser = await launchBrowser();
      if (values.auth && staffRoutes) {
        session = await signInOnce(browser, { origin: values["browser-origin"], email: process.env.E2E_OWNER_EMAIL ?? "", propertyName: SEEDED_PROPERTY });
      }
    }
    const propertyId = values["property-id"] ?? session?.propertyId;
    const { results, graph, measure, build } = await measureStartRoutes({
      projectDir: values["project-dir"] && resolve(values["project-dir"]),
      routeKeys,
      propertyId,
      vercel: values.vercel,
      sentinel: values.sentinel,
    });
    errors.push(...checkStartBudgets(results));
    const sanitize = path => propertyId ? path.replace(encodeURIComponent(propertyId), "$id") : path;
    if (browser) {
      const { observeStartRoute } = await import("./start-route-js-browser.mjs");
      for (const row of results) {
        if ((row.key === "property" || row.key === "checkout") && !session) {
          throw new Error(`Pass --auth inside the local integration harness to observe ${row.nextRoute}`);
        }
        for (const directTour of row.key === "room" ? [false, true] : [false]) {
          const pathname = directTour ? row.path + "?tour=1" : row.path;
          const observation = await observeStartRoute(browser, {
            origin: values["browser-origin"], pathname, key: row.key, directTour, graph,
            storageState: row.key === "property" || row.key === "checkout" ? session.storageState : undefined,
          });
          const summary = summarizeBrowserObservation(row, observation, graph, measure, directTour);
          const label = sanitize(pathname);
          errors.push(...[...summary.errors, ...checkBrowserBudget(row, summary, directTour)].map(error => `${label}: ${error}`));
          observations.push({ key: row.key, path: label, directTour, ...summary, errors: undefined });
        }
      }
    }
    console.log("Start route\tNext budget key\tURL\tchunks\traw bytes\tgzip bytes\tBrotli bytes\tlocale dictionaries");
    for (const row of results) {
      console.log([row.route, row.nextRoute, row.path, row.chunks.length, row.raw, row.gzip, row.brotli, row.localeScripts.join(",") || "-"].join("\t"));
    }
    if (observations.length) {
      console.log("\nbrowser\tset\tchunks\tlocal raw\tlocal gzip\tlocal Brotli\tdecoded\tencoded\ttransfer\twire/cache\tencodings\tready");
      for (const row of observations) {
        for (const set of ["static", "dynamic"]) {
          const t = row[set];
          console.log([row.path, set, t.chunks, t.raw, t.gzip, t.brotli, t.decoded, t.encoded, t.transfer, `${t.wire}/${t.cache}`,
            Object.entries(t.encodings).map(([k, v]) => `${k}:${v}`).join(",") || "-", set === "static" ? `${row.ready} ${row.readyMs}ms` : ""].join("\t"));
        }
      }
    }
    if (values.json) {
      const sanitized = results.map(row => ({ ...row, path: sanitize(row.path) }));
      writeFileSync(values.json, JSON.stringify({ build, results: sanitized, browser: observations, errors }, null, 2) + "\n");
    }
  } finally {
    await browser?.close();
  }
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
