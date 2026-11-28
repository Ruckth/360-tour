import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Return items (W2B·L3) on real Convex functions: journey 7's Gold Wellness receipt (฿6,900 by
 * card, 2 of 5 sessions used, a Sand / M robe, ฿500 voucher value). v27's tap budget counts taps
 * from the receipt: a manager needs 5 (Return items → Robe Sellable → reason → Authorize → Money
 * given back); a cashier 5 plus the manager's 2 (Approvals → Approve).
 */

const SHOTS = "test-results/returns-desk";
const CAPTURE_SHOTS = process.env.CAPTURE_SCREENSHOTS === "1";
const IPAD_LANDSCAPE = { width: 1180, height: 820 };

async function captureShot(page: Page, name: string) {
  if (CAPTURE_SHOTS) await page.screenshot({ path: `${SHOTS}/${name}` });
}

async function open(page: Page, query = "") {
  await page.goto(`/tests/browser/returns-desk.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByTestId("receipt-items")).toBeVisible();
}

/** Every counted tap, by its accessible name, so a report can show the journey. */
function tapLog() {
  const taps: string[] = [];
  return {
    taps,
    /** Keep the journey in test-results/returns-desk/tap-log.md for the handoff report. */
    save(journey: string, width: number) {
      mkdirSync(SHOTS, { recursive: true });
      appendFileSync(`${SHOTS}/tap-log.md`, `| ${width} | ${journey} | ${taps.length} | ${taps.join(" → ")} |\n`);
    },
    async tap(target: Locator, name?: string) {
      const label = name ?? ((await target.textContent()) ?? "").trim();
      await target.click();
      taps.push(label);
    },
  };
}
const sheet = (page: Page) => page.locator("[data-return-sheet]");

test.describe("Return items", () => {
  test.use({ viewport: IPAD_LANDSCAPE });

  test("a manager returns the Gold package in 5 taps and gives ฿4,793 back to the card", async ({ page }, info) => {
    await open(page);
    const log = tapLog();
    await log.tap(page.getByRole("button", { name: "Return items · Gold Wellness" }));
    const panel = sheet(page);
    // The whole package is ticked; the robe asks what came back.
    await expect(panel.getByRole("checkbox", { name: "Whole package" })).toBeChecked();
    await expect(panel.getByRole("button", { name: "Choose what comes back" })).toHaveCount(0);
    await log.tap(panel.getByRole("button", { name: "Sellable · back to stock" }));
    await log.tap(panel.getByRole("button", { name: "Package cancelled" }));
    // Each amount and where it goes, before anything is recorded.
    await expect(panel.locator("[data-return-quote]")).toContainText("Gold Wellness฿4,793");
    await expect(panel.locator("[data-return-destinations]")).toHaveText("฿4,793 to Card");
    const authorize = panel.getByRole("button", { name: "Authorize ฿4,793 to Card" });
    await log.tap(authorize);
    await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿4,793 on the card terminal");
    await panel.getByRole("textbox", { name: "Reference (optional)" }).fill("APPR 81723");
    await log.tap(panel.getByRole("button", { name: "Money given back · Record" }));
    await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
    await expect(panel.locator("[data-claim-state]")).toContainText("Given back · APPR 81723");
    expect(log.taps).toEqual(["Return items", "Sellable · back to stock", "Package cancelled", "Authorize ฿4,793 to Card", "Money given back · Record"]);
    info.annotations.push({ type: "taps", description: log.taps.join(" → ") });
    const payouts = await page.evaluate(() => window.returnsFixture.payouts()) as { amount: number; method: string; reference?: string }[];
    expect(payouts).toMatchObject([{ amount: 479300, method: "card", reference: "APPR 81723" }]);
    expect(await page.evaluate(() => window.returnsFixture.stock())).toBe(2);
    await captureShot(page, "manager-completed-1180.png");
  });

  test("a cashier asks a manager, the manager approves in Approvals, and the cashier gives the money back", async ({ page, browser }, info) => {
    await open(page, "?role=cashier");
    const cashier = tapLog();
    await cashier.tap(page.getByRole("button", { name: "Return items · Gold Wellness" }));
    const panel = sheet(page);
    await cashier.tap(panel.getByRole("button", { name: "Sellable · back to stock" }));
    await cashier.tap(panel.getByRole("button", { name: "Package cancelled" }));
    await expect(panel.locator("[data-return-destinations]")).toHaveText("฿4,793 to Card");
    await cashier.tap(panel.getByRole("button", { name: "Ask a manager" }));
    await expect(panel.locator("[data-return-waiting]")).toHaveText("Waiting for a manager");

    // The manager's own screen, on the same database.
    const session = await page.evaluate(() => window.returnsFixture.session);
    const managerContext = await browser.newContext({ viewport: IPAD_LANDSCAPE });
    const managerPage = await managerContext.newPage();
    await open(managerPage, `?role=manager&session=${session}`);
    const manager = tapLog();
    await expect(managerPage.getByTestId("approvals-button")).toContainText("1");
    await manager.tap(managerPage.getByTestId("approvals-button"), "Approvals");
    const request = managerPage.locator("[data-return-request]");
    await expect(request).toContainText("Mint asks to return 2 parts · ฿4,793");
    // Major 4: the decision shows what comes back, where every baht goes and by when, the reason,
    // and who still pays out, before the second tap.
    const quote = request.locator("[data-return-approval-quote]");
    await expect(quote).toContainText("Thai massage 60 sessions");
    await expect(quote).toContainText("Spa robe · Sand / M");
    await expect(quote).toContainText("Voucher value ฿500");
    await expect(quote.locator("[data-return-destinations]")).toHaveText("฿4,793 to Card");
    await expect(quote.locator("[data-return-due]")).toContainText("Refund due by");
    await expect(request).toContainText("“Package cancelled”");
    await expect(request.locator("[data-return-payer]")).toHaveText("Mint gives the money back at their till.");
    await captureShot(managerPage, "approval-detail-1180.png");
    await manager.tap(request.getByRole("button", { name: "Approve · authorize ฿4,793 to Card" }));
    await expect(managerPage.getByText("Approved · ฿4,793 return on #1042")).toBeVisible();
    await managerContext.close();

    // Approval authorized it for the cashier, whose till shows the instruction straight away.
    await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿4,793 on the card terminal", { timeout: 8000 });
    await cashier.tap(panel.getByRole("button", { name: "Money given back · Record" }));
    await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
    expect(cashier.taps).toEqual(["Return items", "Sellable · back to stock", "Package cancelled", "Ask a manager", "Money given back · Record"]);
    expect(manager.taps).toEqual(["Approvals", "Approve · authorize ฿4,793 to Card"]);
    info.annotations.push({ type: "taps", description: `cashier ${cashier.taps.join(" → ")} | manager ${manager.taps.join(" → ")}` });
  });

  test("a cashier's waiting request can be withdrawn, and a cashier has no Approvals", async ({ page }) => {
    await open(page, "?role=cashier");
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
    await panel.getByRole("button", { name: "Package cancelled" }).click();
    await panel.getByRole("button", { name: "Ask a manager" }).click();
    await expect(panel.locator("[data-return-waiting]")).toBeVisible();
    // The cashier has no Approvals; their only step is to withdraw.
    await expect(page.getByTestId("approvals-button")).toHaveCount(0);
    await panel.getByRole("button", { name: "Withdraw request" }).click();
    // Back to choosing, with nothing waiting and nothing recorded.
    await expect(panel.getByRole("checkbox", { name: "Whole package" })).toBeVisible();
    await expect(panel.locator("[data-return-waiting]")).toHaveCount(0);
    expect(await page.evaluate(() => window.returnsFixture.returns())).toHaveLength(0);
  });

  test("after a reload the till shows Check previous refund and never a second payout", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    let panel = sheet(page);
    await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
    await panel.getByRole("button", { name: "Package cancelled" }).click();
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    await expect(panel.locator("[data-return-instruction]")).toBeVisible();

    await page.reload();
    await page.locator("[data-fixture-ready]").waitFor();
    // The receipt is locked behind its open return.
    await expect(page.getByRole("button", { name: /^Return items · / })).toHaveCount(0);
    await page.locator("[data-return-notice]").getByRole("button", { name: "Open the return" }).click();
    panel = sheet(page);
    await expect(panel.locator("[data-return-check]")).toContainText("Check previous refund");
    await expect(panel.locator("[data-return-check]")).toContainText("Card ฿4,793 · sent");
    // Major 7: the card deadline shows while reconciling too.
    await expect(panel.locator("[data-return-check] [data-return-due]")).toContainText("Refund due by");
    await expect(panel.locator("[data-return-instruction]")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Money given back/ })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Refund ฿/ })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Cancel return" })).toHaveCount(0);
    await captureShot(page, "check-previous-1180.png");
    await panel.getByRole("button", { name: "It was given back" }).click();
    await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
    expect(await page.evaluate(() => window.returnsFixture.payouts())).toHaveLength(1);
  });

  test("a payout that wasn't given can be cancelled, which gives everything back", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    await panel.getByRole("button", { name: "Damaged · written off" }).click();
    await panel.getByRole("button", { name: "Changed mind" }).click();
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    await panel.getByRole("button", { name: "Not given back" }).click();
    await expect(panel.locator("[data-claim-state]")).toContainText("Failed");
    await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
    await panel.getByRole("button", { name: "Cancel return" }).click();
    await expect(panel.locator("[data-return-status]")).toHaveText("Return cancelled · nothing was given back");
    const [row] = await page.evaluate(() => window.returnsFixture.returns()) as { status: string }[];
    expect(row.status).toBe("cancelled");
    expect(await page.evaluate(() => window.returnsFixture.payouts())).toHaveLength(0);
    expect(await page.evaluate(() => window.returnsFixture.stock())).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Return items · Gold Wellness" })).toBeVisible();
  });

  test("a give-back retried by another method keeps the date the guest was promised", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    await panel.getByRole("button", { name: "Damaged · written off" }).click();
    await panel.getByRole("button", { name: "Changed mind" }).click();
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    const promised = (await panel.locator("[data-return-due]").textContent())!;
    expect(promised).toMatch(/^Refund due by /);
    await panel.getByRole("button", { name: "Not given back" }).click();
    await expect(panel.locator("[data-return-due]")).toHaveText(promised);
    await panel.getByRole("group", { name: "Use another method" }).getByRole("button", { name: "Cash" }).click();
    await panel.getByRole("button", { name: "Retry · Cash" }).click();
    await expect(panel.locator("[data-claim-state]")).toContainText(promised);
    const [row] = await page.evaluate(() => window.returnsFixture.returns()) as { claims: { method: string; dueAt: number }[] }[];
    expect(row.claims[0].method).toBe("cash");
  });
});

for (const [width, height, label] of [[390, 844, "phone"], [820, 700, "ipad-portrait-keyboard"], [1180, 820, "ipad-landscape"], [1440, 900, "desktop"]] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test(`Return items fits, keeps its action above the keyboard and has 44 px targets (${label})`, async ({ page }) => {
      await open(page);
      await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
      const panel = sheet(page);
      await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
      // Typing a reason opens the keyboard; the next step stays in view above it.
      const reason = panel.getByRole("textbox", { name: "Reason" });
      await reason.focus();
      await reason.fill("Package cancelled at the desk");
      const authorize = panel.getByRole("button", { name: "Authorize ฿4,793 to Card" });
      await expect(authorize).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await panel.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
      for (const button of await panel.getByRole("button").all()) {
        if (!(await button.isVisible())) continue;
        const target = await button.boundingBox();
        expect(Math.round(target!.height), await button.innerText()).toBeGreaterThanOrEqual(44);
        expect(Math.round(target!.width), await button.innerText()).toBeGreaterThanOrEqual(44);
      }
      // Visible focus on the primary action from the keyboard.
      await authorize.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      expect(await authorize.evaluate((node) => getComputedStyle(node).boxShadow !== "none" || getComputedStyle(node).outlineStyle !== "none")).toBe(true);
      await captureShot(page, `picker-${width}.png`);
      await authorize.click();
      await expect(panel.getByRole("button", { name: "Money given back · Record" })).toBeInViewport({ ratio: 1 });
      await panel.getByRole("textbox", { name: "Reference (optional)" }).focus();
      await expect(panel.getByRole("button", { name: "Money given back · Record" })).toBeInViewport({ ratio: 1 });
      await captureShot(page, `payout-${width}.png`);
    });
  });
}

// ─── PR #93 round-1 audit regressions ─────────────────────────────────────────────────────────

const WIDTHS = [[390, 844, "390"], [820, 700, "820-keyboard"], [1180, 820, "1180"], [1440, 900, "1440"]] as const;
/** At 820 × 700 the reason field is focused, as with the keyboard open (the lead's focused-input method). */
async function focusReason(page: Page, width: number) {
  if (width === 820) await sheet(page).getByRole("textbox", { name: "Reason" }).focus();
}

for (const [width, height, shot] of WIDTHS) {
  test.describe(`audit round 1 at ${shot}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width !== 1440 });

    test("blocker 1: after a takeover and release, the original till checks the previous refund instead of instructing it again", async ({ page, browser }) => {
      await open(page);
      const a = tapLog();
      await a.tap(page.getByRole("button", { name: "Return items · Gold Wellness" }));
      const panelA = sheet(page);
      await a.tap(panelA.getByRole("button", { name: "Sellable · back to stock" }));
      await a.tap(panelA.getByRole("button", { name: "Package cancelled" }));
      await a.tap(panelA.getByRole("button", { name: "Authorize ฿4,793 to Card" }));
      await expect(panelA.locator("[data-return-instruction]")).toContainText("Refund ฿4,793 on the card terminal");
      await captureShot(page, `blocker1-original-instruction-${shot}.png`);

      // Till B: the same manager on another device (its own till).
      const session = await page.evaluate(() => window.returnsFixture.session);
      const other = await browser.newContext({ viewport: { width, height }, hasTouch: width !== 1440 });
      const b = await other.newPage();
      await open(b, `?session=${session}`);
      await a.tap(b.locator("[data-return-notice]").getByRole("button", { name: "Open the return" }), "B · Open the return");
      const panelB = sheet(b);
      await a.tap(panelB.getByRole("checkbox", { name: "The previous operator has stopped" }), "B · The previous operator has stopped");
      await panelB.getByRole("textbox", { name: "Reason" }).fill("Till A froze");
      await a.tap(panelB.getByRole("button", { name: "Take over this return" }), "B · Take over this return");
      await expect(panelB.locator("[data-return-check]")).toContainText("Check previous refund");
      await expect(panelB.locator("[data-return-instruction]")).toHaveCount(0);
      await captureShot(b, `blocker1-takeover-check-${shot}.png`);
      await a.tap(panelB.getByRole("button", { name: "Release to another till" }), "B · Release to another till");
      await expect(panelB.getByRole("button", { name: "Continue at this till" })).toBeVisible();

      // Back on A: continue here. The earlier instruction belonged to another operator revision.
      await a.tap(panelA.getByRole("button", { name: "Continue at this till" }), "A · Continue at this till");
      await expect(panelA.locator("[data-return-check]")).toContainText("Check previous refund");
      await expect(panelA.locator("[data-return-instruction]")).toHaveCount(0);
      await expect(panelA.getByRole("button", { name: /Money given back/ })).toHaveCount(0);
      await captureShot(page, `blocker1-original-reclaimed-check-${shot}.png`);
      await other.close();
      a.save("handover → reclaim shows Check previous refund", width);
    });

    test("blocker 2: a voucher-and-card return names each destination exactly before it commits", async ({ page }) => {
      await open(page, "?variant=mixed");
      const log = tapLog();
      await log.tap(page.getByRole("button", { name: "Return items · Thai massage" }));
      const panel = sheet(page);
      await focusReason(page, width);
      await log.tap(panel.getByRole("button", { name: "Changed mind" }));
      await expect(panel.locator("[data-return-destinations]")).toHaveText("฿700 to Card฿500 back to voucher GV-••••-Q9XD");
      await expect(panel.locator("[data-return-total]")).toHaveText("Return total฿1,200");
      await expect(panel.locator("[data-return-due]")).toContainText("Refund due by");
      const authorize = panel.getByRole("button", { name: "Authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD" });
      await expect(authorize).toBeInViewport({ ratio: 1 });
      await expect(panel.getByRole("button", { name: /Authorize ฿1,200/ })).toHaveCount(0);
      await captureShot(page, `blocker2-mixed-quote-${shot}.png`);
      await log.tap(authorize);
      await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿700 on the card terminal");
      await expect(panel.locator("[data-return-claims]")).toContainText("฿500 back to voucher GV-••••-Q9XD");
      await captureShot(page, `blocker2-mixed-instruction-${shot}.png`);
      await log.tap(panel.getByRole("button", { name: "Money given back · Record" }));
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toMatchObject([{ amount: 70000, method: "card" }]);
      log.save("mixed voucher + card return", width);
    });

    for (const variant of ["visit", "linked"] as const) {
      test(`blocker 3: a commerce-funded ${variant === "visit" ? "attached" : "late-linked"} visit returns from its receipt`, async ({ page }) => {
        await open(page, `?variant=${variant}`);
        const items = page.getByTestId("receipt-items");
        // No dead end: the row offers Return items, not "Refund this on the appointment".
        await expect(items.getByRole("button", { name: "Refunding Thai massage" })).toHaveCount(0);
        const log = tapLog();
        await log.tap(items.getByRole("button", { name: "Return items · Thai massage" }));
        const panel = sheet(page);
        await focusReason(page, width);
        await log.tap(panel.getByRole("button", { name: "Changed mind" }));
        const authorize = panel.getByRole("button", { name: "Authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD" });
        await expect(authorize).toBeVisible();
        await captureShot(page, `blocker3-${variant}-quote-${shot}.png`);
        await log.tap(authorize);
        await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿700 on the card terminal");
        await log.tap(panel.getByRole("button", { name: "Money given back · Record" }));
        await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
        log.save(`${variant} visit return`, width);
      });
    }

    test("blocker 3: a session-covered visit offers Restore session (฿0)", async ({ page }) => {
      await open(page, "?variant=covered");
      const log = tapLog();
      await log.tap(page.getByRole("button", { name: "Return items · Thai massage" }));
      const panel = sheet(page);
      await expect(panel.getByRole("checkbox", { name: "Restore session" })).toBeChecked();
      await focusReason(page, width);
      await log.tap(panel.getByRole("button", { name: "Changed mind" }));
      await expect(panel.locator("[data-return-parts]")).toContainText("Restore session฿0");
      await expect(panel.locator("[data-return-destinations]")).toContainText("No money to give back");
      await captureShot(page, `blocker3-covered-quote-${shot}.png`);
      await log.tap(panel.getByRole("button", { name: "Restore session" }));
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toHaveLength(0);
      await captureShot(page, `blocker3-covered-done-${shot}.png`);
      log.save("covered visit restore", width);
    });
  });
}

