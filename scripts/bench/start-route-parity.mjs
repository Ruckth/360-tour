#!/usr/bin/env node
/**
 * Reusable Phase 2 route parity runner for immutable Next.js and TanStack Start
 * Preview deployments (and isolated local servers).
 *
 * Read-only by default (GET/HEAD only; redirects never followed; raw responses stay in memory).
 * Optional Clerk Playwright authenticated fixture runs only when `--auth-fixture` is supplied
 * against valid Clerk test-tenant run-owned sessions.
 *
 * Exit codes:
 *   0 — All evaluated routes/checks passed (pending candidate allowed unless --strict).
 *   1 — One or more contract/parity/auth checks failed (or unavailable under --strict).
 *   2 — Invalid CLI arguments, manifest coverage mismatch, or sensitive data leak detected.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertManifestCoversAppTree,
  buildManifest,
  loadLocalizedStrings,
  LOCALES,
} from "./start-route-parity.manifest.mjs";
import {
  assertNoSensitiveLeaks,
  inspectHtmlDocument,
  parseHttpRawResponse,
  parseRobotsTxt,
  parseSitemapXml,
  sanitizeHeaders,
  sanitizePath,
} from "./start-route-parity.sanitize.mjs";
import { runAuthenticatedFixture } from "./start-route-parity.auth.mjs";
import {
  buildParityReport,
  normalizeCaptureInput,
  renderMarkdownReport,
} from "./start-route-parity.report.mjs";

const CURL_MARKER = "\n__ROUTE_PARITY_STATS__";

/**
 * Resolve repository root from this script path.
 * @returns {string}
 */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Sanitize transport error messages so hostnames or credentials never leak into output.
 * @param {unknown} error
 * @returns {string}
 */
