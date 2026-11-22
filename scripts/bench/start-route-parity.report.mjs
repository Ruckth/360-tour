/**
 * Strict contract evaluation, reference normalization, Next-vs-Start parity
 * comparison, and Markdown/JSON reporting for Phase 2 route parity.
 *
 * Non-negotiable verification rules:
 * - Never pass a generic 200 without validating route-specific content, metadata, and headers.
 * - Never catch transport/parse exceptions and mark them pass.
 * - Report uncollected/unavailable evidence honestly as `unavailable`, never `pass`.
 */
import {
  EXPECTED_HANDLER_COUNT,
  EXPECTED_PAGE_COUNT,
  LOCALES,
  SEPARATE_PERF_EVIDENCE,
  STATE_CHANGING_CONTRACTS,
} from "./start-route-parity.manifest.mjs";
import { sanitizePath } from "./start-route-parity.sanitize.mjs";

/**
 * @typedef {import("./start-route-parity.manifest.mjs").RouteSpec} RouteSpec
 * @typedef {import("./start-route-parity.sanitize.mjs").HtmlInspection} HtmlInspection
 * @typedef {import("./start-route-parity.auth.mjs").AuthFixtureReport} AuthFixtureReport
 *
 * @typedef {{
 *   id: string,
 *   kind: "page" | "handler" | "special",
 *   method: "GET" | "HEAD",
 *   path: string,
 *   source: string,
 *   acceptLanguage?: string,
 *   status: number | null,
 *   ttfbMs: number | null,
 *   headers: Record<string, string | { path: string | null, rel: "alternate" | "canonical", hreflang: string | null }[]>,
 *   html?: Partial<HtmlInspection> | null,
 *   robotsDirectives?: [string, string][] | null,
 *   sitemap?: { entries: number, localizedPrefixes: string[], poolVilla: boolean, privacy: boolean, terms: boolean, disallowedLeaks?: string[] } | null,
 *   transportError?: string | null,
 *   sourceOrigin?: "live-probe" | "verified-local-reference",
 * }} RouteObservation
 *
 * @typedef {{
 *   targetKind: "next" | "start",
 *   deployment: string | null,
 *   sourceCommit: string | null,
 *   sourceTree: string | null,
 *   collectedAt: string | null,
 *   collectionMethod: string,
 *   caveats: string[],
 *   observations: Record<string, RouteObservation>,
 * }} TargetCapture
 *
 * @typedef {{ name: string, pass: boolean, detail: string }} CheckItem
 *
 * @typedef {{
 *   verdict: "pass" | "fail" | "unavailable",
 *   sourceOrigin: "live-probe" | "verified-local-reference" | null,
 *   path?: string | null,
 *   status: number | null,
 *   location: string | null,
 *   ttfbMs: number | null,
 *   headers?: RouteObservation["headers"],
 *   cacheControl: string | null,
 *   vercelCache: string | null,
 *   contentType: string | null,
 *   referrerPolicy: string | null,
 *   xRobotsTag: string | null,
 *   localeAlternateCount: number | null,
 *   html: Partial<HtmlInspection> | null,
 *   robotsDirectiveCount: number | null,
 *   robotsDirectives?: [string, string][] | null,
 *   sitemapSummary: RouteObservation["sitemap"],
 *   transportError: string | null,
 *   checks: CheckItem[],
 * }} EvaluatedSide
 */

/**
 * Helper to read a string header cleanly.
 * @param {RouteObservation["headers"]} headers
 * @param {string} name
 * @returns {string | null}
 */
function stringHeader(headers, name) {
  const value = headers?.[name];
  return typeof value === "string" ? value : null;
}

/**
 * Count locale alternates from HTTP Link header or HTML `<link rel="alternate">`.
 * @param {RouteObservation} obs
 * @returns {Set<string>}
 */
function observedAlternateHreflangs(obs) {
  /** @type {Set<string>} */
  const langs = new Set();
  const headerLinks = obs.headers?.link;
  if (Array.isArray(headerLinks)) {
    for (const entry of headerLinks) {
      if (entry.rel === "alternate" && entry.hreflang) langs.add(entry.hreflang);
    }
  }
  const htmlLinks = obs.html?.alternateLinks;
  if (Array.isArray(htmlLinks)) {
    for (const entry of htmlLinks) {
      if (entry.hreflang) langs.add(entry.hreflang);
    }
  }
  return langs;
}

/**
 * Evaluate a single route observation against its explicit non-generic contract.
 * @param {RouteSpec} spec
 * @param {RouteObservation | undefined | null} observation
 * @returns {EvaluatedSide}
 */