test.describe("audit round 1", () => {
  test.use({ viewport: IPAD_LANDSCAPE });

  test("sol blocker 1: a retry armed in another tab leaves the first tab checking, so only one tab instructs", async ({ page, context }) => {
    await open(page);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const tabA = sheet(page);
    await tabA.getByRole("button", { name: "Sellable · back to stock" }).click();
    await tabA.getByRole("button", { name: "Package cancelled" }).click();
    await tabA.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    await expect(tabA.locator("[data-return-instruction]")).toBeVisible();

    // Tab B at the same till: verify the first instruction was never paid, retry and arm it.
    const session = await page.evaluate(() => window.returnsFixture.session);
    const second = await context.newPage();
    await open(second, `?session=${session}`);
    await second.locator("[data-return-notice]").getByRole("button", { name: "Open the return" }).click();
    const tabB = sheet(second);
    await tabB.getByRole("button", { name: "It wasn't given back" }).click();
    await tabB.getByRole("button", { name: "Retry" }).click();
    await tabB.getByRole("button", { name: "Refund ฿4,793 to Card" }).click();
    await expect(tabB.locator("[data-return-instruction]")).toContainText("Refund ฿4,793 on the card terminal");
    // Tab A refreshes to the re-armed claim: same destination key, but not its instruction.
    await expect(tabA.locator("[data-return-check]")).toContainText("Check previous refund", { timeout: 8000 });
    await expect(tabA.locator("[data-return-instruction]")).toHaveCount(0);
    await second.close();
  });

  test("major 6: the picker offers only the three unused sessions, and a cancelled package no longer opens", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    await panel.getByRole("checkbox", { name: "Whole package" }).uncheck();
    await panel.getByRole("checkbox", { name: "Thai massage 60 sessions" }).check();
    const more = panel.getByRole("button", { name: "One more" });
    await more.click();
    await more.click();
    await expect(panel.getByRole("group", { name: "Units of Thai massage 60 sessions" }).locator("output")).toHaveText("3");
    await expect(more).toBeDisabled();
    // The whole cancellation, then the receipt row has nothing left to return.
    await panel.getByRole("checkbox", { name: "Thai massage 60 sessions" }).uncheck();
    await panel.getByRole("checkbox", { name: "Whole package" }).check();
    await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
    await panel.getByRole("button", { name: "Package cancelled" }).click();
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    await panel.getByRole("button", { name: "Money given back · Record" }).click();
    await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Return items · Gold Wellness" })).toHaveCount(0);
  });

  test("major 5: a cashier granted the Team Refund rule authorizes instead of asking", async ({ page }) => {
    await open(page, "?role=cashier&refundRule=cashier");
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
    await panel.getByRole("button", { name: "Package cancelled" }).click();
    await expect(panel.getByRole("button", { name: "Authorize ฿4,793 to Card" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Ask a manager" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    // A server that grants the rule instructs; one that still wants a manager turns the sheet back to Ask a manager.
    await expect(panel.locator("[data-return-instruction]").or(panel.getByRole("button", { name: "Ask a manager" }))).toBeVisible();
  });

  test("minor: a fine-pointer desktop gets 44 px Close, inputs and buttons in the return sheet", async ({ browser }) => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false });
    const page = await desktop.newPage();
    await open(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
    await page.getByRole("button", { name: "Return items · Gold Wellness" }).click();
    const panel = sheet(page);
    for (const control of [panel.getByRole("button", { name: "Close" }), panel.getByRole("textbox", { name: "Reason" })]) {
      const box = (await control.boundingBox())!;
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    }
    expect(Math.round((await panel.getByRole("button", { name: "Close" }).boundingBox())!.width)).toBeGreaterThanOrEqual(44);
    await panel.getByRole("button", { name: "Sellable · back to stock" }).click();
    await panel.getByRole("button", { name: "Package cancelled" }).click();
    await panel.getByRole("button", { name: "Authorize ฿4,793 to Card" }).click();
    const reference = (await panel.getByRole("textbox", { name: "Reference (optional)" }).boundingBox())!;
    expect(Math.round(reference.height)).toBeGreaterThanOrEqual(44);
    await desktop.close();
  });
});

