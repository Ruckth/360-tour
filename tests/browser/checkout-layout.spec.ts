import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

/*
 * Checkout layout and receipt printing in a real browser, on the fixture backend.
 * "Enlarged text" sets the root font to 32px (200% of the 16px default) at an unchanged CSS
 * viewport, which scales rem-based text and spacing the way a large browser text size does.
 */

const ENLARGED = "32px";
const TENDERS = ["Cash", "PromptPay", "Card", "Transfer", "Split payment"];
const PX_PER_MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;
const EVIDENCE = process.env.CHECKOUT_LAYOUT_EVIDENCE;

test("320px enlarged checkout keeps the page and catalog actions inside the viewport", async ({ page }) => {
  await open(page, { width: 320, height: 740 });
  await setRootFont(page, ENLARGED);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectReachable(page, page.getByRole("button", { name: "Orders", exact: true }), "Orders");
  await expectReachable(page, page.getByRole("button", { name: "New order", exact: true }), "New order");
  const firstTab = page.getByRole("tab", { name: "Frequent", exact: true });
  await firstTab.focus();
  await firstTab.press("End");
  await expect(page.getByRole("tab", { name: "Extras", exact: true })).toHaveAttribute("aria-selected", "true");
  await expectReachable(page, page.getByRole("tab", { name: "Extras", exact: true }), "last catalog tab");
  await page.getByRole("tab", { name: "Extras", exact: true }).press("Home");
  const tile = page.getByRole("button", { name: /^Thai massage 60.*Add to order/ });
  await tile.scrollIntoViewIfNeeded();
  const geometry = await tile.evaluate((el) => {
    const icon = Array.from(el.querySelectorAll("span")).find(node => node.classList.contains("sr-only") && node.textContent === "Add to order")!.parentElement!;
    return { overflow: el.scrollWidth - el.clientWidth, right: icon.getBoundingClientRect().right, left: icon.getBoundingClientRect().left };
  });
  expect.soft(geometry.overflow).toBeLessThanOrEqual(1);
  expect.soft(geometry.left).toBeGreaterThanOrEqual(0);
  expect.soft(geometry.right).toBeLessThanOrEqual(320);
  await expectReachable(page, tile.locator("span.sr-only").filter({ hasText: "Add to order" }).locator(".."), "catalog add control");
  await shot(page, "catalog-text200-320");
});