export function evaluateRouteObservation(spec, observation) {
  if (!observation) {
    return {
      verdict: "unavailable",
      sourceOrigin: null,
      status: null,
      location: null,
      ttfbMs: null,
      cacheControl: null,
      vercelCache: null,
      contentType: null,
      referrerPolicy: null,
      xRobotsTag: null,
      localeAlternateCount: null,
      html: null,
      robotsDirectiveCount: null,
      sitemapSummary: null,
      transportError: null,
      checks: [{ name: "collected", pass: false, detail: "Not collected in this dataset." }],
    };
  }

  /** @type {CheckItem[]} */
  const checks = [];
  /** @param {string} name @param {boolean} pass @param {string} detail */
  const check = (name, pass, detail) => checks.push({ name, pass, detail });

  if (observation.transportError || observation.status === null) {
    check("transport", false, observation.transportError ?? "Missing HTTP status code.");
    return {
      verdict: "fail",
      sourceOrigin: observation.sourceOrigin ?? "live-probe",
      path: observation.path,
      status: observation.status,
      location: stringHeader(observation.headers, "location"),
      ttfbMs: observation.ttfbMs,
      headers: observation.headers ?? {},
      cacheControl: stringHeader(observation.headers, "cache-control"),
      vercelCache: stringHeader(observation.headers, "x-vercel-cache"),
      contentType: stringHeader(observation.headers, "content-type"),
      referrerPolicy: stringHeader(observation.headers, "referrer-policy"),
      xRobotsTag: stringHeader(observation.headers, "x-robots-tag"),
      localeAlternateCount: null,
      html: observation.html ?? null,
      robotsDirectiveCount: observation.robotsDirectives ? observation.robotsDirectives.length : null,
      robotsDirectives: observation.robotsDirectives ?? null,
      sitemapSummary: observation.sitemap ?? null,
      transportError: observation.transportError ?? "Missing HTTP status",
      checks,
    };
  }

  const { contract } = spec;
  const location = stringHeader(observation.headers, "location");
  const contentType = stringHeader(observation.headers, "content-type");
  const cacheControl = stringHeader(observation.headers, "cache-control");
  const vercelCache = stringHeader(observation.headers, "x-vercel-cache");
  const referrerPolicy = stringHeader(observation.headers, "referrer-policy");
  const xRobotsTag = stringHeader(observation.headers, "x-robots-tag");

  // 1. Exact HTTP status
  check(
    "status",
    observation.status === contract.expectedStatus,
    observation.status === contract.expectedStatus
      ? `HTTP ${observation.status}`
      : `Expected HTTP ${contract.expectedStatus}, got ${observation.status}${location ? ` (Location: ${location})` : ""}`,
  );

  // 2. Redirect target path
  if (contract.expectedLocation) {
    const ok = location === contract.expectedLocation;
    check(
      "redirect-location",
      ok,
      ok ? `Location ${location}` : `Expected Location ${contract.expectedLocation}, got ${location ?? "none"}`,
    );
  }

  // 3. Content-Type prefix
  if (contract.expectedContentType) {
    const ok = Boolean(contentType && contentType.toLowerCase().startsWith(contract.expectedContentType.toLowerCase()));
    check(
      "content-type",
      ok,
      ok
        ? `Content-Type ${contentType}`
        : `Expected Content-Type starting with ${contract.expectedContentType}, got ${contentType ?? "none"}`,
    );
  }

  // 4. Required headers
  if (contract.requiredHeaders) {
    const req = contract.requiredHeaders;
    if (req.referrerPolicy) {
      const ok = referrerPolicy?.toLowerCase() === req.referrerPolicy.toLowerCase();
      check(
        "referrer-policy",
        ok,
        ok ? `Referrer-Policy ${referrerPolicy}` : `Expected Referrer-Policy ${req.referrerPolicy}, got ${referrerPolicy ?? "none"}`,
      );
    }
    if (req.cacheControlIncludes) {
      const ccLower = (cacheControl ?? "").toLowerCase();
      const missing = req.cacheControlIncludes.filter((token) => !ccLower.includes(token.toLowerCase()));
      check(
        "cache-control",
        missing.length === 0,
        missing.length === 0
          ? `Cache-Control includes ${req.cacheControlIncludes.join(", ")}`
          : `Cache-Control (${cacheControl ?? "none"}) missing: ${missing.join(", ")}`,
      );
    }
    if (req.xRobotsTagIncludes) {
      const xrLower = (xRobotsTag ?? "").toLowerCase();
      const missing = req.xRobotsTagIncludes.filter((token) => !xrLower.includes(token.toLowerCase()));
      check(
        "x-robots-tag",
        missing.length === 0,
        missing.length === 0
          ? `X-Robots-Tag includes ${req.xRobotsTagIncludes.join(", ")}`
          : `X-Robots-Tag (${xRobotsTag ?? "none"}) missing: ${missing.join(", ")}`,
      );
    }
    if (req.requireLocaleAlternates) {
      const langs = observedAlternateHreflangs(observation);
      const expectedLangs = [...LOCALES, "x-default"];
      const missing = expectedLangs.filter((loc) => !langs.has(loc));
      check(
        "locale-alternates",
        missing.length === 0,
        missing.length === 0
          ? `${langs.size} hreflang alternates present`
          : `Missing hreflang alternates: ${missing.join(", ")}`,
      );
    }
  }

  // 5. HTML metadata, localized title, visible vs hidden content, errors & leak checks
  if (contract.expectedHtml && spec.method === "GET") {
    const html = observation.html;
    if (!html) {
      check("html-document", false, "Expected parsed HTML inspection, got none.");
    } else {
      const expected = contract.expectedHtml;

      if (expected.lang !== undefined) {
        const ok = html.lang === expected.lang || Boolean(expected.allowMissingLang && html.lang === null);
        check(
          "html-lang",
          ok,
          ok ? `lang=${html.lang ?? "null"}` : `Expected lang=${expected.lang}, got ${html.lang ?? "null"}`,
        );
      }

      if (expected.titleContains) {
        const ok = Boolean(html.title && html.title.includes(expected.titleContains));
        check(
          "html-title",
          ok,
          ok
            ? `Title matches "${expected.titleContains}"`
            : `Expected title containing "${expected.titleContains}", got ${html.title ? `"${html.title}"` : "null"}`,
        );
      }

      if (expected.robotsIncludes) {
        const robotsLower = (html.robots ?? "").toLowerCase();
        const missing = expected.robotsIncludes.filter((token) => !robotsLower.includes(token.toLowerCase()));
        check(
          "html-robots",
          missing.length === 0,
          missing.length === 0
            ? `meta robots="${html.robots}"`
            : `meta robots (${html.robots ?? "none"}) missing: ${missing.join(", ")}`,
        );
      } else if (expected.noindexViaMetaOrHeader) {
        const metaNoindex = (html.robots ?? "").toLowerCase().includes("noindex");
        const headerNoindex = (xRobotsTag ?? "").toLowerCase().includes("noindex");
        check(
          "noindex-signal",
          metaNoindex || headerNoindex,
          metaNoindex && headerNoindex
            ? `noindex via meta robots ("${html.robots}") and X-Robots-Tag ("${xRobotsTag}")`
            : metaNoindex
              ? `noindex via meta robots ("${html.robots}")`
              : headerNoindex
                ? `noindex via X-Robots-Tag ("${xRobotsTag}")`
                : "Missing noindex in both meta robots and X-Robots-Tag header.",
        );
      }

      if (expected.trackRoomVisibility && expected.roomHeading) {
        const headings = html.headings ?? [];
        const roomHeadingMatch = headings.find((h) => h.text.includes(expected.roomHeading ?? ""));
        const loading = html.loadingMarkup ?? [];
        const hasVisibleHeading = Boolean(roomHeadingMatch && !roomHeadingMatch.hiddenAncestor);
        const hasHiddenHeading = Boolean(roomHeadingMatch && roomHeadingMatch.hiddenAncestor);
        const hasVisibleLoading = loading.some((item) => !item.hiddenAncestor);
        check(
          "room-html-content",
          hasVisibleHeading || hasHiddenHeading,
          hasVisibleHeading
            ? `Visible room heading "${expected.roomHeading}" in JS-disabled HTML.`
            : hasHiddenHeading
              ? `Room heading "${expected.roomHeading}" present inside hidden Suspense subtree${hasVisibleLoading ? ` (visible fallback: "${loading[0]?.text ?? ""}")` : ""}.`
              : `Missing room heading "${expected.roomHeading}" in SSR HTML.`,
        );
      }

      if (expected.expectedMarkers && expected.expectedMarkers.length > 0 && Array.isArray(html.matchedExpectedMarkers)) {
        const matchedAny = html.matchedExpectedMarkers.some((m) => m.visible || m.hidden);
        check(
          "body-markers",
          matchedAny,
          matchedAny
            ? `Matched body markers (${html.matchedExpectedMarkers.filter((m) => m.visible || m.hidden).map((m) => `${m.marker}:${m.visible ? "visible" : "hidden"}`).join(", ")})`
            : `Expected body markers missing: ${expected.expectedMarkers.join(", ")}`,
        );
      }

      if (expected.errorMarkers && expected.errorMarkers.length > 0 && Array.isArray(html.matchedErrorMarkers)) {
        const matchedAny = html.matchedErrorMarkers.some((m) => m.visible || m.hidden);
        check(
          "error-markers",
          matchedAny,
          matchedAny
            ? `Matched error marker (${html.matchedErrorMarkers.filter((m) => m.visible || m.hidden).map((m) => m.marker).join(", ")})`
            : `404 HTML missing expected error markers (${expected.errorMarkers.join(" | ")})`,
        );
      }

      if (Array.isArray(html.matchedForbiddenMarkers)) {
        const ok = html.matchedForbiddenMarkers.length === 0;
        check(
          expected.requireAnonymousNoStaffLeak ? "anonymous-admin-no-leak" : "no-error-markers",
          ok,
          ok
            ? expected.requireAnonymousNoStaffLeak
              ? "No staff-only content leaked in anonymous SSR HTML."
              : "No server error fallback markers found."
            : `Forbidden markers detected: ${html.matchedForbiddenMarkers.join(", ")}`,
        );
      }
    }
  }

  // 6. robots.txt directives
  if (contract.expectedRobotsDirectives) {
    const actual = observation.robotsDirectives ?? [];
    const expectedJson = JSON.stringify(contract.expectedRobotsDirectives);
    const actualJson = JSON.stringify(actual);
    const ok = expectedJson === actualJson;
    check(
      "robots-directives",
      ok,
      ok
        ? `${actual.length} robots.txt directives match exact contract.`
        : `robots.txt directives mismatch (got ${actual.length}, expected ${contract.expectedRobotsDirectives.length}).`,
    );
  }

  // 7. sitemap.xml structure
  if (contract.expectedSitemap) {
    const sitemap = observation.sitemap;
    if (!sitemap) {
      check("sitemap-xml", false, "Missing parsed sitemap XML.");
    } else {
      const missingPrefixes = contract.expectedSitemap.requiredPrefixes.filter(
        (prefix) => !sitemap.localizedPrefixes.includes(prefix),
      );
      const leaks = sitemap.disallowedLeaks ?? [];
      const ok =
        sitemap.entries >= contract.expectedSitemap.minEntries &&
        missingPrefixes.length === 0 &&
        sitemap.poolVilla &&
        sitemap.privacy &&
        sitemap.terms &&
        leaks.length === 0;
      check(
        "sitemap-xml",
        ok,
        ok
          ? `${sitemap.entries} URLs across ${sitemap.localizedPrefixes.length} localized prefixes, pool-villa/privacy/terms present, 0 disallowed leaks.`
          : `Sitemap mismatch: entries=${sitemap.entries}, missingPrefixes=[${missingPrefixes.join(",")}], poolVilla=${sitemap.poolVilla}, privacy=${sitemap.privacy}, terms=${sitemap.terms}, leaks=[${leaks.join(",")}]`,
      );
    }
  }

  // Guard: never pass a row that has zero checks!
  if (checks.length === 0) {
    check("contract-non-empty", false, "Route contract must assert more than a bare status.");
  }

  const allPassed = checks.every((c) => c.pass);
  const alternates = observedAlternateHreflangs(observation);

  return {
    verdict: allPassed ? "pass" : "fail",
    sourceOrigin: observation.sourceOrigin ?? "live-probe",
    path: observation.path,
    status: observation.status,
    location,
    ttfbMs: observation.ttfbMs,
    headers: observation.headers ?? {},
    cacheControl,
    vercelCache,
    contentType,
    referrerPolicy,
    xRobotsTag,
    localeAlternateCount: alternates.size > 0 ? alternates.size : null,
    html: observation.html ?? null,
    robotsDirectiveCount: observation.robotsDirectives ? observation.robotsDirectives.length : null,
    robotsDirectives: observation.robotsDirectives ?? null,
    sitemapSummary: observation.sitemap ?? null,
    transportError: null,
    checks,
  };
}

