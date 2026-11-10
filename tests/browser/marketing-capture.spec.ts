import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Release 3a capture UI in a real browser (marketing-fixture.tsx): the measurement banner on a guest page
 * and the Source row of the admin booking sheet, at phone, iPad and desktop widths in light and dark.
 * Set MARKETING_EVIDENCE to a folder to keep screenshots.
 */

const WIDTHS = [390, 820, 1180, 1440];
const EVIDENCE = process.env.MARKETING_EVIDENCE;

async function open(page: Page, width: number, query: string, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.goto(`/tests/browser/marketing.html?${query}${theme === "dark" ? "&theme=dark" : ""}`);
}

async function expectFits(page: Page, locator: Locator, width: number, label: string) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), "page scroll width").toBeLessThanOrEqual(width);
  const box = (await locator.boundingBox())!;
  expect.soft(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect.soft(box.x + box.width, `${label} right`).toBeLessThanOrEqual(width);
  expect.soft(await locator.evaluate((el) => el.scrollWidth - el.clientWidth), `${label} overflow`).toBeLessThanOrEqual(1);
}

async function expectReadable(page: Page, selector: string) {
  const { violations } = await new AxeBuilder({ page }).include(selector).withRules(["color-contrast"]).analyze();
  expect.soft(violations.flatMap((violation) => violation.nodes.map((node) => node.failureSummary)), "contrast").toEqual([]);
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`measurement banner fits at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "mode=consent", theme);
      const banner = page.getByRole("dialog", { name: "Measurement choice" });
      await expect(banner).toContainText("remember your visits for 30 days");
      await expectFits(page, banner, width, "banner");
      const box = (await banner.boundingBox())!;
      expect.soft(box.x, "side gutter").toBeGreaterThanOrEqual(16);
      expect.soft(box.y + box.height, "bottom gutter").toBeLessThanOrEqual((width < 1024 ? 844 : 900) - 16);
      await expectReadable(page, '[role="dialog"]');
      await shot(page, `consent-${width}-${theme}`);

      await banner.getByRole("button", { name: "Allow" }).click();
      await expect(banner).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem("analytics-consent-v2"))).toBe("yes");
    });

    test(`booking source row fits at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "mode=source&marketing=1", theme);
      const row = page.getByTestId("booking-marketing-source");
      await expect(row).toContainText("/f1 · facebook / paid_social");
      await expect(row).toContainText("Tracked visit");
      await expect(row).toContainText("First seen via /q1");
      await row.scrollIntoViewIfNeeded();
      await expectFits(page, row, width, "source row");
      const sheet = page.getByRole("dialog");
      const outer = (await sheet.boundingBox())!;
      const box = (await row.boundingBox())!;
      expect.soft(box.x + box.width, "row inside the sheet").toBeLessThanOrEqual(outer.x + outer.width + 1);
      await expectReadable(page, '[data-testid="booking-marketing-source"]');
      await shot(page, `source-${width}-${theme}`);
    });
  }
}

test("Thai banner wraps on a phone", async ({ page }) => {
  await open(page, 390, "mode=consent&locale=th", "light");
  const banner = page.getByRole("dialog", { name: "ตัวเลือกการวัดผล" });
  await expect(banner.getByRole("button", { name: "อนุญาต" })).toBeVisible();
  await expectFits(page, banner, 390, "banner");
  await shot(page, "consent-390-light-th");
});

test("the choice follows across open tabs without a reload", async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const tab of [a, b]) {
    await tab.goto("/tests/browser/marketing.html?mode=choice");
    // Survives only if the page is never reloaded.
    await tab.evaluate(() => ((window as unknown as { kept?: boolean }).kept = true));
  }
  const banner = (tab: Page) => tab.getByRole("dialog", { name: "Measurement choice" });
  await banner(a).getByRole("button", { name: "Allow" }).click();
  await expect(banner(b)).toBeHidden();
  await expect(b.getByText("Measurement is on in this browser.")).toBeVisible();

  await b.getByRole("button", { name: "Turn off measurement" }).click();
  await expect(b.getByText("Measurement is off in this browser.")).toBeVisible();
  await expect(a.getByText("Measurement is off in this browser.")).toBeVisible();
  expect(await a.evaluate(() => localStorage.getItem("marketing-visitor"))).toBeNull();

  await a.getByRole("button", { name: "Turn on measurement" }).click();
  await expect(b.getByText("Measurement is on in this browser.")).toBeVisible();
  // Clearing the site's storage in one tab withdraws the choice in the other, which asks again.
  await a.evaluate(() => localStorage.clear());
  await expect(banner(b)).toBeVisible();
  await expect(b.getByText("Measurement is off in this browser.")).toBeVisible();
  for (const tab of [a, b]) expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
});
