import { expect, test, type Locator, type Page } from "@playwright/test";
import { Taps } from "./helpers/desk-taps";

/*
 * W2A·L3 · Pay desk in a real browser on the fixture database, wired as the live checkout is.
 * Journeys count taps from the order (v27 "Thirteen desk journeys": a tap that opens or focuses
 * counts; the card terminal doesn't). Below 1024 px the order is a sheet, one more tap.
 * CAPTURE_SCREENSHOTS=1 saves evidence in test-results/pay-desk/ at 390, 820 (keyboard open), 1180 and 1440.
 */

const WIDTHS = {
  phone: { width: 390, height: 844 },
  portraitKeyboard: { width: 820, height: 700 },
  landscape: { width: 1180, height: 820 },
  desktop: { width: 1440, height: 900 },
} as const;
type Width = keyof typeof WIDTHS;
const NOW = new Date("2026-11-19T14:00:00+07:00");

async function open(page: Page, width: Width, query: string) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize(WIDTHS[width]);
  await page.goto(`/tests/browser/pay-desk.html?${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

/** The order: beside the catalog from 1024 px, else the sheet (one tap). */
async function order(page: Page, taps: Taps) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) return page.getByRole("complementary", { name: "Order", exact: true });
  await taps.tap(page.getByRole("button", { name: /open the order/ }), "open order");
  return page.getByRole("dialog");
}

const CAPTURE_SHOTS = process.env.CAPTURE_SCREENSHOTS === "1";

async function shot(page: Page, name: string) {
  if (CAPTURE_SHOTS) await page.screenshot({ path: `test-results/pay-desk/${name}-${page.viewportSize()!.width}.png` });
}

async function targets(scope: Locator) {
  const small = await scope.locator("button:visible, input:visible").evaluateAll((els) => els
    .map((el) => ({ label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.id, ...el.getBoundingClientRect().toJSON() }))
    .filter((box) => box.width > 0 && (box.height < 44 || box.width < 44)).map((box) => `${box.label} ${Math.round(box.width)}×${Math.round(box.height)}`));
  return small;
}

async function inView(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  const { height, width } = page.viewportSize()!;
  return box.y >= 0 && box.y + box.height <= height + 1 && box.x >= 0 && box.x + box.width <= width + 1;
}

const payments = (page: Page) => page.evaluate(() => (window as unknown as { payDesk: { fixtureRows(t: string): Promise<{ method: string; amount: number }[]> } }).payDesk.fixtureRows("orderPayments"));

for (const width of Object.keys(WIDTHS) as Width[]) test.describe(width, () => {
  // Phones and iPads are touch screens (every control ≥ 44 × 44 px); the desktop uses a mouse.
  const touch = width !== "desktop";
  test.use({ hasTouch: touch, isMobile: touch });
  test(`Card in two taps from the order, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
    const confirm = panel.getByRole("button", { name: "Confirm ฿1,200" });
    await expect(confirm).toBeFocused();
    expect(await inView(page, confirm)).toBe(true);
    if (touch) expect(await targets(panel.getByTestId("pay-panel"))).toEqual([]);
    await shot(page, "card-instruction");
    await taps.tap(confirm, "Confirm ฿1,200");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    const tapped = taps.summary();
    console.log(`card ${width}: ${JSON.stringify(tapped.log)}`);
    expect(tapped.log).toEqual([...(WIDTHS[width].width < 1024 ? ["tap open order"] : []), "tap Card", "tap Confirm ฿1,200"]);
    expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
  });

  test(`cash received keeps Confirm above the keyboard, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: /^Cash/ }).first(), "Cash");
    await expect(panel.getByText("Collect ฿1,200 cash")).toBeVisible();
    await taps.type(panel.getByLabel("Cash received"), "1500", "cash received");
    await expect(panel.getByTestId("cash-change")).toHaveText("฿300");
    const confirm = panel.getByRole("button", { name: "Confirm · ฿1,200 cash received" });
    expect(await inView(page, confirm)).toBe(true);
    await shot(page, "cash-keyboard");
    await taps.tap(confirm, "Confirm cash");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    console.log(`cash ${width}: ${JSON.stringify(taps.summary().log)}`);
  });
});

test("reload after the terminal approved shows Check previous payment, never a second charge", async ({ page }) => {
  await open(page, "landscape", "mode=attempts");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
  // The guest taps the card; the iPad closes before staff confirm.
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  const resumed = page.getByRole("complementary", { name: "Order", exact: true });
  await expect(resumed.getByTestId("check-previous")).toContainText(/Card ฿1,200 · \d\d:\d\d/);
  await expect(resumed.getByText("on the terminal")).toHaveCount(0);
  for (const w of ["landscape", "desktop", "phone", "portraitKeyboard"] as const) { await page.setViewportSize(WIDTHS[w]); if (WIDTHS[w].width >= 1024) await shot(page, "check-previous"); }
  await page.setViewportSize(WIDTHS.landscape);
  await taps.tap(resumed.getByRole("button", { name: "Taken", exact: true }), "Taken");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toHaveLength(1);
});

test("a lost answer after Confirm, then a reload, settles the same payment once", async ({ page }) => {
  await open(page, "landscape", "mode=attempts");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await page.evaluate(() => (window as unknown as { payDesk: { loseNextAnswer(name: string): void } }).payDesk.loseNextAnswer("pos/commands/recordPaymentLeg:recordPaymentLeg"));
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200" }), "Confirm");
  await expect(panel.getByTestId("pay-offline")).toContainText("No answer from the server");
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
});

test("offline: the banner shows, nothing is lost, and Retry sends the same step", async ({ page, context }) => {
  await open(page, "landscape", "mode=attempts");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "PromptPay", exact: true }), "PromptPay");
  await expect(panel.getByText("Request ฿1,200 by PromptPay")).toBeVisible();
  await context.setOffline(true);
  await expect(panel.getByTestId("pay-offline")).toContainText("Offline");
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200" }), "Confirm");
  await shot(page, "offline");
  await context.setOffline(false);
  await taps.tap(panel.getByRole("button", { name: "Retry" }), "Retry");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toHaveLength(1);
});

test("split payment across parts survives a reload, and the untouched rest changes method", async ({ page }) => {
  await open(page, "phone", "mode=attempts&scenario=big");
  const taps = new Taps(page);
  let panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Split payment" }), "Split");
  await taps.tap(panel.getByLabel("Payment 1 method").getByText("Card", { exact: true }), "part 1 Card");
  await taps.tap(panel.getByLabel("Payment 2 method").getByText("Transfer", { exact: true }), "part 2 Transfer");
  await taps.type(panel.getByLabel("Payment 1 amount"), "3000", "part 1 amount");
  await taps.tap(panel.getByRole("button", { name: "Charge ฿3,000" }), "Charge ฿3,000");
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿3,000" }), "Confirm ฿3,000");
  await expect(panel.getByText("Card ฿3,000 · taken")).toBeVisible();
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  panel = await order(page, taps);
  await expect(panel.getByText("Card ฿3,000 · taken")).toBeVisible();
  await taps.tap(panel.getByLabel("Payment 2 method").getByText("PromptPay", { exact: true }), "part 2 PromptPay");
  await shot(page, "split-after-reload");
  await taps.tap(panel.getByRole("button", { name: "Charge ฿2,000" }), "Charge ฿2,000");
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿2,000" }), "Confirm ฿2,000");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  console.log(`split: ${JSON.stringify(taps.summary().log)}`);
  expect(await payments(page)).toMatchObject([{ method: "card", amount: 300000 }, { method: "promptpay", amount: 200000 }]);
});

test("Pay the room first splits the stay before any instruction, then charges the room", async ({ page }) => {
  await open(page, "landscape", "mode=attempts&scenario=room");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText("This bill is too large to pay in one go")).toBeVisible();
  await expect(panel.getByText("on the terminal")).toHaveCount(0);
  await taps.tap(panel.getByRole("button", { name: "Pay the room first" }), "Pay the room first");
  await expect(panel.getByTestId("linked-shop")).toContainText("Shop & spa · ฿350");
  await expect(panel.getByText(/^Charge ฿[\d,]+ on the terminal$/)).toBeVisible();
  await shot(page, "room-first");
  await taps.tap(panel.getByRole("button", { name: /^Confirm ฿/ }), "Confirm");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  console.log(`room first: ${JSON.stringify(taps.summary().log)}`);
  expect(taps.summary().log).toEqual(["tap Card", "tap Pay the room first", "tap Confirm"]);
});

test("another till's payment locks the order and shows who is taking it", async ({ page }) => {
  await open(page, "landscape", "mode=attempts&role=cashier");
  const orderId = await page.evaluate(() => sessionStorage.getItem("pay-desk-fixture-order"));
  await page.evaluate(async (id) => {
    type Row = { revision: number; _id: string; paymentRollout?: { acknowledged?: { revision: number } } };
    const desk = (window as unknown as { payDesk: { runFixtureMutation(n: string, a: object): Promise<{ attempt: { attemptId: string } }>; fixtureRows(t: string): Promise<Row[]>; insertFixtureRows(rows: object[]): Promise<void> } }).payDesk;
    const [row] = (await desk.fixtureRows("orders")).filter((o) => o._id === id);
    // The other till acknowledged the new panel too (start admission refuses any other till).
    let acknowledged: { revision: number } | undefined;
    for (let i = 0; i < 50 && !acknowledged; i++) {
      acknowledged = (await desk.fixtureRows("tills")).find((till) => till.paymentRollout?.acknowledged)?.paymentRollout?.acknowledged;
      if (!acknowledged) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!acknowledged) throw new Error("This till never acknowledged the new panel");
    // The other till is another browser: its own device key, admitted by its own acknowledgement.
    const deviceKey = "other-till-device-key-0001";
    const { tillId: till } = await desk.runFixtureMutation("commerce/paymentCutover:acknowledge", { deviceKey, loadedMode: "attempts", loadedRevision: acknowledged.revision }) as unknown as { tillId: string };
    const own = { tillId: till, tabKey: "other-till-tab-key-000001", load: { tillId: till, deviceKey, loadedMode: "attempts", loadedRevision: acknowledged.revision } };
    const started = await desk.runFixtureMutation("pos/commands/startPaymentAttempt:startPaymentAttempt", {
      orderId: id, ...own,
      clientKey: "other-till", expectedRevision: row.revision, expectedDue: 120000, businessDate: "2026-11-19", customers: [], vouchers: [], legs: [{ key: "card-1", method: "card", amount: 120000 }],
    });
    await desk.runFixtureMutation("pos/commands/armPaymentLeg:armPaymentLeg", { attemptId: started.attempt.attemptId, ownerRevision: 0, ...own, legKey: "card-1" });
  }, orderId);
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await expect(panel.getByTestId("payment-elsewhere")).toContainText(/Payment in progress on Till [A-Z0-9]{6}/);
  await expect(panel.getByRole("button", { name: "Card", exact: true })).toHaveCount(0);
  for (const w of Object.keys(WIDTHS) as Width[]) {
    await page.setViewportSize(WIDTHS[w]);
    if (WIDTHS[w].width < 1024) { await page.getByRole("button", { name: /open the order/ }).click(); await expect(page.getByRole("dialog").getByTestId("payment-elsewhere")).toBeVisible(); }
    await shot(page, "elsewhere");
    if (WIDTHS[w].width < 1024) await page.keyboard.press("Escape");
  }
});

test("the pause and reload screens replace the pay buttons", async ({ page }) => {
  await open(page, "landscape", "paused=1");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await expect(panel.getByTestId("checkout-paused")).toContainText("Checkout paused for update");
  await expect(panel.getByRole("button", { name: "Card", exact: true })).toHaveCount(0);
  await shot(page, "paused");
  // The manager switches to new payments while this till still has the direct panel loaded.
  await page.evaluate(() => (window as unknown as { payDesk: { setCommerceSettings(p: object): Promise<void> } }).payDesk.setCommerceSettings({ paymentsMode: "attempts", paused: false }));
  await expect(panel.getByTestId("till-reload")).toContainText("Reload this till to take payments again");
  await shot(page, "reload");
  await panel.getByRole("button", { name: "Reload" }).click();
  await page.locator("[data-fixture-ready]").waitFor();
  const taps = new Taps(page);
  await taps.tap(page.getByRole("complementary", { name: "Order", exact: true }).getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(page.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
});

test("before the cutover the direct panel is unchanged", async ({ page }) => {
  await open(page, "landscape", "");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Confirm ฿1,200 card" })).toBeVisible();
  await expect(page.locator("[data-pay-desk]")).toHaveCount(0);
  await panel.getByRole("button", { name: "Confirm ฿1,200 card" }).click();
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
});

// ─── Audit round 1 (PR #92): astra B2, M4, M5, M6, m7, m8 and sol B1 ────────────────────────────
const ARM = "pos/commands/armPaymentLeg:armPaymentLeg";
const reopen = async (page: Page, taps: Taps) => {
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  return order(page, taps);
};

for (const width of Object.keys(WIDTHS) as Width[]) test.describe(`round 1 at ${width}`, () => {
  const touch = width !== "desktop";
  test.use({ hasTouch: touch, isMobile: touch });

  test(`a reload during a give-back reconciles it and never repeats the refund, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=tote");
    const taps = new Taps(page);
    let panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText("Charge ฿1,900 on the terminal")).toBeVisible();
    // The owner switches product sales off after the guest's card was charged.
    await page.evaluate(() => (window as unknown as { productSales(flag: string): Promise<void> }).productSales("off"));
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,900" }), "Confirm ฿1,900");
    await taps.tap(panel.getByRole("button", { name: "Give all the money back" }), "Give all the money back");
    await expect(panel.getByText("Refund ฿1,900 on the terminal")).toBeVisible();
    panel = await reopen(page, taps);
    const check = panel.getByTestId("check-previous");
    await expect(check).toContainText("Check previous refund");
    await expect(check).toContainText(/Card ฿1,900 · \d\d:\d\d/);
    await expect(check).toContainText("What does the terminal show?");
    await expect(panel.getByText(/on the terminal/)).toHaveCount(0);
    expect(await targets(panel.getByTestId("pay-panel"))).toEqual([]);
    await shot(page, "r1-give-back-check");
    await taps.tap(panel.getByRole("button", { name: "Given back", exact: true }), "Given back");
    const given = panel.getByTestId("money-given-back");
    await expect(given).toContainText("Card ฿1,900 taken");
    await expect(given).toContainText("Card ฿1,900 given back");
    await expect(given).toContainText("Kept · ฿0");
    await expect(panel.getByText("Nothing was taken")).toHaveCount(0);
    await shot(page, "r1-given-back");
    expect(await payments(page)).toHaveLength(0);
  });

  test(`a split reloads exactly as planned and the rest can change method, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=big");
    const taps = new Taps(page);
    let panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Split payment" }), "Split");
    await taps.tap(panel.getByLabel("Payment 1 method").getByText("Card", { exact: true }), "part 1 Card");
    await taps.tap(panel.getByLabel("Payment 2 method").getByText("Transfer", { exact: true }), "part 2 Transfer");
    await taps.type(panel.getByLabel("Payment 1 amount"), "3000", "part 1 amount");
    // Every split control is at least 44 × 44, with a mouse too (astra m8).
    expect(await targets(panel.getByTestId("pay-panel"))).toEqual([]);
    await shot(page, "r1-split-planned");
    await taps.tap(panel.getByRole("button", { name: "Charge ฿3,000" }), "Charge ฿3,000");
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿3,000" }), "Confirm ฿3,000");
    panel = await reopen(page, taps);
    await expect(panel.getByText("Card ฿3,000 · taken")).toBeVisible();
    const planned = panel.locator('[data-testid="split-part"][data-state="planned"]');
    await expect(planned).toHaveCount(1);
    await expect(planned.locator("h3")).toHaveText("Payment 2 · rest");
    await expect(panel.getByLabel("Payment 2 amount")).toHaveText("2,000");
    await expect(panel.getByLabel("Payment 2 method").locator('[data-state="on"]')).toHaveText("Transfer");
    await expect(panel.getByText("Payment 3")).toHaveCount(0);
    await expect(page.getByTestId("order-panel-title")).toHaveText("Still to collect");
    await expect(page.getByTestId("pay-header-due")).toHaveText("฿2,000");
    expect(await targets(panel.getByTestId("pay-panel"))).toEqual([]);
    await shot(page, "r1-split-after-reload");
    await taps.tap(panel.getByLabel("Payment 2 method").getByText("PromptPay", { exact: true }), "part 2 PromptPay");
    await taps.tap(panel.getByRole("button", { name: "Charge ฿2,000" }), "Charge ฿2,000");
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿2,000" }), "Confirm ฿2,000");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "card", amount: 300000 }, { method: "promptpay", amount: 200000 }]);
  });

  test(`Check previous cash after a reload shows what was handed over and the change, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=big");
    const taps = new Taps(page);
    let panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: /^Cash/ }).first(), "Cash");
    await taps.type(panel.getByLabel("Cash received"), "5500", "cash received");
    await expect(panel.getByTestId("cash-change")).toHaveText("฿500");
    panel = await reopen(page, taps);
    const check = panel.getByTestId("check-previous");
    await expect(check).toContainText("Check previous cash");
    await expect(check.getByLabel("Cash received")).toHaveValue("5500");
    await expect(check.getByTestId("cash-change")).toHaveText("฿500");
    const taken = check.getByRole("button", { name: "Taken", exact: true });
    // With the keyboard up (the field focused), Taken stays reachable.
    await check.getByLabel("Cash received").focus();
    await taken.scrollIntoViewIfNeeded();
    expect(await inView(page, taken)).toBe(true);
    expect(await targets(panel.getByTestId("pay-panel"))).toEqual([]);
    await shot(page, "r1-previous-cash");
    await taps.tap(taken, "Taken");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "cash", amount: 500000, received: 550000 }]);
  });

  test(`offline before the first method keeps the order and starts nothing, at ${width}`, async ({ page, context }) => {
    await open(page, width, "mode=attempts");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    // The order is open and the till admitted; then the connection drops (auditor's cold disconnect).
    await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeEnabled();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await expect(panel.getByTestId("pay-offline-order")).toContainText("Offline");
    await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeDisabled();
    await expect(page.getByText("This view could not load")).toHaveCount(0);
    await shot(page, "r1-offline-before-start");
    await context.setOffline(false);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200" }), "Confirm ฿1,200");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toHaveLength(1);
  });
});