/**
 * Strip a leading known locale prefix from a path (for legacy pre-headers report fallback only).
 * @param {string} pathname
 * @returns {string}
 */
function stripLocalePrefixPath(pathname) {
  const [, first, ...rest] = pathname.split("/");
  if (first && /** @type {readonly string[]} */ (LOCALES).includes(first)) {
    return rest.length > 0 ? `/${rest.join("/")}` : "/";
  }
  return pathname || "/";
}

/**
 * Import either our native TargetCapture JSON, a saved `schemaVersion: 1` parity report JSON,
 * or the legacy `collect-routes.py` `routes.json` format into a normalized TargetCapture keyed
 * by manifest row ID.
 * @param {any} raw
 * @param {readonly RouteSpec[]} manifest
 * @param {"next" | "start"} [defaultTargetKind]
 * @param {"control" | "candidate"} [reportSide]
 * @returns {TargetCapture}
 */
export function normalizeCaptureInput(raw, manifest, defaultTargetKind = "next", reportSide = "control") {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid capture input: expected JSON object.");
  }

  // Native format already keyed by row id
  if (raw.observations && typeof raw.observations === "object" && !Array.isArray(raw.observations)) {
    return {
      targetKind: raw.targetKind === "start" ? "start" : defaultTargetKind,
      deployment: typeof raw.deployment === "string" ? raw.deployment : null,
      sourceCommit: typeof raw.sourceCommit === "string" ? raw.sourceCommit : null,
      sourceTree: typeof raw.sourceTree === "string" ? raw.sourceTree : null,
      collectedAt: typeof raw.collectedAt === "string" ? raw.collectedAt : null,
      collectionMethod: typeof raw.collectionMethod === "string" ? raw.collectionMethod : "captured-json",
      caveats: Array.isArray(raw.caveats) ? raw.caveats.map(String) : [],
      observations: raw.observations,
    };
  }

  // Re-import from a previous parity report JSON (`schemaVersion: 1` with `rows[].control|candidate`)
  const preferredSide =
    reportSide === "candidate" && raw.candidate?.status === "collected" ? "candidate" : "control";
  if (raw.schemaVersion === 1 && Array.isArray(raw.rows) && raw[preferredSide] && typeof raw[preferredSide] === "object") {
    const meta = raw[preferredSide];
    /** @type {Record<string, RouteObservation>} */
    const observations = {};
    for (const row of raw.rows) {
      const side = row[preferredSide];
      if (!side || side.verdict === "unavailable") continue;
      const spec = manifest.find((s) => s.id === row.id);
      if (!spec) continue;
      /** @type {RouteObservation["headers"]} */
      let headers;
      if (side.headers && typeof side.headers === "object" && !Array.isArray(side.headers)) {
        // Preserve actual sanitized headers verbatim (including Link alternates, Vary, etc.).
        headers = structuredClone(side.headers);
      } else {
        // Backward compatibility for earlier schemaVersion 1 reports written before `side.headers` existed.
        headers = {};
        if (side.cacheControl) headers["cache-control"] = side.cacheControl;
        if (side.vercelCache) headers["x-vercel-cache"] = side.vercelCache;
        if (side.contentType) headers["content-type"] = side.contentType;
        if (side.referrerPolicy) headers["referrer-policy"] = side.referrerPolicy;
        if (side.xRobotsTag) headers["x-robots-tag"] = side.xRobotsTag;
        if (side.location) headers.location = side.location;
        if (side.localeAlternateCount && side.localeAlternateCount >= LOCALES.length + 1) {
          const cleanBase = stripLocalePrefixPath(sanitizePath(spec.path, { preserveSafeQuery: false }) ?? "/");
          headers.link = [
            ...LOCALES.map((loc) => ({
              path: loc === "en" ? cleanBase : `/${loc}${cleanBase === "/" ? "" : cleanBase}`,
              rel: /** @type {const} */ ("alternate"),
              hreflang: loc,
            })),
            { path: cleanBase, rel: /** @type {const} */ ("alternate"), hreflang: "x-default" },
          ];
        }
      }
      observations[spec.id] = {
        id: spec.id,
        kind: spec.kind,
        method: spec.method,
        path: side.path ?? spec.path,
        source: spec.source,
        ...(spec.acceptLanguage ? { acceptLanguage: spec.acceptLanguage } : {}),
        status: side.status,
        ttfbMs: side.ttfbMs,
        headers,
        html: side.html ? structuredClone(side.html) : null,
        robotsDirectives: side.robotsDirectives ? structuredClone(side.robotsDirectives) : null,
        sitemap: side.sitemapSummary ? structuredClone(side.sitemapSummary) : null,
        transportError: side.transportError ?? null,
        sourceOrigin: side.sourceOrigin ?? "verified-local-reference",
      };
    }
    return {
      targetKind: meta.targetKind === "start" ? "start" : defaultTargetKind,
      deployment: typeof meta.deployment === "string" ? meta.deployment : null,
      sourceCommit: typeof meta.sourceCommit === "string" ? meta.sourceCommit : null,
      sourceTree: typeof meta.sourceTree === "string" ? meta.sourceTree : null,
      collectedAt: typeof meta.collectedAt === "string" ? meta.collectedAt : null,
      collectionMethod: typeof meta.collectionMethod === "string" ? meta.collectionMethod : "report-control-reimport",
      caveats: Array.isArray(meta.caveats) ? meta.caveats.map(String) : [],
      observations,
    };
  }

  // Legacy collect-routes.py `routes.json` format (array in `routes`)
  if (!Array.isArray(raw.routes)) {
    throw new Error("Invalid capture input: expected `observations` map or `routes` array.");
  }

  /** @type {Record<string, RouteObservation>} */
  const observations = {};
  for (const row of raw.routes) {
    const match = manifest.find(
      (spec) =>
        spec.kind === row.kind &&
        spec.method === row.method &&
        spec.path === row.path &&
        (spec.acceptLanguage ?? null) === (row.acceptLanguage ?? null),
    );
    if (!match) continue;
    const html = row.html
      ? {
          lang: row.html.lang ?? null,
          title: row.html.title ?? null,
          canonical: row.html.canonical ?? null,
          robots: row.html.robots ?? null,
          headings: Array.isArray(row.html.headings)
            ? row.html.headings.map((/** @type {any} */ h) => ({
                level: h.level === "h2" ? /** @type {const} */ ("h2") : /** @type {const} */ ("h1"),
                text: String(h.text ?? ""),
                hiddenAncestor: Boolean(h.hiddenAncestor),
              }))
            : undefined,
          loadingMarkup: Array.isArray(row.html.loadingMarkup) ? row.html.loadingMarkup : undefined,
          anonymousAdminGate:
            typeof row.html.anonymousAdminGate === "boolean" ? row.html.anonymousAdminGate : undefined,
          jsDisabledSummary: inferLegacyJsDisabledSummary(row),
        }
      : null;

    observations[match.id] = {
      id: match.id,
      kind: match.kind,
      method: match.method,
      path: sanitizePath(row.path, { preserveSafeQuery: true }) ?? match.path,
      source: match.source,
      ...(match.acceptLanguage ? { acceptLanguage: match.acceptLanguage } : {}),
      status: typeof row.status === "number" ? row.status : null,
      ttfbMs: typeof row.ttfbMs === "number" ? row.ttfbMs : null,
      headers: row.headers && typeof row.headers === "object" ? row.headers : {},
      html,
      robotsDirectives: Array.isArray(row.robotsDirectives) ? row.robotsDirectives : null,
      sitemap: row.sitemap && typeof row.sitemap === "object" ? row.sitemap : null,
      transportError: null,
      sourceOrigin: "verified-local-reference",
    };
  }

  return {
    targetKind: defaultTargetKind,
    deployment: typeof raw.deployment === "string" ? raw.deployment : null,
    sourceCommit: typeof raw.sourceCommit === "string" ? raw.sourceCommit : null,
    sourceTree: typeof raw.sourceTree === "string" ? raw.sourceTree : null,
    collectedAt: typeof raw.collectedAt === "string" ? raw.collectedAt : null,
    collectionMethod: "verified-local-reference (preview-control/routes.json)",
    caveats: Array.isArray(raw.caveats) ? raw.caveats.map(String) : [],
    observations,
  };
}

