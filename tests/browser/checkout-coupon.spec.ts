import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Checkout coupons in a real browser, on the fixture backend (checkout-fixture.tsx scenarios):
 * no horizontal scroll at phone, iPad and desktop widths in light and dark, and the entry,
 * applied, problem, payment and receipt states laid out inside their panels.
 */

const WIDTHS = [390, 820, 1180, 1440];
const EVIDENCE = process.env.CHECKOUT_LAYOUT_EVIDENCE;

async function open(page: Page, width: number, scenario: string, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.goto(`/tests/browser/checkout.html?scenario=${scenario}${theme === "dark" ? "&theme=dark" : ""}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await page.waitForTimeout(300);
}

/** The order panel: the side panel on wide screens, the bottom sheet (opened) on narrow ones. */
async function orderPanel(page: Page, width: number): Promise<Locator> {
  if (width >= 1024) return page.getByRole("complementary", { name: "Order" });
  await page.getByRole("button", { name: /open the order/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

async function expectNoSideScroll(page: Page, width: number) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), "page scroll width").toBeLessThanOrEqual(width);
}

/** The element sits inside the viewport and inside its panel, and its content doesn't overflow it. */
async function expectInside(locator: Locator, panel: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const outer = (await panel.boundingBox())!;
  expect.soft(box.x, `${label} left`).toBeGreaterThanOrEqual(outer.x - 1);
  expect.soft(box.x + box.width, `${label} right`).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect.soft(await locator.evaluate((el) => el.scrollWidth - el.clientWidth), `${label} overflow`).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`coupon states fit at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "coupon-entry", theme);
      let panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: /^Add coupon/ }).click();
      const field = panel.getByRole("textbox", { name: "Coupon code or offer link" });
      await field.fill("https://elsewhere.example/q1");
      await field.press("Enter");
      await expect(panel.getByText("Only offer links from this site can be used.")).toBeVisible();
      await expectInside(panel.getByRole("form", { name: "Add coupon" }), panel, "coupon field");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-entry-${width}-${theme}`);

      // A scanner types the poster QR's link and Enter.
      await field.fill(`${new URL(page.url()).origin}/q1`);
      await field.press("Enter");
      const chip = panel.getByTestId("order-coupon");
      await expect(chip).toContainText("Saves ฿500");
      await expect(panel.getByTestId("order-coupon-total")).toContainText("Coupon DCNT-SPA-500");
      await expectInside(chip, panel, "applied coupon");
      await expectInside(panel.getByRole("listitem").filter({ hasText: "Thai massage 60" }).first(), panel, "row with a coupon share");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-applied-${width}-${theme}`);

      await open(page, width, "coupon-problem", theme);
      panel = await orderPanel(page, width);
      await expect(panel.getByTestId("order-coupon-problem")).toContainText("This coupon needs at least ฿1,500.");
      await expect(panel.getByRole("button", { name: "Card", exact: true })).toBeDisabled();
      await expectInside(panel.getByTestId("order-coupon-problem"), panel, "coupon problem");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-problem-${width}-${theme}`);

      await open(page, width, "coupon-soldout", theme);
      panel = await orderPanel(page, width);
      await panel.getByRole("button", { name: "Card", exact: true }).click();
      await panel.getByRole("button", { name: /^Confirm .* received$/ }).click();
      const refused = panel.getByTestId("pay-coupon-problem");
      await expect(refused).toContainText("Payment not recorded.");
      await expectInside(refused, panel, "refused at payment");
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-soldout-${width}-${theme}`);

      await open(page, width, "coupon-paid", theme);
      const receipt = page.locator("article.pos-receipt");
      await expect(receipt.getByTestId("receipt-coupon-total")).toHaveText(/Coupon DCNT-SPA-500.*-฿500/);
      await expectNoSideScroll(page, width);
      await shot(page, `coupon-receipt-${width}-${theme}`);
    });
  }
}