test("a second tab's Charge on the same part shows Check previous payment, not a fresh charge (sol B1)", async ({ page }) => {
  await open(page, "landscape", "mode=attempts&scenario=big");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Split payment" }), "Split");
  await taps.tap(panel.getByLabel("Payment 1 method").getByText("Card", { exact: true }), "part 1 Card");
  await taps.type(panel.getByLabel("Payment 1 amount"), "3000", "part 1 amount");
  // Another tab on this till tapped the same Charge a moment earlier: the server instructs it, not this one.
  await page.evaluate((name) => (window as unknown as { payDesk: { raceNextCall(n: string): void } }).payDesk.raceNextCall(name), ARM);
  await taps.tap(panel.getByRole("button", { name: "Charge ฿3,000" }), "Charge ฿3,000");
  await expect(panel.getByTestId("check-previous")).toContainText(/Card ฿3,000 · \d\d:\d\d/);
  await expect(panel.getByText("Charge ฿3,000 on the terminal")).toHaveCount(0);
  await shot(page, "r1-second-tab");
  await taps.tap(panel.getByRole("button", { name: "Taken", exact: true }), "Taken");
  await expect(panel.getByText("Card ฿3,000 · taken")).toBeVisible();
});

test("offline after an instruction: Confirm waits, the banner says to retry, Retry sends the same step once", async ({ page, context }) => {
  await open(page, "landscape", "mode=attempts");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "PromptPay", exact: true }), "PromptPay");
  await expect(panel.getByText("Request ฿1,200 by PromptPay")).toBeVisible();
  await context.setOffline(true);
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200" }), "Confirm");
  await expect(panel.getByTestId("pay-offline")).toContainText("Retry once the connection is back");
  await expect(panel.getByRole("button", { name: "Retry" })).toBeDisabled();
  await context.setOffline(false);
  await taps.tap(panel.getByRole("button", { name: "Retry" }), "Retry");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toHaveLength(1);
});