/**
 * Infer JS-disabled HTML summary for rows imported from the legacy reference file.
 * @param {any} row
 * @returns {HtmlInspection["jsDisabledSummary"] | undefined}
 */
function inferLegacyJsDisabledSummary(row) {
  if (!row.html) return undefined;
  if (typeof row.status === "number" && row.status >= 400) return "error-page";
  const headings = Array.isArray(row.html.headings) ? row.html.headings : [];
  const loading = Array.isArray(row.html.loadingMarkup) ? row.html.loadingMarkup : [];
  const hasVisibleLoading = loading.some((/** @type {any} */ item) => !item.hiddenAncestor);
  const hasHiddenHeading = headings.some((/** @type {any} */ h) => h.hiddenAncestor);
  const hasVisibleHeading = headings.some((/** @type {any} */ h) => !h.hiddenAncestor);
  if (hasVisibleLoading && hasHiddenHeading && !hasVisibleHeading) {
    return "suspense-fallback-with-hidden-content";
  }
  if (hasVisibleHeading) return "visible-content";
  if (typeof row.path === "string" && (row.path.startsWith("/admin") || row.path.startsWith("/sign-"))) {
    return "shell-or-client-gated";
  }
  return undefined;
}

/**
 * Compare evaluated control vs candidate rows for parity.
 * @param {RouteSpec} spec
 * @param {EvaluatedSide} control
 * @param {EvaluatedSide} candidate
 * @returns {{ parityVerdict: "match" | "improved" | "drift" | "fail" | "pending", parityNotes: string[] }}
 */