test("a stay priced with its own coupon says so and keeps its price", async ({ page }) => {
  await open(page, 1180, "coupon-stay", "light");
  const panel = await orderPanel(page, 1180);
  await expect(panel.getByText("on the booking")).toBeVisible();
  await expect(panel.getByTestId("order-coupon-total")).toContainText("-฿120");
  await shot(page, "coupon-stay-1180-light");
});

test("the receipt prints the coupon on 58 mm paper", async ({ page }) => {
  await open(page, 1180, "coupon-paid", "light");
  await page.getByRole("radio", { name: "58 mm" }).click();
  await page.emulateMedia({ media: "print" });
  const receipt = page.locator("article.pos-receipt");
  await expect(receipt.getByTestId("receipt-line-coupon")).toHaveCount(2);
  expect(await receipt.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await shot(page, "coupon-receipt-print-58");
});

test("on a short phone screen the coupon trigger sits in the order header, keeping the tenders in view", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tests/browser/checkout.html?scenario=coupon-entry");
  await page.locator("[data-fixture-ready]").waitFor();
  const panel = await orderPanel(page, 844);
  const card = panel.getByRole("button", { name: "Card", exact: true });
  expect((await card.boundingBox())!.y + (await card.boundingBox())!.height).toBeLessThanOrEqual(390.5);
  await panel.getByRole("button", { name: "Add coupon", exact: true }).click();
  const field = panel.getByRole("textbox", { name: "Coupon code or offer link" });
  await expect(field).toBeFocused();
  await field.fill("DCNT-SPA-500");
  await field.press("Enter");
  await expect(panel.getByTestId("order-coupon")).toContainText("Saves ฿500");
  await expectNoSideScroll(page, 844);
  await shot(page, "coupon-short-844x390");
});

test("cancelling the coupon field returns focus to the Add coupon that is showing", async ({ page }) => {
  // The full-size row on a normal screen.
  await open(page, 1280, "coupon-entry", "light");
  let panel = await orderPanel(page, 1280);
  await panel.getByRole("button", { name: /^Add coupon/ }).click();
  await panel.getByRole("button", { name: "Cancel coupon" }).click();
  await expect(panel.getByRole("button", { name: /^Add coupon/ })).toBeFocused();
  // The compact trigger in the order header on a short screen.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tests/browser/checkout.html?scenario=coupon-entry");
  await page.locator("[data-fixture-ready]").waitFor();
  panel = await orderPanel(page, 844);
  await panel.getByRole("button", { name: "Add coupon", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel coupon" }).click();
  await expect(panel.getByRole("button", { name: "Add coupon", exact: true })).toBeFocused();
});

/*
 * The camera scanner, with qr-scanner swapped for tests/browser/qr-scanner-mock.ts (it decodes
 * what a spec hands it) and getUserMedia faked: a blank canvas stream, a refusal, or no camera.
 */
type CameraWindow = Window & { __cameraTracks?: MediaStreamTrack[]; __cameraConstraints?: MediaStreamConstraints };

async function fakeCamera(page: Page, camera: "granted" | "denied" | "missing") {
  await page.addInitScript((camera) => {
    const win = window as CameraWindow;
    win.__cameraTracks = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      win.__cameraConstraints = constraints;
      if (camera === "denied") throw new DOMException("Permission denied", "NotAllowedError");
      if (camera === "missing") throw new DOMException("Requested device not found", "NotFoundError");
      const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 480 });
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#334";
      context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(5);
      win.__cameraTracks!.push(...stream.getTracks());
      return stream;
    };
  }, camera);
}

/** Whether the scanner's code (the dialog or qr-scanner) has been fetched yet. */
const scannerLoaded = (page: Page) =>
  page.evaluate(() => performance.getEntriesByType("resource").some((entry) => /CouponScanDialog|qr-scanner/.test(entry.name)));

