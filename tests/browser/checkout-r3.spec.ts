import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test.use({ hasTouch: true, isMobile: true });
test.setTimeout(60_000);

async function open(page: Page, fixture: string, query: string) {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const discardDialog = (page: Page) => page.getByRole("alertdialog").filter({ has: page.getByRole("heading", { name: "Discard unsaved changes?", exact: true }) });
async function keep(page: Page) {
  const guard = discardDialog(page);
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(guard).toHaveCount(0);
}
async function discard(page: Page) {
  await discardDialog(page).getByRole("button", { name: "Discard", exact: true }).click();
}
async function orderPanel(page: Page, width: number): Promise<Locator> {
  if (width < 1024) {
    await page.getByRole("button", { name: /open the order/ }).click();
    return page.getByRole("dialog");
  }
  return page.getByRole("complementary", { name: "Order", exact: true });
}

for (const width of [390, 1180]) {
  test.describe(`${width}px checkout round 3`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 820 } });

    test("empty order is passive, and an iPad line editor keeps Remove item in view", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier");
      await expect(page.getByRole("button", { name: /open the order/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Cash ฿/ })).toHaveCount(0);
      if (width === 390) await expect(page.locator("[data-admin-bottom-bar]")).toHaveText("No items yet");
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await expect(panel.getByRole("button", { name: "Add coupon", exact: true })).toBeVisible();
      await expect(panel.getByText("Code, QR or link", { exact: true })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "Remove item", exact: true })).toBeInViewport();
      if (width === 1180) {
        const secondary = await Promise.all(["PromptPay", "Card", "Transfer", "Split payment"].map((name) => panel.getByRole("button", { name, exact: true }).boundingBox()));
        expect(new Set(secondary.map((box) => Math.round(box!.y))).size).toBe(1);
      }
    });

    test("all refund chip groups keep selected text visible on the foreground fill", async ({ page }) => {
      await open(page, "staff-roles", "?role=manager&scenario=refund");
      await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
      const form = page.getByRole("form", { name: "Refund", exact: true });
      await form.getByRole("button", { name: "Guest complaint", exact: true }).click();
      const palette = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.cssText = "color:var(--foreground);background-color:var(--background)";
        document.body.append(probe);
        const colors = { foreground: getComputedStyle(probe).color, background: getComputedStyle(probe).backgroundColor };
        probe.remove();
        return colors;
      });
      for (const name of ["All", "Card", "Guest complaint"]) {
        const chip = form.getByRole("button", { name, exact: true });
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        await expect(chip).toHaveCSS("background-color", palette.foreground);
        await expect(chip).toHaveCSS("color", palette.background);
      }
      await expect(form.getByRole("button", { name: "Half", exact: true })).toHaveCSS("background-color", palette.background);
    });

    test("price and reason survive cancelled collapse, row switch, payment and sheet dismissal", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      await panel.getByRole("button", { name: /^Price ฿1,200$/ }).click();
      const price = panel.getByLabel("New unit price");
      const reason = panel.getByLabel("Reason for the price change");
      await price.fill("1100");
      await reason.fill("Guest waited");
      expect(await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })).toBe(true);
      await panel.evaluate((panelElement) => {
        const link = document.createElement("a");
        link.href = "/tests/browser/index.html";
        link.textContent = "Leave checkout";
        link.style.cssText = "position:fixed;top:0;left:0;z-index:100;width:100px;height:44px";
        panelElement.append(link);
      });
      for (const action of [
        () => page.getByRole("link", { name: "Leave checkout", exact: true }).click(),
        () => row.click(),
        () => panel.getByRole("button", { name: /^Foot spa 45/ }).click(),
        () => panel.getByRole("button", { name: /^Cash ฿1,800$/ }).click(),
        () => panel.getByRole("button", { name: "Cancel", exact: true }).click(),
        ...(width === 390 ? [
          () => panel.getByRole("button", { name: "Close order", exact: true }).click(),
          () => reason.press("Escape"),
          () => page.mouse.click(2, 2),
        ] : []),
      ]) {
        await action();
        await keep(page);
        await expect(price).toHaveValue("1100");
        await expect(reason).toHaveValue("Guest waited");
        await expect(row).toHaveAttribute("aria-expanded", "true");
        await page.getByRole("link", { name: "Leave checkout", exact: true }).evaluateAll((links) => links.forEach((link) => link.remove()));
      }
      if (width === 390) {
        await page.setViewportSize({ width: 1180, height: 820 });
        await keep(page);
        await expect(price).toBeVisible();
        await expect(price).toHaveValue("1100");
        await expect(reason).toHaveValue("Guest waited");
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,800");
      await expect(page.getByTestId("receipt-view")).toHaveCount(0);
      await row.click();
      await discard(page);
      await expect(row).toHaveAttribute("aria-expanded", "false");
      await row.click();
      await panel.getByRole("button", { name: /^Price ฿1,200$/ }).click();
      await expect(price).toHaveValue("");
      await expect(reason).toHaveValue("");
    });

    test("an unsent approval reason is kept, and sending still waits for a manager", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      await panel.getByLabel("Discount", { exact: true }).fill("15%");
      const ask = panel.getByRole("group", { name: "Ask a manager", exact: true });
      await ask.getByLabel("Reason", { exact: true }).fill("Service delay");
      await row.click();
      await keep(page);
      await expect(ask.getByLabel("Reason", { exact: true })).toHaveValue("Service delay");
      await ask.getByRole("button", { name: "Send 15% (฿180) to manager", exact: true }).click();
      await expect(panel.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
      await expect(panel.getByRole("button", { name: /^Cash ฿1,200$/ })).toBeDisabled();
    });

    test("link and unlink drafts guard Escape, outside, Back and Cancel without changing the receipt", async ({ page }) => {
      await open(page, "checkout", "?scenario=unscheduled-paid");
      const paper = page.locator(".pos-receipt");
      const issued = await paper.textContent();
      const items = page.getByTestId("receipt-items");
      await items.getByRole("button", { name: "Link appointment", exact: true }).click();
      const link = page.getByRole("dialog").filter({ has: page.getByTestId("link-review") });
      await link.getByLabel("Reason", { exact: true }).fill("Prepaid appointment");
      for (const action of [
        () => link.getByLabel("Reason", { exact: true }).press("Escape"),
        () => page.mouse.click(2, 2),
        () => link.getByRole("button", { name: "Back", exact: true }).click(),
      ]) {
        await action();
        await keep(page);
        await expect(link.getByLabel("Reason", { exact: true })).toHaveValue("Prepaid appointment");
        await expect(items.getByTestId("line-link")).toHaveCount(0);
      }
      await link.getByRole("button", { name: "Back", exact: true }).click();
      await discard(page);
      const search = page.getByLabel("Find the appointment");
      await search.fill("Somchai");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await keep(page);
      await expect(search).toHaveValue("Somchai");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await discard(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await items.getByRole("button", { name: "Link appointment", exact: true }).click();
      await page.getByRole("dialog").getByLabel("Reason", { exact: true }).fill("Prepaid appointment");
      await page.getByRole("button", { name: "Confirm link", exact: true }).click();
      await expect(items.getByTestId("line-link")).toHaveText("Linked · SVC-0002");
      await items.getByRole("button", { name: /^Unlink / }).click();
      const unlink = page.getByRole("alertdialog").filter({ has: page.getByLabel("Reason", { exact: true }) });
      await unlink.getByLabel("Reason", { exact: true }).fill("Wrong appointment");
      for (const action of [
        () => unlink.getByLabel("Reason", { exact: true }).press("Escape"),
        () => page.mouse.click(2, 2),
        () => unlink.getByRole("button", { name: "Cancel", exact: true }).click(),
      ]) {
        await action();
        await keep(page);
        await expect(unlink.getByLabel("Reason", { exact: true })).toHaveValue("Wrong appointment");
        await expect(items.getByTestId("line-link")).toHaveText("Linked · SVC-0002");
      }
      await unlink.getByRole("button", { name: "Cancel", exact: true }).click();
      await discard(page);
      expect(await paper.textContent()).toBe(issued);
      await expect(items.getByTestId("line-link")).toHaveText("Linked · SVC-0002");
    });
  });
}