function compareRowParity(spec, control, candidate) {
  /** @type {string[]} */
  const notes = [];
  if (candidate.verdict === "unavailable") {
    return { parityVerdict: "pending", parityNotes: ["Awaiting candidate Start deployment run."] };
  }
  if (candidate.verdict === "fail") {
    const failed = candidate.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
    return { parityVerdict: "fail", parityNotes: failed };
  }
  if (control.verdict === "unavailable") {
    return { parityVerdict: "match", parityNotes: ["Candidate passed contract; pre-change control row was unavailable."] };
  }
  if (control.status !== candidate.status) {
    return {
      parityVerdict: "fail",
      parityNotes: [`Status mismatch: control=${control.status}, candidate=${candidate.status}`],
    };
  }
  if (control.location !== candidate.location) {
    return {
      parityVerdict: "fail",
      parityNotes: [`Redirect location mismatch: control=${control.location}, candidate=${candidate.location}`],
    };
  }
  if (control.html?.title && candidate.html?.title && control.html.title !== candidate.html.title) {
    notes.push(`Title differs: control="${control.html.title}" vs candidate="${candidate.html.title}"`);
  }
  if (
    spec.contract.expectedHtml?.trackRoomVisibility &&
    control.html?.jsDisabledSummary === "suspense-fallback-with-hidden-content" &&
    candidate.html?.jsDisabledSummary === "visible-content"
  ) {
    notes.push("JS-disabled HTML improved: visible room heading replaces Suspense loading fallback.");
    return { parityVerdict: "improved", parityNotes: notes };
  }
  if (notes.length > 0) {
    return { parityVerdict: "drift", parityNotes: notes };
  }
  return { parityVerdict: "match", parityNotes: ["Control and candidate satisfy matching HTTP/metadata/HTML contract."] };
}

