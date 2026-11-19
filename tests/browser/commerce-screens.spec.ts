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
        await expect(page.getByLabel("Receipt", { exact: true }).getByText("GV-••••-Q9XD").first()).toBeAttached();
        expect(await page.locator("body").innerText()).not.toMatch(FULL_CODE);
        if (size.touch) expect.soft(await smallTargets(page), "targets under 44 × 44 px").toEqual([]);
        if (EVIDENCE && (state === "dark" || state === "live")) await page.screenshot({ path: `${EVIDENCE}/${state}-${size.name}-receipt.png`, fullPage: true });

        // Voucher value is spent on its own sale (v27): the redemption receipt.
        await open(page, `commerce=${state}&receipt=redemption`);
        await expect(page.getByLabel("Receipt", { exact: true }).getByText("Gift voucher GV-••••-7PAX")).toBeAttached();
        expect(await page.locator("body").innerText()).not.toMatch(FULL_CODE);
        expect.soft(await overflowX(page), "redemption receipt sideways scroll").toBeLessThanOrEqual(0);
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
      const requests = panel.getByTestId("approval-request");
      await expect(requests).toHaveCount(3);
      // One compact list; the stale edit expires first, so it is open with its own detail.
      await expect(panel.getByTestId("approval-stale")).toContainText("Expected revision 6, now 7");
      // Tapping another row opens it instead.
      await requests.nth(0).getByRole("button").click();
      await expect(requests.nth(0)).toContainText("Regular guest, birthday");
      await expect(panel.getByTestId("approval-stale")).toHaveCount(0);
      expect.soft(await overflowX(page), "approvals sideways scroll").toBeLessThanOrEqual(0);
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/approvals-${size.name}.png` });
    });

    // Audit r1 finding 1: a full code typed into an item name never prints on the paper.
    test("the receipt paper masks a voucher code typed into an item name", async ({ page }) => {
      await open(page, "commerce=dark&receipt=1&typed=GV-7K2M-Q9XD");
      const paper = page.getByLabel("Receipt", { exact: true });
      // On a phone the paper starts folded under Receipt preview: open it as staff would.
      const preview = page.locator("summary", { hasText: "Receipt preview" });
      if (await preview.isVisible()) await preview.click();
      await expect(paper.getByText("Gift voucher GV-••••-Q9XD").first()).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(FULL_CODE);
      if (size.name === "820-keyboard") await page.getByRole("button", { name: "More receipt actions" }).focus();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/receipt-name-${size.name}.png`, fullPage: true });
    });

    // Audit r1 finding 2: shown to the guest, nothing staff-only on the screen behind is legible.
    test("Show guest covers every staff name behind the sheet", async ({ page }) => {
      await open(page, "commerce=dark&receipt=1");
      await page.getByRole("button", { name: /^Edit · History: Gold Wellness · 5 ×/ }).click();
      const sheet = page.getByTestId("edit-history");
      await sheet.getByRole("button", { name: "Show guest" }).click();
      await expect(sheet.getByRole("heading", { name: "Your history" })).toBeVisible();
      await page.waitForTimeout(300);
      const cover = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="edit-history"]')!;
        const scrim = [...document.querySelectorAll<HTMLElement>('[data-state="open"]')].find((el) => el !== dialog && getComputedStyle(el).position === "fixed" && !el.contains(dialog));
        const rect = scrim?.getBoundingClientRect();
        const alpha = scrim ? (getComputedStyle(scrim).backgroundColor.match(/[\d.]+/g) ?? []).map(Number) : [];
        const staff = [...document.querySelectorAll<HTMLElement>('[data-testid="receipt-view"] *')]
          .filter((el) => el.children.length === 0 && /\b(Ploy|Nok)\b/.test(el.textContent ?? ""))
          .filter((el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth; });
        const exposed = staff.filter((el) => {
          const box = el.getBoundingClientRect();
          const top = document.elementFromPoint(Math.min(innerWidth - 1, box.left + box.width / 2), Math.min(innerHeight - 1, box.top + box.height / 2));
          return !top || (top !== scrim && !dialog.contains(top));
        }).map((el) => el.textContent);
        return {
          staffOnScreen: staff.length,
          exposed,
          covers: Boolean(rect && rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth && rect.bottom >= innerHeight),
          opaque: alpha.length === 3 || alpha[3] === 1,
        };
      });
      // The receipt beneath names Ploy on the covered visit at iPad landscape and desktop widths.
      if (size.width >= 1180) expect(cover.staffOnScreen).toBeGreaterThan(0);
      expect(cover.exposed).toEqual([]);
      expect(cover.covers).toBe(true);
      expect(cover.opaque).toBe(true);
      expect(await page.locator("body").innerText()).not.toMatch(FULL_CODE);
      if (size.name === "820-keyboard") await sheet.getByRole("button", { name: "Staff view" }).focus();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/history-guest-${size.name}.png` });
    });

    // Audit r1 finding 6: the Preview's pickers are 44 × 44 px, label and select alike.
    test("Preview pickers are at least 44 × 44 px", async ({ page }) => {
      await open(page, "commerce=dark");
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("label:has(select), label select")]
        .map((el) => ({ name: `${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? el.textContent?.trim().slice(0, 14)}`, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
        .map(({ name, box }) => `${name} ${Math.round(box.width)}×${Math.round(box.height)}`));
      expect(small).toEqual([]);
      await expect(page.getByRole("button", { name: "Commerce receipt · voucher spend" })).toBeVisible();
      if (size.name === "820-keyboard") await page.getByTestId("commerce-state").focus();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/picker-${size.name}.png` });
    });

    // Audit r1 finding 7: About approvals, Close, Decline and Approve are 44 × 44 px with any pointer.
    test("Approvals controls are at least 44 × 44 px with any pointer", async ({ page }) => {
      await open(page, "commerce=live");
      await page.getByTestId("approvals-button").click();
      const panel = page.getByRole("dialog", { name: "Approvals" });
      await panel.getByTestId("approval-request").nth(0).getByRole("button").click();
      await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
      const measured = await panel.evaluate((root) => ["About approvals", "Close", "Decline", "Approve"].map((name) => {
        const button = [...root.querySelectorAll<HTMLElement>("button")].find((el) => el.getAttribute("aria-label") === name || el.textContent?.trim() === name);
        const box = button?.getBoundingClientRect();
        return { name, width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
      }));
      for (const { name, width, height } of measured) {
        expect.soft(width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect.soft(height, `${name} height`).toBeGreaterThanOrEqual(44);
      }
      expect.soft(await overflowX(page), "approvals sideways scroll").toBeLessThanOrEqual(0);
      if (size.name === "820-keyboard") await panel.getByRole("button", { name: "Approve" }).focus();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/approvals-controls-${size.name}.png` });
    });
  });
}
