/**
 * Opt-in full-app Preview QA. Run through scripts/heavy.mjs with credentials
 * inherited from the operator's private environment. See preview-qa.md.
 */
import assert from "node:assert/strict";
import { readFile, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel";

const roles = ["owner", "cashier", "nonstaff"] as const;
type Role = (typeof roles)[number];
type PreviewCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type Target = {
  app: string;
  backend: string;
  clerk: string;
  deploymentId: string;
  commit: string;
  emails: Record<Role, string>;
  bypass?: string;
  protectionCookie?: PreviewCookie;
};
type Stage = "target" | "setup" | "checkout-read-only" | "auth" | "booking" | "chat" | "live-tour" | "cleanup";
const outcomes: Partial<Record<Stage, "pass" | "fail">> = {};

async function stage(name: Stage, run: () => Promise<void>) {
  try {
    await run();
    outcomes[name] = "pass";
  } catch {
    outcomes[name] = "fail";
    throw new Error(`Preview QA failed at ${name}`);
  }
}

function httpsOrigin(input: unknown, host: RegExp): string {
  assert.equal(typeof input, "string");
  const url = new URL(String(input));
  assert.equal(url.protocol, "https:");
  assert.equal(url.origin, input);
  assert.match(url.hostname, host);
  return url.origin;
}

function fixtureEmail(value: unknown) {
  assert.equal(typeof value, "string");
  assert.match(String(value), /^arch-e2e-(owner|cashier|nonstaff)-[a-f0-9]{32}\+clerk_test@example\.com$/);
  return String(value);
}

async function readPreviewCookie(path: string, app: string): Promise<PreviewCookie> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    assert(stats.isFile() && (stats.mode & 0o777) === 0o600 && stats.size <= 65_536);
    const host = new URL(app).hostname;
    const prefix = "#HttpOnly_";
    const entries = (await file.readFile("utf8")).split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter(([domain, , , , , name]) => domain === prefix + host && name === "_vercel_jwt");
    assert.equal(entries.length, 1);
    const [, subdomains, cookiePath, secure, seconds, name, value, extra] = entries[0];
    assert.equal(subdomains, "FALSE");
    assert.equal(cookiePath, "/");
    assert.equal(secure, "TRUE");
    assert(/^[0-9]+$/.test(seconds));
    const expires = Number(seconds);
    assert(Number.isSafeInteger(expires) && (expires === 0 || expires > Date.now() / 1000));
    // RFC 6265 cookie octets, excluding whitespace, separators and control bytes.
    assert(extra === undefined && value && /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(value));
    return { name, value, domain: host, path: "/", httpOnly: true, secure: true, expires: expires || -1 };
  } finally {
    await file.close();
  }
}

async function loadTarget(): Promise<Target> {
  assert.equal(process.env.E2E_PREVIEW_QA_OPT_IN, "disposable-test-only");
  const path = process.env.E2E_PREVIEW_QA_TARGET;
  assert(path);
  const file = await lstat(path);
  assert(file.isFile() && (file.mode & 0o077) === 0);
  const target = JSON.parse(await readFile(path, "utf8"));
  assert.equal(target.isolation, "dedicated-vercel-convex-preview");
  assert.equal(target.providerDispatchDisabled, true);
  assert.equal(target.ownerGrantsAreRunOwned, true);
  assert.equal(target.freshlySeeded, true);
  assert.match(String(target.deploymentId), /^dpl_[A-Za-z0-9]+$/);
  assert.match(String(target.commit), /^[a-f0-9]{40}$/);
  const app = httpsOrigin(target.app, /^[a-z0-9-]+\.vercel\.app$/);
  const backend = httpsOrigin(target.backend, /^[a-z0-9-]+\.convex\.cloud$/);
  const issuer = httpsOrigin(process.env.CLERK_JWT_ISSUER_DOMAIN, /^[a-z0-9.-]+\.clerk\.accounts\.dev$/);
  const publicKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  assert(publicKey && publicKey.startsWith("pk_test_"));
  assert(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
  assert.equal(Buffer.from(publicKey.slice(8), "base64").toString(), new URL(issuer).host + "$");
  const emails = {
    owner: fixtureEmail(target.emails.owner),
    cashier: fixtureEmail(target.emails.cashier),
    nonstaff: fixtureEmail(target.emails.nonstaff),
  };
  for (const role of roles) assert(emails[role].startsWith(`arch-e2e-${role}-`));
  assert.equal(new Set(Object.values(emails).map((email) => email.split("-")[3])).size, 1);
  const bypass = process.env.E2E_PREVIEW_VERCEL_BYPASS;
  const cookieJar = process.env.E2E_PREVIEW_VERCEL_COOKIE_JAR;
  const protectionCookie = !bypass && cookieJar ? await readPreviewCookie(cookieJar, app) : undefined;
  return {
    app, backend, clerk: issuer, deploymentId: target.deploymentId, commit: target.commit, emails,
    bypass, protectionCookie,
  };
}

type Network = { offline: boolean; sockets: Set<WebSocketRoute>; connections: number };
async function context(browser: Browser, target: Target, allowBackend: boolean) {
  const session = await browser.newContext({
    baseURL: target.app, locale: "en-US", serviceWorkers: "block", viewport: { width: 1360, height: 950 },
    reducedMotion: "reduce",
  });
  const network: Network = { offline: false, sockets: new Set(), connections: 0 };
  const { bypass, protectionCookie } = target;
  if (protectionCookie) await session.addCookies([protectionCookie]);
  await session.addInitScript(() => localStorage.setItem("analytics-consent-v2", "no"));
  await session.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === target.app) {
      if (!["GET", "HEAD"].includes(request.method()) || url.pathname.startsWith("/api/")) return route.abort();
      if (!bypass) return route.continue();
      // Never forward the bypass header when a browser request follows a redirect.
      const response = await route.fetch({
        maxRedirects: 0,
        headers: { ...await request.allHeaders(), "x-vercel-protection-bypass": bypass },
      });
      return route.fulfill({ response });
    }
    const clerkRead = ["GET", "HEAD"].includes(request.method());
    if ((url.origin === target.clerk && (allowBackend || clerkRead)) ||
        (allowBackend && !network.offline && url.origin === target.backend)) {
      return route.continue();
    }
    return route.abort();
  });
  await session.routeWebSocket("**/*", async (socket) => {
    const endpoint = new URL(socket.url());
    if (!allowBackend || network.offline || endpoint.origin.replace(/^wss:/, "https:") !== target.backend) {
      await socket.close();
      return;
    }
    network.connections += 1;
    network.sockets.add(socket);
    socket.connectToServer();
  });
  return { session, network };
}

