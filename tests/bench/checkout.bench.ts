import { readFileSync, writeFileSync } from "node:fs";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Browser, type BrowserContextOptions } from "@playwright/test";

/**
 * Checkout on a desk-iPad profile (1180×820 landscape, touch, DPR 2, CPU 4×), against a running
 * production server (BENCH_BASE_URL, else E2E_BASE_URL). Checkout needs a signed-in staff session,
 * from either:
 * - the e2e Clerk test identities: run it inside the local integration harness, which starts a
 *   fresh seeded local Convex, a production build and a cashier test user (E2E_CASHIER_EMAIL):
 *     node scripts/heavy.mjs node scripts/local-integration.mjs -- bun run bench:browser checkout.bench.ts
 *   The bench signs that cashier in once (clerkSetup + clerk.signIn, as tests/e2e do) in a context
 *   it doesn't measure, and reuses its storage state for every cold run.
 * - BENCH_CHECKOUT_STATE: a Playwright storage-state file for a cashier or manager on that server
 *   (e.g. saved with `context.storageState({ path })` after signing in).
 * Without either the case is skipped. BENCH_RECEIPT_ID adds a receipt case (any paid order).
 *
 * Measured per run (cold HTTP cache, new context):
 * - openToCatalogMs: navigation start → the catalog's Frequent tab visible.
 * - initialScriptBytes: encodedBodySize of scripts fetched before that point.
 * - addItemMs: tap a catalog tile → the order pane shows that item (a real pos.addItem round trip).
 * - openReceiptMs: navigation start → the receipt heading visible.
 * Every run uses ?timing=1, so the p95 per action from the staff readout (localStorage
 * "checkout-timing") is reported too: the same numbers the owner reads on the real desk iPad.
 * Each run is a new context with empty storage, so its samples are added to the ones before.
 */
const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const STATE = process.env.BENCH_CHECKOUT_STATE;
const STAFF_EMAIL = process.env.BENCH_STAFF_EMAIL ?? process.env.E2E_CASHIER_EMAIL;
const RECEIPT = process.env.BENCH_RECEIPT_ID;
type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

/** A signed-in staff session: the given state file, or the e2e test cashier signed in once. */
async function staffState(browser: Browser): Promise<StorageState> {
  if (STATE) return JSON.parse(readFileSync(STATE, "utf8")) as StorageState;
  await clerkSetup({ dotenv: false });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/admin/chats");
    await clerk.signIn({ page, emailAddress: STAFF_EMAIL! });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/** Adds one context's samples to those of earlier runs (each new context starts with none). */
function mergeTiming(into: Record<string, number[]>, from: Record<string, number[]>) {
  for (const [action, runs] of Object.entries(from)) into[action] = [...(into[action] ?? []), ...runs];
  return into;
}

async function newPage(browser: Browser, storageState: StorageState) {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, storageState,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { context, page };
}

const scriptBytes = () => (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
  .filter((entry) => entry.initiatorType === "script").reduce((sum, entry) => sum + entry.encodedBodySize, 0);

test("checkout open, add item and receipt on a desk-iPad profile", async ({ browser }) => {
  test.skip(!STATE && !STAFF_EMAIL, "Run inside scripts/local-integration.mjs (E2E_CASHIER_EMAIL), or set BENCH_CHECKOUT_STATE to a signed-in staff storage state");
  test.setTimeout(RUNS * 180_000 + 120_000);
  const storageState = await staffState(browser);
  const samples: Array<{ openToCatalogMs: number; initialScriptBytes: number; addItemMs: number | null; openReceiptMs: number | null }> = [];
  const timing: Record<string, number[]> = {};
  for (let run = 0; run < RUNS; run++) {
    const { context, page } = await newPage(browser, storageState);
    await page.goto("/admin/checkout?timing=1", { waitUntil: "commit" });
    const frequent = page.getByRole("tab", { name: "Frequent", exact: true }).first();
    await expect(frequent).toBeVisible({ timeout: 60_000 });
    const openToCatalogMs = await page.evaluate(() => performance.now());
    const initialScriptBytes = await page.evaluate(scriptBytes);

    let addItemMs: number | null = null;
    const tile = page.getByRole("button", { name: /Add to order/ }).first();
    if (await tile.isVisible()) {
      const name = (await tile.locator(".line-clamp-2").first().textContent())?.trim() ?? "";
      const order = page.getByRole("complementary", { name: "Order", exact: true });
      const started = Date.now();
      await tile.click();
      // The row as the order pane draws it once pos.addItem answers (its controls open with the row).
      await expect(order.getByText(name).first()).toBeVisible({ timeout: 30_000 });
      addItemMs = Date.now() - started;
    }

    let openReceiptMs: number | null = null;
    if (RECEIPT) {
      await page.goto(`/admin/receipt/${RECEIPT}?timing=1`, { waitUntil: "commit" });
      await expect(page.getByRole("heading", { name: /^Receipt / })).toBeVisible({ timeout: 60_000 });
      openReceiptMs = await page.evaluate(() => performance.now());
    }
    mergeTiming(timing, await page.evaluate(() => JSON.parse(localStorage.getItem("checkout-timing") ?? "{}") as Record<string, number[]>));
    samples.push({ openToCatalogMs, initialScriptBytes, addItemMs, openReceiptMs });
    await context.close();
  }
  const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
  const p95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] : null;
  const output = {
    profile: "desk iPad 1180×820, touch, DPR 2, CPU 4×, cold cache",
    session: STATE ? "BENCH_CHECKOUT_STATE" : "e2e test cashier",
    runs: RUNS,
    median: {
      openToCatalogMs: median(samples.map((s) => s.openToCatalogMs)),
      initialScriptBytes: median(samples.map((s) => s.initialScriptBytes)),
      addItemMs: median(samples.flatMap((s) => (s.addItemMs === null ? [] : [s.addItemMs]))),
      openReceiptMs: median(samples.flatMap((s) => (s.openReceiptMs === null ? [] : [s.openReceiptMs]))),
    },
    actionP95Ms: Object.fromEntries(Object.entries(timing).map(([action, runs]) => [action, p95(runs)])),
    samples,
  };
  console.log(JSON.stringify(output.median), JSON.stringify(output.actionP95Ms));
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${JSON.stringify(output, null, 2)}\n`);
});
