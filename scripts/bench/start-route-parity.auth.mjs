/**
 * Optional authenticated integration fixture for route parity using existing
 * Clerk Playwright run-owned sessions (as provisioned by scripts/local-integration.mjs
 * and scripts/e2e-clerk.mjs).
 *
 * Security & safety rules:
 * - Refuses production Clerk keys (pk_live_ / sk_live_).
 * - Never writes emails, user IDs, JWTs, cookies, or hostnames into results.
 * - Never catches unexpected errors as pass; reports explicit fail or unavailable.
 * - Optional POST validation is strictly loopback-only and non-mutating (401/400).
 * - Always closes Playwright browser/contexts and signs out in finally.
 */
import { sanitizeHeaders, sanitizePath } from "./start-route-parity.sanitize.mjs";
import { LOCALES } from "./start-route-parity.manifest.mjs";

export const AUTH_FIXTURE_CHECK_IDS = /** @type {const} */ ([
  "auth:anonymous:admin-chats-js",
  "auth:anonymous:admin-chats-nojs",
  "auth:anonymous:room-nojs",
  "auth:anonymous:config-status",
  "auth:nonstaff:admin-checkout",
  "auth:nonstaff:config-status",
  "auth:cashier:admin-checkout",
  "auth:cashier:admin-settings-redirect",
  "auth:cashier:config-status",
  "auth:owner:admin-settings-team",
  "auth:owner:admin-chats",
  "auth:owner:config-status",
]);

/**
 * Check whether an URL points to loopback only (127.0.0.1 / localhost / [::1]).
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function isLoopbackUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

/**
 * Validate environment prerequisites for the Clerk Playwright authenticated fixture.
 * @param {Record<string, string | undefined>} env
 * @param {string | null | undefined} baseUrl
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateAuthFixturePrereqs(env, baseUrl) {
  if (!baseUrl) {
    return { ok: false, reason: "Authenticated fixture requires --candidate-url or --control-url (or E2E_BASE_URL)." };
  }
  const pk = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY ?? "";
  const sk = env.CLERK_SECRET_KEY ?? "";
  if (pk.startsWith("pk_live_") || sk.startsWith("sk_live_")) {
    return { ok: false, reason: "Refusing authenticated fixture with production Clerk keys (pk_live_/sk_live_)." };
  }
  if (!pk.startsWith("pk_test_") || !sk.startsWith("sk_test_")) {
    return {
      ok: false,
      reason: "Authenticated fixture requires Clerk test-tenant keys (pk_test_ and sk_test_).",
    };
  }
  const missingRoles = ["E2E_OWNER_EMAIL", "E2E_CASHIER_EMAIL", "E2E_NONSTAFF_EMAIL"].filter(
    (key) => !env[key]?.trim(),
  );
  if (missingRoles.length > 0) {
    return {
      ok: false,
      reason: `Missing run-owned Clerk test session emails (${missingRoles.join(", ")}); run inside scripts/local-integration.mjs.`,
    };
  }
  return { ok: true };
}

/**
 * Sanitize an error into a short non-sensitive message (never echoing URLs, emails, or tokens).
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeErrorSummary(error) {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, "[clerk-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * @typedef {{
 *   id: string,
 *   role: "anonymous" | "nonstaff" | "cashier" | "owner",
 *   method: "GET" | "POST",
 *   path: string,
 *   jsEnabled: boolean | null,
 *   verdict: "pass" | "fail",
 *   status: number | null,
 *   finalPath: string | null,
 *   headers?: Record<string, unknown>,
 *   markers: Record<string, boolean | string | number | null>,
 *   detail: string,
 * }} AuthCheckResult
 *
 * @typedef {{
 *   status: "pass" | "fail" | "unavailable",
 *   reason?: string,
 *   summary: { total: number, pass: number, fail: number },
 *   checks: AuthCheckResult[],
 * }} AuthFixtureReport
 */

/**
 * @typedef {{
 *   loadPlaywright?: () => Promise<{ chromium: { launch: (opts: { headless: boolean }) => Promise<any> } }>,
 *   loadClerkTesting?: () => Promise<{ clerkSetup: (opts: { dotenv: boolean }) => Promise<unknown>, clerk: { signIn: (opts: { page: any, emailAddress: string }) => Promise<unknown>, signOut: (opts: { page: any }) => Promise<unknown> } }>,
 *   fetchImpl?: typeof fetch,
 * }} AuthFixtureDeps
 */