async function refreshAuthorization(page: Page, client: ConvexHttpClient) {
  const jwt = await page.evaluate(() => window.Clerk?.session?.getToken({ template: "convex" }));
  assert(jwt);
  client.setAuth(jwt);
  return client;
}

async function signIn(page: Page, target: Target, role: Role) {
  await page.goto("/admin/chats");
  await clerk.signIn({ page, emailAddress: target.emails[role] });
  const client = await refreshAuthorization(page, new ConvexHttpClient(target.backend, { logger: false }));
  let access = await client.query(api.auth.staffAccess.myAccess, {});
  if (access.pendingInvitation?.role === "owner" && role === "owner" ||
      access.pendingInvitation?.role === "cashier" && role === "cashier" && process.env.E2E_PREVIEW_QA_PROVISION_CASHIER === "1") {
    await client.mutation(api.auth.staffAccess.claimInvite, {});
    access = await client.query(api.auth.staffAccess.myAccess, {});
  }
  assert.equal(access.role, role === "nonstaff" ? null : role);
  return client;
}

async function chooseBranchIfPrompted(page: Page, target: Locator) {
  const chooser = page.getByRole("heading", { name: "Choose a branch to start", exact: true });
  await target.or(chooser).first().waitFor({ state: "visible" });
  if (await chooser.isVisible()) {
    await page.getByRole("listitem").getByRole("button").first().click();
    await chooser.waitFor({ state: "hidden" });
  }
}