/**
 * Build the complete parity report object from control and optional candidate captures.
 * @param {{
 *   scope: "full" | "room-slice",
 *   manifest: readonly RouteSpec[],
 *   control: TargetCapture | null,
 *   candidate: TargetCapture | null,
 *   authenticatedFixture?: AuthFixtureReport | null,
 *   command?: string,
 * }} input
 */
export function buildParityReport(input) {
  const { scope, manifest, control, candidate } = input;
  const authFixture = input.authenticatedFixture ?? {
    status: /** @type {const} */ ("unavailable"),
    reason: "Optional Clerk Playwright authenticated fixture not run (requires isolated local integration or Clerk test-tenant run-owned sessions).",
    summary: { total: 0, pass: 0, fail: 0 },
    checks: [],
  };

  const rows = manifest.map((spec) => {
    const controlObs = control?.observations[spec.id] ?? null;
    const candidateObs = candidate?.observations[spec.id] ?? null;
    const controlEval = evaluateRouteObservation(spec, controlObs);
    const candidateEval = evaluateRouteObservation(spec, candidateObs);
    const { parityVerdict, parityNotes } = compareRowParity(spec, controlEval, candidateEval);
    return {
      id: spec.id,
      kind: spec.kind,
      group: spec.group,
      method: spec.method,
      path: spec.path,
      canonicalPathKey: spec.canonicalPathKey,
      source: spec.source,
      inRoomSlice: spec.inRoomSlice,
      ...(spec.acceptLanguage ? { acceptLanguage: spec.acceptLanguage } : {}),
      ...(spec.note ? { note: spec.note } : {}),
      control: controlEval,
      candidate: candidateEval,
      parityVerdict,
      parityNotes,
    };
  });

  const countVerdicts = (/** @type {"control" | "candidate"} */ side) => ({
    pass: rows.filter((r) => r[side].verdict === "pass").length,
    fail: rows.filter((r) => r[side].verdict === "fail").length,
    unavailable: rows.filter((r) => r[side].verdict === "unavailable").length,
  });

  const controlCounts = countVerdicts("control");
  const candidateCounts = countVerdicts("candidate");
  const parityCounts = {
    match: rows.filter((r) => r.parityVerdict === "match").length,
    improved: rows.filter((r) => r.parityVerdict === "improved").length,
    drift: rows.filter((r) => r.parityVerdict === "drift").length,
    fail: rows.filter((r) => r.parityVerdict === "fail").length,
    pending: rows.filter((r) => r.parityVerdict === "pending").length,
  };

  const mode = candidate ? /** @type {const} */ ("paired") : /** @type {const} */ ("control-only");
  /** @type {"pass" | "fail" | "pending-candidate"} */
  let overallVerdict;
  if (controlCounts.fail > 0 || candidateCounts.fail > 0 || parityCounts.fail > 0 || authFixture.status === "fail") {
    overallVerdict = "fail";
  } else if (mode === "control-only" || parityCounts.pending > 0) {
    overallVerdict = "pending-candidate";
  } else {
    overallVerdict = "pass";
  }

  return {
    schemaVersion: 1,
    scope,
    mode,
    overallVerdict,
    manifestCoverage: {
      totalRows: rows.length,
      pages: rows.filter((r) => r.kind === "page").length,
      expectedPages: scope === "full" ? EXPECTED_PAGE_COUNT : rows.filter((r) => r.kind === "page").length,
      handlers: new Set(rows.filter((r) => r.kind === "handler").map((r) => r.source)).size,
      expectedHandlers: scope === "full" ? EXPECTED_HANDLER_COUNT : new Set(rows.filter((r) => r.kind === "handler").map((r) => r.source)).size,
      handlerProbes: rows.filter((r) => r.kind === "handler").length,
      specialRoutes: rows.filter((r) => r.kind === "special").length,
    },
    control: control
      ? {
          status: /** @type {const} */ ("collected"),
          targetKind: control.targetKind,
          deployment: control.deployment,
          sourceCommit: control.sourceCommit,
          sourceTree: control.sourceTree,
          collectedAt: control.collectedAt,
          collectionMethod: control.collectionMethod,
          caveats: control.caveats,
        }
      : { status: /** @type {const} */ ("unavailable"), reason: "No control input supplied." },
    candidate: candidate
      ? {
          status: /** @type {const} */ ("collected"),
          targetKind: candidate.targetKind,
          deployment: candidate.deployment,
          sourceCommit: candidate.sourceCommit,
          sourceTree: candidate.sourceTree,
          collectedAt: candidate.collectedAt,
          collectionMethod: candidate.collectionMethod,
          caveats: candidate.caveats,
        }
      : {
          status: /** @type {const} */ ("unavailable"),
          reason: "Awaiting TanStack Start Preview deployment URL (room-slice first, then full route tree).",
        },
    summary: {
      control: controlCounts,
      candidate: candidateCounts,
      parity: parityCounts,
    },
    rows,
    authenticatedFixture: authFixture,
    stateChangingContracts: STATE_CHANGING_CONTRACTS,
    separatePerfReport: SEPARATE_PERF_EVIDENCE,
    ...(input.command ? { command: input.command } : {}),
  };
}

/**
 * Escape Markdown table cells cleanly.
 * @param {string} value
 * @returns {string}
 */
