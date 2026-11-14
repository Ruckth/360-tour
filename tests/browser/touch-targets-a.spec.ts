import { expect, test, type Page } from "@playwright/test";

// No size exceptions: small checkbox glyphs may use their actual clickable label wrapper.
// Hidden responsive copies and clipped screen-reader-only inputs are not visible controls.
const controls = 'button, a[href], input, select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch]';
async function targets(page: Page, state: string) {
  const failures = await page.locator(controls).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || style.visibility === "hidden" || style.clipPath === "inset(50%)" || style.clip === "rect(0px, 0px, 0px, 0px)" || element.closest('[inert]')) return [];
    let box = rect;
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      const label = element.labels?.[0];
      if (label) {
        const wrapper = label.getBoundingClientRect();
        // The label is a real input activation area. Verify its centre is hit-testable.
        const x = wrapper.left + wrapper.width / 2;
        const y = wrapper.top + wrapper.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && label.contains(hit)) box = wrapper;
      }
    }
    return box.width >= 43.9 && box.height >= 43.9 ? [] : [{
      name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 70) ?? element.tagName,
      width: box.width, height: box.height,
    }];
  }));
  expect(failures, `${state}: all visible controls need a 44×44 CSS px hit box`).toEqual([]);
}
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
  test.describe(`${viewport.width}px checkout touch targets`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    test("catalog, editor, schedule, cash, split and Orders", async ({ page }) => {
      await open(page, "?role=cashier");
      await targets(page, "empty catalog");
      await open(page, "?role=cashier&scenario=spa");
      if (viewport.width === 390) await page.getByRole("button", { name: /open the order/ }).click();
      const order = viewport.width === 390 ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
      await order.getByRole("button", { name: /^Thai massage 60/ }).click();
      await targets(page, "line editor");
      await order.getByRole("button", { name: /^Schedule/ }).click();
      await targets(page, "schedule editor");
      await order.getByRole("button", { name: /^Cash ฿/ }).click();
      await targets(page, "cash");
      await order.getByRole("button", { name: "Edit payment time" }).click();
      await targets(page, "payment time");
      await order.getByRole("button", { name: "Split payment", exact: true }).click();
      await targets(page, "empty split");
      await order.getByLabel("Payment 1 amount").fill("500");
      await targets(page, "covered split");
      await order.getByRole("button", { name: "Add payment", exact: true }).click();
      await targets(page, "removable split rows");
      await open(page, "?role=cashier&scenario=spa");
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      await targets(page, "Orders");
    });
    test("cashier account controls", async ({ page }) => {
      await page.goto("/tests/browser/admin-shell.html?role=cashier&path=/admin/checkout");
      await page.locator("header h1").waitFor();
      await targets(page, "cashier app header");
      if (viewport.width === 390) {
        await page.getByRole("button", { name: "Account menu", exact: true }).click();
        await targets(page, "account menu");
        const signOut = page.getByRole("menuitem", { name: "Sign out", exact: true });
        const box = await signOut.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    });
    test("receipt, refund and approvals", async ({ page }) => {
      await open(page, "?role=manager&scenario=refund");
      await targets(page, "receipt");
      await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
      await targets(page, "refund");
      await open(page, "?role=manager&scenario=pending");
      await page.getByTestId("approvals-button").click();
      await targets(page, "approvals");
    });
  });
}