async function checkAuth(browser: Browser, target: Target, ownerSession: BrowserContext) {
  const ownerPage = await ownerSession.newPage();
  const owner = await signIn(ownerPage, target, "owner");
  assert((await owner.query(api.pos.catalog.stableCatalog, {})).services.length > 0);
  await ownerPage.goto("/admin/settings?tab=team");
  const invite = ownerPage.getByRole("button", { name: "Invite", exact: true });
  await chooseBranchIfPrompted(ownerPage, invite);
  await expect(invite).toBeVisible();
  const anonymous = new ConvexHttpClient(target.backend, { logger: false });
  await assert.rejects(anonymous.query(api.pos.catalog.stableCatalog, {}));

  const provisionCashier = process.env.E2E_PREVIEW_QA_PROVISION_CASHIER === "1";
  if (provisionCashier) {
    const grants = await owner.query(api.auth.staffAccess.listPeople, {});
    assert(!grants.some(({ email }) => email === target.emails.cashier));
    const { branches } = await owner.query(api.auth.staffAccess.myAccess, {});
    const branch = branches.find(({ key }) => key === "koh-samui");
    if (!branch) throw new Error("Koh Samui branch was not seeded");
    await owner.mutation(api.auth.staffAccess.setGrant, { email: target.emails.cashier, role: "cashier", branchIds: [branch.id] });
  }
  try {
    for (const role of ["cashier", "nonstaff"] as const) {
      const { session } = await context(browser, target, true);
      const page = await session.newPage();
      try {
        const client = await signIn(page, target, role);
        if (role === "cashier") {
          await page.goto("/admin/checkout");
          const order = page.getByRole("complementary", { name: "Order", exact: true });
          await chooseBranchIfPrompted(page, order);
          await expect(order).toBeVisible();
          await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
          await assert.rejects(client.query(api.auth.staffAccess.listPeople, {}));
          await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
        } else {
          await assert.rejects(client.query(api.pos.catalog.stableCatalog, {}));
          await page.goto("/admin/checkout");
          await expect(page.getByRole("heading", { name: "No access", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
          await expect(page.getByRole("complementary", { name: "Order", exact: true })).toHaveCount(0);
          await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toHaveCount(0);
          await clerk.signOut({ page });
        }
        await page.waitForFunction(() => Boolean(window.Clerk?.loaded) && !window.Clerk?.session);
        await page.goto("/admin/checkout");
        await expect(page.getByRole("complementary", { name: "Order", exact: true })).toHaveCount(0);
      } finally {
        await clerk.signOut({ page }).catch(() => undefined);
        await session.close();
      }
    }
  } finally {
    if (provisionCashier) {
      await refreshAuthorization(ownerPage, owner);
      await owner.mutation(api.auth.staffAccess.setGrant, { email: target.emails.cashier, role: null, branchIds: [] });
      const grants = await owner.query(api.auth.staffAccess.listPeople, {});
      assert(!grants.some(({ email }) => email === target.emails.cashier));
    }
  }
  return () => refreshAuthorization(ownerPage, owner);
}

async function checkoutReadOnly(browser: Browser, target: Target) {
  // The invalid-link screens need no Convex data. Deny its HTTP and WebSocket traffic.
  const { session, network } = await context(browser, target, false);
  try {
    const page = await session.newPage();
    await page.goto("/booking/pay?bookingId=invalid-without-token");
    await expect(page.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
    await expect(page.getByText(/access token|secure link/i)).toBeVisible();
    await page.goto("/booking/success?bookingId=invalid-without-token");
    await expect(page.getByRole("heading", { name: "Booking not confirmed" })).toBeVisible();
    assert.equal(network.connections, 0);
  } finally {
    await session.close();
  }
}

async function booking(page: Page, getOwner: () => Promise<ConvexHttpClient>) {
  const email = `preview-fixture-${randomUUID()}@example.com`;
  try {
    const day = new Date(Date.now() + 45 * 86400_000).toISOString().slice(0, 10);
    await page.goto(`/booking?checkin=${day}&nights=2&adults=2&children=0&unit=garden-suite`);
    for (const heading of ["Reserve your villa", "Guests"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Guest details" })).toBeVisible();
    await page.getByLabel("Full name").fill("Preview Fixture Guest");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone / WhatsApp").fill("+66 77 111 222");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review and pay" })).toBeVisible();
    await page.getByRole("button", { name: "Continue to Pay" }).click();
    await page.waitForURL((url) => url.pathname === "/booking/pay" && Boolean(url.searchParams.get("token")));
    await expect(page.getByRole("heading", { name: "Confirm payment" })).toBeVisible();
  } finally {
    const owner = await getOwner();
    const owned = (await owner.query(api.bookings.admin.searchBookings, { query: email }))
      .filter((row) => row.guestEmail === email);
    for (const booking of owned) {
      await owner.mutation(api.bookings.commands.deleteBooking.deleteBooking, {
        bookingId: booking._id,
        expectedRevision: booking.revision,
      });
    }
  }
}

async function chat(page: Page, getOwner: () => Promise<ConvexHttpClient>) {
  try {
    await page.goto("/chat");
    const notice = page.getByRole("button", { name: "I understand", exact: true });
    if (await notice.isVisible()) await notice.click();
    const input = page.getByRole("textbox", { name: "Ask a question", exact: true }).last();
    await expect(input).toBeEnabled();
    const question = "What time is check-in?";
    await input.fill(question);
    await input.press("Enter");
    await expect(page.getByText(/Check-in is from/)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await expect(page.getByText(/Check-in is from/)).toBeVisible();
    assert(await page.evaluate(() => !Object.keys(localStorage).some((key) => key.startsWith("sv_chat_messages:"))));
  } finally {
    const sessionId = await page.evaluate(() => localStorage.getItem("sv_chat_session_id"));
    if (sessionId) {
      const owner = await getOwner();
      await owner.mutation(api.messaging.adminChat.setSessionStatus, { sessionId: sessionId as Id<"conversations">, status: "archived" });
      await owner.mutation(api.messaging.adminChat.deleteArchivedSession, { sessionId: sessionId as Id<"conversations"> });
    }
  }
}

async function liveTour(browser: Browser, target: Target, getOwner: () => Promise<ConvexHttpClient>) {
  const owner = await getOwner();
  const properties = api.catalog.adminProperties;
  const ordinary = await context(browser, target, true);
  const reconnecting = await context(browser, target, true);
  const a = await ordinary.session.newPage();
  const b = await reconnecting.session.newPage();
  const first = a.getByTestId("tour-viewer");
  const second = b.getByTestId("tour-viewer");
  const propertyId = await owner.mutation(properties.create, {
    name: "Preview scene fixture", slug: `preview-tour-${randomUUID()}`,
  });
  try {
    const initial = await owner.query(properties.get, { propertyId });
    assert(initial);
    await owner.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 500000 });
    for (const room of ["living", "pool"]) {
      await owner.mutation(properties.createRoom, {
        propertyId, name: room === "living" ? "Fixture Living" : "Fixture Pool",
        slug: room, imagePath: `/tour/panoramas/v1/pool-villa-${room}-2048.webp`,
      });
    }
    await owner.mutation(properties.setStatus, { propertyId, status: "active" });
    const path = `/rooms/${initial.property.slug}?tour=1`;
    await Promise.all([a.goto(path), b.goto(path)]);
    for (const viewer of [first, second]) {
      await expect(viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 25_000 });
      await expect(viewer).toHaveAttribute("data-shown-room", "living");
    }
    await second.getByRole("button", { name: "Fixture Pool", exact: true }).last().click();
    await expect(second).toHaveAttribute("data-shown-room", "pool", { timeout: 20_000 });
    await second.getByRole("button", { name: "Fixture Living", exact: true }).last().click();
    await expect(second).toHaveAttribute("data-shown-room", "living", { timeout: 20_000 });

    await getOwner();
    await owner.mutation(properties.reorderRooms, { propertyId, roomSlugs: ["pool", "living"] });
    await expect(first).toHaveAttribute("data-shown-room", "pool", { timeout: 20_000 });
    await expect(second).toHaveAttribute("data-shown-room", "living");

    const { network } = reconnecting;
    const before = network.connections;
    assert(before > 0);
    network.offline = true;
    await Promise.all([...network.sockets].map(async (socket) => {
      await socket.close().catch(() => undefined);
    }));
    await getOwner();
    await owner.mutation(properties.setStatus, { propertyId, status: "archived" });
    await expect(first).toHaveAttribute("data-scene-status", "empty", { timeout: 20_000 });
    network.offline = false;
    await expect.poll(() => network.connections, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect(second).toHaveAttribute("data-scene-status", "empty", { timeout: 25_000 });
    for (const viewer of [first, second]) await expect(viewer.getByRole("button", { name: "Close" })).toBeVisible();
  } finally {
    await ordinary.session.close();
    await reconnecting.session.close();
    await getOwner();
    await owner.mutation(properties.setStatus, { propertyId, status: "draft" });
    await owner.mutation(properties.deleteDraft, { propertyId });
  }
}

async function main() {
  let target!: Target;
  await stage("target", async () => { target = await loadTarget(); });
  let browser!: Browser;
  const mode = process.env.E2E_PREVIEW_QA_MODE;
  const checkoutOnly = mode === "checkout-read-only";
  await stage("setup", async () => {
    assert(checkoutOnly || mode === "isolated-fixtures");
    assert(!process.env.DEBUG && !process.env.PWDEBUG && !process.env.CLERK_TESTING_DEBUG);
    if (!checkoutOnly) await clerkSetup({ dotenv: false });
    browser = await chromium.launch();
  });
  try {
    if (checkoutOnly) {
      await stage("checkout-read-only", () => checkoutReadOnly(browser, target));
      return;
    }
    const ownerSession = (await context(browser, target, true)).session;
    const guest = (await context(browser, target, true)).session;
    let auth: Awaited<ReturnType<typeof checkAuth>> | undefined;
    try {
      await stage("auth", async () => { auth = await checkAuth(browser, target, ownerSession); });
      await stage("booking", async () => { await booking(await guest.newPage(), auth!); });
      await stage("chat", async () => { await chat(await guest.newPage(), auth!); });
      await stage("live-tour", async () => { await liveTour(browser, target, auth!); });
    } finally {
      await stage("cleanup", async () => {
        for (const page of ownerSession.pages()) await clerk.signOut({ page });
        await guest.close();
        await ownerSession.close();
      });
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch {
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({ status: process.exitCode ? "failed" : "passed", stages: outcomes }));
}