function safeTransportError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[clerk-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Turn a raw HTTP response (status, headers, body buffer, ttfbMs) into a sanitized RouteObservation.
 * @param {import("./start-route-parity.manifest.mjs").RouteSpec} spec
 * @param {{ status: number, rawHeaders: [string, string][] | Headers, body: Buffer, ttfbMs: number }} raw
 * @param {{ loadingStrings: readonly string[] }} context
 * @returns {import("./start-route-parity.report.mjs").RouteObservation}
 */
export function buildObservationFromHttp(spec, raw, context) {
  const headers = sanitizeHeaders(raw.rawHeaders, LOCALES);
  const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : "";
  const bodyText = spec.method === "GET" ? raw.body.toString("utf8") : "";

  /** @type {import("./start-route-parity.sanitize.mjs").HtmlInspection | null} */
  let html = null;
  /** @type {[string, string][] | null} */
  let robotsDirectives = null;
  /** @type {import("./start-route-parity.report.mjs").RouteObservation["sitemap"]} */
  let sitemap = null;
  /** @type {string | null} */
  let parseError = null;

  if (spec.method === "GET" && contentType.toLowerCase().includes("text/html")) {
    const htmlContract = spec.contract.expectedHtml;
    html = inspectHtmlDocument(bodyText, {
      status: raw.status,
      locales: LOCALES,
      loadingStrings: context.loadingStrings,
      expectedMarkers: htmlContract?.expectedMarkers,
      errorMarkers: htmlContract?.errorMarkers,
      forbiddenMarkers: htmlContract?.forbiddenMarkers,
      captureHeadings: true,
      captureLoadingMarkup: Boolean(htmlContract?.trackRoomVisibility),
      isAdminPath: spec.path.startsWith("/admin"),
    });
  } else if (spec.id === "special:robots" && raw.status === 200) {
    robotsDirectives = parseRobotsTxt(bodyText);
  } else if (spec.id === "special:sitemap" && raw.status === 200) {
    try {
      sitemap = parseSitemapXml(bodyText, LOCALES);
    } catch (error) {
      parseError = safeTransportError(error);
    }
  }

  return {
    id: spec.id,
    kind: spec.kind,
    method: spec.method,
    path: sanitizePath(spec.path, { preserveSafeQuery: true }) ?? spec.path,
    source: spec.source,
    ...(spec.acceptLanguage ? { acceptLanguage: spec.acceptLanguage } : {}),
    status: raw.status,
    ttfbMs: Math.round(raw.ttfbMs * 10) / 10,
    headers,
    html,
    robotsDirectives,
    sitemap,
    transportError: parseError,
    sourceOrigin: "live-probe",
  };
}

/**
 * Fetch a single route via `vercel curl` against an immutable Vercel Preview deployment.
 * @param {import("./start-route-parity.manifest.mjs").RouteSpec} spec
 * @param {{ deployment: string, scope?: string, vercelBin: string, timeoutMs?: number }} target
 * @returns {{ status: number, rawHeaders: [string, string][], body: Buffer, ttfbMs: number }}
 */
function fetchViaVercelCurl(spec, target) {
  const curlArgs = [
    "--silent",
    "--show-error",
    "--max-time",
    "35",
    "--connect-timeout",
    "10",
    "--include",
    "--write-out",
    `${CURL_MARKER}%{http_code} %{time_starttransfer}`,
  ];
  if (spec.method === "HEAD") curlArgs.push("--head");
  if (spec.acceptLanguage) curlArgs.push("--header", `Accept-Language: ${spec.acceptLanguage}`);

  const vercelArgs = ["curl", spec.path, "--deployment", target.deployment];
  if (target.scope) vercelArgs.push("--scope", target.scope);
  vercelArgs.push("--", ...curlArgs);

  const cleanCwd = mkdtempSync(path.join(tmpdir(), "route-parity-"));
  try {
    const result = spawnSync(target.vercelBin, vercelArgs, {
      cwd: cleanCwd,
      timeout: target.timeoutMs ?? 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
      throw result.error;
    }
    const stdout = result.stdout ?? Buffer.alloc(0);
    const markerBuf = Buffer.from(CURL_MARKER, "utf8");
    const markerIdx = stdout.lastIndexOf(markerBuf);
    if (result.status !== 0 || markerIdx < 0) {
      throw new Error(`vercel curl failed (exit ${result.status ?? "signal"})`);
    }
    const rawHttp = stdout.subarray(0, markerIdx);
    const statsText = stdout.subarray(markerIdx + markerBuf.length).toString("utf8").trim();
    const statsMatch = /^(\d{3})\s+([0-9.]+)$/.exec(statsText);
    if (!statsMatch) {
      throw new Error("Malformed curl timing stats");
    }
    const parsed = parseHttpRawResponse(rawHttp);
    const status = Number.parseInt(statsMatch[1], 10);
    const ttfbMs = Number.parseFloat(statsMatch[2]) * 1000;
    return { status, rawHeaders: parsed.headers, body: parsed.body, ttfbMs };
  } finally {
    rmSync(cleanCwd, { recursive: true, force: true });
  }
}

/**
 * Fetch a single route via Node built-in `fetch` against a direct base URL (local or Preview).
 * Never follows redirects. Uses curl-like default Accept (`*\/*`) to avoid Clerk browser-handshake 307s.
 * @param {import("./start-route-parity.manifest.mjs").RouteSpec} spec
 * @param {{ baseUrl: string, bypassToken?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} target
 * @returns {Promise<{ status: number, rawHeaders: Headers, body: Buffer, ttfbMs: number }>}
 */
async function fetchViaHttp(spec, target) {
  const fetchImpl = target.fetchImpl ?? globalThis.fetch;
  const url = new URL(spec.path, target.baseUrl).toString();
  /** @type {Record<string, string>} */
  const headers = { accept: "*/*" };
  if (spec.acceptLanguage) headers["accept-language"] = spec.acceptLanguage;
  if (target.bypassToken) headers["x-vercel-protection-bypass"] = target.bypassToken;

  const started = performance.now();
  const response = await fetchImpl(url, {
    method: spec.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(target.timeoutMs ?? 35_000),
  });
  const ttfbMs = performance.now() - started;
  const arrayBuf = spec.method === "GET" ? await response.arrayBuffer() : new ArrayBuffer(0);
  return {
    status: response.status,
    rawHeaders: response.headers,
    body: Buffer.from(arrayBuf),
    ttfbMs,
  };
}

/**
 * Collect sanitized observations for every route in `manifest` sequentially.
 * Never catches exceptions as pass — transport failures are recorded explicitly as `transportError`.
 * @param {{
 *   manifest: readonly import("./start-route-parity.manifest.mjs").RouteSpec[],
 *   targetKind: "next" | "start",
 *   rootDir: string,
 *   baseUrl?: string,
 *   bypassToken?: string,
 *   deployment?: string,
 *   vercelScope?: string,
 *   vercelBin?: string,
 *   sourceCommit?: string | null,
 *   sourceTree?: string | null,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<import("./start-route-parity.report.mjs").TargetCapture>}
 */
export async function collectTarget(options) {
  const { loadingStrings } = loadLocalizedStrings(options.rootDir);
  /** @type {Record<string, import("./start-route-parity.report.mjs").RouteObservation>} */
  const observations = {};

  for (const spec of options.manifest) {
    try {
      const raw = options.deployment
        ? fetchViaVercelCurl(spec, {
            deployment: options.deployment,
            scope: options.vercelScope,
            vercelBin: options.vercelBin ?? "vercel",
          })
        : await fetchViaHttp(spec, {
            baseUrl: /** @type {string} */ (options.baseUrl),
            bypassToken: options.bypassToken,
            fetchImpl: options.fetchImpl,
          });
      observations[spec.id] = buildObservationFromHttp(spec, raw, { loadingStrings });
    } catch (error) {
      observations[spec.id] = {
        id: spec.id,
        kind: spec.kind,
        method: spec.method,
        path: sanitizePath(spec.path, { preserveSafeQuery: true }) ?? spec.path,
        source: spec.source,
        ...(spec.acceptLanguage ? { acceptLanguage: spec.acceptLanguage } : {}),
        status: null,
        ttfbMs: null,
        headers: {},
        html: null,
        robotsDirectives: null,
        sitemap: null,
        transportError: safeTransportError(error),
        sourceOrigin: "live-probe",
      };
    }
  }

  return {
    targetKind: options.targetKind,
    deployment: options.deployment ?? null,
    sourceCommit: options.sourceCommit ?? null,
    sourceTree: options.sourceTree ?? null,
    collectedAt: new Date().toISOString(),
    collectionMethod: options.deployment ? "vercel-curl (read-only)" : "http-fetch (read-only)",
    caveats: [
      "Anonymous read-only GET/HEAD requests with default Accept (*/*).",
      "Redirects are never followed. Location and Link targets retain sanitized public paths only.",
      "Single descriptive wire TTFB per request; cache state is uncontrolled (see separate room perf report).",
      "JS-disabled HTML visibility is inferred from SSR markup before scripts or external CSS execute.",
    ],
    observations,
  };
}

/**
 * Merge a base verified reference capture with supplementary live observations (e.g. extra special routes).
 * @param {import("./start-route-parity.report.mjs").TargetCapture} base
 * @param {import("./start-route-parity.report.mjs").TargetCapture} extra
 * @returns {import("./start-route-parity.report.mjs").TargetCapture}
 */
export function mergeCaptures(base, extra) {
  return {
    ...base,
    collectedAt: extra.collectedAt ?? base.collectedAt,
    collectionMethod: `${base.collectionMethod} + ${extra.collectionMethod}`,
    caveats: [...new Set([...base.caveats, ...extra.caveats])],
    observations: {
      ...base.observations,
      ...extra.observations,
    },
  };
}

/**
 * Resolve git commit/tree metadata for a local checkout when not explicitly passed.
 * @param {string} rootDir
 * @param {string | undefined} commitRef
 * @returns {{ commit: string | null, tree: string | null }}
 */
function resolveGitMetadata(rootDir, commitRef) {
  if (!commitRef) return { commit: null, tree: null };
  try {
    const commit = execFileSync("git", ["rev-parse", "--short=8", commitRef], { cwd: rootDir, encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["rev-parse", `${commitRef}^{tree}`], { cwd: rootDir, encoding: "utf8" }).trim();
    return { commit, tree };
  } catch {
    return { commit: commitRef, tree: null };
  }
}

/**
 * Write output safely after verifying zero sensitive data leaks.
 * @param {string} outPath
 * @param {string} content
 * @param {readonly (string | null | undefined)[]} secrets
 */
function writeSanitizedFile(outPath, content, secrets) {
  assertNoSensitiveLeaks(content, secrets);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
}

/**
 * CLI entry point.
 * @param {string[]} argv
 */
async function main(argv) {
  const rootDir = repoRoot();
  const parsed = parseArgs({
    args: argv,
    strict: true,
    options: {
      scope: { type: "string", default: "full" },
      "control-input": { type: "string" },
      "control-deployment": { type: "string" },
      "control-scope": { type: "string" },
      "control-url": { type: "string" },
      "control-kind": { type: "string", default: "next" },
      "control-commit": { type: "string" },
      "candidate-input": { type: "string" },
      "candidate-deployment": { type: "string" },
      "candidate-scope": { type: "string" },
      "candidate-url": { type: "string" },
      "candidate-kind": { type: "string", default: "start" },
      "candidate-commit": { type: "string" },
      "vercel-bin": { type: "string", default: "vercel" },
      "supplement-missing": { type: "boolean", default: false },
      "auth-fixture": { type: "boolean", default: false },
      "include-safe-post-validation": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      "save-control": { type: "string" },
      "save-candidate": { type: "string" },
      json: { type: "string" },
      md: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  const v = parsed.values;
  if (v.help) {
    console.log(
      [
        "Usage: node scripts/bench/start-route-parity.mjs [options]",
        "",
        "  --scope <full|room-slice>            Manifest scope (default: full)",
        "  --control-input <path>               Load saved control JSON or preview-control/routes.json",
        "  --control-deployment <dpl_id>        Collect read-only control from immutable Vercel Preview",
        "  --control-scope <scope>              Vercel scope for --control-deployment (never written to output)",
        "  --control-url <url>                  Collect read-only control from direct HTTP(S) URL",
        "  --control-kind <next|start>          Control framework adapter (default: next)",
        "  --candidate-input <path>             Load saved candidate JSON",
        "  --candidate-deployment <dpl_id>      Collect read-only candidate from immutable Vercel Preview",
        "  --candidate-scope <scope>            Vercel scope for --candidate-deployment (never written to output)",
        "  --candidate-url <url>                Collect read-only candidate from direct HTTP(S) URL",
        "  --candidate-kind <next|start>        Candidate framework adapter (default: start)",
        "  --vercel-bin <path>                  Vercel CLI executable (default: vercel)",
        "  --auth-fixture                       Run optional Clerk Playwright authenticated integration fixture",
        "  --include-safe-post-validation       Loopback-only non-mutating 401/400 POST validation",
        "  --strict                             Exit 1 if any in-scope row is unavailable",
        "  --save-control <path>                Write sanitized control capture JSON",
        "  --save-candidate <path>              Write sanitized candidate capture JSON",
        "  --json <path>                        Write sanitized parity report JSON",
        "  --md <path>                          Write sanitized parity report Markdown",
      ].join("\n"),
    );
    return 0;
  }

  if (v.scope !== "full" && v.scope !== "room-slice") {
    throw new Error(`Invalid --scope "${v.scope}"; expected "full" or "room-slice".`);
  }
  const controlKind = v["control-kind"] === "start" ? "start" : "next";
  const candidateKind = v["candidate-kind"] === "next" ? "next" : "start";

  // Always validate full 32-page / 3-handler manifest coverage against src/app before running.
  const fullControlManifest = buildManifest({ targetKind: controlKind, scope: "full", rootDir });
  assertManifestCoversAppTree(rootDir, fullControlManifest);

  const controlManifest = buildManifest({ targetKind: controlKind, scope: v.scope, rootDir });
  const candidateManifest = buildManifest({ targetKind: candidateKind, scope: v.scope, rootDir });

  // Collect caller secrets to guarantee they can never leak into serialized output.
  const callerSecrets = [
    v["control-scope"],
    v["candidate-scope"],
    v["control-url"] && !v["control-url"].includes("127.0.0.1") && !v["control-url"].includes("localhost")
      ? new URL(v["control-url"]).host
      : null,
    v["candidate-url"] && !v["candidate-url"].includes("127.0.0.1") && !v["candidate-url"].includes("localhost")
      ? new URL(v["candidate-url"]).host
      : null,
    process.env.PARITY_BYPASS_TOKEN,
    process.env.CLERK_SECRET_KEY,
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    process.env.E2E_OWNER_EMAIL,
    process.env.E2E_CASHIER_EMAIL,
    process.env.E2E_NONSTAFF_EMAIL,
  ];

  /** @type {import("./start-route-parity.report.mjs").TargetCapture | null} */
  let controlCapture = null;
  if (v["control-input"]) {
    const raw = JSON.parse(readFileSync(path.resolve(v["control-input"]), "utf8"));
    controlCapture = normalizeCaptureInput(raw, controlManifest, controlKind, "control");
  }
  if (v["control-deployment"] || v["control-url"]) {
    const gitMeta = resolveGitMetadata(rootDir, v["control-commit"]);
    const targetManifest =
      v["supplement-missing"] && controlCapture
        ? controlManifest.filter((spec) => !controlCapture?.observations[spec.id])
        : controlManifest;
    const live = await collectTarget({
      manifest: targetManifest,
      targetKind: controlKind,
      rootDir,
      deployment: v["control-deployment"],
      vercelScope: v["control-scope"],
      vercelBin: v["vercel-bin"],
      baseUrl: v["control-url"],
      bypassToken: process.env.PARITY_BYPASS_TOKEN,
      sourceCommit: gitMeta.commit ?? controlCapture?.sourceCommit ?? null,
      sourceTree: gitMeta.tree ?? controlCapture?.sourceTree ?? null,
    });
    controlCapture = controlCapture ? mergeCaptures(controlCapture, live) : live;
  }

  /** @type {import("./start-route-parity.report.mjs").TargetCapture | null} */
  let candidateCapture = null;
  if (v["candidate-input"]) {
    const raw = JSON.parse(readFileSync(path.resolve(v["candidate-input"]), "utf8"));
    candidateCapture = normalizeCaptureInput(raw, candidateManifest, candidateKind, "candidate");
  }
  if (v["candidate-deployment"] || v["candidate-url"]) {
    const gitMeta = resolveGitMetadata(rootDir, v["candidate-commit"]);
    const live = await collectTarget({
      manifest: candidateManifest,
      targetKind: candidateKind,
      rootDir,
      deployment: v["candidate-deployment"],
      vercelScope: v["candidate-scope"],
      vercelBin: v["vercel-bin"],
      baseUrl: v["candidate-url"],
      bypassToken: process.env.PARITY_BYPASS_TOKEN,
      sourceCommit: gitMeta.commit ?? candidateCapture?.sourceCommit ?? null,
      sourceTree: gitMeta.tree ?? candidateCapture?.sourceTree ?? null,
    });
    candidateCapture = candidateCapture ? mergeCaptures(candidateCapture, live) : live;
  }

  if (!controlCapture && !candidateCapture && !v["auth-fixture"]) {
    throw new Error("Supply at least one control/candidate input or URL/deployment, or --auth-fixture.");
  }

  let authReport = null;
  if (v["auth-fixture"]) {
    authReport = await runAuthenticatedFixture({
      baseUrl: v["candidate-url"] ?? v["control-url"] ?? process.env.E2E_BASE_URL,
      includeSafePostValidation: v["include-safe-post-validation"],
    });
  }

  if (v["save-control"] && controlCapture) {
    writeSanitizedFile(path.resolve(v["save-control"]), `${JSON.stringify(controlCapture, null, 2)}\n`, callerSecrets);
  }
  if (v["save-candidate"] && candidateCapture) {
    writeSanitizedFile(
      path.resolve(v["save-candidate"]),
      `${JSON.stringify(candidateCapture, null, 2)}\n`,
      callerSecrets,
    );
  }

  const report = buildParityReport({
    scope: v.scope,
    manifest: controlManifest,
    control: controlCapture,
    candidate: candidateCapture,
    authenticatedFixture: authReport,
  });

  const jsonOut = `${JSON.stringify(report, null, 2)}\n`;
  const mdOut = renderMarkdownReport(report);
  assertNoSensitiveLeaks(jsonOut, callerSecrets);
  assertNoSensitiveLeaks(mdOut, callerSecrets);

  if (v.json) writeSanitizedFile(path.resolve(v.json), jsonOut, callerSecrets);
  if (v.md) writeSanitizedFile(path.resolve(v.md), mdOut, callerSecrets);
  if (!v.json && !v.md) {
    process.stdout.write(mdOut);
  }

  if (report.overallVerdict === "fail") return 1;
  if (v.strict && (report.overallVerdict !== "pass" || report.summary.control.unavailable > 0)) return 1;
  return 0;
}

const isEntrypoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
