import { expect, test, type Page } from "@playwright/test";

/*
 * W1·L4 reader screens in the checkout Preview, at the four audited widths (390 phone, 820 iPad
 * portrait with the keyboard open, 1180 iPad landscape, 1440 desktop), for every commerce design
 * state: no sideways scroll, 44×44 px touch targets, visible focus, masked codes only.
 * COMMERCE_SCREENS_EVIDENCE=<dir> also saves a screenshot per state, width and screen.
 */

const STATES = ["dark", "rehearsal", "live", "payment-in-progress", "sale-not-saved", "return-open", "expired-and-paused"] as const;
// 820 × 700: an iPad in portrait with the on-screen keyboard taking the bottom of the screen.
const WIDTHS = [
  { name: "390", width: 390, height: 844, touch: true },
  { name: "820-keyboard", width: 820, height: 700, touch: true },
  { name: "1180", width: 1180, height: 820, touch: true },
  { name: "1440", width: 1440, height: 900, touch: false },
] as const;
const EVIDENCE = process.env.COMMERCE_SCREENS_EVIDENCE;
const FULL_CODE = /\b[A-Z]{2,4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/;

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/commerce-screens.html?${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(150);
}

/** Visible buttons narrower or shorter than 44 px (a 0.5 px rounding allowance). */
const smallTargets = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="receipt-view"] button, [role="dialog"] button')]
  .filter((el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden"; })
  .filter((el) => { const box = el.getBoundingClientRect(); return box.width < 43.5 || box.height < 43.5; })
  .map((el) => `${el.getAttribute("aria-label") ?? el.textContent?.trim()} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`));

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const size of WIDTHS) {
  test.describe(`${size.name} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch && size.width < 1000 });

    for (const state of STATES) {
      test(`${state}: checkout and the commerce receipt fit, with masked codes`, async ({ page }) => {
        await open(page, `commerce=${state}`);
        await expect(page.getByRole("tab", { name: "Frequent", exact: true }).first()).toBeVisible();
        expect.soft(await overflowX(page), "checkout sideways scroll").toBeLessThanOrEqual(0);
        if (EVIDENCE && (state === "dark" || state === "live")) await page.screenshot({ path: `${EVIDENCE}/${state}-${size.name}-checkout.png` });

        await open(page, `commerce=${state}&receipt=1`);
        const receipt = page.getByTestId("receipt-view");
        await expect(receipt.getByRole("heading", { name: /Receipt/ }).first()).toBeVisible();
        expect.soft(await overflowX(page), "receipt sideways scroll").toBeLessThanOrEqual(0);
        await expect(page.getByLabel("Receipt", { exact: true }).getByText("Gift voucher GV-••••-7PAX")).toBeAttached();
        expect(await page.locator("body").innerText()).not.toMatch(FULL_CODE);
        if (size.touch) expect.soft(await smallTargets(page), "targets under 44 × 44 px").toEqual([]);
        if (EVIDENCE && (state === "dark" || state === "live")) await page.screenshot({ path: `${EVIDENCE}/${state}-${size.name}-receipt.png`, fullPage: true });
      });
    }

    test("Edit · History opens with visible focus, and Show guest hides staff", async ({ page }) => {
      await open(page, "commerce=dark&receipt=1");
      const trigger = page.getByRole("button", { name: /^Edit · History: Gold Wellness · 5 ×/ });
      await trigger.focus();
      const ring = await trigger.evaluate((el) => { const style = getComputedStyle(el); return style.outlineStyle !== "none" || style.boxShadow !== "none"; });
      expect.soft(ring, "focus is visible").toBe(true);
      await trigger.press("Enter");
      const sheet = page.getByTestId("edit-history");
      await expect(sheet.getByText("Extended to 30 Dec 2026")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
      await expect(sheet.getByText("By Ploy · Health pause or extension")).toBeVisible();
      expect.soft(await overflowX(page), "history sideways scroll").toBeLessThanOrEqual(0);
      if (size.touch) expect.soft(await smallTargets(page), "history targets under 44 × 44 px").toEqual([]);
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/history-${size.name}.png` });
      await sheet.getByRole("button", { name: "Show guest" }).click();
      await expect(sheet.getByRole("heading", { name: "Your history" })).toBeVisible();
      await expect(sheet.getByText(/By Ploy|By Nok/)).toHaveCount(0);
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/history-guest-${size.name}.png` });
    });

    test("Approvals lists both shapes of request and marks the stale one", async ({ page }) => {
      await open(page, "commerce=live");
      await page.getByTestId("approvals-button").click();
      const panel = page.getByRole("dialog", { name: "Approvals" });
      await expect(panel.getByTestId("approval-request")).toHaveCount(3);
      await expect(panel.getByTestId("approval-stale")).toContainText("Expected revision 6, now 7");
      expect.soft(await overflowX(page), "approvals sideways scroll").toBeLessThanOrEqual(0);
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/approvals-${size.name}.png` });
    });
  });
}