async function open(page: Page, viewport: { width: number; height: number }, query = "") {
  await page.setViewportSize(viewport);
  await page.goto(`/tests/browser/checkout.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

async function setRootFont(page: Page, size: string) {
  await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
  // Let transitions and layout settle.
  await page.waitForTimeout(400);
}

async function openOrderSheet(page: Page) {
  await page.getByRole("button", { name: /open the order/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

type Reach = { left: number; right: number; top: number; bottom: number; hit: boolean; overflowX: number };

/**
 * Scrolls the element into view the way keyboard focus or a swipe would, then reports whether it
 * lies wholly inside the viewport, is the top element at its centre (not covered), and whether
 * its own content overflows it horizontally.
 */
function reach(locator: Locator): Promise<Reach> {
  return locator.evaluate((element) => {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    // Disabled buttons ignore the pointer; hit-test them as if enabled.
    const style = (element as HTMLElement).style;
    const pointerEvents = style.pointerEvents;
    style.pointerEvents = "auto";
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 20));
    style.pointerEvents = pointerEvents;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      hit: !!top && (top === element || element.contains(top)),
      overflowX: element.scrollWidth - element.clientWidth,
    };
  });
}

async function expectReachable(page: Page, locator: Locator, label: string) {
  const viewport = page.viewportSize()!;
  const box = await reach(locator);
  expect.soft(box.left, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect.soft(box.right, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
  expect.soft(box.top, `${label} top edge`).toBeGreaterThanOrEqual(0);
  expect.soft(box.bottom, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
  expect.soft(box.hit, `${label} is not covered`).toBe(true);
  expect.soft(box.overflowX, `${label} label fits`).toBeLessThanOrEqual(1);
}

/** The nearest scrolling ancestor of the first order row: the rows' own viewport. */
function rowsViewport(sheet: Locator) {
  return sheet.locator("li button[aria-expanded]").first().evaluate((row) => {
    let node = row.parentElement;
    while (node && !["auto", "scroll"].includes(getComputedStyle(node).overflowY)) node = node.parentElement;
    return node ? { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight } : null;
  });
}

/** A money amount reads as one number: it fits on a single line instead of breaking between digits. */
async function expectOneLine(locator: Locator, label: string) {
  const lines = await locator.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize));
  expect.soft(lines, `${label} on one line`).toBeLessThan(1.9);
}

type Box = { x: number; y: number; width: number; height: number };

/** Boxes of several controls in one layout, without scrolling between reads. */
async function boxesOf(locators: Locator[]) {
  const boxes: Box[] = [];
  for (const locator of locators) boxes.push((await locator.boundingBox())!);
  return boxes;
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

test.describe("order panel under enlarged text (RA-01)", () => {
  for (const { lines, name } of [{ lines: 2, name: "ordinary" }, { lines: 13, name: "long" }]) {
    test(`phone 390x844, ${name} order: actions, tenders and rows stay usable`, async ({ page }) => {
      await open(page, { width: 390, height: 844 }, `?lines=${lines}`);
      const sheet = await openOrderSheet(page);
      await setRootFont(page, ENLARGED);
      await shot(page, `order-sheet-text200-${name}-top`);

      const width = await sheet.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect.soft(width.scroll, "sheet has no horizontal overflow").toBeLessThanOrEqual(width.client + 1);

      for (const label of ["Close order", "Save & close", "Clear order"]) {
        await expectReachable(page, sheet.getByRole("button", { name: label, exact: true }), label);
      }

      const rows = await rowsViewport(sheet);
      expect(rows, "rows have a scrolling viewport").not.toBeNull();
      expect.soft(rows!.clientHeight, "rows viewport keeps a usable height").toBeGreaterThanOrEqual(200);

      // The last row can be brought into view and tapped.
      await expectReachable(page, sheet.locator("li button[aria-expanded]").last(), "last order row");

      const tenders = TENDERS.map((label) => sheet.getByRole("button", { name: label, exact: true }));
      for (const [index, button] of tenders.entries()) await expectReachable(page, button, TENDERS[index]);
      const boxes = await boxesOf(tenders);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) expect.soft(overlaps(boxes[i], boxes[j]), `${TENDERS[i]} and ${TENDERS[j]} do not overlap`).toBe(false);
      }
      const due = await reach(sheet.getByTestId("order-due"));
      expect.soft(due.right, "due amount stays inside the sheet").toBeLessThanOrEqual(390.5);
      await expectOneLine(sheet.getByTestId("order-due"), "due amount");
      await shot(page, `order-sheet-text200-${name}-footer`);
    });
  }

  test("phone 390x844: cash and split payment controls fit", async ({ page }) => {
    await open(page, { width: 390, height: 844 }, "?lines=13");
    const sheet = await openOrderSheet(page);
    await setRootFont(page, ENLARGED);

    await sheet.getByRole("button", { name: "Cash", exact: true }).click();
    await sheet.getByText("Payment date and time", { exact: false }).first().click();
    await expectReachable(page, sheet.getByLabel("Money received date · Bangkok time"), "payment business date");
    await expectReachable(page, sheet.getByLabel("Money received time · Bangkok time"), "payment business time");
    const paymentWidth = await sheet.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect.soft(paymentWidth.scroll, "payment sheet has no horizontal overflow").toBeLessThanOrEqual(paymentWidth.client + 1);
    for (const label of ["Back to order", "Exact", "+฿100", "+฿500", "+฿1,000", "Confirm cash"]) {
      await expectReachable(page, sheet.getByRole("button", { name: label, exact: true }), label);
    }
    await expectReachable(page, sheet.getByLabel("Cash received"), "Cash received");
    await expectReachable(page, sheet.getByTestId("cash-balance"), "amount still short");
    await expectOneLine(sheet.getByTestId("cash-balance"), "amount still short");
    await shot(page, "pay-cash-text200");

    await sheet.getByRole("button", { name: "Back to order" }).click();
    await sheet.getByRole("button", { name: "Split payment", exact: true }).click();
    const controls = [
      sheet.getByRole("combobox", { name: "Payment 1 method" }),
      sheet.getByLabel("Payment 1 amount"),
      sheet.getByRole("button", { name: "Rest" }).first(),
      sheet.getByRole("button", { name: "Remove payment 1" }),
      sheet.getByRole("combobox", { name: "Payment 2 method" }),
      sheet.getByLabel("Payment 2 amount"),
      sheet.getByRole("button", { name: "Add payment" }),
      sheet.getByRole("button", { name: "Confirm split" }),
    ];
    for (const [index, control] of controls.entries()) await expectReachable(page, control, `split control ${index + 1}`);
    const boxes = await boxesOf(controls);
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) expect.soft(overlaps(boxes[i], boxes[j]), `split row controls ${i + 1} and ${j + 1}`).toBe(false);
    }
    await expectReachable(page, sheet.getByTestId("split-remaining"), "remaining amount");
    await expectOneLine(sheet.getByTestId("split-remaining"), "remaining amount");
    const amount = await sheet.getByLabel("Payment 1 amount").boundingBox();
    expect.soft(amount!.width, "amount field keeps room to type").toBeGreaterThanOrEqual(96);
    await shot(page, "pay-split-text200");
  });
});

test("phone cash entry and confirmation stay visible above a reduced keyboard viewport", async ({ page }) => {
  await open(page, { width: 360, height: 800 }, "?lines=13");
  const sheet = await openOrderSheet(page);
  await sheet.getByRole("button", { name: "Cash", exact: true }).click();
  const input = sheet.getByLabel("Cash received");
  await input.focus();
  await page.setViewportSize({ width: 360, height: 464 });
  await input.fill("1200");
  const confirm = sheet.getByRole("button", { name: "Confirm cash", exact: true });
  await expect.poll(async () => {
    const [field, balance, action] = await boxesOf([input, sheet.getByTestId("cash-balance"), confirm]);
    return field.y >= 0 && field.y + field.height <= balance.y && balance.y + balance.height <= action.y && action.y + action.height <= 464.5;
  }).toBe(true);
});

/** Four tenders fill the row exactly: Cash starts and Transfer ends where Split payment does. */
async function expectFullTenderRow(scope: Locator) {
  const [cash, transfer, split] = await boxesOf(["Cash", "Transfer", "Split payment"].map((name) => scope.getByRole("button", { name, exact: true })));
  expect(cash.x).toBeCloseTo(split.x, 0);
  expect(transfer.x + transfer.width).toBeCloseTo(split.x + split.width, 0);
}

test.describe("order panel at normal text keeps its compact layout", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    test(`phone ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await open(page, viewport, "?lines=13");
      const sheet = await openOrderSheet(page);
      const tops: number[] = [];
      for (const label of [...TENDERS, "Close order", "Save & close"]) {
        // Visible as laid out, without any scrolling.
        const box = (await sheet.getByRole("button", { name: label, exact: true }).boundingBox())!;
        expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height + 0.5);
        expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(viewport.width + 0.5);
        tops.push(box.y + box.height / 2);
      }
      // Four tenders in one row (five with Split on a short landscape screen); header in one row.
      const tenderRow = viewport.height < 512 ? 5 : 4;
      for (let i = 1; i < tenderRow; i += 1) expect(tops[i]).toBeCloseTo(tops[0], 0);
      expect(tops[5]).toBeCloseTo(tops[6], 0);
      if (tenderRow === 4) await expectFullTenderRow(sheet);
      // Only the rows scroll; the panel itself does not.
      const panelScrolls = await sheet.getByTestId("order-panel-title").evaluate((title) => {
        let node = title.parentElement;
        while (node && !["auto", "scroll"].includes(getComputedStyle(node).overflowY)) node = node.parentElement;
        return node ? node.scrollHeight > node.clientHeight + 1 : false;
      });
      expect(panelScrolls, "panel itself does not scroll").toBe(false);
      const rows = await rowsViewport(sheet);
      expect(rows!.scrollHeight, "long order scrolls inside its rows").toBeGreaterThan(rows!.clientHeight);
      await shot(page, `order-sheet-normal-${viewport.width}x${viewport.height}`);
    });
  }

  test("desktop 1440x900 shows one order panel", async ({ page }) => {
    await open(page, { width: 1440, height: 900 }, "?lines=13");
    await expect(page.getByRole("complementary", { name: "Order" })).toBeVisible();
    await expect(page.getByRole("button", { name: /open the order/ })).toBeHidden();
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toHaveCount(1);
    const tops: number[] = [];
    for (const label of TENDERS.slice(0, 4)) tops.push((await page.getByRole("button", { name: label, exact: true }).boundingBox())!.y);
    for (const top of tops) expect(top).toBeCloseTo(tops[0], 0);
    await expectFullTenderRow(page.getByRole("complementary", { name: "Order" }));
    await shot(page, "order-panel-desktop-1440");
  });
});

