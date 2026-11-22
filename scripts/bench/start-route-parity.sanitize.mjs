/**
 * Strict sanitization, HTTP response parsing, and JS-disabled HTML inspection
 * for the Phase 2 Next-vs-TanStack-Start route parity runner.
 *
 * Security boundary:
 * - Never retain hostnames, tokens, cookies, raw headers, scopes, local home paths, or PII.
 * - Explicit allowlists only; fail closed with SanitizationError if any leak pattern appears.
 */

export const ALLOWED_HEADERS = /** @type {const} */ ([
  "cache-control",
  "x-vercel-cache",
  "x-nextjs-cache",
  "vary",
  "content-language",
  "content-type",
  "referrer-policy",
  "x-robots-tag",
  "location",
  "link",
  "allow",
  "x-content-type-options",
]);

const ALLOWED_HEADER_SET = new Set(/** @type {readonly string[]} */ (ALLOWED_HEADERS));
const SAFE_PATH_RE = /^\/[a-zA-Z0-9._/~%-]*$/;
const SAFE_ADMIN_TABS = new Set([
  "business",
  "bookingRules",
  "checkoutRules",
  "ai",
  "email",
  "channels",
  "team",
]);
const DISALLOWED_IMAGE_SENTINEL = "https://disallowed.invalid/photo.jpg";
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "template"]);
const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
});

/**
 * Thrown when output sanitization detects a potential secret, host, cookie, or PII leak.
 */
export class SanitizationError extends Error {
  /**
   * @param {string[]} findings
   */
  constructor(findings) {
    super(`Sensitive data leak detected in route parity output: ${findings.join("; ")}`);
    this.name = "SanitizationError";
    this.findings = findings;
  }
}

/**
 * Decode common HTML character references safely.
 * @param {string} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (full, dec, hex, name) => {
    if (dec) {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    return name && Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : full;
  });
}

/**
 * Normalize whitespace and bound extracted markup snippets.
 * @param {string} value
 * @param {number} [maxLength]
 * @returns {string}
 */
function normalizeText(value, maxLength = 180) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Sanitize an image optimizer `url` query parameter.
 * Only permits safe local asset paths or the explicit synthetic disallowed-host sentinel.
 * @param {string} raw
 * @returns {string | null}
 */
function sanitizeImageQueryParam(raw) {
  if (raw === DISALLOWED_IMAGE_SENTINEL) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//") && SAFE_PATH_RE.test(raw)) return raw;
  return null;
}

/**
 * Retain a public path (and optionally allowlisted non-sensitive structural query params).
 * Never retains scheme, origin, credentials, fragments, or arbitrary query values.
 * @param {string | null | undefined} value
 * @param {{ preserveSafeQuery?: boolean }} [options]
 * @returns {string | null}
 */
export function sanitizePath(value, options = {}) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed, "https://placeholder.invalid");
  } catch {
    return "[redacted]";
  }
  const pathname = parsed.pathname || "/";
  if (!SAFE_PATH_RE.test(pathname)) return "[redacted]";
  if (!options.preserveSafeQuery || !parsed.search) return pathname;

  const safeParams = new URLSearchParams();
  for (const [key, paramValue] of parsed.searchParams.entries()) {
    if (key === "tour" && paramValue === "1") {
      safeParams.set("tour", "1");
    } else if ((key === "w" || key === "q") && /^\d{1,4}$/.test(paramValue)) {
      safeParams.set(key, paramValue);
    } else if (key === "url") {
      const safeImage = sanitizeImageQueryParam(paramValue);
      if (safeImage) safeParams.set("url", safeImage);
    } else if (key === "tab" && SAFE_ADMIN_TABS.has(paramValue)) {
      safeParams.set("tab", paramValue);
    }
  }
  const serialized = safeParams.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

/**
 * Parse and sanitize an HTTP Link header into alternate/canonical public paths only.
 * @param {string} value
 * @param {readonly string[]} locales
 * @returns {{ path: string | null, rel: "alternate" | "canonical", hreflang: string | null }[]}
 */
export function sanitizeLinkHeader(value, locales) {
  /** @type {{ path: string | null, rel: "alternate" | "canonical", hreflang: string | null }[]} */
  const links = [];
  const allowedLangs = new Set([...locales, "x-default"]);
  const linkRe = /<([^>]+)>([^,]*)/g;
  for (const match of value.matchAll(linkRe)) {
    const target = match[1] ?? "";
    const attrs = match[2] ?? "";
    const relMatch = /\brel="?([a-zA-Z-]+)"?/i.exec(attrs);
    const rel = relMatch?.[1]?.toLowerCase();
    if (rel !== "alternate" && rel !== "canonical") continue;
    const langMatch = /\bhreflang="?([a-zA-Z-]+)"?/i.exec(attrs);
    const hreflang = langMatch?.[1] && allowedLangs.has(langMatch[1]) ? langMatch[1] : null;
    links.push({
      path: sanitizePath(target, { preserveSafeQuery: false }),
      rel,
      hreflang,
    });
  }
  return links;
}