for (const paperWidth of [58, 80]) test(`a closed phone receipt preview prints every line on one full-length ${paperWidth} mm page`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "staff-roles", "?role=manager&scenario=refund");
  if (paperWidth === 58) {
    await page.getByRole("button", { name: "More receipt actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Use 58 mm paper", exact: true }).click();
  }
  const preview = page.locator("details.receipt-preview");
  const paper = page.getByRole("article", { name: "Receipt", includeHidden: true });
  await expect(preview).not.toHaveAttribute("open");
  await expect(page.getByRole("article", { name: "Receipt" })).toHaveCount(0);
  await expect(page.getByTestId("receipt-items")).toBeVisible();
  await preview.locator("summary").click();
  await expect(paper).toBeVisible();
  const issued = await paper.textContent();
  await preview.locator("summary").click();
  await expect(preview).not.toHaveAttribute("open");
  await page.emulateMedia({ media: "print" });
  await expect(paper).toBeVisible();
  await expect(paper).toContainText("Thai massage 60");
  await expect(paper).toContainText("Foot spa 45");
  expect(await paper.textContent()).toBe(issued);
  const printed = await paper.boundingBox();
  expect(printed!.height).toBeGreaterThan(100);
  expect(printed!.width).toBeCloseTo(paperWidth * 96 / 25.4, 0);
  const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getHeight() * 96 / 72).toBeGreaterThanOrEqual(printed!.height);
  await page.emulateMedia({ media: "screen" });
  await expect(preview).not.toHaveAttribute("open");
});