test("a duplicated tab sees the payment as another tab's, and only the first tab's instruction stands", async ({ page, context }) => {
  await open(page, "landscape", "mode=attempts");
  const taps = new Taps(page);
  const first = await order(page, taps);
  await taps.tap(first.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(first.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
  // Duplicate the tab: the same fixture database, the same sessionStorage (including this tab's key).
  const copied = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  expect(copied["checkout.tabKey"]).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
  const second = await context.newPage();
  await second.addInitScript((entries) => { if (!sessionStorage.length) for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v); }, copied);
  await open(second, "landscape", "mode=attempts");
  const other = second.getByRole("complementary", { name: "Order", exact: true });
  await expect(other.getByTestId("payment-elsewhere")).toContainText(/Payment in progress on Till [A-Z0-9]{6}/);
  await expect(other.getByText(/on the terminal/)).toHaveCount(0);
  await expect(other.getByTestId("check-previous")).toHaveCount(0);
  expect(await second.evaluate(() => sessionStorage.getItem("checkout.tabKey"))).not.toBe(copied["checkout.tabKey"]);
  await shot(second, "r1-duplicated-tab");
  await second.close();
  // The first tab still owns it, and a reload keeps it this tab's: Check previous payment.
  await page.reload();
  await page.locator("[data-fixture-ready]").waitFor();
  const resumed = page.getByRole("complementary", { name: "Order", exact: true });
  await expect(resumed.getByTestId("check-previous")).toContainText(/Card ฿1,200 · \d\d:\d\d/);
  await taps.tap(resumed.getByRole("button", { name: "Taken", exact: true }), "Taken");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toHaveLength(1);
});

test("Swap that removes the last row keeps the money reachable: give it all back from an empty cart", async ({ page }) => {
  await open(page, "landscape", "mode=attempts&scenario=tote");
  const taps = new Taps(page);
  const panel = await order(page, taps);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText("Charge ฿1,900 on the terminal")).toBeVisible();
  await page.evaluate(() => (window as unknown as { productSales(flag: string): Promise<void> }).productSales("off"));
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,900" }), "Confirm ฿1,900");
  await taps.tap(panel.getByRole("button", { name: "Swap the item" }), "Swap the item");
  // The rows open for the swap; the tote is removed on its own row.
  await taps.tap(panel.getByRole("button", { name: /Beach tote/ }).first(), "Beach tote");
  await taps.tap(panel.getByRole("button", { name: /^Remove/ }).first(), "Remove");
  await expect(panel.getByText("No items yet")).toBeVisible();
  await taps.tap(panel.getByRole("button", { name: "Resume payment" }), "Resume payment");
  await taps.tap(panel.getByRole("button", { name: "Give back ฿1,900" }), "Give back ฿1,900");
  await expect(panel.getByText("Refund ฿1,900 on the terminal")).toBeVisible();
  await shot(page, "r1-swap-empty-give-back");
  await taps.tap(panel.getByRole("button", { name: "Given back", exact: true }), "Given back");
  await expect(panel.getByTestId("money-given-back")).toContainText("Kept · ฿0");
  expect(await payments(page)).toHaveLength(0);
});