/**
 * Strip accidental origins, tokens, or credentials from a generic allowlisted header value.
 * @param {string} value
 * @returns {string}
 */
function sanitizeScalarHeader(value) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (/(?:https?:\/\/|bearer\s+|eyJ[A-Za-z0-9_-]{8,}|pk_(?:test|live)_|sk_(?:test|live)_)/i.test(cleaned)) {
    return "[redacted]";
  }
  return cleaned.slice(0, 300);
}

/**
 * Filter and sanitize HTTP headers against the explicit allowlist.
 * @param {Record<string, string | string[] | undefined> | Headers | [string, string][]} rawHeaders
 * @param {readonly string[]} locales
 * @returns {Record<string, string | { path: string | null, rel: "alternate" | "canonical", hreflang: string | null }[]>}
 */
export function sanitizeHeaders(rawHeaders, locales) {
  /** @type {Map<string, string[]>} */
  const collected = new Map();
  /** @param {string} key @param {string} val */
  const add = (key, val) => {
    const lower = key.toLowerCase();
    if (!ALLOWED_HEADER_SET.has(lower)) return;
    const trimmed = val.trim();
    if (!trimmed) return;
    const list = collected.get(lower) ?? [];
    list.push(trimmed);
    collected.set(lower, list);
  };

  if (Array.isArray(rawHeaders)) {
    for (const [key, val] of rawHeaders) add(key, val);
  } else if (typeof Headers !== "undefined" && rawHeaders instanceof Headers) {
    rawHeaders.forEach((val, key) => add(key, val));
  } else {
    for (const [key, val] of Object.entries(rawHeaders)) {
      if (Array.isArray(val)) {
        for (const item of val) add(key, item);
      } else if (typeof val === "string") {
        add(key, val);
      }
    }
  }

  /** @type {Record<string, string | { path: string | null, rel: "alternate" | "canonical", hreflang: string | null }[]>} */
  const observed = {};
  for (const name of ALLOWED_HEADERS) {
    const values = collected.get(name);
    if (!values || values.length === 0) continue;
    const joined = values.join(", ");
    if (name === "location") {
      const safe = sanitizePath(values[0], { preserveSafeQuery: false });
      if (safe) observed[name] = safe;
    } else if (name === "link") {
      const safe = sanitizeLinkHeader(joined, locales);
      if (safe.length > 0) observed[name] = safe;
    } else {
      const safe = sanitizeScalarHeader(joined);
      if (safe) observed[name] = safe;
    }
  }
  return observed;
}

/**
 * Parse raw HTTP wire output (as returned by `curl --include`), stripping any interim
 * 100-Continue or proxy CONNECT header blocks cleanly.
 * @param {Buffer} raw
 * @returns {{ statusCode: number, headers: [string, string][], body: Buffer }}
 */
export function parseHttpRawResponse(raw) {
  const startIdx = raw.indexOf(Buffer.from("HTTP/"));
  if (startIdx < 0) {
    throw new Error("Missing HTTP status line in raw response");
  }
  let slice = raw.subarray(startIdx);

  /** @param {Buffer} buf */
  const splitBlock = (buf) => {
    const crlf = buf.indexOf(Buffer.from("\r\n\r\n"));
    if (crlf >= 0) return { head: buf.subarray(0, crlf), rest: buf.subarray(crlf + 4) };
    const lf = buf.indexOf(Buffer.from("\n\n"));
    if (lf >= 0) return { head: buf.subarray(0, lf), rest: buf.subarray(lf + 2) };
    return { head: buf, rest: Buffer.alloc(0) };
  };

  let { head, rest } = splitBlock(slice);
  while (rest.subarray(0, 5).equals(Buffer.from("HTTP/"))) {
    ({ head, rest } = splitBlock(rest));
  }

  const lines = head.toString("latin1").split(/\r?\n/);
  const statusMatch = /^HTTP\/\S+\s+(\d{3})\b/.exec(lines[0] ?? "");
  if (!statusMatch) {
    throw new Error("Malformed HTTP status line");
  }
  const statusCode = Number.parseInt(statusMatch[1], 10);
  /** @type {[string, string][]} */
  const headers = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { statusCode, headers, body: rest };
}