// ─── PR #93 round 2 ────────────────────────────────────────────────────────────────────────────
const ROUND2 = [[390, 844], [820, 700], [1180, 820], [1440, 900]] as const;

for (const [width, height] of ROUND2) {
  test.describe(`audit round 2 at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("blocker 1: a manager's fresh Settings tab on an admitted till decides on first open, in 5 + 2 taps", async ({ page, browser }) => {
      test.setTimeout(90_000); // two screens on one in-process database
      await open(page, "?role=cashier");
      const cashier = tapLog();
      await cashier.tap(page.getByRole("button", { name: "Return items · Gold Wellness" }));
      const panel = sheet(page);
      await cashier.tap(panel.getByRole("button", { name: "Sellable · back to stock" }));
      await cashier.tap(panel.getByRole("button", { name: "Package cancelled" }));
      await cashier.tap(panel.getByRole("button", { name: "Ask a manager" }));
      await expect(panel.locator("[data-return-waiting]")).toHaveText("Waiting for a manager");

      const session = await page.evaluate(() => window.returnsFixture.session);
      const managerContext = await browser.newContext({ viewport: { width, height } });
      const settings = await managerContext.newPage();
      // Any frame that tells the manager to wait for rollout is the defect, however briefly it shows.
      await settings.addInitScript(() => {
        new MutationObserver(() => {
          if (document.body?.textContent?.includes("open at checkout")) (window as unknown as { sawNotYet: boolean }).sawNotYet = true;
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await settings.goto(`/tests/browser/returns-desk.html?role=manager&page=settings&session=${session}`);
      await settings.locator("[data-fixture-ready]").waitFor();
      const manager = tapLog();
      await expect(settings.getByTestId("approvals-button")).toContainText("1");
      await manager.tap(settings.getByTestId("approvals-button"), "Approvals");
      const request = settings.locator("[data-return-request]");
      const approve = request.getByRole("button", { name: "Approve · authorize ฿4,793 to Card" });
      await expect(approve).toBeEnabled();
      await captureShot(settings, `r2-settings-first-open-${width}.png`);
      await manager.tap(approve);
      await expect(settings.getByText("Approved · ฿4,793 return on #1042")).toBeVisible();
      expect(await settings.evaluate(() => (window as unknown as { sawNotYet?: boolean }).sawNotYet ?? false)).toBe(false);
      await managerContext.close();

      await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿4,793 on the card terminal", { timeout: 8000 });
      await cashier.tap(panel.getByRole("button", { name: "Money given back · Record" }));
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      expect(cashier.taps).toHaveLength(5);
      expect(manager.taps).toEqual(["Approvals", "Approve · authorize ฿4,793 to Card"]);
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toHaveLength(1);
      cashier.taps.push(...manager.taps.map((tap) => `manager:${tap}`));
      cashier.save("Settings-first-open approval (cashier 5 + manager 2)", width);
    });

    test("blocker 3: an expired voucher's ฿500 goes onto a new voucher, named as such from quote to reload", async ({ page }) => {
      await open(page, "?variant=expired");
      const log = tapLog();
      await log.tap(page.getByRole("button", { name: "Return items · Thai massage" }));
      const panel = sheet(page);
      await log.tap(panel.getByRole("button", { name: "Changed mind" }));
      await expect(panel.locator("[data-return-destinations]")).toHaveText("฿700 to Card฿500 on a new voucher replacing GV-••••-Q9XD (90 days)");
      const authorize = panel.getByRole("button", { name: "Authorize ฿700 to Card · ฿500 on a new voucher replacing GV-••••-Q9XD (90 days)" });
      await expect(authorize).toBeInViewport({ ratio: 1 });
      await captureShot(page, `r2-expired-quote-${width}.png`);
      await log.tap(authorize);
      await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿700 on the card terminal");
      await expect(panel.locator("[data-return-claims]")).toContainText("฿500 on a new voucher replacing GV-••••-Q9XD (90 days)");
      await log.tap(panel.getByRole("button", { name: "Money given back · Record" }));
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      // The money goes onto the new voucher, named by the one it replaces; its slip carries a code in the shared format.
      await expect(panel.locator("[data-return-claims] [data-return-credit=replacement]")).toHaveText("฿500 on a new voucher replacing GV-••••-Q9XD (90 days)");
      const slip = panel.locator("[data-gift-slip]");
      await expect(slip.locator("[data-gift-slip-voucher]")).toHaveText(new RegExp(`^New voucher GV-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4} · ฿500 · valid through ${lastUsableDay(90)}$`));
      await expect(slip.locator("[data-gift-slip-replaces]")).toHaveText("Replaces GV-••••-Q9XD");
      await captureShot(page, `r2-expired-completed-${width}.png`);
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toMatchObject([{ amount: 70000, method: "card" }]);
      const code = (await slip.textContent())!.match(/GV-\S{4}-\S{4}/)![0];

      await page.reload();
      await page.locator("[data-fixture-ready]").waitFor();
      await expect(page.locator("[data-gift-slip]")).toContainText(code);
      await captureShot(page, `r2-expired-reload-${width}.png`);
      expect(log.taps).toHaveLength(4);
      log.save("expired-voucher return onto a new voucher", width);
    });
  });
}

// ─── PR #93 round 3 ────────────────────────────────────────────────────────────────────────────
/** The Bangkok date of the last usable day of a voucher issued today for `days` days ("18 Feb 2027"). */
function lastUsableDay(days: number) {
  const bangkok = new Date(Date.now() + 7 * 3_600_000);
  const day = new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate() + days));
  return day.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

for (const [width, height] of ROUND2) {
  test.describe(`audit round 3 at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("B3, B4: two equal replacements each name the voucher they replace and their last usable day, from quote to reload", async ({ page }) => {
      await open(page, "?variant=twoExpired");
      const log = tapLog();
      await log.tap(page.getByRole("button", { name: "Return items · Thai massage" }));
      const panel = sheet(page);
      await log.tap(panel.getByRole("button", { name: "Changed mind" }));
      const lines = ["฿700 to Card", "฿250 on a new voucher replacing GV-••••-Q9XD (90 days)", "฿250 on a new voucher replacing GV-••••-R8TB (90 days)"];
      await expect(panel.locator("[data-return-destinations] li")).toHaveText(lines);
      const authorize = panel.getByRole("button", { name: `Authorize ${lines.join(" · ")}` });
      await expect(authorize).toBeInViewport({ ratio: 1 });
      await captureShot(page, `r3-two-expired-quote-${width}.png`);
      await log.tap(authorize);
      await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿700 on the card terminal");
      await log.tap(panel.getByRole("button", { name: "Money given back · Record" }));
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      await expect(panel.locator("[data-return-claims] [data-return-credit=replacement]")).toHaveText(lines.slice(1));
      const through = `valid through ${lastUsableDay(90)}`;
      const slips = panel.locator("[data-gift-slip]");
      await expect(slips).toHaveCount(2);
      expect((await slips.locator("[data-gift-slip-replaces]").allTextContents()).sort()).toEqual(["Replaces GV-••••-Q9XD", "Replaces GV-••••-R8TB"]);
      for (const slip of await slips.all()) await expect(slip.locator("[data-gift-slip-voucher]")).toHaveText(new RegExp(`^New voucher GV-\\S{4}-\\S{4} · ฿250 · ${through}$`));
      await captureShot(page, `r3-two-expired-completed-${width}.png`);
      const paired = async (scope: Locator) => Object.fromEntries(await Promise.all((await scope.locator("[data-gift-slip]").all()).map(async (slip) =>
        [(await slip.locator("[data-gift-slip-replaces]").textContent())!, (await slip.locator("[data-gift-slip-voucher]").textContent())!.match(/GV-\S{4}-\S{4}/)![0]])));
      const before = await paired(panel);
      expect(new Set(Object.values(before)).size).toBe(2);
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toMatchObject([{ amount: 70000, method: "card" }]);

      await page.reload();
      await page.locator("[data-fixture-ready]").waitFor();
      const receipt = page.locator("[data-replacement-vouchers]");
      await expect(receipt.locator("[data-gift-slip]")).toHaveCount(2);
      // The same code stays with the same original after a reload.
      expect(await paired(receipt)).toEqual(before);
      await expect(receipt.locator("[data-gift-slip-voucher]").first()).toContainText(through);
      await captureShot(page, `r3-two-expired-reload-${width}.png`);
      expect(log.taps).toHaveLength(4);
      log.save("two expired vouchers onto two new ones, each paired with its original", width);
    });
  });
}