test("returning to Order after a direct Card instruction leaves its admission open", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  const panel = await order(page, new Taps(page));
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByText(/Charge the amount on the card terminal/)).toBeVisible();
  await panel.getByRole("button", { name: "Order", exact: true }).click();
  await expect(panel.getByTestId("pay-panel")).toHaveCount(0);
  const panels = await page.evaluate(() => (window as unknown as {
    payDesk: { fixtureRows(table: string): Promise<unknown[]> };
  }).payDesk.fixtureRows("directPaymentPanels"));
  expect(panels).toHaveLength(1);
  expect(await payments(page)).toEqual([]);
});

test("a refused second split leg exposes give-back and lets the cashier cancel after verification", async ({ page }) => {
  await open(page, "landscape", "mode=attempts&scenario=tote");
  const taps = new Taps(page);
  let panel = await order(page, taps);
  await panel.getByRole("button", { name: "Split payment" }).click();
  await panel.getByLabel("Payment 1 method").getByText("Card", { exact: true }).click();
  await panel.getByLabel("Payment 2 method").getByText("Transfer", { exact: true }).click();
  await panel.getByLabel("Payment 1 amount").fill("1000");
  await panel.getByRole("button", { name: "Charge ฿1,000" }).click();
  await panel.getByRole("button", { name: "Confirm ฿1,000" }).click();
  await expect(panel.getByText("Card ฿1,000 · taken")).toBeVisible();
  await page.evaluate(() => (window as unknown as { productSales(flag: string): Promise<void> }).productSales("off"));
  await panel.getByLabel("Payment 2 method").getByText("PromptPay", { exact: true }).click();
  await panel.getByRole("button", { name: "Charge ฿900" }).click();
  await expect(panel.getByTestId("pay-recovery")).toContainText("Money taken");
  await expect(panel.getByTestId("pay-instruction")).toHaveCount(0);
  panel = await reopen(page, taps);
  await expect(panel.getByRole("button", { name: "Swap the item" })).toBeVisible();
  await panel.getByRole("button", { name: "Give all the money back" }).click();
  await expect(panel.getByText("Refund ฿1,000 on the terminal")).toBeVisible();
  await panel.getByRole("button", { name: "Given back", exact: true }).click();
  await expect(panel.getByTestId("money-given-back")).toContainText("Kept · ฿0");
  await panel.getByRole("button", { name: "Review order" }).click();
  await expect(panel.getByTestId("pay-panel")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Resume payment" })).toHaveCount(0);
  expect(await payments(page)).toEqual([]);
});

// ─── Audit round 3 (PR #92): approved direct Card across the pause, cash corrected twice, focus ──
const pause = (page: Page, paused: boolean) => page.evaluate((value) => (window as unknown as {
  payDesk: { setCommerceSettings(p: object): Promise<void> };
}).payDesk.setCommerceSettings({ paused: value }), paused);
const directPanels = (page: Page) => page.evaluate(() => (window as unknown as {
  payDesk: { fixtureRows(table: string): Promise<unknown[]> };
}).payDesk.fixtureRows("directPaymentPanels"));
const CARD_HINT = "Charge the amount on the card terminal, then confirm here.";

for (const width of Object.keys(WIDTHS) as Width[]) test.describe(`round 3 at ${width}`, () => {
  const touch = width !== "desktop";
  test.use({ hasTouch: touch, isMobile: touch });

  test(`an approved direct Card left before Confirm is recorded during the pause under its first registration, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=direct");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText(CARD_HINT)).toBeVisible();
    // The terminal approves; the cashier taps Order before Confirm, then checkout pauses.
    await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
    await pause(page, true);
    await expect(panel.getByTestId("checkout-paused")).toBeVisible();
    await taps.tap(panel.getByRole("button", { name: "Check previous payment" }), "Check previous payment");
    const check = panel.getByTestId("check-previous");
    await expect(check).toContainText("Check previous payment");
    await expect(check).toContainText(/Card ฿1,200 · \d\d:\d\d/);
    await expect(panel.getByText(CARD_HINT)).toHaveCount(0);
    await shot(page, "r3-direct-check-previous-paused");
    await taps.tap(panel.getByRole("button", { name: "Taken", exact: true }), "Taken");
    await expect(panel.getByTestId("record-previous")).toContainText("Record the payment that was taken");
    await expect(panel.getByText(CARD_HINT)).toHaveCount(0);
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200 card" }), "Confirm");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
    expect(await directPanels(page)).toEqual([]);
  });

  test(`a second cash correction survives a second reload and is what Taken records, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=big");
    const taps = new Taps(page);
    let panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: /^Cash/ }).first(), "Cash");
    await taps.type(panel.getByLabel("Cash received"), "5500", "cash received");
    await expect(panel.getByTestId("cash-change")).toHaveText("฿500");
    panel = await reopen(page, taps);
    let check = panel.getByTestId("check-previous");
    await expect(check.getByLabel("Cash received")).toHaveValue("5500");
    await check.getByLabel("Cash received").fill("5600");
    await expect(check.getByTestId("cash-change")).toHaveText("฿600");
    panel = await reopen(page, taps);
    check = panel.getByTestId("check-previous");
    await expect(check.getByLabel("Cash received")).toHaveValue("5600");
    await expect(check.getByTestId("cash-change")).toHaveText("฿600");
    await shot(page, "r3-cash-second-reload");
    await taps.tap(check.getByRole("button", { name: "Taken", exact: true }), "Taken");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "cash", amount: 500000, received: 560000 }]);
  });

  test(`Escape and Order leave Check previous payment during the pause with focus back on it, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=direct");
    const panel = await order(page, new Taps(page));
    await panel.getByRole("button", { name: "Card", exact: true }).click();
    await expect(panel.getByText(CARD_HINT)).toBeVisible();
    await panel.getByRole("button", { name: "Order", exact: true }).click();
    await pause(page, true);
    const entry = panel.getByRole("button", { name: "Check previous payment" });
    for (const leave of ["Escape", "Order"] as const) {
      await entry.click();
      await expect(panel.getByRole("button", { name: "Taken", exact: true })).toBeFocused();
      if (leave === "Escape") await page.keyboard.press("Escape");
      else await panel.getByRole("button", { name: "Order", exact: true }).click();
      await expect(panel.getByTestId("check-previous")).toHaveCount(0);
      await expect(entry).toBeFocused();
    }
    expect(await directPanels(page)).toHaveLength(1);
  });

  test(`Order straight after Split, or after changing tender, returns focus to that tender, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=direct");
    const panel = await order(page, new Taps(page));
    await panel.getByRole("button", { name: "Split payment", exact: true }).click();
    await panel.getByRole("button", { name: "Order", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Split payment", exact: true })).toBeFocused();
    // After changing tender inside the panel, Order returns to the one now pressed.
    await panel.getByRole("button", { name: "Card", exact: true }).click();
    const pay = panel.getByTestId("pay-panel");
    const tenders = pay.getByRole("group", { name: "Take payment by" });
    await tenders.getByRole("button", { name: "PromptPay", exact: true }).click();
    await panel.getByRole("button", { name: "Order", exact: true }).click();
    await expect(pay).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "PromptPay", exact: true })).toBeFocused();
  });
});

