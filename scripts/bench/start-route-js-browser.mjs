import { chooseBranchIfPrompted } from "../../tests/support/choose-branch.mjs";
import { chromium } from "@playwright/test";
import { setTimeout } from "node:timers/promises";

const timeout = 30_000;
const quietWindow = 500;

/**
 * Readiness proof per budgeted route: the view that the measurement claims to cover is mounted.
 * Staff routes require seeded data to render (the editor tabs and checkout catalog only appear
 * after authenticated Convex queries return), so a sign-in page or loading shell cannot pass.
 */
export const READY = {
  home: { label: "section#villas", wait: page => page.locator("section#villas").waitFor({ state: "visible" }) },
  room: {
    label: "room_hydrated mark",
    wait: page => page.waitForFunction(() => window.__startRouteJsMarks.includes("room_hydrated")),
  },
  property: { label: "tab: 360 rooms", wait: page => page.getByRole("tab", { name: "360 rooms", exact: true }).waitFor({ state: "visible" }) },
  checkout: { label: "tab: Frequent", wait: page => page.getByRole("tab", { name: "Frequent", exact: true }).first().waitFor({ state: "visible" }) },
};

function checkedOrigin(origin) {
  const target = new URL(origin);
  if (!["http:", "https:"].includes(target.protocol) || target.href !== target.origin + "/") {
    throw new Error("Browser origin must be an HTTP(S) origin without credentials, path or query");
  }
  return target;
}

/** Launches the measurement browser used by every observation (fixed mobile viewport, no SW). */
export function launchBrowser() {
  return chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

/**
 * Observe one fresh document in a new context (empty HTTP cache). `storageState` reuses an
 * already signed-in session without measuring the sign-in. Same-origin built JavaScript is
 * reported per chunk with request counts, failures, served encoding, CDP cache flags and
 * ResourceTiming bytes; cross-origin scripts are reported separately and never counted.
 * @param {import("@playwright/test").Browser} browser
 * @param {{ origin: string, pathname: string, key: keyof typeof READY, directTour?: boolean,
 *   graph: Record<string, unknown>, storageState?: object }} options
 */
export async function observeStartRoute(browser, { origin, pathname, key, directTour = false, graph, storageState }) {
  const target = checkedOrigin(origin);
  const url = new URL(pathname, target);
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, storageState });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(5000);
      window.__startRouteJsMarks = [];
      window.__tourBench = {
        mark: name => window.__startRouteJsMarks.push(name),
        frame() {},
      };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map();
    const pending = new Set();
    const failed = new Set();
    const encodings = new Map();
    const cacheFlags = new Map();
    const thirdParty = new Map();
    let lastActivity = Date.now();
    function getChunk(requestUrl) {
      const asset = new URL(requestUrl);
      if (asset.origin !== target.origin) return;
      const name = asset.pathname.slice(1);
      if (Object.hasOwn(graph, name) || /^assets\/.+\.(?:m?js|cjs)$/.test(name)) return name;
    }
    cdp.on("Network.responseReceived", ({ response }) => {
      const chunk = getChunk(response.url);
      if (chunk) cacheFlags.set(chunk, { fromDiskCache: !!response.fromDiskCache, fromPrefetchCache: !!response.fromPrefetchCache, fromServiceWorker: !!response.fromServiceWorker });
    });
    page.on("request", request => {
      const chunk = getChunk(request.url());
      if (!chunk) {
        if (request.resourceType() === "script" && new URL(request.url()).origin !== target.origin) {
          // Sanitized: only the file name of a third-party script, never its host or query.
          const file = new URL(request.url()).pathname.split("/").filter(Boolean).at(-1) ?? "(script)";
          thirdParty.set(file, (thirdParty.get(file) ?? 0) + 1);
        }
        return;
      }
      requests.set(chunk, (requests.get(chunk) ?? 0) + 1);
      pending.add(request);
      lastActivity = Date.now();
    });
    page.on("response", response => {
      const chunk = getChunk(response.url());
      if (!chunk) return;
      if (!response.ok()) failed.add(chunk);
      encodings.set(chunk, response.headers()["content-encoding"] ?? "identity");
    });
    page.on("requestfinished", request => {
      if (pending.delete(request)) lastActivity = Date.now();
    });
    page.on("requestfailed", request => {
      if (!pending.delete(request)) return;
      failed.add(getChunk(request.url()));
      lastActivity = Date.now();
    });

    const started = Date.now();
    try {
      const response = await page.goto(url.href, { waitUntil: "load", timeout });
      if (!response?.ok() || page.url() !== url.href) throw new Error("Unexpected document status or redirect");
      await READY[key].wait(page);
      if (directTour) await page.getByTestId("tour-viewer").waitFor({ state: "attached" });
    } catch {
      throw new Error(`Start document failed to load or reach its expected initial state (${READY[key].label}): ${pathname}`);
    }
    const readyMs = Date.now() - started;

    const deadline = Date.now() + timeout;
    lastActivity = Date.now();
    while (pending.size || Date.now() - lastActivity < quietWindow) {
      if (Date.now() >= deadline) throw new Error(`Initial JavaScript did not settle for ${pathname}`);
      await setTimeout(50);
    }
    if (page.url() !== url.href) throw new Error(`Unexpected redirect after initial hydration: ${pathname}`);
    if (key === "room" && !directTour && await page.getByTestId("tour-viewer").count()) {
      throw new Error(`Tour mounted during ordinary entry: ${pathname}`);
    }
    const timings = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => ({
      name: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize,
    })));
    const resources = {};
    for (const entry of timings) {
      const chunk = getChunk(entry.name);
      if (!chunk || resources[chunk]) continue;
      resources[chunk] = {
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        encoding: encodings.get(chunk) ?? "unknown",
        ...cacheFlags.get(chunk),
      };
    }
    return {
      readyMs,
      ready: READY[key].label,
      chunks: [...requests.keys()].sort(),
      requests: Object.fromEntries([...requests].sort()),
      failed: [...failed].filter(Boolean).sort(),
      resources,
      thirdPartyScripts: Object.fromEntries([...thirdParty].sort()),
    };
  } finally {
    await context.close();
  }
}

/**
 * Signs the dedicated Clerk test user in once, in a context that is not measured, and returns
 * its storage state plus the seeded property editor path. Test-tenant keys only.
 * @param {import("@playwright/test").Browser} browser
 * @param {{ origin: string, email: string, propertyName: string, env?: Record<string, string | undefined> }} options
 */
export async function signInOnce(browser, { origin, email, propertyName, env = process.env }) {
  const target = checkedOrigin(origin);
  const publishable = env.CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (!publishable.startsWith("pk_test_") || !env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Authenticated measurement requires Clerk test-tenant keys");
  }
  if (!email) throw new Error("Authenticated measurement requires the harness's dedicated owner test user");
  const { clerk, clerkSetup } = await import("@clerk/testing/playwright");
  await clerkSetup({ dotenv: false });
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(new URL("/admin/chats", target).href);
    await clerk.signIn({ page, emailAddress: email });
    await page.goto(new URL("/admin/properties", target).href);
    const link = page.locator('a[href^="/admin/properties/"]').filter({ hasText: propertyName }).first();
    await chooseBranchIfPrompted(page, link);
    await link.waitFor({ state: "attached" });
    const href = await link.getAttribute("href");
    const propertyId = href?.match(/^\/admin\/properties\/([\w-]+)$/)?.[1];
    if (!propertyId) throw new Error("Seeded property editor link was not found");
    return { storageState: await context.storageState(), propertyId };
  } finally {
    await context.close();
  }
}