// ─── PR #93 round 4 ────────────────────────────────────────────────────────────────────────────
for (const [width, height] of ROUND2) {
  test.describe(`audit round 4 at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("the manager's two-voucher Approve label wraps inside its card, reads in full and approves on a centred tap", async ({ page, browser }) => {
      test.setTimeout(90_000); // two screens on one in-process database
      await open(page, "?variant=twoExpired&role=cashier");
      await page.getByRole("button", { name: "Return items · Thai massage" }).click();
      const panel = sheet(page);
      await panel.getByRole("button", { name: "Changed mind" }).click();
      await panel.getByRole("button", { name: "Ask a manager" }).click();
      await expect(panel.locator("[data-return-waiting]")).toHaveText("Waiting for a manager");

      const summary = panel.getByRole("region", { name: "Requested return" });
      const expectMasks = async () => {
        await expect(summary).toContainText("Replacement voucher · GV-••••-Q9XD · ฿250");
        await expect(summary).toContainText("Replacement voucher · GV-••••-R8TB · ฿250");
        await expect(summary).not.toContainText(/GV-(7KQ2|3HW5)-/);
      };
      await expectMasks();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await page.getByRole("button", { name: "Return items · Thai massage" }).click();
      await expectMasks();

      const session = await page.evaluate(() => window.returnsFixture.session);
      const managerContext = await browser.newContext({ viewport: { width, height } });
      const settings = await managerContext.newPage();
      await settings.goto(`/tests/browser/returns-desk.html?variant=twoExpired&role=manager&page=settings&session=${session}`);
      await settings.locator("[data-fixture-ready]").waitFor();
      await settings.getByTestId("approvals-button").click();
      const request = settings.locator("[data-return-request]");
      const lines = ["฿700 to Card", "฿250 on a new voucher replacing GV-••••-Q9XD (90 days)", "฿250 on a new voucher replacing GV-••••-R8TB (90 days)"];
      await expect(request.locator("[data-return-destinations] li")).toHaveText(lines);
      // The accessible name and the visible text are the whole v27 label: the verb, the card and both masks.
      const label = `Approve · authorize ${lines.join(" · ")}`;
      const approve = request.getByRole("button", { name: label });
      await expect(approve).toHaveText(label);
      await approve.scrollIntoViewIfNeeded();
      await expect(approve).toBeInViewport({ ratio: 1 });
      const fit = await approve.evaluate((button) => {
        const card = button.closest("[data-return-request] > div")!.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(button);
        const glyphs = text.getBoundingClientRect();
        return {
          overflowX: button.scrollWidth - button.clientWidth, overflowY: button.scrollHeight - button.clientHeight,
          inCard: box.left >= card.left - 0.5 && box.right <= card.right + 0.5,
          textInButton: glyphs.left >= box.left - 0.5 && glyphs.right <= box.right + 0.5 && glyphs.top >= box.top - 0.5 && glyphs.bottom <= box.bottom + 0.5,
          height: box.height, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(fit).toMatchObject({ overflowX: 0, overflowY: 0, inCard: true, textInButton: true, pageOverflow: 0 });
      expect(fit.height).toBeGreaterThanOrEqual(44);
      await captureShot(settings, `r4-two-voucher-approval-${width}.png`);
      // An ordinary centred click (no force, no edge offset) reaches the button and approves once.
      await approve.click();
      await expect(settings.getByText(/^Approved · ฿1,200 return on #/)).toBeVisible();
      await managerContext.close();

      await expect(panel.locator("[data-return-instruction]")).toContainText("Refund ฿700 on the card terminal", { timeout: 8000 });
      await panel.getByRole("button", { name: "Money given back · Record" }).click();
      await expect(panel.locator("[data-return-status]")).toHaveText("Return completed");
      expect(await page.evaluate(() => window.returnsFixture.payouts())).toMatchObject([{ amount: 70000, method: "card" }]);
    });
  });
}