/**
 * Parse HTML attributes from a tag opening substring.
 * @param {string} rawAttrs
 * @returns {Record<string, string>}
 */
function parseTagAttributes(rawAttrs) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of rawAttrs.matchAll(attrRe)) {
    const key = (match[1] ?? "").toLowerCase();
    if (!key) continue;
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = decodeHtmlEntities(rawValue);
  }
  return attrs;
}

/**
 * Determine whether an opening tag hides its subtree when JavaScript is disabled.
 * @param {Record<string, string>} attrs
 * @returns {boolean}
 */
function isElementHidden(attrs) {
  if (Object.hasOwn(attrs, "hidden")) return true;
  if (attrs["aria-hidden"] === "true") return true;
  const style = attrs.style ?? "";
  if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return true;
  const classes = (attrs.class ?? "").split(/\s+/);
  if (classes.includes("hidden")) return true;
  return false;
}

/**
 * @typedef {{
 *   lang: string | null,
 *   title: string | null,
 *   canonical: string | null,
 *   robots: string | null,
 *   hasDescription: boolean,
 *   hasOgImage: boolean,
 *   alternateLinks: { path: string | null, hreflang: string }[],
 *   headings: { level: "h1" | "h2", text: string, hiddenAncestor: boolean }[],
 *   loadingMarkup: { text: string, hiddenAncestor: boolean }[],
 *   visibleTextChars: number,
 *   hiddenTextChars: number,
 *   matchedExpectedMarkers: { marker: string, visible: boolean, hidden: boolean }[],
 *   matchedErrorMarkers: { marker: string, visible: boolean, hidden: boolean }[],
 *   matchedForbiddenMarkers: string[],
 *   anonymousAdminGate: boolean,
 *   jsDisabledSummary: "visible-content" | "suspense-fallback-with-hidden-content" | "shell-or-client-gated" | "error-page" | "empty",
 * }} HtmlInspection
 */

/**
 * Inspect raw SSR HTML without executing scripts or external stylesheets.
 * Distinguishes visible markup from hidden Suspense/template subtrees.
 * @param {string} html
 * @param {{
 *   status: number,
 *   locales: readonly string[],
 *   loadingStrings: readonly string[],
 *   expectedMarkers?: readonly string[],
 *   errorMarkers?: readonly string[],
 *   forbiddenMarkers?: readonly string[],
 *   captureHeadings?: boolean,
 *   captureLoadingMarkup?: boolean,
 *   isAdminPath?: boolean,
 * }} options
 * @returns {HtmlInspection}
 */
