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

    test("all refund choices use the locked subtle tone with legible selected text", async ({ page }) => {
      await open(page, "staff-roles", "?role=manager&scenario=refund");
      await page.getByRole("button", { name: "Refund Foot spa 45", exact: true }).click();
      const form = page.getByRole("form", { name: "Refund", exact: true });
      await form.getByRole("radio", { name: "Guest complaint", exact: true }).click();
      const palette = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.cssText = "color:var(--foreground);background-color:var(--background)";
        document.body.append(probe);
        const colors = { foreground: getComputedStyle(probe).color, background: getComputedStyle(probe).backgroundColor };
        probe.remove();
        return colors;
      });
      for (const name of ["All", "Card", "Guest complaint"]) {
        const chip = form.getByRole("radio", { name, exact: true });
        await expect(chip).toHaveAttribute("aria-checked", "true");
        await expect(chip).toHaveCSS("background-color", palette.background);
        await expect(chip).toHaveCSS("color", palette.foreground);
      }
      await expect(form.getByRole("radio", { name: "Half", exact: true })).toHaveAttribute("aria-checked", "false");
      for (const group of await form.locator("[data-variant=segmented]").all()) await expect(group).toHaveAttribute("data-tone", "subtle");
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

    for (const action of ["switch row", "remove item", "new sale", ...(width === 390 ? ["close order"] : [])]) {
      test(`a blur-saving discount is no longer a draft when tapping ${action}`, async ({ page }) => {
        await open(page, "staff-roles", "?role=cashier&scenario=spa");
        await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
        let panel = await orderPanel(page, width);
        await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
        await page.evaluate(() => window.fixture.holdNextDiscountWrite());
        await panel.getByLabel("Discount", { exact: true }).fill("10%");
        if (action === "switch row") await panel.getByRole("button", { name: /^Foot spa 45/ }).click();
        if (action === "remove item") await panel.getByRole("button", { name: "Remove item", exact: true }).click();
        if (action === "close order") await panel.getByRole("button", { name: "Close order", exact: true }).click();
        if (action === "new sale") {
          // The phone header is behind the modal sheet: closing it also blurs the field.
          if (width === 390) {
            await panel.getByRole("button", { name: "Close order", exact: true }).click();
            await page.getByRole("button", { name: "More checkout actions", exact: true }).click();
            await page.getByRole("menuitem", { name: "New order", exact: true }).click();
          } else await page.getByRole("button", { name: "New order", exact: true }).click();
        }
        await expect(discardDialog(page)).toHaveCount(0);
        // The held write starts once the queued add-item write settles; release it as soon as it is waiting.
        await expect.poll(() => page.evaluate(() => { try { window.fixture.finishDiscountWrite(); return true; } catch { return false; } })).toBe(true);
        if (action === "new sale") {
          await page.getByRole("button", { name: "Orders", exact: true }).click();
          await page.getByRole("dialog").getByRole("button", { name: /Order #1043/ }).click();
        }
        if (action === "close order" || action === "new sale") panel = await orderPanel(page, width);
        await expect(panel.getByTestId("order-due")).toHaveText(action === "remove item" ? "฿600" : "฿1,680");
        await expect(discardDialog(page)).toHaveCount(0);
      });
    }

    test("a failed blur save becomes a draft again and Discard clears it", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      const discount = panel.getByLabel("Discount", { exact: true });
      await discount.fill("10%");
      await discount.press("Tab");
      await page.evaluate(() => window.fixture.finishDiscountWrite(true));
      await expect(discount).toBeEnabled();
      await expect(page.getByRole("alert").first()).toContainText("Discount write failed");
      await row.click();
      await keep(page);
      await expect(discount).toHaveValue("10%");
      await row.click();
      await discard(page);
      await row.click();
      await expect(discount).toHaveValue("");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
    });

    test("a server approval refusal restores the unsaved discount and its reason path", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa&serverLimit=5");
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      await panel.getByLabel("Discount", { exact: true }).fill("10%");
      await panel.getByLabel("Discount", { exact: true }).press("Tab");
      const ask = panel.getByRole("group", { name: "Ask a manager", exact: true });
      await expect(ask).toBeVisible();
      await row.click();
      await keep(page);
      await ask.getByLabel("Reason", { exact: true }).fill("Guest waited");
      await ask.getByRole("button", { name: "Send 10% (฿120) to manager", exact: true }).click();
      await expect(panel.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,200");
    });

    test("a late discount refusal survives a row switch and reopens the request", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa&serverLimit=5");
      await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      await panel.getByLabel("Discount", { exact: true }).fill("10%");
      await panel.getByRole("button", { name: /^Foot spa 45/ }).click();
      await expect(panel.getByRole("button", { name: /^Foot spa 45/ })).toHaveAttribute("aria-expanded", "true");
      await page.evaluate(() => window.fixture.finishDiscountWrite());
      await expect(panel.getByRole("alert")).toContainText("10% off Thai massage 60 needs a manager — not applied.");
      await panel.getByRole("button", { name: "Review discount", exact: true }).click();
      await expect(panel.getByLabel("Discount", { exact: true })).toHaveValue("10%");
      await expect(panel.getByRole("group", { name: "Ask a manager", exact: true })).toBeVisible();
      await panel.getByRole("group", { name: "Ask a manager", exact: true }).getByLabel("Reason", { exact: true }).fill("Guest waited");
      await panel.getByRole("button", { name: "Send 10% (฿120) to manager", exact: true }).click();
      await expect(panel.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager");
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,800");
    });

    for (const loseAnswer of [false, true]) test(`discount Review cannot interrupt a submitting payment (${loseAnswer ? "lost answer" : "success"})`, async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa&serverLimit=5");
      await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      await panel.getByLabel("Discount", { exact: true }).fill("10%");
      await panel.getByRole("button", { name: /^Foot spa 45/ }).click();
      await page.evaluate(() => window.fixture.finishDiscountWrite());
      const review = panel.getByRole("button", { name: "Review discount", exact: true });
      await expect(review).toBeEnabled();
      await panel.getByRole("button", { name: /^Cash ฿1,800$/ }).click();
      // Discard the refused line draft while retaining its notice.
      if (await discardDialog(page).count()) await discard(page);
      await page.evaluate(() => window.fixture.holdNextPayment());
      await panel.getByRole("button", { name: "Confirm cash · ฿1,800 received · no change", exact: true }).click();
      await expect(review).toBeDisabled();
      await expect(panel.getByRole("button", { name: "Dismiss discount notice" })).toBeDisabled();
      // A synthetic click also exercises the handler's guard.
      await review.evaluate((button: HTMLButtonElement) => button.click());
      await expect(panel.getByTestId("pay-panel")).toBeVisible();
      await page.evaluate((lost) => window.fixture.finishPayment(lost), loseAnswer);
      if (loseAnswer) {
        await expect(panel.getByTestId("pay-panel").getByRole("alert")).toContainText("Payment answer lost");
        await panel.getByRole("button", { name: "Retry payment", exact: true }).click();
        const attempts = await page.evaluate(() => window.fixture.paymentAttempts());
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toBe(attempts[0]);
      }
      await expect(page.getByRole("article", { name: "Receipt", includeHidden: true })).toContainText("฿1,800");
    });

    test("a discount reply reaches the editor reopened during the save", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa&serverLimit=5");
      await page.getByRole("button", { name: /^Foot spa 45.*Add to order/ }).click();
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      await panel.getByLabel("Discount", { exact: true }).fill("10%");
      await panel.getByRole("button", { name: /^Foot spa 45/ }).click();
      await row.click();
      await expect(discardDialog(page)).toHaveCount(0);
      await expect(panel.getByLabel("Discount", { exact: true })).toHaveAttribute("readonly");
      await page.evaluate(() => window.fixture.finishDiscountWrite());
      await expect(panel.getByRole("group", { name: "Ask a manager", exact: true })).toBeVisible();
      await expect(panel.getByLabel("Discount", { exact: true })).toHaveValue("10%");
    });

    test("Enter keeps discount focus while the save is pending", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      const discount = panel.getByLabel("Discount", { exact: true });
      await discount.fill("10%");
      await discount.press("Enter");
      await expect(discount).toBeFocused();
      await expect(discount).toHaveAttribute("aria-busy", "true");
      await page.evaluate(() => window.fixture.finishDiscountWrite());
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,080");
      await expect(discount).toBeFocused();
    });

    for (const refusal of [false, true]) test(`a late discount ${refusal ? "refusal" : "failure"} stays visible after New order`, async ({ page }) => {
      await open(page, "staff-roles", `?role=cashier&scenario=spa${refusal ? "&serverLimit=5" : ""}`);
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await page.evaluate(() => window.fixture.holdNextDiscountWrite());
      await panel.getByLabel("Discount", { exact: true }).fill("10%");
      if (width === 390) {
        await panel.getByRole("button", { name: "Close order", exact: true }).click();
        await page.getByRole("button", { name: "More checkout actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "New order", exact: true }).click();
      } else await page.getByRole("button", { name: "New order", exact: true }).click();
      await expect(page.getByTestId("order-title")).toHaveText("New order");
      await page.evaluate((fail) => window.fixture.finishDiscountWrite(fail), !refusal);
      await expect(page.getByRole("alert")).toContainText(refusal
        ? "10% off Thai massage 60 needs a manager — not applied."
        : "A change on the previous order did not save: Discount write failed");
      if (refusal) {
        await page.getByRole("button", { name: "Review discount", exact: true }).click();
        const recovered = width === 390 ? page.getByRole("dialog") : panel;
        await expect(recovered.getByTestId("order-panel-title")).toHaveText("Order #1043");
        await expect(recovered.getByLabel("Discount", { exact: true })).toHaveValue("10%");
        await expect(recovered.getByRole("group", { name: "Ask a manager", exact: true })).toBeVisible();
      }
    });

    test("payment rechecks the lock after a discard confirmation", async ({ page }) => {
      await open(page, "staff-roles", "?role=cashier&scenario=spa");
      const panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      await panel.getByRole("button", { name: /^Price ฿1,200$/ }).click();
      await panel.getByLabel("New unit price").fill("1100");
      await panel.getByRole("button", { name: /^Cash ฿1,200$/ }).click();
      await expect(discardDialog(page)).toBeVisible();
      await page.evaluate(() => window.fixture.requestFromAnotherTill());
      // The confirmation makes the underlying panel aria-hidden while the live order updates.
      await expect(page.locator('[data-approval-status="pending"]')).toHaveCount(1);
      await discard(page);
      await expect(panel.getByTestId("pay-panel")).toHaveCount(0);
      await expect(panel.getByRole("button", { name: /^Cash ฿1,200$/ })).toBeDisabled();
      await expect(panel.getByLabel("New unit price")).toHaveCount(0);
    });

    test("a live discount sync stays clean but preserves a typed draft", async ({ page }) => {
      await open(page, "staff-roles", "?role=manager&scenario=spa");
      const panel = await orderPanel(page, width);
      const row = panel.getByRole("button", { name: /^Thai massage 60/ });
      await row.click();
      const discount = panel.getByLabel("Discount", { exact: true });
      await page.evaluate(() => window.fixture.discountFromAnotherTill(5));
      await expect(discount).toHaveValue("5%");
      await row.click();
      await expect(row).toHaveAttribute("aria-expanded", "false");
      await expect(discardDialog(page)).toHaveCount(0);
      await row.click();
      await discount.fill("invalid draft");
      await page.evaluate(() => window.fixture.discountFromAnotherTill(10));
      await expect(discount).toHaveValue("invalid draft");
      await row.click();
      await keep(page);
      await expect(discount).toHaveValue("invalid draft");
      await row.click();
      await discard(page);
      await row.click();
      await expect(discount).toHaveValue("10%");
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

test("rotation preserves the side editor price and reason in the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await open(page, "staff-roles", "?role=cashier&scenario=spa");
  const side = await orderPanel(page, 1180);
  await side.getByRole("button", { name: /^Thai massage 60/ }).click();
  await side.getByRole("button", { name: /^Price ฿1,200$/ }).click();
  await side.getByLabel("New unit price").fill("1100");
  await side.getByLabel("Reason for the price change").fill("Guest waited");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(side).toHaveCount(0);
  const sheet = await orderPanel(page, 820);
  await expect(sheet.getByRole("button", { name: /^Thai massage 60/ })).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.getByLabel("New unit price")).toHaveValue("1100");
  await expect(sheet.getByLabel("Reason for the price change")).toHaveValue("Guest waited");
  await sheet.getByLabel("New unit price").fill("1000");
  await sheet.getByRole("button", { name: /^Cash ฿1,200$/ }).click();
  await discard(page);
  await expect(sheet.getByTestId("pay-panel")).toBeVisible();
  await sheet.getByRole("button", { name: "Order", exact: true }).click();
  await sheet.getByRole("button", { name: /^Price ฿1,200$/ }).click();
  await expect(sheet.getByLabel("New unit price")).toHaveValue("");
  await sheet.getByRole("button", { name: "Close order", exact: true }).click();
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
});

test("an iPad lower-line refund reveals its form and keeps the line header below the app bar", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 600 });
  await open(page, "staff-roles", "?role=manager&scenario=refund");
  const trigger = page.getByRole("button", { name: "Refund Foot spa 45", exact: true });
  await trigger.evaluate((button) => button.scrollIntoView({ block: "end" }));
  await trigger.click();
  const form = page.getByRole("form", { name: "Refund", exact: true });
  await expect(form.getByText("Refund", { exact: true })).toBeInViewport();
  const rowTop = await form.locator("xpath=ancestor::li").evaluate((row) => row.getBoundingClientRect().top);
  expect(rowTop).toBeGreaterThanOrEqual(64);
});