test("unpaused, reopening a direct Card the cashier left shows Check previous payment, never a fresh instruction", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await panel.getByRole("button", { name: "Order", exact: true }).click();
  await pause(page, true);
  // During the pause, Not taken leaves the panel to a manager: no instruction either.
  await panel.getByRole("button", { name: "Check previous payment" }).click();
  await panel.getByRole("button", { name: "Not taken", exact: true }).click();
  await expect(panel.getByTestId("checkout-paused")).toBeVisible();
  await expect(panel.getByText("Ask a manager to reconcile this pay panel.")).toBeVisible();
  await expect(panel.getByText(CARD_HINT)).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to order" }).click();
  await pause(page, false);
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByTestId("check-previous")).toContainText("Check previous payment");
  await expect(panel.getByText(CARD_HINT)).toHaveCount(0);
  await shot(page, "r3-direct-check-previous-unpaused");
  // Nothing was taken: the usual instruction, still under the one registration.
  await panel.getByRole("button", { name: "Not taken", exact: true }).click();
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  expect(await directPanels(page)).toHaveLength(1);
  await panel.getByRole("button", { name: "Confirm ฿1,200 card" }).click();
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toHaveLength(1);
  expect(await directPanels(page)).toEqual([]);
});

test("Escape and Order leave Check previous payment with focus back on the tender", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await panel.getByRole("button", { name: "Order", exact: true }).click();
  // The cutover window: a pause has started (and been lifted).
  await pause(page, true);
  await pause(page, false);
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Taken", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel.getByTestId("check-previous")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeFocused();
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByTestId("check-previous")).toBeVisible();
  await panel.getByRole("button", { name: "Order", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeFocused();
  expect(await directPanels(page)).toHaveLength(1);
});

