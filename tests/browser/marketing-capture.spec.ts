import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };

/*
 * Release 3a capture UI in a real browser (marketing-fixture.tsx): the inline home measurement choice
 * and the Source row of the admin booking sheet, at phone, iPad and desktop widths in light and dark.
 * Set MARKETING_EVIDENCE to a folder to keep screenshots.
 */

const WIDTHS = [390, 820, 1180, 1440];
const EVIDENCE = process.env.MARKETING_EVIDENCE;
const consent = (page: Page, label = en.Consent.label) => page.getByRole("region", { name: label, exact: true });

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

async function expectInFlowConsent(page: Page, region: Locator, width: number) {
  await expect(region).toHaveCSS("position", "static");
  await expect(region).toBeInViewport({ ratio: 1 });
  await expectFits(page, region, width, "measurement choice");
  const booking = page.getByTestId("home-quick-booking-form");
  await expect(booking).toBeInViewport({ ratio: 1 });
  const [formBox, regionBox] = await Promise.all([booking.boundingBox(), region.boundingBox()]);
  expect(regionBox!.x, "side gutter").toBeGreaterThanOrEqual(16);
  expect(regionBox!.y, "choice stays below the booking controls").toBeGreaterThanOrEqual(formBox!.y + formBox!.height);
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`measurement choice fits below booking at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "mode=consent", theme);
      const region = consent(page);
      await expect(region).toContainText("remember your visits for 30 days");
      await expectInFlowConsent(page, region, width);
      await expectReadable(page, '[role="region"][aria-label="Measurement choice"]');
      await shot(page, `consent-${width}-${theme}`);

      const book = page.getByRole("button", { name: en.Nav.book, exact: true });
      await expect(book).toBeEnabled();
      await region.getByRole("button", { name: en.Consent.accept, exact: true }).press("Enter");
      await expect(region).toBeHidden();
      await expect(book).toBeFocused();
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

test("Thai consent wraps on a narrow phone and decline keeps booking ready", async ({ page }) => {
  await open(page, 360, "mode=consent&locale=th&path=/th", "light");
  const region = consent(page, th.Consent.label);
  await expect(region.getByRole("button", { name: th.Consent.accept, exact: true })).toBeVisible();
  await expect(region.getByRole("link", { name: th.Consent.details, exact: true })).toHaveAttribute("href", "/th/privacy");
  await expectInFlowConsent(page, region, 360);
  await shot(page, "consent-360-light-th");
  const book = page.getByRole("button", { name: th.Nav.book, exact: true });
  await expect(book).toBeEnabled();
  await region.getByRole("button", { name: th.Consent.decline, exact: true }).click();
  await expect(region).toBeHidden();
  await expect(book).toBeFocused();
  await page.reload();
  await expect(book).toBeEnabled();
  await expect(region).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("analytics-consent-v2"))).toBe("no");
});

test("the choice follows across open tabs without a reload", async ({ context }) => {
  const [a, b] = [await context.newPage(), await context.newPage()];
  for (const tab of [a, b]) {
    await tab.goto("/tests/browser/marketing.html?mode=choice");
    // Survives only if the page is never reloaded.
    await tab.evaluate(() => ((window as unknown as { kept?: boolean }).kept = true));
  }
  await expect(consent(b)).toBeVisible();
  await consent(a).getByRole("button", { name: en.Consent.accept, exact: true }).click();
  await expect(consent(a)).toBeHidden();
  await expect(consent(b)).toBeHidden();
  await expect(b.getByText("Measurement is on in this browser.")).toBeVisible();

  await b.getByRole("button", { name: "Turn off measurement" }).click();
  await expect(b.getByText("Measurement is off in this browser.")).toBeVisible();
  await expect(a.getByText("Measurement is off in this browser.")).toBeVisible();
  await expect(consent(a)).toBeHidden();
  await expect(consent(b)).toBeHidden();
  expect(await a.evaluate(() => localStorage.getItem("analytics-consent-v2"))).toBe("no");
  expect(await a.evaluate(() => localStorage.getItem("marketing-visitor"))).toBeNull();

  await a.getByRole("button", { name: "Turn on measurement" }).click();
  await expect(b.getByText("Measurement is on in this browser.")).toBeVisible();
  // Clearing the site's storage in one tab withdraws the choice in the other, which asks again.
  await a.evaluate(() => localStorage.clear());
  await expect(consent(b)).toBeVisible();
  await expect(b.getByText("Measurement is off in this browser.")).toBeVisible();
  for (const tab of [a, b]) expect(await tab.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
});