/**
 * Execute the optional Clerk Playwright authenticated integration fixture.
 * @param {{
 *   baseUrl: string | null | undefined,
 *   env?: Record<string, string | undefined>,
 *   includeSafePostValidation?: boolean,
 * }} options
 * @param {AuthFixtureDeps} [deps]
 * @returns {Promise<AuthFixtureReport>}
 */
export async function runAuthenticatedFixture(options, deps = {}) {
  const env = options.env ?? process.env;
  const prereq = validateAuthFixturePrereqs(env, options.baseUrl);
  if (!prereq.ok) {
    return {
      status: "unavailable",
      reason: prereq.reason,
      summary: { total: 0, pass: 0, fail: 0 },
      checks: [],
    };
  }

  const baseUrl = /** @type {string} */ (options.baseUrl).replace(/\/$/, "");
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  if (options.includeSafePostValidation && !isLoopbackUrl(baseUrl)) {
    return {
      status: "fail",
      reason: "Safe POST validation is strictly limited to loopback targets (127.0.0.1 / localhost).",
      summary: { total: 0, pass: 0, fail: 1 },
      checks: [],
    };
  }

  /** @type {any} */
  let browser = null;
  /** @type {AuthCheckResult[]} */
  const checks = [];

  /**
   * @param {string} id
   * @param {"anonymous" | "nonstaff" | "cashier" | "owner"} role
   * @param {"GET" | "POST"} method
   * @param {string} routePath
   * @param {boolean | null} jsEnabled
   * @param {() => Promise<{ pass: boolean, status: number | null, finalPath: string | null, headers?: Record<string, unknown>, markers: Record<string, boolean | string | number | null>, detail: string }>} fn
   */
  const record = async (id, role, method, routePath, jsEnabled, fn) => {
    try {
      const outcome = await fn();
      checks.push({
        id,
        role,
        method,
        path: sanitizePath(routePath, { preserveSafeQuery: true }) ?? "[redacted]",
        jsEnabled,
        verdict: outcome.pass ? "pass" : "fail",
        status: outcome.status,
        finalPath: outcome.finalPath ? sanitizePath(outcome.finalPath, { preserveSafeQuery: true }) : null,
        ...(outcome.headers ? { headers: outcome.headers } : {}),
        markers: outcome.markers,
        detail: outcome.detail,
      });
    } catch (error) {
      checks.push({
        id,
        role,
        method,
        path: sanitizePath(routePath, { preserveSafeQuery: true }) ?? "[redacted]",
        jsEnabled,
        verdict: "fail",
        status: null,
        finalPath: null,
        markers: {},
        detail: `Exception: ${sanitizeErrorSummary(error)}`,
      });
    }
  };

  try {
    const pw = deps.loadPlaywright ? await deps.loadPlaywright() : await import("@playwright/test");
    const clerkMod = deps.loadClerkTesting
      ? await deps.loadClerkTesting()
      : await import("@clerk/testing/playwright");

    await clerkMod.clerkSetup({ dotenv: false });
    browser = await pw.chromium.launch({ headless: true });

    /**
     * Create an isolated browser context with optional JS disablement and analytics declined.
     * @param {boolean} javaScriptEnabled
     */
    const openPage = async (javaScriptEnabled) => {
      const context = await browser.newContext({ baseURL: baseUrl, javaScriptEnabled });
      if (javaScriptEnabled) {
        await context.addInitScript(() => {
          localStorage.setItem("analytics-consent-v2", "no");
        });
      }
      const page = await context.newPage();
      return { context, page };
    };

    // 1. Anonymous browser (JS enabled): /admin/chats shows Admin sign-in gate and zero staff nav
    {
      const { context, page } = await openPage(true);
      try {
        await record("auth:anonymous:admin-chats-js", "anonymous", "GET", "/admin/chats", true, async () => {
          const response = await page.goto("/admin/chats", { waitUntil: "domcontentloaded" });
          const adminHeading = page.getByRole("heading", { name: "Admin", exact: true });
          await adminHeading.waitFor({ state: "visible", timeout: 15_000 });
          const signInVisible = await page.getByRole("button", { name: "Sign in", exact: true }).isVisible();
          const settingsLinks = await page.getByRole("link", { name: "Settings", exact: true }).count();
          const status = response ? response.status() : null;
          const pass = status === 200 && signInVisible && settingsLinks === 0;
          return {
            pass,
            status,
            finalPath: new URL(page.url()).pathname,
            markers: { adminGateVisible: true, signInButtonVisible: signInVisible, settingsLinkCount: settingsLinks },
            detail: pass ? "Anonymous admin gate rendered without staff navigation." : "Anonymous admin gate check failed.",
          };
        });
      } finally {
        await context.close();
      }
    }

    // 2. Anonymous browser (JS disabled): /admin/chats leaks zero staff content; /rooms/pool-villa?tour=1 records visible vs hidden HTML
    {
      const { context, page } = await openPage(false);
      try {
        await record("auth:anonymous:admin-chats-nojs", "anonymous", "GET", "/admin/chats", false, async () => {
          const response = await page.goto("/admin/chats", { waitUntil: "domcontentloaded" });
          const bodyText = await page.locator("body").innerText();
          const leakedStaff = /Checkout rules|Record payment|Invite staff|Business facts/i.test(bodyText);
          const status = response ? response.status() : null;
          const pass = status === 200 && !leakedStaff;
          return {
            pass,
            status,
            finalPath: new URL(page.url()).pathname,
            markers: { leakedStaffContent: leakedStaff, visibleBodyChars: bodyText.trim().length },
            detail: pass ? "JS-disabled anonymous /admin/chats leaks no staff content." : "Staff content leaked or non-200.",
          };
        });

        await record("auth:anonymous:room-nojs", "anonymous", "GET", "/rooms/pool-villa?tour=1", false, async () => {
          const response = await page.goto("/rooms/pool-villa?tour=1", { waitUntil: "domcontentloaded" });
          const status = response ? response.status() : null;
          const title = await page.title();
          const visibleText = (await page.locator("body").innerText()).trim();
          const h1Count = await page.locator("h1").count();
          const visibleH1Count = await page.locator("h1:visible").count();
          const loadingVisible = visibleText.includes("Loading villa...");
          const villaTitleVisible = visibleText.includes("Tideglass Pool Residence");
          const pass = status === 200 && title.includes("Tideglass Pool Residence") && (villaTitleVisible || loadingVisible);
          return {
            pass,
            status,
            finalPath: new URL(page.url()).pathname + new URL(page.url()).search,
            markers: {
              titleMatchesVilla: title.includes("Tideglass Pool Residence"),
              totalH1Count: h1Count,
              visibleH1Count,
              villaTitleVisible,
              loadingFallbackVisible: loadingVisible,
            },
            detail: villaTitleVisible
              ? "JS-disabled browser renders visible room content."
              : loadingVisible
                ? "JS-disabled browser renders Suspense loading fallback while room heading remains hidden."
                : "Neither room heading nor loading fallback rendered.",
          };
        });
      } finally {
        await context.close();
      }
    }

    // 3. Anonymous API: /api/admin/config-status -> 401
    await record("auth:anonymous:config-status", "anonymous", "GET", "/api/admin/config-status", null, async () => {
      const response = await fetchImpl(`${baseUrl}/api/admin/config-status`, { redirect: "manual" });
      const headers = sanitizeHeaders(response.headers, LOCALES);
      const pass = response.status === 401;
      return {
        pass,
        status: response.status,
        finalPath: "/api/admin/config-status",
        headers,
        markers: { unauthorized: response.status === 401 },
        detail: pass ? "Anonymous /api/admin/config-status rejected with 401." : `Expected 401, got ${response.status}.`,
      };
    });

    /**
     * Sign in a run-owned Clerk test user in a clean context, obtain its `convex` JWT,
     * execute checks, and always sign out + close context.
     * @param {"OWNER" | "CASHIER" | "NONSTAFF"} roleKey
     * @param {(ctx: { page: any, token: string }) => Promise<void>} fn
     */
    const withRoleSession = async (roleKey, fn) => {
      const { context, page } = await openPage(true);
      try {
        await page.goto("/admin/chats", { waitUntil: "domcontentloaded" });
        await clerkMod.clerk.signIn({ page, emailAddress: /** @type {string} */ (env[`E2E_${roleKey}_EMAIL`]) });
        const token = /** @type {string | null} */ (
          await page.evaluate(async () => {
            const clerkGlobal = /** @type {any} */ (window).Clerk;
            return clerkGlobal?.session ? await clerkGlobal.session.getToken({ template: "convex" }) : null;
          })
        );
        if (!token) {
          throw new Error(`Failed to mint convex JWT template for ${roleKey}`);
        }
        await fn({ page, token });
      } finally {
        await clerkMod.clerk.signOut({ page }).catch(() => undefined);
        await context.close();
      }
    };

    // 4. Non-staff checks
    await withRoleSession("NONSTAFF", async ({ page, token }) => {
      await record("auth:nonstaff:admin-checkout", "nonstaff", "GET", "/admin/checkout", true, async () => {
        const response = await page.goto("/admin/checkout", { waitUntil: "domcontentloaded" });
        const errorHeading = page.getByRole("heading", { name: "This view could not load" });
        await errorHeading.waitFor({ state: "visible", timeout: 15_000 });
        const status = response ? response.status() : null;
        const pass = status === 200;
        return {
          pass,
          status,
          finalPath: new URL(page.url()).pathname,
          markers: { errorBoundaryVisible: true },
          detail: pass ? "Non-staff session blocked from protected checkout view." : "Unexpected non-staff checkout status.",
        };
      });

      await record("auth:nonstaff:config-status", "nonstaff", "GET", "/api/admin/config-status", null, async () => {
        const response = await fetchImpl(`${baseUrl}/api/admin/config-status`, {
          redirect: "manual",
          headers: { authorization: `Bearer ${token}` },
        });
        const headers = sanitizeHeaders(response.headers, LOCALES);
        const pass = response.status === 403;
        return {
          pass,
          status: response.status,
          finalPath: "/api/admin/config-status",
          headers,
          markers: { forbidden: response.status === 403 },
          detail: pass ? "Non-staff /api/admin/config-status rejected with 403." : `Expected 403, got ${response.status}.`,
        };
      });
    });

    // 5. Cashier checks
    await withRoleSession("CASHIER", async ({ page, token }) => {
      await record("auth:cashier:admin-checkout", "cashier", "GET", "/admin/checkout", true, async () => {
        const response = await page.goto("/admin/checkout", { waitUntil: "domcontentloaded" });
        const heading = page.getByRole("heading", { name: "Checkout", exact: true });
        await heading.waitFor({ state: "visible", timeout: 15_000 });
        const settingsCount = await page.getByRole("link", { name: "Settings", exact: true }).count();
        const status = response ? response.status() : null;
        const pass = status === 200 && settingsCount === 0;
        return {
          pass,
          status,
          finalPath: new URL(page.url()).pathname,
          markers: { checkoutHeadingVisible: true, settingsLinkCount: settingsCount },
          detail: pass ? "Cashier authorized for till-only checkout without Settings nav." : "Cashier checkout gate failed.",
        };
      });

      await record("auth:cashier:admin-settings-redirect", "cashier", "GET", "/admin/settings", true, async () => {
        const response = await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
        await page.waitForURL(/\/admin\/checkout/, { timeout: 15_000 });
        const finalPath = new URL(page.url()).pathname;
        const pass = finalPath === "/admin/checkout";
        return {
          pass,
          status: response ? response.status() : null,
          finalPath,
          markers: { redirectedToCheckout: pass },
          detail: pass ? "Cashier redirected from /admin/settings to /admin/checkout." : `Expected /admin/checkout, landed on ${finalPath}.`,
        };
      });

      await record("auth:cashier:config-status", "cashier", "GET", "/api/admin/config-status", null, async () => {
        const response = await fetchImpl(`${baseUrl}/api/admin/config-status`, {
          redirect: "manual",
          headers: { authorization: `Bearer ${token}` },
        });
        const headers = sanitizeHeaders(response.headers, LOCALES);
        const pass = response.status === 403;
        return {
          pass,
          status: response.status,
          finalPath: "/api/admin/config-status",
          headers,
          markers: { forbidden: response.status === 403 },
          detail: pass ? "Cashier /api/admin/config-status rejected with 403." : `Expected 403, got ${response.status}.`,
        };
      });
    });

    // 6. Owner checks
    await withRoleSession("OWNER", async ({ page, token }) => {
      await record("auth:owner:admin-settings-team", "owner", "GET", "/admin/settings?tab=team", true, async () => {
        const response = await page.goto("/admin/settings?tab=team", { waitUntil: "domcontentloaded" });
        const inviteBtn = page.getByRole("button", { name: "Invite", exact: true });
        await inviteBtn.waitFor({ state: "visible", timeout: 15_000 });
        const status = response ? response.status() : null;
        const pass = status === 200;
        return {
          pass,
          status,
          finalPath: new URL(page.url()).pathname + new URL(page.url()).search,
          markers: { inviteButtonVisible: true },
          detail: pass ? "Owner authorized for team management controls." : "Owner settings team check failed.",
        };
      });

      await record("auth:owner:admin-chats", "owner", "GET", "/admin/chats", true, async () => {
        const response = await page.goto("/admin/chats", { waitUntil: "domcontentloaded" });
        const chatsHeading = page.getByRole("heading", { name: "Chats", exact: true });
        await chatsHeading.waitFor({ state: "visible", timeout: 15_000 });
        const status = response ? response.status() : null;
        const pass = status === 200;
        return {
          pass,
          status,
          finalPath: new URL(page.url()).pathname,
          markers: { chatsHeadingVisible: true },
          detail: pass ? "Owner authorized for /admin/chats inbox." : "Owner /admin/chats check failed.",
        };
      });

      await record("auth:owner:config-status", "owner", "GET", "/api/admin/config-status", null, async () => {
        const response = await fetchImpl(`${baseUrl}/api/admin/config-status`, {
          redirect: "manual",
          headers: { authorization: `Bearer ${token}` },
        });
        const headers = sanitizeHeaders(response.headers, LOCALES);
        const body = response.status === 200 ? await response.json().catch(() => null) : null;
        const channelsValid =
          Boolean(body && typeof body === "object" && body.channels && typeof body.channels === "object") &&
          Object.values(body.channels).every((v) => typeof v === "boolean");
        const cacheControl = typeof headers["cache-control"] === "string" ? headers["cache-control"] : "";
        const pass = response.status === 200 && channelsValid && cacheControl.includes("no-store");
        return {
          pass,
          status: response.status,
          finalPath: "/api/admin/config-status",
          headers,
          markers: {
            channelsBooleanMap: channelsValid,
            channelCount: channelsValid ? Object.keys(body.channels).length : 0,
            noStoreHeader: cacheControl.includes("no-store"),
          },
          detail: pass
            ? "Owner /api/admin/config-status returned 200 boolean channel config with no-store."
            : `Expected 200 + boolean channels + no-store (got status ${response.status}).`,
        };
      });

      if (options.includeSafePostValidation) {
        await record("auth:anonymous:chat-reply-post-401", "anonymous", "POST", "/api/admin/chat/reply", null, async () => {
          const response = await fetchImpl(`${baseUrl}/api/admin/chat/reply`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const pass = response.status === 401;
          return {
            pass,
            status: response.status,
            finalPath: "/api/admin/chat/reply",
            markers: { rejectedWithoutAuth: pass },
            detail: pass ? "Anonymous POST /api/admin/chat/reply rejected with 401." : `Expected 401, got ${response.status}.`,
          };
        });

        await record("auth:owner:chat-reply-post-400", "owner", "POST", "/api/admin/chat/reply", null, async () => {
          const response = await fetchImpl(`${baseUrl}/api/admin/chat/reply`, {
            method: "POST",
            redirect: "manual",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: "{}",
          });
          const pass = response.status === 400;
          return {
            pass,
            status: response.status,
            finalPath: "/api/admin/chat/reply",
            markers: { rejectedInvalidPayloadBeforeMutation: pass },
            detail: pass ? "Invalid POST /api/admin/chat/reply rejected with 400 before mutation." : `Expected 400, got ${response.status}.`,
          };
        });
      }
    });
  } catch (error) {
    checks.push({
      id: "auth:fixture:runtime",
      role: "anonymous",
      method: "GET",
      path: "/admin/chats",
      jsEnabled: true,
      verdict: "fail",
      status: null,
      finalPath: null,
      markers: {},
      detail: `Fixture error: ${sanitizeErrorSummary(error)}`,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  const passCount = checks.filter((c) => c.verdict === "pass").length;
  const failCount = checks.filter((c) => c.verdict === "fail").length;
  return {
    status: failCount === 0 && passCount > 0 ? "pass" : "fail",
    summary: { total: checks.length, pass: passCount, fail: failCount },
    checks,
  };
}