export function inspectHtmlDocument(html, options) {
  const allowedLangs = new Set([...options.locales, "x-default"]);
  const loadingSet = new Set(options.loadingStrings);
  const captureHeadings = options.captureHeadings ?? true;
  const captureLoading = options.captureLoadingMarkup ?? false;

  /** @type {{ tag: string, hidden: boolean, inBody: boolean, parts: string[] | null }[]} */
  const stack = [];
  /** @type {string[]} */
  const titles = [];
  /** @type {{ level: "h1" | "h2", text: string, hiddenAncestor: boolean }[]} */
  const headings = [];
  /** @type {{ text: string, hiddenAncestor: boolean }[]} */
  const loadingMarkup = [];
  /** @type {{ path: string | null, hreflang: string }[]} */
  const alternateLinks = [];
  /** @type {string[]} */
  const visibleBodyChunks = [];
  /** @type {string[]} */
  const hiddenBodyChunks = [];

  /** @type {string | null} */
  let lang = null;
  /** @type {string | null} */
  let canonical = null;
  /** @type {string | null} */
  let robots = null;
  let hasDescription = false;
  let hasOgImage = false;
  let rawTextTag = /** @type {string | null} */ (null);

  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)/g;

  for (const match of html.matchAll(tokenRe)) {
    const closingTag = match[1]?.toLowerCase();
    const openingTag = match[2]?.toLowerCase();
    const rawAttrs = match[3] ?? "";
    const selfClosing = match[4] === "/";
    const textChunk = match[5];

    if (rawTextTag) {
      if (closingTag === rawTextTag) {
        rawTextTag = null;
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i].tag === closingTag) {
            stack.splice(i);
            break;
          }
        }
      }
      continue;
    }

    if (openingTag) {
      const attrs = parseTagAttributes(rawAttrs);
      const parent = stack[stack.length - 1];
      const hidden = isElementHidden(attrs) || (parent?.hidden ?? false);
      const inBody = openingTag === "body" || (parent?.inBody ?? false);

      if (openingTag === "html" && attrs.lang) {
        lang = attrs.lang.trim();
      } else if (openingTag === "link") {
        const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("canonical") && attrs.href) {
          canonical = sanitizePath(attrs.href, { preserveSafeQuery: false });
        }
        if (rel.includes("alternate") && attrs.hreflang && allowedLangs.has(attrs.hreflang) && attrs.href) {
          alternateLinks.push({
            path: sanitizePath(attrs.href, { preserveSafeQuery: false }),
            hreflang: attrs.hreflang,
          });
        }
      } else if (openingTag === "meta") {
        const name = (attrs.name ?? "").toLowerCase();
        const property = (attrs.property ?? "").toLowerCase();
        const content = (attrs.content ?? "").trim();
        if (name === "robots" && content) robots = content;
        if (name === "description" && content) hasDescription = true;
        if (property === "og:image" && content) hasOgImage = true;
      }

      const classes = (attrs.class ?? "").split(/\s+/);
      const trackParts =
        openingTag === "title" ||
        (captureHeadings && (openingTag === "h1" || openingTag === "h2")) ||
        (captureLoading && openingTag === "div" && classes.includes("min-h-screen"));

      if (!selfClosing && !VOID_TAGS.has(openingTag)) {
        stack.push({ tag: openingTag, hidden, inBody, parts: trackParts ? [] : null });
        if (RAW_TEXT_TAGS.has(openingTag)) {
          rawTextTag = openingTag;
        }
      }
      continue;
    }

    if (closingTag) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const frame = stack[i];
        if (frame.tag !== closingTag) continue;
        stack.splice(i);
        if (frame.parts !== null) {
          const text = normalizeText(frame.parts.join(""));
          if (closingTag === "title" && text) {
            titles.push(text);
          } else if ((closingTag === "h1" || closingTag === "h2") && text && headings.length < 12) {
            // Keep heading records non-identifying on admin pages; public headings are resort/villa titles.
            if (!options.isAdminPath || text === "Admin" || text === "Clerk is required for admin") {
              headings.push({ level: closingTag, text, hiddenAncestor: frame.hidden });
            }
          } else if (closingTag === "div" && loadingSet.has(text)) {
            loadingMarkup.push({ text, hiddenAncestor: frame.hidden });
          }
        }
        break;
      }
      continue;
    }

    if (textChunk) {
      const top = stack[stack.length - 1];
      if (!top || RAW_TEXT_TAGS.has(top.tag)) continue;
      for (const frame of stack) {
        if (frame.parts !== null) frame.parts.push(textChunk);
      }
      if (top.inBody) {
        const cleaned = decodeHtmlEntities(textChunk).replace(/\s+/g, " ").trim();
        if (cleaned) {
          if (top.hidden) hiddenBodyChunks.push(cleaned);
          else visibleBodyChunks.push(cleaned);
        }
      }
    }
  }

  const visibleBodyText = visibleBodyChunks.join(" ");
  const hiddenBodyText = hiddenBodyChunks.join(" ");
  const title = titles[0] ?? null;
  const visibleLower = visibleBodyText.toLowerCase();
  const hiddenLower = hiddenBodyText.toLowerCase();
  const rawLower = html.toLowerCase();

  /** @param {readonly string[] | undefined} list */
  const matchMarkers = (list) =>
    (list ?? []).map((marker) => {
      const needle = marker.toLowerCase();
      return {
        marker,
        visible: visibleLower.includes(needle),
        hidden: hiddenLower.includes(needle),
      };
    });

  const matchedExpectedMarkers = matchMarkers(options.expectedMarkers);
  const matchedErrorMarkers = matchMarkers(options.errorMarkers);
  const matchedForbiddenMarkers = (options.forbiddenMarkers ?? []).filter((marker) => {
    const needle = marker.toLowerCase();
    return visibleLower.includes(needle) || hiddenLower.includes(needle) || rawLower.includes(needle);
  });

  const visibleH1s = headings.filter((h) => h.level === "h1" && !h.hiddenAncestor);
  const hiddenH1s = headings.filter((h) => h.level === "h1" && h.hiddenAncestor);
  const visibleLoading = loadingMarkup.some((m) => !m.hiddenAncestor);
  const anonymousAdminGate = Boolean(
    options.isAdminPath && visibleH1s.some((h) => h.text === "Admin"),
  );

  /** @type {HtmlInspection["jsDisabledSummary"]} */
  let jsDisabledSummary;
  if (options.status >= 400) {
    jsDisabledSummary = "error-page";
  } else if (visibleLoading && hiddenH1s.length > 0 && visibleH1s.length === 0) {
    jsDisabledSummary = "suspense-fallback-with-hidden-content";
  } else if (visibleH1s.length > 0 || matchedExpectedMarkers.some((m) => m.visible)) {
    jsDisabledSummary = "visible-content";
  } else if (visibleBodyText.length === 0 && hiddenBodyText.length === 0) {
    jsDisabledSummary = "empty";
  } else {
    jsDisabledSummary = "shell-or-client-gated";
  }

  return {
    lang,
    title,
    canonical,
    robots,
    hasDescription,
    hasOgImage,
    alternateLinks,
    headings,
    loadingMarkup,
    visibleTextChars: visibleBodyText.length,
    hiddenTextChars: hiddenBodyText.length,
    matchedExpectedMarkers,
    matchedErrorMarkers,
    matchedForbiddenMarkers,
    anonymousAdminGate,
    jsDisabledSummary,
  };
}