test("a phone refund keeps a tall line header below the app bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "staff-roles", "?role=manager&scenario=refund");
  const trigger = page.getByRole("button", { name: "Refund Foot spa 45", exact: true });
  await trigger.evaluate((button) => {
    const row = button.closest("li")!;
    const header = document.createElement("p");
    header.textContent = "Appointment details for a guest with a long service and therapist name";
    header.style.height = "130px";
    row.prepend(header);
    button.scrollIntoView({ block: "end" });
  });
  await trigger.click();
  const form = page.getByRole("form", { name: "Refund", exact: true });
  await expect(form.getByText("Refund", { exact: true })).toBeInViewport();
  const rowTop = await form.locator("xpath=ancestor::li").evaluate((row) => row.getBoundingClientRect().top);
  const headerBottom = await page.locator("header").first().evaluate((header) => header.getBoundingClientRect().bottom);
  expect(rowTop).toBeGreaterThanOrEqual(headerBottom);
});

for (const outcome of ["withdraw", "decline"]) test(`a phone empty-order request stays accessible to ${outcome}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "staff-roles", "?role=cashier");
  await page.getByRole("tab", { name: "Extras", exact: true }).click();
  await page.getByRole("button", { name: "Custom item", exact: true }).click();
  const custom = page.getByRole("dialog");
  await custom.getByLabel("Name", { exact: true }).fill("Guest transfer");
  await custom.getByLabel("Price (฿, VAT included)", { exact: true }).fill("500");
  await custom.getByRole("button", { name: "Ask manager", exact: true }).click();
  const ask = page.getByRole("group", { name: /^Ask a manager/ });
  await ask.getByLabel("Reason", { exact: true }).fill("Extra stop");
  await ask.getByRole("button", { name: "Send request", exact: true }).click();
  const bar = page.getByRole("button", { name: /Request waiting · View/ });
  await expect(bar).toBeVisible();
  await bar.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("No items yet");
  await expect(sheet.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager");
  if (outcome === "withdraw") {
    await sheet.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(sheet.locator('[data-approval-status="cancelled"]')).toContainText("Request withdrawn.");
  } else {
    await sheet.getByRole("button", { name: "Close order", exact: true }).click();
    await page.evaluate(() => window.fixture.setRole("manager"));
    await page.getByTestId("approvals-button").click();
    await page.getByRole("dialog", { name: "Approvals", exact: true }).getByRole("button", { name: "Decline", exact: true }).click();
    await page.evaluate(() => window.fixture.setRole("cashier"));
    await page.getByRole("button", { name: /Request update · View/ }).click();
    await expect(sheet.locator('[data-approval-status="rejected"]')).toContainText("Declined. Nothing changed.");
  }
});

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
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(preview).toHaveAttribute("open");
  await expect(paper).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(preview).not.toHaveAttribute("open");
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(preview).toHaveAttribute("open");
  await expect(paper).toBeVisible();
});
