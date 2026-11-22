import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  assertManifestCoversAppTree,
  buildManifest,
  EXPECTED_HANDLER_COUNT,
  EXPECTED_PAGE_COUNT,
  loadLocalizedStrings,
  LOCALES,
  ROBOTS_EXPECTED_DIRECTIVES,
  SEPARATE_PERF_EVIDENCE,
  STATE_CHANGING_CONTRACTS,
} from "../../scripts/bench/start-route-parity.manifest.mjs";
import {
  assertNoSensitiveLeaks,
  inspectHtmlDocument,
  parseHttpRawResponse,
  parseRobotsTxt,
  parseSitemapXml,
  SanitizationError,
  sanitizeHeaders,
  sanitizeLinkHeader,
  sanitizePath,
} from "../../scripts/bench/start-route-parity.sanitize.mjs";
import {
  isLoopbackUrl,
  runAuthenticatedFixture,
  validateAuthFixturePrereqs,
} from "../../scripts/bench/start-route-parity.auth.mjs";
import {
  buildParityReport,
  evaluateRouteObservation,
  normalizeCaptureInput,
  renderMarkdownReport,
} from "../../scripts/bench/start-route-parity.report.mjs";
import { buildObservationFromHttp, collectTarget } from "../../scripts/bench/start-route-parity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts/bench/start-route-parity.mjs");

function localeLinkHeader(basePath: string): string {
  const entries = LOCALES.map((loc) => {
    const p = loc === "en" ? basePath : `/${loc}${basePath === "/" ? "" : basePath}`;
    return `<https://preview-secret.vercel.app${p}>; rel="alternate"; hreflang="${loc}"`;
  });
  entries.push(`<https://preview-secret.vercel.app${basePath}>; rel="alternate"; hreflang="x-default"`);
  return entries.join(", ");
}

describe("start-route-parity manifest", () => {
  it("covers all 32 tracked page.tsx files and 3 route.ts handlers 1:1 with zero duplicates", () => {
    const manifest = buildManifest({ targetKind: "next", scope: "full", rootDir: ROOT });
    expect(() => assertManifestCoversAppTree(ROOT, manifest)).not.toThrow();
    expect(manifest.filter((r) => r.kind === "page")).toHaveLength(EXPECTED_PAGE_COUNT);
    expect(new Set(manifest.filter((r) => r.kind === "handler").map((r) => r.source)).size).toBe(
      EXPECTED_HANDLER_COUNT,
    );
    expect(manifest.some((r) => r.id === "special:robots")).toBe(true);
    expect(manifest.some((r) => r.id === "special:sitemap")).toBe(true);
    expect(manifest.some((r) => r.id === "special:legacy-redirect")).toBe(true);
    expect(manifest.some((r) => r.id === "special:static-headers")).toBe(true);
    expect(manifest.some((r) => r.id === "special:image-local")).toBe(true);
    expect(manifest.some((r) => r.id === "special:image-disallowed-host")).toBe(true);
    expect(manifest.some((r) => r.id === "special:unknown-locale-room")).toBe(true);
    expect(manifest.some((r) => r.id === "special:unknown-locale-services")).toBe(true);
    expect(manifest.some((r) => r.id === "special:admin-section-unknown")).toBe(true);
  });

  it("throws when a tracked page or handler is omitted from the manifest", () => {
    const manifest = buildManifest({ targetKind: "next", scope: "full", rootDir: ROOT });
    const missingPage = manifest.filter((r) => r.id !== "page:display");
    expect(() => assertManifestCoversAppTree(ROOT, missingPage)).toThrow(/page\.tsx coverage mismatch/);
    const missingHandler = manifest.filter((r) => r.source !== "src/app/api/messaging/image/route.ts");
    expect(() => assertManifestCoversAppTree(ROOT, missingHandler)).toThrow(/route\.ts coverage mismatch/);
  });

  it("maps image optimizer routes cleanly between Next and Start while preserving row IDs", () => {
    const nextRoom = buildManifest({ targetKind: "next", scope: "room-slice", rootDir: ROOT });
    const startRoom = buildManifest({ targetKind: "start", scope: "room-slice", rootDir: ROOT });
    expect(nextRoom.map((r) => r.id)).toEqual(startRoom.map((r) => r.id));
    expect(nextRoom.find((r) => r.id === "special:image-local")?.path).toContain("/_next/image?");
    expect(startRoom.find((r) => r.id === "special:image-local")?.path).toContain("/_vercel/image?");
    expect(startRoom.find((r) => r.id === "special:image-disallowed-host")?.path).toContain("/_vercel/image?");
  });
});