function mdCell(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Format a compact single-cell summary of an evaluated side.
 * @param {EvaluatedSide} side
 * @returns {string}
 */
function formatSideSummary(side) {
  if (side.verdict === "unavailable") return "unavailable";
  const status = side.status === null ? "ERR" : String(side.status);
  const redirect = side.location ? ` -> \`${side.location}\`` : "";
  const cache = side.vercelCache ?? "n/a";
  const ttfb = side.ttfbMs !== null ? `${side.ttfbMs} ms` : "n/a";
  return `\`${side.verdict}\` ${status}${redirect} (${cache}, ${ttfb})`;
}

/**
 * Format compact metadata + JS-disabled HTML markers for a row.
 * @param {EvaluatedSide} side
 * @returns {string}
 */
function formatContentSummary(side) {
  if (side.verdict === "unavailable") return "unavailable";
  if (side.transportError) return `error: ${side.transportError}`;
  if (side.robotsDirectiveCount !== null) return `robots.txt (${side.robotsDirectiveCount} directives)`;
  if (side.sitemapSummary) {
    return `sitemap (${side.sitemapSummary.entries} URLs, ${side.sitemapSummary.localizedPrefixes.length} locales)`;
  }
  if (side.html) {
    const parts = [];
    if (side.html.lang) parts.push(`lang=${side.html.lang}`);
    if (side.html.title) parts.push(`title="${side.html.title.slice(0, 48)}"`);
    if (side.html.robots) parts.push(`robots=${side.html.robots}`);
    if (side.html.jsDisabledSummary) parts.push(`no-js=${side.html.jsDisabledSummary}`);
    if (side.html.headings && side.html.headings.length > 0) {
      const first = side.html.headings[0];
      parts.push(`h1="${first.text.slice(0, 32)}"(${first.hiddenAncestor ? "hidden" : "visible"})`);
    }
    if (side.html.loadingMarkup && side.html.loadingMarkup.length > 0) {
      const first = side.html.loadingMarkup[0];
      parts.push(`fallback="${first.text}"(${first.hiddenAncestor ? "hidden" : "visible"})`);
    }
    return parts.join("; ") || "html parsed";
  }
  const bits = [];
  if (side.contentType) bits.push(side.contentType);
  if (side.referrerPolicy) bits.push(`referrer=${side.referrerPolicy}`);
  if (side.cacheControl) bits.push(`cc=${side.cacheControl}`);
  return bits.join("; ") || "headers only";
}

/**
 * Render a deterministic, sanitized Markdown report (`docs/plans/benchmarks/start-routes.md`).
 * @param {ReturnType<typeof buildParityReport>} report
 * @returns {string}
 */
export function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Phase 2 Route Parity Report (Next.js vs TanStack Start)");
  lines.push("");
  lines.push(
    `Scope: **${report.scope}** · Mode: **${report.mode}** · Overall verdict: **${report.overallVerdict}**`,
  );
  lines.push("");
  lines.push(
    "This report tracks URL-by-URL HTTP, metadata, redirect, header, and JS-disabled HTML parity across all " +
      `${report.manifestCoverage.expectedPages} tracked page routes, ${report.manifestCoverage.expectedHandlers} frontend HTTP handlers, and special routes. ` +
      "See the [controlled room timings](room-preview-corrected-timing.md), [natural cache replay](room-preview-corrected-natural.md), [cache outage study](start-villa-cache-study.md), [mobile interaction measurements](tour-entry-start.md) and [authenticated Preview workflows](start-room-preview.md) for the corresponding tests.",
  );
  lines.push("");

  lines.push("## Target metadata");
  lines.push("");
  lines.push("| Side | Status | Framework | Deployment | Commit | Tree | Collected (UTC) | Method |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [label, meta] of /** @type {const} */ ([["Control", report.control], ["Candidate", report.candidate]])) {
    if (meta.status === "collected") {
      lines.push(
        `| ${label} | collected | ${meta.targetKind} | \`${meta.deployment ?? "local"}\` | \`${meta.sourceCommit ?? "n/a"}\` | \`${meta.sourceTree ?? "n/a"}\` | ${meta.collectedAt ?? "n/a"} | ${mdCell(meta.collectionMethod)} |`,
      );
    } else {
      lines.push(`| ${label} | unavailable | - | - | - | - | - | ${mdCell(meta.reason)} |`);
    }
  }
  lines.push("");

  const caveats = new Set([report.control, report.candidate].flatMap(
    (side) => side.status === "collected" ? side.caveats : [],
  ));
  if (caveats.size > 0) {
    lines.push("### Collection caveats");
    lines.push("");
    for (const caveat of caveats) {
      lines.push(`- ${caveat}`);
    }
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Manifest rows in scope | ${report.manifestCoverage.totalRows} |`);
  lines.push(`| Page routes (${report.manifestCoverage.expectedPages} expected in full scope) | ${report.manifestCoverage.pages} |`);
  lines.push(`| HTTP handlers (${report.manifestCoverage.expectedHandlers} expected; ${report.manifestCoverage.handlerProbes} GET/HEAD probes) | ${report.manifestCoverage.handlers} |`);
  lines.push(`| Special routes (SEO, redirects, static headers, images, locales, 404s) | ${report.manifestCoverage.specialRoutes} |`);
  lines.push(`| Control pass / fail / unavailable | ${report.summary.control.pass} / ${report.summary.control.fail} / ${report.summary.control.unavailable} |`);
  lines.push(`| Candidate pass / fail / unavailable | ${report.summary.candidate.pass} / ${report.summary.candidate.fail} / ${report.summary.candidate.unavailable} |`);
  lines.push(`| Parity match / improved / drift / fail / pending | ${report.summary.parity.match} / ${report.summary.parity.improved} / ${report.summary.parity.drift} / ${report.summary.parity.fail} / ${report.summary.parity.pending} |`);
  lines.push("");

  // Highlight JS-disabled visible vs hidden HTML findings on room + key routes
  const roomRows = report.rows.filter((r) => r.id === "page:rooms-id" || r.id === "special:room-th");
  if (roomRows.length > 0) {
    lines.push("## JS-disabled HTML visibility (room slice)");
    lines.push("");
    lines.push("| Route | Control no-JS state | Control headings | Control loading fallback | Candidate no-JS state |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of roomRows) {
      const ch = (row.control.html?.headings ?? [])
        .map((h) => `"${h.text}" (${h.hiddenAncestor ? "hiddenAncestor" : "visible"})`)
        .join(", ") || "none";
      const cl = (row.control.html?.loadingMarkup ?? [])
        .map((l) => `"${l.text}" (${l.hiddenAncestor ? "hiddenAncestor" : "visible"})`)
        .join(", ") || "none";
      const candState = row.candidate.verdict === "unavailable"
        ? "unavailable"
        : (row.candidate.html?.jsDisabledSummary ?? "n/a");
      lines.push(
        `| \`${row.path}\` | \`${row.control.html?.jsDisabledSummary ?? "unavailable"}\` | ${mdCell(ch)} | ${mdCell(cl)} | \`${candState}\` |`,
      );
    }
    lines.push("");
  }

  // Group rows cleanly
  /** @type {[string, string[]][]} */
  const sections = [
    ["Localized public pages (10)", ["public"]],
    ["Admin pages — anonymous SSR gate (18)", ["admin"]],
    ["Other pages (4)", ["other"]],
    ["Frontend HTTP handlers — read-only probes (3 handlers × GET/HEAD)", ["handler"]],
    ["Special routes — SEO, redirects, headers, images, locales, 404s", ["seo", "redirects", "headers", "images", "locale", "errors", "marketing"]],
  ];

  lines.push("## URL-by-URL parity table");
  lines.push("");
  for (const [heading, groups] of sections) {
    const groupRows = report.rows.filter((r) => groups.includes(r.group));
    if (groupRows.length === 0) continue;
    lines.push(`### ${heading}`);
    lines.push("");
    lines.push("| Path | Method | Source | Control (Next) | Control markers / headers | Candidate (Start) | Parity |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const row of groupRows) {
      const pathLabel = row.acceptLanguage ? `\`${row.path}\` (Accept-Language: \`${row.acceptLanguage}\`)` : `\`${row.path}\``;
      lines.push(
        `| ${pathLabel} | ${row.method} | \`${row.source}\` | ${mdCell(formatSideSummary(row.control))} | ${mdCell(formatContentSummary(row.control))} | ${mdCell(formatSideSummary(row.candidate))} | \`${row.parityVerdict}\` |`,
      );
    }
    lines.push("");
  }

  // Authenticated staff / anonymous integration fixture
  lines.push("## Authenticated staff & anonymous integration fixture");
  lines.push("");
  lines.push(`Status: **${report.authenticatedFixture.status}**`);
  if (report.authenticatedFixture.reason) {
    lines.push("");
    lines.push(`> ${report.authenticatedFixture.reason}`);
  }
  if (report.authenticatedFixture.checks.length > 0) {
    lines.push("");
    lines.push("| Check | Role | Method | Path | JS | Status | Verdict | Detail |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const item of report.authenticatedFixture.checks) {
      const js = item.jsEnabled === null ? "n/a" : item.jsEnabled ? "on" : "off";
      lines.push(
        `| \`${item.id}\` | ${item.role} | ${item.method} | \`${item.path}\` | ${js} | ${item.status ?? "err"} | \`${item.verdict}\` | ${mdCell(item.detail)} |`,
      );
    }
  }
  lines.push("");

  // State-changing HTTP contracts ledger
  lines.push("## State-changing HTTP contracts (preserved without mutating Preview)");
  lines.push("");
  lines.push("| Contract | Method | Path | Verified by | Live Preview policy |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const item of report.stateChangingContracts) {
    lines.push(
      `| \`${item.id}\` | ${item.method} | \`${mdCell(item.path)}\` | ${item.verifiedBy.map((t) => `\`${t}\``).join(", ")} | ${mdCell(item.livePreviewPolicy)} |`,
    );
  }
  lines.push("");

  // Honest unavailable fields owned by separate room perf report
  lines.push("## Measurements collected separately");
  lines.push("");
  lines.push("| Field | Status | Why unavailable here | Required protocol | Owner |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [key, entry] of Object.entries(report.separatePerfReport)) {
    lines.push(
      `| \`${key}\` | \`${entry.status}\` | ${mdCell(entry.reason)} | ${mdCell(entry.requiredProtocol)} | ${mdCell(entry.ownedBy)} |`,
    );
  }
  lines.push("");

  lines.push("## Reproduce");
  lines.push("");
  lines.push("```sh");
  lines.push("# 1. Re-render pre-change report from verified local reference control JSON");
  lines.push("node scripts/bench/start-route-parity.mjs \\");
  lines.push("  --control-input <path/to/preview-control/routes.json> \\");
  lines.push("  --json docs/plans/benchmarks/start-routes.json \\");
  lines.push("  --md docs/plans/benchmarks/start-routes.md");
  lines.push("");
  lines.push("# 2. Run read-only room-slice parity against immutable Next & Start Preview deployments");
  lines.push("node scripts/bench/start-route-parity.mjs \\");
  lines.push("  --scope room-slice \\");
  lines.push("  --control-deployment <next-dpl-id> --control-scope <vercel-scope> \\");
  lines.push("  --candidate-deployment <start-dpl-id> --candidate-scope <vercel-scope> \\");
  lines.push("  --strict --json output/start-routes-room.json --md output/start-routes-room.md");
  lines.push("");
  lines.push("# 3. Run full 32-page + 3-handler + special-route parity against Start Preview");
  lines.push("node scripts/bench/start-route-parity.mjs \\");
  lines.push("  --scope full \\");
  lines.push("  --control-input docs/plans/benchmarks/start-routes.json \\");
  lines.push("  --candidate-deployment <start-dpl-id> --candidate-scope <vercel-scope> \\");
  lines.push("  --strict --json docs/plans/benchmarks/start-routes.json --md docs/plans/benchmarks/start-routes.md");
  lines.push("");
  lines.push("# 4. Optional authenticated Clerk Playwright integration fixture (isolated local backend)");
  lines.push("export VITEST_MAX_WORKERS=2");
  lines.push("node scripts/heavy.mjs node scripts/local-integration.mjs -- \\");
  lines.push("  node scripts/bench/start-route-parity.mjs --scope full --control-url \"$E2E_BASE_URL\" --auth-fixture \\");
  lines.push("  --include-safe-post-validation --json output/start-routes-local-auth.json --md output/start-routes-local-auth.md");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