test("before any pause, reopening a direct panel left open is today's panel: no check, one registration", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  const taps = new Taps(page);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
  await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeFocused();
  await expect.poll(() => directPanels(page)).toHaveLength(1);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await expect(panel.getByTestId("check-previous")).toHaveCount(0);
  await expect(panel.getByTestId("record-previous")).toHaveCount(0);
  expect(await directPanels(page)).toHaveLength(1);
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200 card" }), "Confirm");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(taps.taps, taps.log.join("\n")).toBe(4);
  expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
  // The one registration was released by the sale.
  expect(await directPanels(page)).toEqual([]);
});

// ─── PR #93 round 3 (astra B1, B2) ──────────────────────────────────────────────────────────────
type Desk = {
  runFixtureMutation(name: string, args: object): Promise<{ status: string } & Record<string, unknown>>;
  fixtureRows(table: string): Promise<Record<string, unknown>[]>;
  setStaff(staff: { role: "cashier" | "manager"; email: string }): Promise<void>;
};
type OtherTill = { tillId: string; label: string; deviceKey: string; load: object };

/** Another admitted till (another browser): its own device key, acknowledged at this cutover. */
const otherTill = (page: Page) => page.evaluate(async () => {
  const desk = (window as unknown as { payDesk: Desk }).payDesk;
  let revision: number | undefined;
  for (let i = 0; i < 50 && revision === undefined; i++) {
    revision = (await desk.fixtureRows("tills") as { paymentRollout?: { acknowledged?: { revision: number } } }[]).find((till) => till.paymentRollout?.acknowledged)?.paymentRollout?.acknowledged?.revision;
    if (revision === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (revision === undefined) throw new Error("This till never acknowledged the new panel");
  const deviceKey = "other-till-device-key-0001";
  const { tillId } = await desk.runFixtureMutation("commerce/paymentCutover:acknowledge", { deviceKey, loadedMode: "attempts", loadedRevision: revision }) as unknown as { tillId: string };
  return { tillId, label: `Till ${tillId.slice(-6).toUpperCase()}`, deviceKey, load: { tillId, deviceKey, loadedMode: "attempts", loadedRevision: revision } } satisfies OtherTill;
});

/** The collecting attempt on this page's order, as stored. */
const liveAttempt = (page: Page) => page.evaluate(async () => {
  const orderId = sessionStorage.getItem("pay-desk-fixture-order");
  const rows = await (window as unknown as { payDesk: Desk }).payDesk.fixtureRows("paymentAttempts") as { _id: string; orderId: string; status: string; ownerRevision: number; notifyGuest?: boolean }[];
  return rows.find((row) => row.orderId === orderId && row.status === "collecting") ?? null;
});

/** Till B's cashier (Nok) accepts the handed-over payment, records nothing, and sends it back to Till A. */
async function handBack(page: Page, tillB: OtherTill) {
  const attempt = (await liveAttempt(page))!;
  await page.evaluate(async ({ tillB, attempt }) => {
    const desk = (window as unknown as { payDesk: Desk }).payDesk;
    const orderId = sessionStorage.getItem("pay-desk-fixture-order")!;
    const tillA = localStorage.getItem("checkout.tillId")!;
    const own = { tillId: tillB.tillId, tabKey: "other-till-tab-key-000001" };
    await desk.setStaff({ role: "cashier", email: "nok@example.com" });
    const accepted = await desk.runFixtureMutation("pos/commands/handoverPaymentAttempt:takeOverPaymentAttempt", { ...own, load: tillB.load, orderId, expectedOwnerRevision: attempt.ownerRevision });
    if (accepted.status !== "taken_over") throw new Error(JSON.stringify(accepted));
    const released = await desk.runFixtureMutation("pos/commands/handoverPaymentAttempt:releasePaymentAttempt", { ...own, attemptId: attempt._id, ownerRevision: attempt.ownerRevision + 1, nextTillId: tillA });
    if (released.status !== "released") throw new Error(JSON.stringify(released));
    await desk.setStaff({ role: "cashier", email: "ploy@example.com" });
  }, { tillB, attempt });
}

const queuedConfirmation = (page: Page) => page.evaluate(async () =>
  ((await (window as unknown as { payDesk: Desk }).payDesk.fixtureRows("bookings")).find((row) => row._id === "fxbkg000001") as { confirmationEmailsQueuedAt?: number }).confirmationEmailsQueuedAt !== undefined);

for (const width of Object.keys(WIDTHS) as Width[]) test.describe(`PR 93 round 3 at ${width}`, () => {
  const touch = width !== "desktop";
  test.use({ hasTouch: touch, isMobile: touch });

  test(`B1: a card payment handed A → B → A shows Check previous payment on the still-open original, never a second charge, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&role=cashier");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText("Charge ฿1,200 on the terminal")).toBeVisible();
    const tillB = await otherTill(page);
    await taps.tap(panel.getByRole("button", { name: "Hand over", exact: true }), "Hand over");
    await taps.tap(panel.getByRole("button", { name: `Hand over to ${tillB.label}` }), "Hand over to B");
    await expect(panel.getByText(`Handed over to ${tillB.label}`)).toBeVisible();
    await handBack(page, tillB);
    await expect(panel.getByText("Handed over to this till")).toBeVisible();
    await taps.tap(panel.getByRole("button", { name: "Accept the payment" }), "Accept the payment");
    await expect(panel.getByTestId("check-previous")).toContainText(/Card ฿1,200 · \d\d:\d\d/);
    await expect(panel.getByText("on the terminal")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
    await shot(page, "r3-hand-back-check");
    await taps.tap(panel.getByRole("button", { name: "Taken", exact: true }), "Taken");
    // The fixture pins this browser's clock to 19 Nov while its server runs today, so a cashier's
    // same-day receipt scope hides the receipt here: check what was recorded instead.
    await expect.poll(() => payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
    await expect(page.getByTestId("check-previous")).toHaveCount(0);
    console.log(`hand back ${width}: ${JSON.stringify(taps.summary().log)}`);
  });

  test(`B2: a checked booking email survives a reload and is queued at settlement, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=stay");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText(/Charge ฿[\d,]+ on the terminal/)).toBeVisible();
    const email = () => panel.getByRole("checkbox", { name: "Send booking payment confirmation email" });
    await taps.tap(email(), "email");
    await expect(email()).toBeChecked();
    await expect.poll(async () => (await liveAttempt(page))?.notifyGuest).toBe(true);
    await page.reload();
    await page.locator("[data-fixture-ready]").waitFor();
    const resumed = await order(page, taps);
    await expect(resumed.getByTestId("check-previous")).toBeVisible();
    await expect(resumed.getByRole("checkbox", { name: "Send booking payment confirmation email" })).toBeChecked();
    await shot(page, "r3-email-reloaded");
    await taps.tap(resumed.getByRole("button", { name: "Taken", exact: true }), "Taken");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await queuedConfirmation(page)).toBe(true);
  });

  test(`B2: the till a checked booking payment is handed to shows the choice and sends it, at ${width}`, async ({ page }) => {
    await open(page, width, "mode=attempts&scenario=stay&role=cashier");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await taps.tap(panel.getByRole("checkbox", { name: "Send booking payment confirmation email" }), "email");
    await expect.poll(async () => (await liveAttempt(page))?.notifyGuest).toBe(true);
    const tillB = await otherTill(page);
    await taps.tap(panel.getByRole("button", { name: "Hand over", exact: true }), "Hand over");
    await taps.tap(panel.getByRole("button", { name: `Hand over to ${tillB.label}` }), "Hand over to B");
    await expect(panel.getByText(`Handed over to ${tillB.label}`)).toBeVisible();
    // This browser becomes Till B with its own cashier (Nok), as another device would.
    await page.evaluate(async (tillB) => {
      localStorage.setItem("checkout.deviceKey", tillB.deviceKey);
      localStorage.setItem("checkout.tillId", tillB.tillId);
      await (window as unknown as { payDesk: Desk }).payDesk.setStaff({ role: "cashier", email: "nok@example.com" });
    }, tillB);
    await page.reload();
    await page.locator("[data-fixture-ready]").waitFor();
    const onB = await order(page, taps);
    await expect(onB.getByText("Handed over to this till")).toBeVisible();
    await taps.tap(onB.getByRole("button", { name: "Accept the payment" }), "Accept the payment");
    await expect(onB.getByTestId("check-previous")).toBeVisible();
    await expect(onB.getByRole("checkbox", { name: "Send booking payment confirmation email" })).toBeChecked();
    await shot(page, "r3-email-handed-over");
    await taps.tap(onB.getByRole("button", { name: "Taken", exact: true }), "Taken");
    // As above: a cashier's receipt is out of scope under the fixture's pinned browser clock.
    await expect.poll(() => queuedConfirmation(page)).toBe(true);
    expect(await payments(page)).toHaveLength(1);
  });
});