describe("start-route-parity sanitization and HTML inspection", () => {
  it("strips hosts, tokens, cookies, raw headers, and sensitive query parameters", () => {
    expect(sanitizePath("https://secret-123.vercel.app/rooms/pool-villa?tour=1&token=abc&email=a@b.com", { preserveSafeQuery: true })).toBe(
      "/rooms/pool-villa?tour=1",
    );
    expect(sanitizePath("https://secret-123.vercel.app/admin/chats?redirect_url=https://evil.test", { preserveSafeQuery: false })).toBe(
      "/admin/chats",
    );
    expect(
      sanitizePath("/_vercel/image?url=https%3A%2F%2Fsecret.convex.cloud%2Fimg.jpg&w=640&q=75", {
        preserveSafeQuery: true,
      }),
    ).toBe("/_vercel/image?w=640&q=75");
    expect(
      sanitizePath("/_vercel/image?url=https%3A%2F%2Fdisallowed.invalid%2Fphoto.jpg&w=640&q=75", {
        preserveSafeQuery: true,
      }),
    ).toBe("/_vercel/image?url=https%3A%2F%2Fdisallowed.invalid%2Fphoto.jpg&w=640&q=75");

    const sanitized = sanitizeHeaders(
      [
        ["set-cookie", "__session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig; HttpOnly"],
        ["authorization", "Bearer super-secret-token"],
        ["x-vercel-id", "sin1::abc123"],
        ["x-clerk-auth-reason", "session-token"],
        ["location", "https://secret-123.vercel.app/admin/chats?code=12345"],
        ["cache-control", "private, no-store"],
        ["referrer-policy", "no-referrer"],
        ["link", localeLinkHeader("/rooms/pool-villa")],
      ],
      LOCALES,
    );

    expect(Object.keys(sanitized).sort()).toEqual(["cache-control", "link", "location", "referrer-policy"]);
    expect(sanitized.location).toBe("/admin/chats");
    expect(JSON.stringify(sanitized)).not.toContain("vercel.app");
    expect(JSON.stringify(sanitized)).not.toContain("super-secret");
    expect(sanitizeLinkHeader('<https://a.vercel.app/th>; rel="alternate"; hreflang="th"', LOCALES)).toEqual([
      { path: "/th", rel: "alternate", hreflang: "th" },
    ]);
  });

  it("throws SanitizationError if serialized output leaks hosts, tokens, emails, or caller secrets", () => {
    expect(() => assertNoSensitiveLeaks('{"path":"/rooms/pool-villa"}')).not.toThrow();
    expect(() => assertNoSensitiveLeaks("https://my-preview.vercel.app/rooms")).toThrow(SanitizationError);
    expect(() => assertNoSensitiveLeaks("pk_test_abcdefgh12345678")).toThrow(SanitizationError);
    expect(() => assertNoSensitiveLeaks("user@example.com")).toThrow(SanitizationError);
    expect(() => assertNoSensitiveLeaks("/Users/alice/dev/repo")).toThrow(SanitizationError);
    expect(() => assertNoSensitiveLeaks("scope-team-secret", ["scope-team-secret"])).toThrow(SanitizationError);
  });

  it("parses raw HTTP responses including interim 100-Continue blocks", () => {
    const raw = Buffer.from(
      "HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200 \r\nContent-Type: text/html; charset=utf-8\r\nX-Vercel-Cache: HIT\r\n\r\n<html lang=\"en\"><head><title>Hi</title></head><body><h1>Hello</h1></body></html>",
    );
    const parsed = parseHttpRawResponse(raw);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.headers).toContainEqual(["x-vercel-cache", "HIT"]);
    expect(parsed.body.toString("utf8")).toContain("<h1>Hello</h1>");
  });

  it("distinguishes JS-disabled visible loading fallback from hidden Suspense room heading", () => {
    const strings = loadLocalizedStrings(ROOT);
    const nextRoomHtml = `<!doctype html>
      <html lang="en">
        <head>
          <title>Tideglass Pool Residence &mdash; Auralis Cove Retreat</title>
          <meta name="description" content="Pool residence" />
          <meta property="og:image" content="https://secret.convex.cloud/pic.webp" />
        </head>
        <body>
          <div class="min-h-screen px-5 py-24">Loading villa...</div>
          <div hidden id="S:0"><main><h1>Tideglass Pool Residence</h1><p>Private infinity pool</p></main></div>
          <script>window.__DATA__ = "ignore script text";</script>
        </body>
      </html>`;

    const nextInspected = inspectHtmlDocument(nextRoomHtml, {
      status: 200,
      locales: LOCALES,
      loadingStrings: strings.loadingStrings,
      expectedMarkers: ["Tideglass Pool Residence"],
      forbiddenMarkers: ["Application error: a server-side exception"],
      captureLoadingMarkup: true,
    });
    expect(nextInspected.lang).toBe("en");
    expect(nextInspected.title).toBe("Tideglass Pool Residence — Auralis Cove Retreat");
    expect(nextInspected.hasDescription).toBe(true);
    expect(nextInspected.hasOgImage).toBe(true);
    expect(nextInspected.headings).toEqual([
      { level: "h1", text: "Tideglass Pool Residence", hiddenAncestor: true },
    ]);
    expect(nextInspected.loadingMarkup).toEqual([{ text: "Loading villa...", hiddenAncestor: false }]);
    expect(nextInspected.jsDisabledSummary).toBe("suspense-fallback-with-hidden-content");
    expect(nextInspected.matchedExpectedMarkers).toEqual([
      { marker: "Tideglass Pool Residence", visible: false, hidden: true },
    ]);

    const startRoomHtml = `<!doctype html>
      <html lang="en">
        <head><title>Tideglass Pool Residence &mdash; Auralis Cove Retreat</title></head>
        <body><main><h1>Tideglass Pool Residence</h1><p>Private infinity pool</p></main></body>
      </html>`;
    const startInspected = inspectHtmlDocument(startRoomHtml, {
      status: 200,
      locales: LOCALES,
      loadingStrings: strings.loadingStrings,
      expectedMarkers: ["Tideglass Pool Residence"],
      captureLoadingMarkup: true,
    });
    expect(startInspected.headings).toEqual([
      { level: "h1", text: "Tideglass Pool Residence", hiddenAncestor: false },
    ]);
    expect(startInspected.loadingMarkup).toEqual([]);
    expect(startInspected.jsDisabledSummary).toBe("visible-content");
  });

  it("parses robots.txt and sitemap.xml strictly and flags malformed XML or disallowed leaks", () => {
    const robotsText = ROBOTS_EXPECTED_DIRECTIVES.map(([k, v]) =>
      k === "Sitemap" ? `${k}: https://preview.vercel.app${v}` : `${k}: ${v}`,
    ).join("\n");
    expect(parseRobotsTxt(robotsText)).toEqual([...ROBOTS_EXPECTED_DIRECTIVES]);

    const badSitemap = "<html><body>Not XML</body></html>";
    expect(() => parseSitemapXml(badSitemap, LOCALES)).toThrow(/Invalid sitemap XML/);

    const leakySitemap = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://site.example/rooms/pool-villa</loc></url>
      <url><loc>https://site.example/admin/chats</loc></url>
    </urlset>`;
    const parsed = parseSitemapXml(leakySitemap, LOCALES);
    expect(parsed.disallowedLeaks).toEqual(["/admin"]);
  });
});

describe("start-route-parity strict contract evaluation (no generic 200 passes)", () => {
  const manifest = buildManifest({ targetKind: "next", scope: "full", rootDir: ROOT });
  const strings = loadLocalizedStrings(ROOT);

  it("fails a bare 200 on /rooms/pool-villa?tour=1 when room title/heading are missing", () => {
    const spec = manifest.find((r) => r.id === "page:rooms-id")!;
    const obs = buildObservationFromHttp(
      spec,
      {
        status: 200,
        rawHeaders: [["content-type", "text/html; charset=utf-8"]],
        body: Buffer.from('<html lang="en"><head><title>Generic 200</title></head><body><p>Empty shell</p></body></html>'),
        ttfbMs: 120,
      },
      { loadingStrings: strings.loadingStrings },
    );
    const evaluated = evaluateRouteObservation(spec, obs);
    expect(evaluated.verdict).toBe("fail");
    expect(evaluated.checks.some((c) => c.name === "html-title" && !c.pass)).toBe(true);
    expect(evaluated.checks.some((c) => c.name === "room-html-content" && !c.pass)).toBe(true);
    expect(evaluated.checks.some((c) => c.name === "locale-alternates" && !c.pass)).toBe(true);
  });

  it("fails /display if Referrer-Policy, no-store, X-Robots-Tag, or robots meta are missing", () => {
    const spec = manifest.find((r) => r.id === "page:display")!;
    const obs = buildObservationFromHttp(
      spec,
      {
        status: 200,
        rawHeaders: [["content-type", "text/html; charset=utf-8"]],
        body: Buffer.from('<html lang="en"><head><title>Customer display</title></head><body>Ready</body></html>'),
        ttfbMs: 80,
      },
      { loadingStrings: strings.loadingStrings },
    );
    const evaluated = evaluateRouteObservation(spec, obs);
    expect(evaluated.verdict).toBe("fail");
    expect(evaluated.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(
      expect.arrayContaining(["referrer-policy", "cache-control", "x-robots-tag", "html-robots"]),
    );
  });

  it("fails anonymous /admin/chats if staff-only content leaks into SSR HTML", () => {
    const spec = manifest.find((r) => r.id === "page:admin-chats")!;
    const obs = buildObservationFromHttp(
      spec,
      {
        status: 200,
        rawHeaders: [
          ["content-type", "text/html; charset=utf-8"],
          ["cache-control", "private, no-store"],
        ],
        body: Buffer.from(
          '<html lang="en"><head><title>Auralis Cove Retreat</title></head><body><div>Checkout rules leaked</div></body></html>',
        ),
        ttfbMs: 90,
      },
      { loadingStrings: strings.loadingStrings },
    );
    const evaluated = evaluateRouteObservation(spec, obs);
    expect(evaluated.verdict).toBe("fail");
    expect(evaluated.checks.some((c) => c.name === "anonymous-admin-no-leak" && !c.pass)).toBe(true);
  });

  it("matches actual Next 404 contracts: unmatched routes accept X-Robots-Tag noindex without meta robots, while dynamic notFound routes still require meta robots", () => {
    const unmatchedIds = [
      "special:unknown-locale-room",
      "special:unknown-locale-services",
      "special:marketing-unknown-slug",
    ];
    for (const id of unmatchedIds) {
      const spec = manifest.find((r) => r.id === id)!;
      // Actual Next.js RootLayout unmatched 404: X-Robots-Tag: noindex, no <meta name="robots">, visible 404 heading
      const nextLike = buildObservationFromHttp(
        spec,
        {
          status: 404,
          rawHeaders: [
            ["content-type", "text/html; charset=utf-8"],
            ["x-robots-tag", "noindex"],
          ],
          body: Buffer.from(
            '<html lang="en"><head><title>404: This page could not be found.</title></head><body><h1>404</h1><h2>This page could not be found.</h2></body></html>',
          ),
          ttfbMs: 620,
        },
        { loadingStrings: strings.loadingStrings },
      );
      const okEval = evaluateRouteObservation(spec, nextLike);
      expect(okEval.verdict).toBe("pass");
      expect(okEval.checks.some((c) => c.name === "noindex-signal" && c.pass)).toBe(true);

      // Missing BOTH X-Robots-Tag and meta robots must still fail
      const noNoindex = buildObservationFromHttp(
        spec,
        {
          status: 404,
          rawHeaders: [["content-type", "text/html; charset=utf-8"]],
          body: Buffer.from(
            '<html lang="en"><head><title>404: This page could not be found.</title></head><body><h1>404</h1><h2>This page could not be found.</h2></body></html>',
          ),
          ttfbMs: 620,
        },
        { loadingStrings: strings.loadingStrings },
      );
      const failEval = evaluateRouteObservation(spec, noNoindex);
      expect(failEval.verdict).toBe("fail");
      expect(failEval.checks.some((c) => c.name === "noindex-signal" && !c.pass)).toBe(true);
    }

    // Dynamic notFound() routes (localized room 404 EN/TH + dev/checkout-preview) MUST preserve strict <meta name="robots" content="noindex">
    for (const [id, title] of [
      ["special:room-not-found-en", strings.byLocale.en.rootTitle],
      ["special:room-not-found-th", strings.byLocale.th.rootTitle],
      ["page:dev-checkout-preview", strings.byLocale.en.rootTitle],
    ] as const) {
      const spec = manifest.find((r) => r.id === id)!;
      const missingMetaRobots = buildObservationFromHttp(
        spec,
        {
          status: 404,
          rawHeaders: [
            ["content-type", "text/html; charset=utf-8"],
            ["x-robots-tag", "noindex"],
          ],
          body: Buffer.from(`<html><head><title>${title}</title></head><body>404 Not found</body></html>`),
          ttfbMs: 600,
        },
        { loadingStrings: strings.loadingStrings },
      );
      const evaluated = evaluateRouteObservation(spec, missingMetaRobots);
      expect(evaluated.verdict).toBe("fail");
      expect(evaluated.checks.some((c) => c.name === "html-robots" && !c.pass)).toBe(true);
    }
  });

  it("fails transport exceptions instead of swallowing them as pass", async () => {
    const roomSlice = buildManifest({ targetKind: "next", scope: "room-slice", rootDir: ROOT });
    const capture = await collectTarget({
      manifest: roomSlice,
      targetKind: "next",
      rootDir: ROOT,
      baseUrl: "http://127.0.0.1:1",
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED https://internal.secret.vercel.app");
      }) as unknown as typeof fetch,
    });
    const report = buildParityReport({
      scope: "room-slice",
      manifest: roomSlice,
      control: capture,
      candidate: null,
    });
    expect(report.overallVerdict).toBe("fail");
    expect(report.summary.control.fail).toBe(roomSlice.length);
    expect(report.summary.control.pass).toBe(0);
    expect(JSON.stringify(report)).not.toContain("secret.vercel.app");
  });

  it("marks uncollected rows as unavailable rather than pass when importing reference JSON", () => {
    const legacyFixture = {
      deployment: "dpl_test123",
      sourceCommit: "c70af789",
      sourceTree: "ee1d5cfd16fe36283fba76ff7cdc13024ac08a58",
      collectedAt: "2026-11-21T17:37:05Z",
      caveats: ["Reference fixture"],
      routes: [
        {
          kind: "page",
          method: "GET",
          path: "/rooms/pool-villa?tour=1",
          source: "src/app/[locale]/rooms/[id]/page.tsx",
          status: 200,
          ttfbMs: 693.4,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-vercel-cache": "MISS",
            link: [
              ...LOCALES.map((loc) => ({
                path: loc === "en" ? "/rooms/pool-villa" : `/${loc}/rooms/pool-villa`,
                rel: "alternate",
                hreflang: loc,
              })),
              { path: "/rooms/pool-villa", rel: "alternate", hreflang: "x-default" },
            ],
          },
          html: {
            lang: "en",
            title: "Tideglass Pool Residence — Auralis Cove Retreat",
            canonical: null,
            robots: null,
            headings: [{ text: "Tideglass Pool Residence", hiddenAncestor: true }],
            loadingMarkup: [{ text: "Loading villa...", hiddenAncestor: false }],
          },
        },
      ],
    };
    const roomSlice = buildManifest({ targetKind: "next", scope: "room-slice", rootDir: ROOT });
    const normalized = normalizeCaptureInput(legacyFixture, roomSlice, "next");
    const report = buildParityReport({
      scope: "room-slice",
      manifest: roomSlice,
      control: normalized,
      candidate: null,
    });
    expect(report.overallVerdict).toBe("pending-candidate");
    expect(report.summary.control.pass).toBe(1);
    expect(report.summary.control.unavailable).toBe(roomSlice.length - 1);
    expect(report.separatePerfReport).toEqual(SEPARATE_PERF_EVIDENCE);
    expect(report.stateChangingContracts).toEqual(STATE_CHANGING_CONTRACTS);
  });
});

describe("start-route-parity optional Clerk Playwright authenticated fixture", () => {
  it("refuses production Clerk keys and reports honest unavailable when test env is missing", async () => {
    expect(isLoopbackUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackUrl("https://preview.vercel.app")).toBe(false);

    const liveKeyCheck = validateAuthFixturePrereqs(
      { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_123", CLERK_SECRET_KEY: "sk_live_456" },
      "http://127.0.0.1:3000",
    );
    expect(liveKeyCheck.ok).toBe(false);

    const missingEnv = await runAuthenticatedFixture({ baseUrl: "http://127.0.0.1:3000", env: {} });
    expect(missingEnv.status).toBe("unavailable");
    expect(missingEnv.checks).toEqual([]);

    const nonLoopbackPost = await runAuthenticatedFixture({
      baseUrl: "https://example.invalid",
      env: {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_1234567890",
        CLERK_SECRET_KEY: "sk_test_1234567890",
        E2E_OWNER_EMAIL: "owner@example.com",
        E2E_CASHIER_EMAIL: "cashier@example.com",
        E2E_NONSTAFF_EMAIL: "nonstaff@example.com",
      },
      includeSafePostValidation: true,
    });
    expect(nonLoopbackPost.status).toBe("fail");
  });

  it("runs all 4 roles cleanly with injected Playwright/Clerk harness, closes browser, and leaks zero secrets", async () => {
    const closeBrowser = vi.fn(async () => undefined);
    const closeContext = vi.fn(async () => undefined);
    const signOut = vi.fn(async () => undefined);
    let currentRole = "anonymous";

    const makePage = (jsEnabled: boolean) => {
      let currentUrl = "http://127.0.0.1:3000/";
      return {
        goto: vi.fn(async (routePath: string) => {
          if (currentRole === "cashier" && routePath === "/admin/settings") {
            currentUrl = "http://127.0.0.1:3000/admin/checkout";
          } else {
            currentUrl = `http://127.0.0.1:3000${routePath}`;
          }
          return { status: () => 200 };
        }),
        url: () => currentUrl,
        waitForURL: vi.fn(async () => undefined),
        title: vi.fn(async () => "Tideglass Pool Residence — Auralis Cove Retreat"),
        evaluate: vi.fn(async () => `eyJhbGciOiJSUzI1NiJ9.${currentRole}Payload1234567890.signature1234567890`),
        getByRole: vi.fn((role: string, opts?: { name?: string }) => ({
          waitFor: vi.fn(async () => undefined),
          isVisible: vi.fn(async () => true),
          count: vi.fn(async () => (role === "link" && opts?.name === "Settings" ? 0 : 1)),
        })),
        locator: vi.fn((selector: string) => ({
          innerText: vi.fn(async () =>
            currentUrl.includes("/rooms/") ? (jsEnabled ? "Tideglass Pool Residence" : "Loading villa...") : "Sign in",
          ),
          count: vi.fn(async () => (selector === "h1:visible" ? 0 : 1)),
        })),
      };
    };

    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_1234567890abcdef",
      CLERK_SECRET_KEY: "sk_test_1234567890abcdef",
      E2E_OWNER_EMAIL: "arch-e2e-owner-123@example.com",
      E2E_CASHIER_EMAIL: "arch-e2e-cashier-123@example.com",
      E2E_NONSTAFF_EMAIL: "arch-e2e-nonstaff-123@example.com",
    };

    const report = await runAuthenticatedFixture(
      { baseUrl: "http://127.0.0.1:3000", env, includeSafePostValidation: true },
      {
        loadPlaywright: async () => ({
          chromium: {
            launch: async () => ({
              newContext: async ({ javaScriptEnabled }: { javaScriptEnabled: boolean }) => ({
                addInitScript: async () => undefined,
                newPage: async () => makePage(javaScriptEnabled),
                close: closeContext,
              }),
              close: closeBrowser,
            }),
          },
        }),
        loadClerkTesting: async () => ({
          clerkSetup: async () => undefined,
          clerk: {
            signIn: async ({ emailAddress }: { emailAddress: string }) => {
              currentRole = emailAddress.includes("owner")
                ? "owner"
                : emailAddress.includes("cashier")
                  ? "cashier"
                  : "nonstaff";
            },
            signOut,
          },
        }),
        fetchImpl: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
          if (url.endsWith("/api/admin/chat/reply") && init?.method === "POST") {
            return auth ? new Response('{"error":"Invalid"}', { status: 400 }) : new Response('{"error":"Auth"}', { status: 401 });
          }
          if (!auth) return new Response('{"error":"Admin sign-in is required"}', { status: 401 });
          if (auth.includes("owner")) {
            return new Response(JSON.stringify({ channels: { line: false, whatsapp: false } }), {
              status: 200,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            });
          }
          return new Response('{"error":"Not authorized"}', { status: 403 });
        }) as unknown as typeof fetch,
      },
    );

    expect(report.status).toBe("pass");
    expect(report.summary.fail).toBe(0);
    expect(report.summary.pass).toBe(14);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(3);

    const serialized = JSON.stringify(report);
    expect(() =>
      assertNoSensitiveLeaks(serialized, [
        env.E2E_OWNER_EMAIL,
        env.E2E_CASHIER_EMAIL,
        env.E2E_NONSTAFF_EMAIL,
        env.CLERK_SECRET_KEY,
        env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      ]),
    ).not.toThrow();
  });
});