async function expectInViewport(page: Page, locator: Locator, label: string) {
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect.soft(box.x, `${label} left`).toBeGreaterThanOrEqual(-1);
  expect.soft(box.y, `${label} top`).toBeGreaterThanOrEqual(-1);
  expect.soft(box.x + box.width, `${label} right`).toBeLessThanOrEqual(viewport.width + 1);
  expect.soft(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

test("the camera reads a poster QR's link, applies it like a pasted link, and turns off", async ({ page }) => {
  await fakeCamera(page, "granted");
  await open(page, 820, "coupon-entry", "light");
  const panel = await orderPanel(page, 820);
  await panel.getByRole("button", { name: /^Add coupon/ }).click();
  const scan = panel.getByRole("button", { name: "Scan a coupon QR code" });
  await expect(scan).toHaveText("Scan");
  await expectInside(panel.getByRole("form", { name: "Add coupon" }), panel, "coupon field with Scan");
  expect(await scannerLoaded(page), "scanner loaded before Scan").toBe(false);

  await scan.click();
  const dialog = page.getByRole("dialog", { name: "Scan a coupon QR code" });
  await expect(dialog.getByText("Looking for a QR code…")).toBeVisible();
  expect(await scannerLoaded(page), "scanner loaded after Scan").toBe(true);
  expect(await page.evaluate(() => (window as CameraWindow).__cameraConstraints)).toEqual({ audio: false, video: { facingMode: { ideal: "environment" } } });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectInViewport(page, dialog, "scanner dialog");
  expect((await new AxeBuilder({ page }).include('[data-testid="coupon-scan-dialog"]').analyze()).violations).toEqual([]);
  await shot(page, "coupon-scan-820");

  await page.evaluate((link) => window.__decodeQr!(link), `${new URL(page.url()).origin}/q1`);
  await expect(dialog).toBeHidden();
  await expect(panel.getByTestId("order-coupon")).toContainText("Saves ฿500");
  expect(await page.evaluate(() => (window as CameraWindow).__cameraTracks!.map((track) => track.readyState))).toEqual(["ended"]);
});

test("a blocked camera is explained, and Escape closes the scanner back to Scan", async ({ page }) => {
  await fakeCamera(page, "denied");
  await open(page, 1180, "coupon-entry", "light");
  const panel = await orderPanel(page, 1180);
  await panel.getByRole("button", { name: /^Add coupon/ }).click();
  const scan = panel.getByRole("button", { name: "Scan a coupon QR code" });
  await scan.click();
  const dialog = page.getByRole("dialog", { name: "Scan a coupon QR code" });
  await expect(dialog.getByRole("alert")).toHaveText(/^Camera access is blocked\./);
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid="coupon-scan-dialog"]').analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(scan).toBeFocused();
  await expect(panel.getByRole("textbox", { name: "Coupon code or offer link" })).toBeVisible();
});

test("in Thai on a phone, a missing camera is explained and Cancel closes the scanner", async ({ page }) => {
  await fakeCamera(page, "missing");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/checkout.html?scenario=coupon-entry&locale=th&theme=dark");
  await page.locator("[data-fixture-ready]").waitFor();
  const panel = await orderPanel(page, 390);
  await panel.getByRole("button", { name: /^Add coupon/ }).click();
  await expectInside(panel.getByRole("form", { name: "Add coupon" }), panel, "coupon field with Scan");
  await panel.getByRole("button", { name: "สแกน QR โค้ดคูปอง" }).click();
  const dialog = page.getByRole("dialog", { name: "สแกน QR โค้ดคูปอง" });
  await expect(dialog.getByRole("alert")).toHaveText("ไม่พบกล้องในอุปกรณ์นี้ โปรดพิมพ์โค้ด หรือใช้เครื่องสแกนบาร์โค้ด");
  await expect(dialog.getByRole("button", { name: "ลองอีกครั้ง" })).toHaveCount(0);
  await expectInViewport(page, dialog, "scanner dialog");
  await expectNoSideScroll(page, 390);
  await shot(page, "coupon-scan-missing-390-th");
  await dialog.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(dialog).toBeHidden();
});
