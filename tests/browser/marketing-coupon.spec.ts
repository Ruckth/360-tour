import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { census } from "./helpers/screen-census";
import { expectAtMostSentences } from "./helpers/sentence-budget";

/*
 * P8 · Marketing: the coupon page (marketing-coupon-fixture.tsx) in a real browser.
 *   - New coupon: at most 130 words and 14 controls on the page at the start (was 332 / 28).
 *   - Create → Save & publish → QR card → Print on the coupon page: 8 taps and 2 typed fields,
 *     one confirm, no other page (was about 18 taps and 2 page switches through Links & QR).
 *   - At most one explanatory sentence in the coupon editor.
 * Coupon conventions (docs/guides/admin-ux.md): one Discount field like checkout's ("20% or 500")
 * instead of the Percent / Fixed ฿ toggle (13 → 11 controls at the start); Print in the QR card's
 * footer, on screen on a phone (was 1 scroll); "is live" is a status line without Dismiss.
 * Set UX_P8_SHOTS to a folder to keep screenshots.
 */

const SIZES = { ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } as const;
const SHOTS = process.env.UX_P8_SHOTS;

async function open(page: Page, size: { width: number; height: number }, query = "") {
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Printing is the browser's dialog; record what would be printed instead.
  await page.addInitScript(() => {
    window.print = () => {
      const sheet = document.querySelector(".qr-print-sheet");
      document.body.dataset.printed = sheet?.querySelector("svg") ? (sheet.getAttribute("data-qr-print") ?? "") : "nothing";
    };
  });
  await page.goto(`/tests/browser/marketing-coupon.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
  await expect(page.getByRole("heading", { name: "New coupon" })).toBeVisible();
}

const editor = (page: Page) => page.locator("[data-coupon-editor]");
const calls = async (page: Page) => JSON.parse((await page.locator("body").getAttribute("data-calls")) ?? "[]").map((call: { name: string }) => call.name);
/** The visible copy of a control that the header and the phone footer both carry. */
const visible = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).locator("visible=true");

for (const [name, size] of Object.entries(SIZES)) {
  test(`new coupon starts with at most 130 words, 14 controls and 1 sentence (${name})`, async ({ page }) => {
    await open(page, size);
    const counts = await census(page);
    expect(counts.controlsOnPage, "controls on the page").toBeLessThanOrEqual(14);
    await expect(page.getByRole("radio", { name: "Percent" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("textbox", { name: "Discount", exact: true })).toHaveAttribute("placeholder", "e.g. 20");
    const discountBox = (await page.getByRole("textbox", { name: "Discount", exact: true }).boundingBox())!;
    const unitBox = (await page.getByRole("radiogroup", { name: "Discount unit", exact: true }).boundingBox())!;
    expect(unitBox.y).toBe(discountBox.y);
    expect(unitBox.height).toBe(discountBox.height);
    expect(counts.wordsOnPage, "words on the page").toBeLessThanOrEqual(130);
    await expectAtMostSentences(editor(page), 1);
    // Dates, minimums and terms are folded away; a quote can't run before the first save.
    await expect(page.locator("summary", { hasText: "More · campaign, dates, limits, terms" })).toBeVisible();
    await expect(page.getByLabel("Total uses")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Test a quote" })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    if (SHOTS && name !== "ipad") await page.screenshot({ path: `${SHOTS}/after-new-coupon-${name}.png`, fullPage: true });
  });

  test(`create, publish and print the QR card on the coupon page in 8 taps (${name})`, async ({ page }) => {
    await open(page, size);
    const url = page.url();
    let taps = 0;
    let fields = 0;
    let confirms = 0;
    const tap = async (target: ReturnType<Page["locator"]>) => {
      await target.click();
      taps += 1;
    };
    const fill = async (target: ReturnType<Page["locator"]>, text: string) => {
      await target.fill(text);
      fields += 1;
    };

    await fill(page.getByRole("textbox", { name: "Code", exact: true }), "SPA20");
    await fill(page.getByRole("textbox", { name: "Discount", exact: true }), "20%");
    await tap(page.getByRole("radio", { name: /^Spa$/ }));
    await tap(visible(page, "Save & publish"));
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Publish SPA20?");
    confirms += 1;
    await tap(confirm.getByRole("button", { name: "Save & publish" }));

    await expect(page.getByRole("status").filter({ hasText: "SPA20 is live" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "SPA20" })).toBeVisible();
    // Test a quote appears once the rules are saved.
    await expect(page.getByRole("heading", { name: "Test a quote" })).toBeVisible();
    if (SHOTS && name !== "ipad") await page.screenshot({ path: `${SHOTS}/after-coupon-published-${name}.png` });

    await tap(visible(page, "QR card"));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("QR card for SPA20");
    await tap(dialog.getByRole("combobox", { name: "Campaign" }));
    await tap(page.getByRole("option", { name: "Songkran spa week" }));
    await expect(dialog.getByRole("textbox", { name: "Short link" })).toHaveValue("spa20");
    await tap(dialog.getByRole("button", { name: "Publish the card" }));
    await expect(dialog.getByRole("heading", { name: "QR offer card" })).toBeVisible();
    if (SHOTS && name !== "ipad") await page.screenshot({ path: `${SHOTS}/after-qr-card-${name}.png` });
    // Print sits in the dialog's footer: on screen without scrolling, phone included.
    await expect(dialog.getByRole("button", { name: "Print" })).toBeInViewport({ ratio: 1 });
    await tap(dialog.getByRole("button", { name: "Print" }));
    await expect(page.locator("body")).toHaveAttribute("data-printed", "square");

    expect({ taps, fields, confirms }).toEqual({ taps: 8, fields: 2, confirms: 1 });
    expect(page.url(), "never left the coupon page").toBe(url);
    // Publish only after each save succeeded.
    expect(await calls(page)).toEqual(["saveCoupon", "setCouponStatus", "saveLink", "setLinkStatus"]);
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " " + n.failureSummary).join(" | ")}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await expectAtMostSentences(editor(page), 1);
  });
}

test("a failed publish keeps the saved draft and says so once", async ({ page }) => {
  await open(page, SIZES.ipad, "?fail=publish");
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await visible(page, "Save & publish").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Saved SPA20 as a draft, but it isn’t live\. The server didn’t answer\./);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "SPA20" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(["saveCoupon", "setCouponStatus"]);
});

test("a failed save publishes nothing", async ({ page }) => {
  await open(page, SIZES.ipad, "?fail=save");
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await visible(page, "Save & publish").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByRole("alert")).toContainText("The server didn’t answer.");
  await expect(page.getByRole("heading", { name: "New coupon" })).toBeVisible();
  expect(await calls(page)).toEqual(["saveCoupon"]);
});

test("Save as draft skips the confirm and doesn't publish", async ({ page }) => {
  await open(page, SIZES.ipad);
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await visible(page, "Save as draft").click();
  await expect(page.getByRole("status").filter({ hasText: "Saved SPA20 as a draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "QR card" })).toHaveCount(0);
  expect(await calls(page)).toEqual(["saveCoupon"]);
});

test("an error under More opens it and focuses the field", async ({ page }) => {
  await open(page, SIZES.ipad);
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await page.locator("summary", { hasText: "More · campaign" }).click();
  await page.getByLabel("Total uses").fill("0");
  await page.locator("summary", { hasText: "More · campaign" }).click();
  await expect(page.getByLabel("Total uses")).toBeHidden();
  await visible(page, "Save & publish").click();
  await expect(page.getByLabel("Total uses")).toBeFocused();
  await expect(page.getByText("Leave empty for no limit")).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

test("a failed link publish opens the card on its draft, with Publish", async ({ page }) => {
  await open(page, SIZES.ipad, "?fail=link-publish");
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await visible(page, "Save & publish").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }).click();
  await visible(page, "QR card").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Campaign" }).click();
  await page.getByRole("option", { name: "Songkran spa week" }).click();
  await dialog.getByRole("button", { name: "Publish the card" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("Saved /spa20 as a draft, but it isn’t live.");
  await expect(dialog.getByText("This link is a draft")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Print" })).toBeDisabled();
});

test("with no campaigns, + New campaign makes one inside the QR card step", async ({ page }) => {
  await open(page, SIZES.ipad, "?campaigns=0");
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20%");
  await visible(page, "Save & publish").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }).click();
  await visible(page, "QR card").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Publish the card" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose a campaign");
  await dialog.getByRole("combobox", { name: "Campaign" }).click();
  await page.getByRole("option", { name: "+ New campaign" }).click();
  await expect(dialog.getByRole("textbox", { name: /New campaign name/ })).toHaveValue("SPA20 print");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Campaign" })).toContainText("SPA20 print");
  await dialog.getByRole("button", { name: "Publish the card" }).click();
  await expect(dialog.getByRole("button", { name: "Print" })).toBeEnabled();
  const all = JSON.parse((await page.locator("body").getAttribute("data-calls"))!);
  expect(all.find((call: { name: string }) => call.name === "saveCampaign").args).toEqual({ name: "SPA20 print", source: "print", medium: "qr" });
});

test("the discount reads like checkout's: 20% is a percent with its nightly saving, 500 is baht", async ({ page }) => {
  await open(page, SIZES.ipad);
  const discount = page.getByRole("textbox", { name: "Discount", exact: true });
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("STAY20");
  await discount.fill("20%");
  // Accommodation, all villas: ฿4,200 and ฿8,500 a night.
  await expect(page.getByText("20% = ฿840–฿1,700 a night")).toBeVisible();
  await expect(page.getByText("20% off", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Choose villas" }).click();
  await page.getByRole("checkbox", { name: /Garden Villa/ }).check();
  await expect(page.getByText("20% = ฿840 a night")).toBeVisible();
  await discount.fill("150%");
  await page.getByRole("textbox", { name: "Code", exact: true }).click();
  await page.getByRole("radio", { name: "Baht" }).click();
  await discount.fill("500");
  await expect(page.getByText("฿500 off", { exact: true })).toBeVisible();
  await expect(page.getByText(/a night$/)).toHaveCount(0);
  await visible(page, "Save as draft").click();
  await expect(page.getByRole("status").filter({ hasText: "Saved STAY20 as a draft" })).toBeVisible();
  const saved = JSON.parse((await page.locator("body").getAttribute("data-calls"))!).find((call: { name: string }) => call.name === "saveCoupon").args;
  expect(saved.benefit).toEqual({ kind: "fixed", amount: 50000 });
  await expect(discount).toHaveValue("500");
});

test("a discount over 100% or with decimals says so on save", async ({ page }) => {
  await open(page, SIZES.ipad);
  await page.getByRole("textbox", { name: "Code", exact: true }).fill("BIG");
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("150%");
  await visible(page, "Save & publish").click();
  await expect(page.getByText("A percentage can’t be over 100")).toBeVisible();
  await page.getByRole("textbox", { name: "Discount", exact: true }).fill("12.5%");
  await expect(page.getByText("Use a whole number")).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

test("unsaved coupons guard every in-app link and retain the draft", async ({ page }) => {
  await open(page, SIZES.ipad);
  const code = page.getByRole("textbox", { name: "Code", exact: true });
  await code.fill("UNSAVED20");
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/admin/marketing/dashboard";
    link.textContent = "Dashboard navigation";
    link.onclick = (event) => { event.preventDefault(); document.body.dataset.left = "yes"; };
    document.body.prepend(link);
  });
  await page.getByRole("link", { name: "Dashboard navigation" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(code).toHaveValue("UNSAVED20");
  await expect(page.locator("body")).not.toHaveAttribute("data-left");
  await page.getByRole("link", { name: "Dashboard navigation" }).click();
  await dialog.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-left", "yes");
});

test("a valid discount reveals a summary below the stable single-column form", async ({ page }) => {
  await open(page, SIZES.desktop);
  const form = editor(page).locator("form");
  const before = (await form.boundingBox())!;
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary).toHaveCount(0);
  const discount = page.getByRole("textbox", { name: "Discount", exact: true });
  await discount.fill("20");
  await expect(summary).toBeVisible();
  const after = (await form.boundingBox())!;
  expect(after.x).toBe(before.x);
  expect(after.width).toBe(before.width);
  expect((await summary.boundingBox())!.y).toBeGreaterThanOrEqual(after.y + after.height);
  await discount.fill("101");
  await expect(summary).toHaveCount(0);
  await page.setViewportSize(SIZES.phone);
  await discount.fill("20");
  await expect(page.locator('[data-admin-bottom-bar="sm"]')).toContainText("20% off · Stays");
});