// ─── Audit round 4 (PR #92): today's direct panel before any pause, the instruction across it ──
const isOpenPanel = (body: string | null) => (body ?? "").includes("paymentCutover:openDirectPanel");

test("before any pause, a failed registration leaves today's Card panel and its two taps", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  await page.route("**/__checkout-fixture", (route) => isOpenPanel(route.request().postData()) ? route.abort() : route.continue());
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  const taps = new Taps(page);
  await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await expect(panel.getByText("The pay panel didn't open")).toHaveCount(0);
  await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200 card" }), "Confirm");
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(taps.taps).toBe(2);
  expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
});

test("before any pause, a registration with no answer yet never holds up today's panel", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__checkout-fixture", async (route) => {
    if (isOpenPanel(route.request().postData())) await held;
    await route.continue();
  });
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await panel.getByRole("button", { name: "Card", exact: true }).click();
  await expect(panel.getByText(CARD_HINT)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Confirm ฿1,200 card" })).toBeEnabled();
  release();
  await panel.getByRole("button", { name: "Confirm ฿1,200 card" }).click();
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
});

test("during the pause a verified PromptPay is recorded as PromptPay, with no tender to change", async ({ page }) => {
  await open(page, "landscape", "mode=direct");
  const panel = page.getByRole("complementary", { name: "Order", exact: true });
  await panel.getByRole("button", { name: "PromptPay", exact: true }).click();
  await expect.poll(() => directPanels(page)).toMatchObject([{ instruction: { tenders: [{ method: "promptpay", amount: 120000 }] } }]);
  await panel.getByRole("button", { name: "Order", exact: true }).click();
  await pause(page, true);
  await panel.getByRole("button", { name: "Check previous payment" }).click();
  await expect(panel.getByTestId("check-previous")).toContainText(/PromptPay ฿1,200 · \d\d:\d\d/);
  await panel.getByRole("button", { name: "Taken", exact: true }).click();
  await expect(panel.getByTestId("record-previous")).toBeVisible();
  await expect(panel.getByRole("group", { name: "Take payment by" })).toHaveCount(0);
  await shot(page, "r4-direct-record-promptpay-paused");
  await panel.getByRole("button", { name: /^Confirm ฿1,200/ }).click();
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
  expect(await payments(page)).toMatchObject([{ method: "promptpay", amount: 120000 }]);
  expect(await directPanels(page)).toEqual([]);
});