test.describe("custom item dialog under enlarged text (RA-02)", () => {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }]) {
    test(`${viewport.width}x${viewport.height}: dialog fits and scrolls`, async ({ page }) => {
      await open(page, viewport);
      await page.getByRole("tab", { name: "Extras" }).click();
      await page.getByRole("button", { name: "Custom item" }).click();
      const dialog = page.getByRole("dialog", { name: "Custom item" });
      await expect(dialog).toBeVisible();
      await setRootFont(page, ENLARGED);
      await shot(page, `custom-item-text200-${viewport.width}-top`);

      const box = (await dialog.boundingBox())!;
      expect.soft(box.y, "dialog top").toBeGreaterThanOrEqual(0);
      expect.soft(box.y + box.height, "dialog bottom").toBeLessThanOrEqual(viewport.height + 0.5);
      expect.soft(box.x, "dialog left").toBeGreaterThanOrEqual(0);
      expect.soft(box.x + box.width, "dialog right").toBeLessThanOrEqual(viewport.width + 0.5);
      const own = await dialog.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect.soft(own.scroll, "no horizontal dialog overflow").toBeLessThanOrEqual(own.client + 1);

      for (const label of ["Close", "Cancel", "Add to order"]) {
        await expectReachable(page, dialog.getByRole("button", { name: label, exact: true }), label);
      }
      await expectReachable(page, dialog.getByLabel("Name"), "Name field");
      await expectReachable(page, dialog.getByRole("heading", { name: "Custom item" }), "heading");
      await dialog.evaluate((el) => el.scrollTo(0, 0));
      const [close, heading] = await boxesOf([dialog.getByRole("button", { name: "Close", exact: true }), dialog.getByRole("heading", { name: "Custom item" })]);
      expect.soft(overlaps(close, heading), "Close does not cover the heading").toBe(false);
      await dialog.getByRole("button", { name: "Add to order" }).scrollIntoViewIfNeeded();
      await shot(page, `custom-item-text200-${viewport.width}-scrolled`);

      // Still works: Cancel closes it.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
    });
  }

  test("320x740 normal text: dialog needs no scrolling", async ({ page }) => {
    await open(page, { width: 320, height: 740 });
    await page.getByRole("tab", { name: "Extras" }).click();
    await page.getByRole("button", { name: "Custom item" }).click();
    const dialog = page.getByRole("dialog", { name: "Custom item" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    const own = await dialog.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(own.scrollH).toBeLessThanOrEqual(own.clientH + 1);
    await shot(page, "custom-item-normal-320");
  });
});

