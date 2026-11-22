import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, connect, type AddressInfo, type Socket as TcpSocket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import type { Browser, WebSocketRoute } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readTourRooms, watchLiveTourRooms, type LiveTourSnapshot } from "../../src/lib/tour/live-tour-rooms";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

/**
 * Live tour freshness on the seeded checkout-local backend, with real anonymous viewer tabs and a
 * second actor (the owner) committing scene edits. Viewer WebSockets pass through a proxy that adds
 * 150 ms RTT, counts live `getTourRooms` subscriptions and can hold server deliveries.
 */
const ONE_WAY_MS = 75;
const FRAMES = 2;
const COMMIT_BUDGET_MS = 2_000;
const ROOMS = [
  { slug: "living", name: "Fixture Living", imagePath: "/tour/panoramas/v1/pool-villa-living-2048.webp" },
  { slug: "pool", name: "Fixture Pool", imagePath: "/tour/panoramas/v1/pool-villa-pool-2048.webp" },
  { slug: "garden", name: "Fixture Garden", imagePath: "/tour/panoramas/v1/garden-villa-360-2048.webp" },
];
const properties = api.catalog.adminProperties;
const results: Record<string, unknown> = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeClean: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "",
  entry: process.env.E2E_START_ADMIN_IDENTITY === "1" ? "start" : "next",
  fixture: { rooms: ROOMS.map(({ slug, imagePath }) => ({ slug, imagePath })), rttMs: ONE_WAY_MS * 2 },
  scenarios: {},
};

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
/** Sanitized timings only (no tokens, IDs or URLs), kept in the ignored Playwright output directory. */
test.afterAll(() => {
  mkdirSync("test-results/live-tour-freshness", { recursive: true });
  writeFileSync(`test-results/live-tour-freshness/${Date.now()}.json`, JSON.stringify(results, null, 2) + "\n", { mode: 0o600 });
});

type Snapshot = { frame: number; t: number; status: string; requested: string; live: string; nav: string[] };
type Probe = { frame: number; yaw: number | null; marks: { name: string; frame: number; t: number }[]; dom: Snapshot[] };

declare global {
  interface Window { __liveTour?: Probe }
}