describe("start-route-parity end-to-end CLI paired comparison", () => {
  it("compares room-slice Next control vs Start candidate over loopback HTTP and reports JS-disabled improvement", async () => {
    const strings = loadLocalizedStrings(ROOT);
    const makeServer = (mode: "next" | "start", breakUnknownLocale = false) =>
      createServer((req, res) => {
        const reqUrl = req.url ?? "/";
        if (reqUrl === "/rooms/pool-villa?tour=1") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "x-vercel-cache": "MISS",
            link: localeLinkHeader("/rooms/pool-villa"),
          });
          res.end(
            mode === "next"
              ? `<html lang="en"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><div class="min-h-screen">${strings.byLocale.en.loadingVilla}</div><div hidden><h1>Tideglass Pool Residence</h1></div></body></html>`
              : `<html lang="en"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><main><h1>Tideglass Pool Residence</h1></main></body></html>`,
          );
          return;
        }
        if (reqUrl === "/th/rooms/pool-villa?tour=1") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            link: localeLinkHeader("/rooms/pool-villa"),
          });
          res.end(
            mode === "next"
              ? `<html lang="th"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><div class="min-h-screen">${strings.byLocale.th.loadingVilla}</div><div hidden><h1>Tideglass Pool Residence</h1></div></body></html>`
              : `<html lang="th"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><main><h1>Tideglass Pool Residence</h1></main></body></html>`,
          );
          return;
        }
        if (reqUrl === "/en/rooms/pool-villa?tour=1") {
          res.writeHead(307, { location: "/rooms/pool-villa" });
          res.end();
          return;
        }
        if (reqUrl === "/garden-image.jpg") {
          res.writeHead(308, { location: "/garden-image.webp" });
          res.end();
          return;
        }
        if (reqUrl === "/garden-image.webp") {
          res.writeHead(200, {
            "content-type": "image/webp",
            "cache-control": "public, max-age=31536000, immutable",
          });
          res.end(Buffer.from("RIFF"));
          return;
        }
        if (reqUrl.startsWith("/_next/image") || reqUrl.startsWith("/_vercel/image")) {
          if (reqUrl.includes("disallowed.invalid")) {
            res.writeHead(400, { "content-type": "text/plain" });
            res.end("Host not allowed");
          } else {
            res.writeHead(200, { "content-type": "image/webp" });
            res.end(Buffer.from("RIFF"));
          }
          return;
        }
        if (reqUrl === "/rooms/phase2-contract-placeholder") {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<html><head><title>${strings.byLocale.en.rootTitle}</title><meta name="robots" content="noindex" /></head><body><h1>${strings.byLocale.en.propertyNotFound}</h1></body></html>`,
          );
          return;
        }
        if (reqUrl === "/th/rooms/phase2-contract-placeholder") {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<html><head><title>${strings.byLocale.th.rootTitle}</title><meta name="robots" content="noindex" /></head><body><h1>${strings.byLocale.th.propertyNotFound}</h1></body></html>`,
          );
          return;
        }
        if (reqUrl === "/xx/rooms/pool-villa") {
          res.writeHead(breakUnknownLocale ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
          res.end('<html><head><meta name="robots" content="noindex" /></head><body>404 Not Found</body></html>');
          return;
        }
        res.writeHead(404);
        res.end("Not Found");
      });

    const nextServer = makeServer("next");
    const startServer = makeServer("start");
    const brokenServer = makeServer("start", true);

    await Promise.all([
      new Promise<void>((resolve) => nextServer.listen(0, "127.0.0.1", resolve)),
      new Promise<void>((resolve) => startServer.listen(0, "127.0.0.1", resolve)),
      new Promise<void>((resolve) => brokenServer.listen(0, "127.0.0.1", resolve)),
    ]);

    const runCli = (args: string[]) =>
      new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
        execFile(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" }, (error, stdout, stderr) => {
          if (!error) return resolve({ status: 0, stdout, stderr });
          if (typeof error.code === "number") return resolve({ status: error.code, stdout, stderr });
          reject(error);
        });
      });

    const tmp = mkdtempSync(path.join(tmpdir(), "parity-cli-test-"));
    try {
      const nextPort = (nextServer.address() as { port: number }).port;
      const startPort = (startServer.address() as { port: number }).port;
      const brokenPort = (brokenServer.address() as { port: number }).port;
      const jsonPath = path.join(tmp, "report.json");
      const mdPath = path.join(tmp, "report.md");

      const okRun = await runCli([
        "--scope",
        "room-slice",
        "--control-url",
        `http://127.0.0.1:${nextPort}`,
        "--candidate-url",
        `http://127.0.0.1:${startPort}`,
        "--strict",
        "--json",
        jsonPath,
        "--md",
        mdPath,
      ]);
      expect(okRun.status).toBe(0);

      const report = JSON.parse(readFileSync(jsonPath, "utf8"));
      const markdown = readFileSync(mdPath, "utf8");
      expect(report.overallVerdict).toBe("pass");
      expect(report.summary.parity.improved).toBe(2);
      expect(report.summary.parity.fail).toBe(0);
      expect(markdown).toContain("# Phase 2 Route Parity Report");
      expect(markdown).toContain("suspense-fallback-with-hidden-content");
      expect(markdown).toContain("visible-content");
      expect(() => assertNoSensitiveLeaks(JSON.stringify(report))).not.toThrow();
      expect(() => assertNoSensitiveLeaks(markdown)).not.toThrow();

      // Regression: unknown locale returning 200 must fail CLI with exit code 1
      const failRun = await runCli([
        "--scope",
        "room-slice",
        "--control-url",
        `http://127.0.0.1:${nextPort}`,
        "--candidate-url",
        `http://127.0.0.1:${brokenPort}`,
        "--strict",
        "--json",
        path.join(tmp, "fail.json"),
      ]);
      expect(failRun.status).toBe(1);
      const failReport = JSON.parse(readFileSync(path.join(tmp, "fail.json"), "utf8"));
      expect(failReport.overallVerdict).toBe("fail");
      expect(failReport.rows.find((r: { id: string }) => r.id === "special:unknown-locale-room").parityVerdict).toBe(
        "fail",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      nextServer.closeAllConnections();
      startServer.closeAllConnections();
      brokenServer.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => nextServer.close(() => resolve())),
        new Promise<void>((resolve) => startServer.close(() => resolve())),
        new Promise<void>((resolve) => brokenServer.close(() => resolve())),
      ]);
    }
  });

  it("renders valid Markdown even in control-only mode with unavailable candidate and separate perf report", () => {
    const manifest = buildManifest({ targetKind: "next", scope: "room-slice", rootDir: ROOT });
    const report = buildParityReport({ scope: "room-slice", manifest, control: null, candidate: null });
    const md = renderMarkdownReport(report);
    expect(md).toContain("Measurements collected separately");
    expect(md).toContain("(room-preview-corrected-timing.md)");
    expect(md).toContain("(room-preview-corrected-natural.md)");
    expect(md).toContain("controlledCacheHitMiss");
    expect(md).toContain("State-changing HTTP contracts");
  });

  it("re-imports a saved schemaVersion 1 parity report across two runs preserving actual observations and headers verbatim", () => {
    const manifest = buildManifest({ targetKind: "next", scope: "room-slice", rootDir: ROOT });
    const roomEn = manifest.find((r) => r.id === "page:rooms-id")!;
    const roomTh = manifest.find((r) => r.id === "special:room-th")!;
    const unknownLocale = manifest.find((r) => r.id === "special:unknown-locale-room")!;
    const strings = loadLocalizedStrings(ROOT);

    const observations = {
      [roomEn.id]: buildObservationFromHttp(
        roomEn,
        {
          status: 200,
          rawHeaders: [
            ["content-type", "text/html; charset=utf-8"],
            ["cache-control", "private, no-cache, no-store, max-age=0, must-revalidate"],
            ["vary", "rsc, next-router-state-tree"],
            ["x-vercel-cache", "MISS"],
            ["link", localeLinkHeader("/rooms/pool-villa")],
          ],
          body: Buffer.from(
            `<html lang="en"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><div class="min-h-screen">${strings.byLocale.en.loadingVilla}</div><div hidden><h1>Tideglass Pool Residence</h1></div></body></html>`,
          ),
          ttfbMs: 693.4,
        },
        { loadingStrings: strings.loadingStrings },
      ),
      [roomTh.id]: buildObservationFromHttp(
        roomTh,
        {
          status: 200,
          rawHeaders: [
            ["content-type", "text/html; charset=utf-8"],
            ["vary", "rsc"],
            // Deliberately partial alternates (only 2) to verify failing actual headers are preserved, not overwritten
            ["link", '<https://preview.vercel.app/rooms/pool-villa>; rel="alternate"; hreflang="en", <https://preview.vercel.app/th/rooms/pool-villa>; rel="alternate"; hreflang="th"'],
          ],
          body: Buffer.from(
            `<html lang="th"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title></head><body><main><h1>Tideglass Pool Residence</h1></main></body></html>`,
          ),
          ttfbMs: 677.5,
        },
        { loadingStrings: strings.loadingStrings },
      ),
      [unknownLocale.id]: {
        id: unknownLocale.id,
        kind: unknownLocale.kind,
        method: unknownLocale.method,
        path: unknownLocale.path,
        source: unknownLocale.source,
        status: null,
        ttfbMs: null,
        headers: {},
        html: null,
        robotsDirectives: null,
        sitemap: null,
        transportError: "Error: simulated timeout",
        sourceOrigin: "live-probe" as const,
      },
    };

    const initialCapture = {
      targetKind: "next" as const,
      deployment: "dpl_roundtrip",
      sourceCommit: "c70af789",
      sourceTree: "ee1d5cfd16fe36283fba76ff7cdc13024ac08a58",
      collectedAt: "2026-11-22T03:00:00.000Z",
      collectionMethod: "vercel-curl (read-only)",
      caveats: ["Roundtrip test"],
      observations,
    };

    const run1 = buildParityReport({ scope: "room-slice", manifest, control: initialCapture, candidate: null });
    const cap2 = normalizeCaptureInput(JSON.parse(JSON.stringify(run1)), manifest, "next", "control");
    const run2 = buildParityReport({ scope: "room-slice", manifest, control: cap2, candidate: null });
    const cap3 = normalizeCaptureInput(JSON.parse(JSON.stringify(run2)), manifest, "next", "control");
    const run3 = buildParityReport({ scope: "room-slice", manifest, control: cap3, candidate: null });

    expect(run2).toEqual(run1);
    expect(run3).toEqual(run1);
    expect(run2.rows.find((r) => r.id === roomEn.id)?.control.headers?.vary).toBe("rsc, next-router-state-tree");
    expect(run2.rows.find((r) => r.id === roomTh.id)?.control.localeAlternateCount).toBe(2);
    expect(run2.rows.find((r) => r.id === roomTh.id)?.control.verdict).toBe("fail");
    expect(run2.rows.find((r) => r.id === unknownLocale.id)?.control.transportError).toBe("Error: simulated timeout");
    expect(run2.rows.find((r) => r.id === unknownLocale.id)?.control.verdict).toBe("fail");
  });
});