test.describe("receipt print page size (PM-01)", () => {
  for (const paper of [58, 80] as const) {
    test(`${paper} mm: the browser accepts the page size and prints one page that wide`, async ({ page }) => {
      await open(page, { width: 1280, height: 800 }, "?lines=3");
      await page.getByRole("button", { name: "Cash", exact: true }).click();
      await page.getByRole("button", { name: "Exact" }).click();
      await page.getByRole("button", { name: "Confirm cash" }).click();
      const receipt = page.getByRole("article", { name: "Receipt" });
      await expect(receipt).toBeVisible();
      await page.getByRole("radio", { name: `${paper} mm` }).click();

      // CSSOM: a parsed @page rule keeps a page size of the selected width.
      const size = await page.evaluate(() => {
        const sizes: string[] = [];
        const walk = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSPageRule) sizes.push(rule.style.getPropertyValue("size"));
            else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
          }
        };
        for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
        return sizes.filter(Boolean);
      });
      expect(size).toHaveLength(1);
      const [width, height] = size[0].split(" ");
      expect(width).toBe(`${paper}mm`);
      expect(height).toMatch(/^\d+(\.\d+)?mm$/);

      // Print rendering: Chromium's print pipeline produces a single page of that size.
      await page.emulateMedia({ media: "print" });
      const printed = await receipt.boundingBox();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/receipt-print-media-${paper}mm.png`, fullPage: true });
      expect(printed!.width).toBeCloseTo(paper * PX_PER_MM, 0);
      expect(printed!.height / PX_PER_MM, "page is at least as long as the receipt").toBeLessThanOrEqual(parseFloat(height));
      await page.emulateMedia({ media: null });

      const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      expect(pdf.getPageCount(), "one page, no blank trailing pages").toBe(1);
      const pageSize = pdf.getPage(0).getSize();
      // Within 1pt: Chromium rounds the page to whole device pixels.
      expect(Math.abs(pageSize.width - paper * PT_PER_MM)).toBeLessThanOrEqual(1);
      expect(Math.abs(pageSize.height - parseFloat(height) * PT_PER_MM)).toBeLessThanOrEqual(1);
      if (EVIDENCE) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${EVIDENCE}/receipt-print-${paper}mm.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      }
    });
  }
});