/** Page-side frame counter, bench marks and every observable viewer state change. */
function installProbe() {
  const probe: Probe = { frame: 0, yaw: null, marks: [], dom: [] };
  window.__liveTour = probe;
  const tick = () => { probe.frame += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__tourBench = {
    mark: (name) => probe.marks.push({ name, frame: probe.frame, t: performance.now() }),
    // Called for every painted panorama frame with the camera's yaw.
    frame: (yaw) => { probe.yaw = yaw; },
  };
  let last = "";
  new MutationObserver(() => {
    const viewer = document.querySelector<HTMLElement>('[data-testid="tour-viewer"]');
    const state = viewer ? {
      status: viewer.dataset.sceneStatus ?? "", requested: viewer.dataset.requestedRoom ?? "",
      live: viewer.dataset.live ?? "",
      nav: [...viewer.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "").filter((text) => text.startsWith("Fixture ")),
    } : { status: "closed", requested: "", live: "", nav: [] };
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    probe.dom.push({ frame: probe.frame, t: performance.now(), ...state });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

type Socket = { ws: WebSocketRoute; tourQueries: Set<number> };
type Viewer = Awaited<ReturnType<typeof openViewer>>;

async function openViewer(browser: Browser, label: string) {
  const backend = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const context = await browser.newContext({ locale: "en-US", serviceWorkers: "block", reducedMotion: "reduce" });
  const net = { offline: false, hold: false, connections: 0, sockets: new Set<Socket>(), held: [] as (() => void)[] };
  await context.addInitScript(() => localStorage.setItem("analytics-consent-v2", "no"));
  await context.addInitScript(installProbe);
  await context.routeWebSocket((url) => url.host === backend.host, (ws) => {
    if (net.offline) return void ws.close();
    const server = ws.connectToServer();
    const socket: Socket = { ws, tourQueries: new Set() };
    net.connections += 1;
    net.sockets.add(socket);
    // Fixed one-way latency per direction, preserving message order.
    let up = Promise.resolve();
    let down = Promise.resolve();
    const later = (chain: Promise<void>, send: () => void) => {
      const due = Date.now() + ONE_WAY_MS;
      return chain.then(() => sleep(Math.max(0, due - Date.now()))).then(() => {
        try { send(); } catch { /* the socket closed meanwhile */ }
      });
    };
    ws.onMessage((message) => {
      trackSubscriptions(socket, message);
      up = later(up, () => server.send(message));
    });
    server.onMessage((message) => {
      const forward = () => { down = later(down, () => ws.send(message)); };
      if (net.hold) net.held.push(forward);
      else forward();
    });
    const drop = () => {
      net.sockets.delete(socket);
      socket.tourQueries.clear();
    };
    ws.onClose(() => { drop(); void server.close(); });
    server.onClose(() => { drop(); void ws.close(); });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const throttle = (offline: boolean) => cdp.send("Network.emulateNetworkConditions", {
    offline, latency: ONE_WAY_MS * 2, downloadThroughput: -1, uploadThroughput: -1,
  });
  await throttle(false);
  const panoramas: string[] = [];
  page.on("request", (request) => {
    if (/\/tour\/panoramas\//.test(new URL(request.url()).pathname)) panoramas.push(request.url());
  });
  return {
    label, context, page, net, panoramas,
    viewer: page.getByTestId("tour-viewer"),
    /** Live getTourRooms subscriptions across this tab's open sockets. */
    subscriptions: () => [...net.sockets].reduce((sum, socket) => sum + socket.tourQueries.size, 0),
    async disconnect() {
      net.offline = true;
      await throttle(true);
      await Promise.all([...net.sockets].map((socket) => socket.ws.close().catch(() => undefined)));
    },
    async reconnect() {
      net.offline = false;
      await throttle(false);
    },
    release() {
      net.hold = false;
      for (const forward of net.held.splice(0)) forward();
    },
    probe: () => page.evaluate(() => window.__liveTour!),
    now: () => page.evaluate(() => performance.now()),
  };
}

function trackSubscriptions(socket: Socket, message: string | Buffer) {
  if (typeof message !== "string") return;
  const parsed = JSON.parse(message) as { type?: string; modifications?: { type: string; queryId: number; udfPath?: string }[] };
  if (parsed.type !== "ModifyQuerySet") return;
  for (const change of parsed.modifications ?? []) {
    if (change.type === "Add" && change.udfPath?.endsWith(":getTourRooms")) socket.tourQueries.add(change.queryId);
    if (change.type === "Remove") socket.tourQueries.delete(change.queryId);
  }
}

/** The first post-commit viewer state that satisfies `want`, timed from the commit and from the live delivery. */
async function converged(viewer: Viewer, since: number, want: (state: Snapshot) => boolean) {
  await expect.poll(async () => (await viewer.probe()).dom.some((s) => s.t >= since && want(s)), { timeout: 10_000 }).toBe(true);
  const probe = await viewer.probe();
  const applied = probe.dom.find((s) => s.t >= since && want(s))!;
  const delivery = probe.marks.filter((m) => m.name === "rooms_update" && m.t >= since && m.t <= applied.t).at(-1);
  expect(delivery, `${viewer.label}: a live delivery precedes the applied state`).toBeDefined();
  return {
    commitToAppliedMs: Math.round(applied.t - since),
    deliveryToAppliedFrames: applied.frame - delivery!.frame,
    applied: { status: applied.status, requested: applied.requested, live: applied.live, nav: applied.nav },
  };
}

function withinBudget(label: string, timing: Awaited<ReturnType<typeof converged>>) {
  expect(timing.deliveryToAppliedFrames, `${label}: frames from live delivery to applied UI`).toBeLessThanOrEqual(FRAMES);
  expect(timing.commitToAppliedMs, `${label}: commit to applied UI`).toBeLessThanOrEqual(COMMIT_BUDGET_MS);
}

async function fixture(browser: Browser) {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const owner: ConvexHttpClient = await signedInBackend(ownerPage);
  /** Clerk session tokens are short-lived; refresh before every write. */
  async function as() {
    const token = await ownerPage.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    owner.setAuth(token!);
    return owner;
  }
  const slug = `live-tour-${randomUUID().slice(0, 8)}`;
  const propertyId = await owner.mutation(properties.create, { name: "Live Tour Fixture", slug }) as Id<"properties">;
  await owner.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 500_000 });
  const roomIds: Record<string, Id<"tourScenes">> = {};
  for (const room of ROOMS) roomIds[room.slug] = await owner.mutation(properties.createRoom, { propertyId, ...room });
  await owner.mutation(properties.setStatus, { propertyId, status: "active" });
  return {
    slug, propertyId, roomIds, as,
    async cleanup() {
      try {
        const client = await as();
        await client.mutation(properties.setStatus, { propertyId, status: "draft" });
        await client.mutation(properties.deleteDraft, { propertyId });
      } finally {
        await ownerContext.close();
      }
    },
  };
}

/** Drag across the canvas and report the painted yaw before and after the camera settles. */
async function drag(viewer: Viewer) {
  const before = (await viewer.probe()).yaw;
  const box = (await viewer.page.locator('[data-testid="tour-viewer"] canvas').boundingBox())!;
  const y = box.y + box.height / 2;
  await viewer.page.mouse.move(box.x + box.width / 2, y);
  await viewer.page.mouse.down();
  await viewer.page.mouse.move(box.x + box.width / 2 + 240, y, { steps: 12 });
  await viewer.page.mouse.up();
  await sleep(800);
  return { before, after: (await viewer.probe()).yaw };
}

async function openTour(viewer: Viewer, slug: string) {
  await viewer.page.goto(`/rooms/${slug}?tour=1`);
  await expect(viewer.viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 30_000 });
  await expect(viewer.viewer).toHaveAttribute("data-live", "confirmed");
  await expect.poll(viewer.subscriptions).toBe(1);
}

test("reorder and removal keep explicit choices and move implicit ones", async ({ browser }) => {
  const villa = await fixture(browser);
  const implicit = await openViewer(browser, "implicit");
  const explicit = await openViewer(browser, "explicit");
  try {
    await Promise.all([openTour(implicit, villa.slug), openTour(explicit, villa.slug)]);
    await expect(explicit.viewer.getByRole("button", { name: "Fixture Pool", exact: true }).last()).toBeVisible();
    await explicit.viewer.getByRole("button", { name: "Fixture Pool", exact: true }).last().click();
    await expect(explicit.viewer).toHaveAttribute("data-shown-room", "pool", { timeout: 20_000 });
    await expect(explicit.viewer).toHaveAttribute("data-scene-status", "ready");

    let owner = await villa.as();
    let since = await Promise.all([implicit.now(), explicit.now()]);
    await owner.mutation(properties.reorderRooms, { propertyId: villa.propertyId, roomSlugs: ["living", "garden", "pool"] });
    // The first room is unchanged; only its neighbors swap.
    const reorderImplicit = await converged(implicit, since[0], (s) =>
      s.requested === "living" && s.nav.slice(-2).join() === "Fixture Pool,Fixture Garden");
    withinBudget("reorder/unchanged-first", reorderImplicit);
    // Keep pool, with garden before it and living after it.
    const reorderExplicit = await converged(explicit, since[1], (s) =>
      s.requested === "pool" && s.nav.slice(-2).join() === "Fixture Garden,Fixture Living");
    withinBudget("reorder/explicit", reorderExplicit);

    owner = await villa.as();
    since = await Promise.all([implicit.now(), explicit.now()]);
    await owner.mutation(properties.reorderRooms, { propertyId: villa.propertyId, roomSlugs: ["garden", "living", "pool"] });
    const firstMoved = await converged(implicit, since[0], (s) => s.requested === "garden");
    withinBudget("reorder/implicit", firstMoved);
    await expect(explicit.viewer).toHaveAttribute("data-requested-room", "pool");

    owner = await villa.as();
    since = await Promise.all([implicit.now(), explicit.now()]);
    await owner.mutation(properties.deleteRoom, { roomId: villa.roomIds.pool });
    const removed = await converged(explicit, since[1], (s) => s.requested === "garden");
    withinBudget("remove/explicit", removed);
    await expect(explicit.viewer).toHaveAttribute("data-shown-room", "garden", { timeout: 20_000 });
    for (const tab of [implicit, explicit]) expect(tab.subscriptions(), `${tab.label} subscriptions`).toBe(1);
    (results.scenarios as Record<string, unknown>).reorderAndRemoval = {
      unchangedFirstImplicit: reorderImplicit, explicitKept: reorderExplicit, implicitMoved: firstMoved, explicitRemoved: removed,
    };
  } finally {
    await implicit.context.close();
    await explicit.context.close();
    await villa.cleanup();
  }
});

test("archive clears open viewers and a primed reload paints no archived scene", async ({ browser }) => {
  const villa = await fixture(browser);
  const first = await openViewer(browser, "first");
  const second = await openViewer(browser, "second");
  try {
    // An ordinary room visit neither subscribes to scenes nor downloads a panorama.
    await first.page.goto(`/rooms/${villa.slug}`);
    await expect(first.page.getByRole("heading", { name: "Live Tour Fixture" })).toBeVisible();
    await first.page.waitForLoadState("networkidle");
    expect(first.panoramas).toEqual([]);
    expect(first.subscriptions()).toBe(0);
    const ordinary = { panoramaRequests: first.panoramas.length, subscriptions: first.subscriptions() };

    await Promise.all([openTour(first, villa.slug), openTour(second, villa.slug)]);
    const owner = await villa.as();
    const since = await Promise.all([first.now(), second.now()]);
    await owner.mutation(properties.setStatus, { propertyId: villa.propertyId, status: "archived" });
    const cleared = [];
    for (const [index, tab] of [first, second].entries()) {
      const timing = await converged(tab, since[index], (s) => s.status === "empty");
      withinBudget(`archive/${tab.label}`, timing);
      cleared.push(timing);
      await expect(tab.viewer.getByRole("button")).toHaveText(["Close"]);
    }

    first.panoramas.length = 0;
    const response = await first.page.reload();
    await first.page.waitForLoadState("networkidle");
    await expect(first.page.locator('[data-testid="tour-viewer"][data-shown-room]:not([data-shown-room=""])')).toHaveCount(0);
    expect(first.panoramas).toEqual([]);
    (results.scenarios as Record<string, unknown>).archive = {
      ordinary, cleared, reload: { status: response?.status() ?? null, panoramaRequests: first.panoramas.length },
    };
  } finally {
    await first.context.close();
    await second.context.close();
    await villa.cleanup();
  }
});

test("a reconnected viewer waits for a fresh live delivery before navigation resumes", async ({ browser }) => {
  const villa = await fixture(browser);
  const online = await openViewer(browser, "online");
  const flaky = await openViewer(browser, "flaky");
  // The last control with a room's name is the "next room" button (living → pool, garden → living).
  const nextTo = (tab: Viewer, name: string) => tab.viewer.getByRole("button", { name, exact: true }).last();
  try {
    await Promise.all([openTour(online, villa.slug), openTour(flaky, villa.slug)]);
    const connections = flaky.net.connections;

    // Unchanged data: the retained value matches the server, yet stays unconfirmed until re-sent.
    await flaky.disconnect();
    await expect(flaky.viewer).toHaveAttribute("data-live", "unconfirmed", { timeout: 20_000 });
    await expect(flaky.viewer).toHaveAttribute("aria-busy", "true");
    await nextTo(flaky, "Fixture Pool").click({ force: true });
    await expect(flaky.viewer).toHaveAttribute("data-requested-room", "living");
    const lockedDrag = await drag(flaky);
    expect(lockedDrag.before).not.toBeNull();
    expect(lockedDrag.after, "no look-around while unconfirmed").toBe(lockedDrag.before);
    flaky.net.hold = true;
    const held = await flaky.now();
    await flaky.reconnect();
    await expect.poll(() => flaky.net.connections, { timeout: 30_000 }).toBeGreaterThan(connections);
    await expect.poll(flaky.subscriptions).toBe(1);
    await sleep(1_000);
    await expect(flaky.viewer).toHaveAttribute("data-live", "unconfirmed");
    expect((await flaky.probe()).marks.filter((m) => m.name === "rooms_update" && m.t >= held)).toEqual([]);
    const released = await flaky.now();
    flaky.release();
    const refreshed = await converged(flaky, released, (s) => s.live === "confirmed");
    expect(refreshed.deliveryToAppliedFrames).toBeLessThanOrEqual(FRAMES);
    expect((await flaky.probe()).dom.filter((s) => s.t >= held && s.t < released && s.live === "confirmed")).toEqual([]);
    const freeDrag = await drag(flaky);
    expect(freeDrag.after, "look-around resumes once confirmed").not.toBe(freeDrag.before);

    // Changed data while offline: the online tab converges at once, the offline tab after reconnecting.
    await flaky.disconnect();
    await expect(flaky.viewer).toHaveAttribute("data-live", "unconfirmed", { timeout: 20_000 });
    const owner = await villa.as();
    const since = await Promise.all([online.now(), flaky.now()]);
    await owner.mutation(properties.reorderRooms, { propertyId: villa.propertyId, roomSlugs: ["garden", "living", "pool"] });
    const onlineMoved = await converged(online, since[0], (s) => s.requested === "garden");
    withinBudget("offline-edit/online", onlineMoved);
    await expect(flaky.viewer).toHaveAttribute("data-requested-room", "living");
    const reconnectAt = await flaky.now();
    await flaky.reconnect();
    const caughtUp = await converged(flaky, reconnectAt, (s) => s.requested === "garden" && s.live === "confirmed");
    expect(caughtUp.deliveryToAppliedFrames).toBeLessThanOrEqual(FRAMES);
    await expect(flaky.viewer).toHaveAttribute("data-scene-status", "ready", { timeout: 20_000 });
    await nextTo(flaky, "Fixture Living").click();
    await expect(flaky.viewer).toHaveAttribute("data-shown-room", "living", { timeout: 20_000 });
    for (const tab of [online, flaky]) expect(tab.subscriptions(), `${tab.label} subscriptions`).toBe(1);
    (results.scenarios as Record<string, unknown>).reconnect = {
      unchangedAfterHold: refreshed, onlineEdit: onlineMoved, offlineCaughtUp: caughtUp,
      dragWhileUnconfirmed: lockedDrag.after !== lockedDrag.before, dragOnceConfirmed: freeDrag.after !== freeDrag.before,
    };
  } finally {
    await online.context.close();
    await flaky.context.close();
    await villa.cleanup();
  }
});

test("a reopened or re-identified viewer shows only scenes the server vouched for", async ({ browser }) => {
  const villa = await fixture(browser);
  const identity = await openViewer(browser, "identity");
  const warm = await openViewer(browser, "warm");
  const marks = async (tab: Viewer, since: number, name: string) =>
    (await tab.probe()).marks.filter((m) => m.name === name && m.t >= since);
  try {
    // Signing in remounts the open viewer while its live deliveries are held. The client still holds
    // the old subscription's value; the viewer shows it only after a separate server read matches.
    await openTour(identity, villa.slug);
    identity.net.hold = true;
    const heldAt = await identity.now();
    await clerk.signIn({ page: identity.page, emailAddress: process.env.E2E_OWNER_EMAIL! });
    await expect.poll(async () => (await marks(identity, heldAt, "rooms_verified")).length, { timeout: 20_000 }).toBe(1);
    const remount = (await marks(identity, heldAt, "viewer_mounted"))[0];
    const verified = (await marks(identity, heldAt, "rooms_verified"))[0];
    expect(remount, "the viewer remounted for the new identity").toBeDefined();
    expect(await marks(identity, heldAt, "rooms_update"), "no live delivery while held").toEqual([]);
    const beforeVerified = (await identity.probe()).dom.filter((s) => s.t >= remount.t && s.t < verified.t);
    expect(beforeVerified.filter((s) => s.requested !== ""), "nothing shown before the server read").toEqual([]);
    await expect(identity.viewer).toHaveAttribute("data-shown-room", "living", { timeout: 20_000 });
    await expect(identity.viewer).toHaveAttribute("data-live", "confirmed");
    await expect.poll(identity.subscriptions).toBe(1);
    identity.release();

    // A closed viewer leaves its last value in the client. Archive the villa while deliveries are
    // held, then reopen: the retained scene must not be shown, requested or painted.
    await openTour(warm, villa.slug);
    warm.net.hold = true;
    await warm.page.keyboard.press("Escape");
    await expect(warm.viewer).toHaveCount(0);
    await (await villa.as()).mutation(properties.setStatus, { propertyId: villa.propertyId, status: "archived" });
    warm.panoramas.length = 0;
    const reopenedAt = await warm.now();
    await warm.page.getByRole("button", { name: /Explore 360|Explore in 360/i }).first().click();
    await expect(warm.viewer).toBeVisible();
    await expect.poll(warm.subscriptions).toBe(1);
    await sleep(1_500);
    const held = await warm.probe();
    expect(held.dom.filter((s) => s.t >= reopenedAt && (s.requested !== "" || s.status === "ready"))).toEqual([]);
    expect(held.marks.filter((m) => m.t >= reopenedAt && ["rooms_update", "rooms_verified", "texture_request_start"].includes(m.name))).toEqual([]);
    expect(warm.panoramas).toEqual([]);
    const released = await warm.now();
    warm.release();
    const cleared = await converged(warm, released, (s) => s.status === "empty");
    expect(cleared.deliveryToAppliedFrames).toBeLessThanOrEqual(FRAMES);
    expect(warm.panoramas).toEqual([]);
    (results.scenarios as Record<string, unknown>).remount = {
      identity: { remountToVerifiedMs: Math.round(verified.t - remount.t), shownBeforeVerified: 0 },
      warmReopenArchived: { heldMs: Math.round(released - reopenedAt), panoramaRequests: warm.panoramas.length, cleared },
    };
  } finally {
    await identity.context.close();
    await warm.context.close();
    await villa.cleanup();
  }
});

test("the SDK gives a second watch of a held query no delivery, so the viewer confirms it with one read", async ({ browser }) => {
  const villa = await fixture(browser);
  const query = api.catalog.properties.getTourRooms;
  const sent: string[] = [];
  class CountingSocket extends WebSocket {
    override send(data: Parameters<WebSocket["send"]>[0]) {
      if (typeof data === "string") sent.push(data);
      super.send(data);
    }
  }
  const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
    webSocketConstructor: CountingSocket, unsavedChangesWarning: false, logger: false,
  });
  const stops: (() => void)[] = [];
  const adds = () => sent.flatMap((raw) => {
    const message = JSON.parse(raw) as { type?: string; modifications?: { type: string; udfPath?: string }[] };
    return message.type === "ModifyQuerySet" ? message.modifications ?? [] : [];
  }).filter((change) => change.type === "Add" && change.udfPath?.endsWith(":getTourRooms")).length;
  try {
    const holder = client.watchQuery(query, { slug: villa.slug });
    await new Promise<void>((resolve) => stops.push(holder.onUpdate(resolve)));

    let plainUpdates = 0;
    const plain = client.watchQuery(query, { slug: villa.slug });
    stops.push(plain.onUpdate(() => { plainUpdates += 1; }));
    expect(plain.localQueryResult()).toHaveLength(ROOMS.length);

    const snapshots: LiveTourSnapshot[] = [];
    const reads: string[] = [];
    stops.push(watchLiveTourRooms(client, villa.slug, (snapshot) => snapshots.push(snapshot), (convex, slug) => {
      reads.push(slug);
      return readTourRooms(convex, slug);
    }));
    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBe(1);
    expect(snapshots[0]).toMatchObject({ rooms: expect.arrayContaining([expect.objectContaining({ slug: "living" })]) });
    await sleep(1_500);
    expect(plainUpdates, "the SDK sends a second watch nothing until the data changes").toBe(0);
    expect(reads).toEqual([villa.slug]);
    expect(adds(), "one live subscription for every watch of the query").toBe(1);

    // A change still reaches every watch, the viewer's included.
    await (await villa.as()).mutation(properties.reorderRooms, { propertyId: villa.propertyId, roomSlugs: ["garden", "living", "pool"] });
    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBe(2);
    expect(plainUpdates).toBe(1);
    expect(adds()).toBe(1);
    (results.scenarios as Record<string, unknown>).sharedWatch = {
      secondWatchDeliveriesWithoutChange: 0, serverReads: reads.length, liveSubscriptionAdds: adds(),
    };
  } finally {
    for (const stop of stops) stop();
    await client.close();
    await villa.cleanup();
  }
});

/** Run `work` within `ms`, failing with the milestone's name; records when each milestone settled. */
function milestones() {
  const start = Date.now();
  const settled: Record<string, number> = {};
  async function step<T>(name: string, work: () => Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Milestone "${name}" did not settle within ${ms} ms`)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      settled[name] = Date.now() - start;
    }
  }
  return { step, settled };
}

/**
 * A TCP proxy in front of the local backend for a Node Convex client; the SDK and its WebSocket are
 * untouched. Every connection is accepted and its upgrade request forwarded.
 * - `hold`: after the upgrade, server frames are kept back (the client sees an open, silent socket).
 * - `stall`: on connections accepted meanwhile, the server's upgrade response and everything after
 *   it are kept back, so the client's socket stays CONNECTING: genuinely offline. `resume` forwards
 *   them in order and the real handshake completes.
 * - `drop` closes the open connections at the TCP level. `close` discards everything held and
 *   destroys every socket.
 */
async function controllableProxy(backend: URL) {
  const state = { hold: false, stall: false, accepted: 0, stalled: 0 };
  const held: (() => void)[] = [];
  const stalled = new Set<{ flush: () => void }>();
  const sockets = new Set<TcpSocket>();
  const pairs = new Set<[TcpSocket, TcpSocket]>();
  const server = createServer((client) => {
    state.accepted += 1;
    const upstream = connect(Number(backend.port), backend.hostname);
    const pair: [TcpSocket, TcpSocket] = [client, upstream];
    for (const socket of pair) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    }
    pairs.add(pair);
    // Bytes held for a stalled connection, from the upgrade response onwards.
    let pending: Buffer[] | null = null;
    if (state.stall) {
      state.stalled += 1;
      pending = [];
      const entry = { flush: () => {
        stalled.delete(entry);
        const chunks = pending ?? [];
        pending = null;
        for (const chunk of chunks) receive(chunk);
      } };
      stalled.add(entry);
    }
    let response = Buffer.alloc(0);
    let upgraded = false;
    function receive(chunk: Buffer) {
      if (pending) return void pending.push(chunk);
      if (!upgraded) {
        response = Buffer.concat([response, chunk]);
        const end = response.indexOf("\r\n\r\n");
        if (end < 0) return;
        upgraded = true;
        client.write(response.subarray(0, end + 4));
        chunk = response.subarray(end + 4);
        if (!chunk.length) return;
      }
      const forward = () => { if (!client.destroyed) client.write(chunk); };
      if (state.hold) held.push(forward);
      else forward();
    }
    client.on("data", (chunk) => upstream.write(chunk));
    upstream.on("data", receive);
    const close = () => { pairs.delete(pair); client.destroy(); upstream.destroy(); };
    for (const socket of pair) { socket.on("close", close); socket.on("error", close); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    open: () => pairs.size,
    held: () => held.length,
    drop: () => { for (const [client, upstream] of [...pairs]) { client.destroy(); upstream.destroy(); } },
    release: () => { state.hold = false; for (const forward of held.splice(0)) forward(); },
    resume: () => { state.stall = false; for (const entry of [...stalled]) entry.flush(); },
    close: () => new Promise<void>((resolve) => {
      state.hold = false;
      state.stall = false;
      held.length = 0;
      stalled.clear();
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

test("a held-value read from before a reconnect never vouches, and an offline mount shows nothing", async ({ browser }) => {
  const { step, settled } = milestones();
  const villa = await step("fixture", () => fixture(browser), 60_000);
  const backend = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const query = api.catalog.properties.getTourRooms;
  const proxy = await step("proxy listening", () => controllableProxy(backend), 5_000);
  const client = new ConvexReactClient(proxy.url, {
    unsavedChangesWarning: false, logger: false, skipConvexDeploymentUrlCheck: true,
  });
  const stops: (() => void)[] = [];
  const connected = () => client.connectionState();
  const archive = async (status: "archived" | "active") =>
    (await villa.as()).mutation(properties.setStatus, { propertyId: villa.propertyId, status });
  let passed = false;
  try {
    // Another watch keeps the active scenes (v1) alive on the first proxied connection.
    const holder = client.watchQuery(query, { slug: villa.slug });
    await step("first delivery through the proxy", () => new Promise<void>((resolve) => stops.push(holder.onUpdate(resolve))), 20_000);
    const v1 = holder.localQueryResult();
    expect(v1).toHaveLength(ROOMS.length);
    expect(proxy.open()).toBe(1);
    const firstConnection = connected().connectionCount;

    // The viewer's confirming read is answered by the server now, before the archive, and handed to
    // the viewer only when the gate opens.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let origin: Promise<NonNullable<typeof v1> | null> | undefined;
    const reads: string[] = [];
    const snapshots: LiveTourSnapshot[] = [];
    stops.push(watchLiveTourRooms(client, villa.slug, (snapshot) => snapshots.push(snapshot), (_convex, slug) => {
      reads.push(slug);
      origin = readTourRooms({ url: backend.origin } as never, slug);
      return origin.then((rooms) => gate.then(() => rooms));
    }));
    expect(reads).toEqual([villa.slug]);
    expect(await step("origin read before the archive", () => origin!, 10_000)).toEqual(v1);
    expect(snapshots).toEqual([]);

    // Drop the connection, archive, and let a new connection open with its deliveries held.
    proxy.state.hold = true;
    proxy.drop();
    await step("archive committed", () => archive("archived"), 15_000);
    await expect.poll(() => connected().isWebSocketConnected && connected().connectionCount > firstConnection,
      { timeout: 30_000, message: "a new proxied connection opens while deliveries are held" }).toBe(true);
    open();
    await sleep(500);
    expect(proxy.held(), "the new connection's server frames are being held").toBeGreaterThan(0);
    // The SDK still holds v1 before the resync, which is what made the old read look valid.
    expect(holder.localQueryResult(), "the client keeps the old value until the server re-sends it").toEqual(v1);
    expect(snapshots, "no scenes from a read that started on the replaced connection").toEqual([]);
    proxy.release();
    await expect.poll(() => snapshots, { timeout: 10_000, message: "the held re-delivery clears the scenes" })
      .toEqual([{ rooms: null, connection: connected().connectionCount }]);

    // Offline mount: no read and nothing shown until the reconnect delivery.
    await step("villa active again", () => archive("active"), 15_000);
    await expect.poll(() => holder.localQueryResult(), { timeout: 10_000, message: "the holder sees v1 again" }).toEqual(v1);
    proxy.state.stall = true;
    proxy.drop();
    await expect.poll(() => connected().isWebSocketConnected, { timeout: 10_000, message: "the client is offline" }).toBe(false);
    const offlineReads: string[] = [];
    const offline: LiveTourSnapshot[] = [];
    stops.push(watchLiveTourRooms(client, villa.slug, (snapshot) => offline.push(snapshot), (_convex, slug) => {
      offlineReads.push(slug);
      return readTourRooms({ url: backend.origin } as never, slug);
    }));
    await expect.poll(() => proxy.state.stalled, { timeout: 10_000, message: "a reconnect attempt is stalled before its upgrade response" }).toBeGreaterThan(0);
    await sleep(500);
    expect(connected().isWebSocketConnected).toBe(false);
    expect(offlineReads).toEqual([]);
    expect(offline).toEqual([]);
    proxy.resume();
    await expect.poll(() => offline.length, { timeout: 30_000, message: "the reconnect delivery reaches the offline-mounted watch" }).toBe(1);
    expect(offline[0]).toMatchObject({ rooms: v1, connection: connected().connectionCount });
    expect(offlineReads).toEqual([]);
    (results.scenarios as Record<string, unknown>).heldReadReconnect = {
      originReadMatchedV1: true, staleReadVouched: false, retainedValueBeforeResync: "v1",
      offlineMountReads: offlineReads.length, proxiedConnections: proxy.state.accepted,
      stalledConnections: proxy.state.stalled, milestonesMs: settled,
    };
    passed = true;
  } finally {
    for (const stop of stops) stop();
    // Release and destroy the proxy first, so closing the client cannot wait on a held frame.
    const problems: unknown[] = [];
    for (const [name, work, ms] of [
      ["proxy closed", () => proxy.close(), 5_000],
      ["Node client closed", () => client.close(), 5_000],
      ["fixture removed", () => villa.cleanup(), 30_000],
    ] as const) {
      await step(name, work, ms).catch((error: unknown) => problems.push(error));
    }
    if (passed && problems.length) throw problems[0];
  }
});