/**
 * Parse `/robots.txt` into sanitized `[directive, value]` pairs.
 * @param {string} body
 * @returns {[string, string][]}
 */
export function parseRobotsTxt(body) {
  /** @type {[string, string][]} */
  const directives = [];
  for (const line of body.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (name === "User-Agent" || name === "User-agent") {
      directives.push(["User-Agent", rawValue]);
    } else if (name === "Allow" || name === "Disallow") {
      directives.push([name, rawValue]);
    } else if (name === "Sitemap") {
      directives.push(["Sitemap", sanitizePath(rawValue, { preserveSafeQuery: false }) ?? "[redacted]"]);
    }
  }
  return directives;
}

/**
 * Parse `/sitemap.xml` into sanitized structural stats (never retaining full host URLs).
 * Throws if XML does not contain a valid `<urlset>` structure.
 * @param {string} body
 * @param {readonly string[]} locales
 * @returns {{ entries: number, localizedPrefixes: string[], poolVilla: boolean, privacy: boolean, terms: boolean, disallowedLeaks: string[] }}
 */
export function parseSitemapXml(body, locales) {
  if (!/<urlset\b[^>]*>/i.test(body) || !/<\/urlset>/i.test(body)) {
    throw new Error("Invalid sitemap XML: missing <urlset> root element");
  }
  /** @type {string[]} */
  const paths = [];
  const locRe = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  for (const match of body.matchAll(locRe)) {
    const cleaned = sanitizePath(decodeHtmlEntities(match[1] ?? ""), { preserveSafeQuery: false });
    if (cleaned && cleaned !== "[redacted]") paths.push(cleaned);
  }
  const nonDefaultLocales = locales.filter((loc) => loc !== "en");
  const localizedPrefixes = nonDefaultLocales.filter((lang) =>
    paths.some((p) => p === `/${lang}` || p.startsWith(`/${lang}/`)),
  );
  const disallowedPrefixes = ["/admin", "/api", "/display", "/sign-in", "/sign-up", "/dev/"];
  const disallowedLeaks = disallowedPrefixes.filter((prefix) =>
    paths.some((p) => p === prefix || p.startsWith(`${prefix}/`)),
  );
  return {
    entries: paths.length,
    localizedPrefixes,
    poolVilla: paths.includes("/rooms/pool-villa"),
    privacy: paths.includes("/privacy"),
    terms: paths.includes("/terms"),
    disallowedLeaks,
  };
}

const SENSITIVE_PATTERNS = /** @type {const} */ ([
  { label: "vercel-host", re: /[a-z0-9-]+\.vercel\.app\b/i },
  { label: "convex-host", re: /[a-z0-9-]+\.convex\.(?:cloud|site)\b/i },
  { label: "clerk-key", re: /\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]{8,}\b/ },
  { label: "jwt-token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: "bearer-header", re: /\bBearer\s+[A-Za-z0-9._-]{12,}/i },
  { label: "cookie-header", re: /\b(?:set-cookie|__clerk_db_jwt|x-vercel-protection-bypass)\b/i },
  { label: "email-address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { label: "local-user-path", re: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
]);

/**
 * Scan serialized output for accidental leaks of hosts, tokens, cookies, emails, or caller secrets.
 * Throws SanitizationError if any sensitive token is detected.
 * @param {string} serialized
 * @param {readonly (string | null | undefined)[]} [extraSecrets]
 */
export function assertNoSensitiveLeaks(serialized, extraSecrets = []) {
  /** @type {string[]} */
  const findings = [];
  for (const { label, re } of SENSITIVE_PATTERNS) {
    if (re.test(serialized)) findings.push(label);
  }
  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.trim().length >= 4 && serialized.includes(secret.trim())) {
      findings.push("caller-secret");
    }
  }
  if (findings.length > 0) {
    throw new SanitizationError([...new Set(findings)]);
  }
}