// ─── Audit round 5 (PR #92): the registration holds exactly the instruction the panel shows ──
for (const width of Object.keys(WIDTHS) as Width[]) test.describe(`round 5 at ${width}`, () => {
  const touch = width !== "desktop";
  test.use({ hasTouch: touch, isMobile: touch });

  test(`a bill left on Card and reopened as PromptPay is recorded as PromptPay, never Card (astra r5 blocker 1), at ${width}`, async ({ page }) => {
    await open(page, width, "mode=direct");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText(CARD_HINT)).toBeVisible();
    // The cashier leaves Card without charging, reopens the same bill as PromptPay and receives the transfer.
    await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
    await taps.tap(panel.getByRole("button", { name: "PromptPay", exact: true }), "PromptPay");
    await expect(panel.getByRole("button", { name: /^Confirm ฿1,200/ })).toBeEnabled();
    await expect.poll(() => directPanels(page)).toMatchObject([{ instruction: { tenders: [{ method: "promptpay", amount: 120000 }] } }]);
    await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
    await pause(page, true);
    await taps.tap(panel.getByRole("button", { name: "Check previous payment" }), "Check previous payment");
    await expect(panel.getByTestId("check-previous")).toContainText(/PromptPay ฿1,200 · \d\d:\d\d/);
    await expect(panel.getByTestId("check-previous")).not.toContainText("Card");
    await taps.tap(panel.getByRole("button", { name: "Taken", exact: true }), "Taken");
    await shot(page, "r5-reopened-promptpay-record");
    await taps.tap(panel.getByRole("button", { name: /^Confirm ฿1,200/ }), "Confirm");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "promptpay", amount: 120000 }]);
    expect(await payments(page)).toHaveLength(1);
    expect(await directPanels(page)).toEqual([]);
  });

  test(`after Not taken the fresh Card instruction is saved, so the next check records it (astra r5 major), at ${width}`, async ({ page }) => {
    await open(page, width, "mode=direct");
    const taps = new Taps(page);
    const panel = await order(page, taps);
    await pause(page, true);
    await pause(page, false);
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await expect(panel.getByText(CARD_HINT)).toBeVisible();
    await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
    await taps.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card");
    await taps.tap(panel.getByRole("button", { name: "Not taken", exact: true }), "Not taken");
    await expect(panel.getByText(CARD_HINT)).toBeVisible();
    await expect.poll(() => directPanels(page)).toMatchObject([{ instruction: { tenders: [{ method: "card", amount: 120000 }] } }]);
    // The terminal approves; the cashier leaves before Confirm and checkout pauses.
    await taps.tap(panel.getByRole("button", { name: "Order", exact: true }), "Order");
    await pause(page, true);
    await taps.tap(panel.getByRole("button", { name: "Check previous payment" }), "Check previous payment");
    await expect(panel.getByTestId("check-previous")).toContainText(/Card ฿1,200 · \d\d:\d\d/);
    await taps.tap(panel.getByRole("button", { name: "Taken", exact: true }), "Taken");
    await taps.tap(panel.getByRole("button", { name: "Confirm ฿1,200 card" }), "Confirm");
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    expect(await payments(page)).toMatchObject([{ method: "card", amount: 120000 }]);
    expect(await directPanels(page)).toEqual([]);
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  console.log("Pay desk fixture at failure", {
    url: page.url(),
    errors: (await page.pageErrors()).map(error => error.message),
    console: (await page.consoleMessages()).filter(message => message.type() === "error").slice(-6).map(message => message.text().slice(0, 300)),
    requests: (await page.requests()).filter(request => request.url().includes("/__checkout-fixture") || !request.existingResponse()?.ok()).slice(-12).map(request => ({
      path: new URL(request.url()).pathname,
      status: request.existingResponse()?.status() ?? request.failure()?.errorText ?? "pending",
      operation: request.postDataJSON()?.method ?? request.postDataJSON()?.kind,
    })),
  });
});
