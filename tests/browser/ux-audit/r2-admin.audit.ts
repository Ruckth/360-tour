import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Recorder, ROOT, VIEWPORTS, census, type ViewportName } from "./measure";
import { COUPON, STAFF, open, sentences } from "./final-shared";

/*
 * Round 2 · admin screens (Settings › Team, Missing information, Marketing). Same counters as
 * final-audit.md (measure.ts, helpers/sentence-count.ts). Written to run on the UI before and after
 * the round, so the locators accept both labels ("Save rules" or "Save", with or without Change).
 *   R2_PHASE=before|after BOOKING_UI_PORT=4364 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts r2-admin
 * Results: docs/reviews/ux-audit/results-r2-admin/<phase>/. Screens of the after run: docs/screenshots/ux-r2-admin/.
 */

const PHASE = process.env.R2_PHASE === "before" ? "before" : "after";
const OUT = {
  results: path.join(ROOT, "docs/reviews/ux-audit/results-r2-admin", PHASE),
  screens: PHASE === "after" ? path.join(ROOT, "docs/screenshots/ux-r2-admin") : path.join(ROOT, "docs/reviews/ux-audit/results-r2-admin/before/screens"),
};
for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });
const QUESTIONS = "/tests/browser/questions.html?path=/admin/questions";
const DASHBOARD = "/tests/browser/marketing-dashboard.html?case=normal";
const AFFILIATES = "/tests/browser/marketing-affiliates.html";

const recorder = (page: Page, task: string, vp: ViewportName) => new Recorder(page, task, vp, OUT, sentences);
const results: Record<string, unknown> = {};
const save = () => writeFileSync(path.join(OUT.results, "screens.json"), JSON.stringify(results, null, 2));
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT.screens, `${name}.png`) });

/** Whether `target` sits inside the viewport now (no scroll needed to reach it). */
const inView = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  });

/** Visible controls above `marker` (top edge), in the page: what a person passes before the first number. */
const controlsAbove = (page: Page, marker: Locator) =>
  marker.evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=combobox], [role=switch]";
    return Array.from(document.querySelectorAll(selector)).filter((node) => {
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || !node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if (node.parentElement?.closest(selector)) return false;
      return r.top + window.scrollY < top;
    }).map((node) => (node.getAttribute("aria-label") ?? (node as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40));
  });

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  test.describe(vp, () => {
    test.use({ viewport: VIEWPORTS[vp] });

    test("screen: Settings › Team", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const people = page.getByRole("region", { name: "People" });
      const limit = page.getByRole("textbox", { name: "Discount without approval" });
      results[`${vp} · Team`] = {
        page: await census(page),
        sentences: (await sentences(page)).length,
        selectsInPeople: await people.getByRole("combobox").count(),
        peopleControls: await people.evaluate((el) => el.querySelectorAll("button, select, a[href], input:not([type=hidden])").length),
        discountLimitInView: await inView(limit),
        emailsShownAsPeople: await people.getByTestId("team-person").evaluateAll((rows) => rows.filter((row) => /^[^\s@]+@/.test((row.querySelector("p")?.textContent ?? "").trim())).length),
      };
      save();
      await shot(page, `team-${vp}`);
    });

    test("screen: Settings › Business (deleted villa history, Save label)", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=business`);
      const region = page.getByRole("region", { name: "Business profile" });
      results[`${vp} · Business`] = {
        page: await census(page),
        deletedVillaHistory: await page.getByText("Deleted villa history", { exact: true }).count(),
        saveLabel: (await region.locator("button[type=submit]").innerText()).trim(),
      };
      save();
      await shot(page, `settings-business-${vp}`);
    });

    test("screen: Missing information", async ({ page }) => {
      await open(page, QUESTIONS);
      const card = page.locator("tbody tr").first();
      results[`${vp} · Missing information`] = {
        page: await census(page),
        sentences: (await sentences(page)).length,
        firstCard: await card.evaluate((el) => ({
          controls: el.querySelectorAll("button, select, a[href], input:not([type=hidden]), [role=combobox]").length,
          text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
          words: ((el as HTMLElement).innerText.match(/[\p{L}\p{N}฿%][\p{L}\p{N}฿%.,:'’/-]*/gu) ?? []).length,
        })),
        newBadges: await page.locator("tbody").getByText("New", { exact: true }).count(),
        rawPaths: await page.locator("tbody").getByText("/villas/", { exact: false }).count(),
        contextLabels: await page.locator('tbody [data-label="Context"]').count(),
      };
      save();
      await shot(page, `missing-information-${vp}`);
    });

    test("task: resolve a report with an existing fact", async ({ page }) => {
      await open(page, QUESTIONS);
      const rec = recorder(page, "resolve-with-fact", vp);
      await rec.begin();
      await rec.tap(page.getByRole("combobox", { name: 'Resolve "Is breakfast included?" with a fact or source' }), "Resolve (open)");
      await rec.tap(page.getByRole("option", { name: "Breakfast is included" }), "Breakfast is included", { decision: true });
      await expect(page.getByTestId("undo-toast")).toBeVisible();
      rec.save();
    });

    test("task: create a fact from a report (to the open form)", async ({ page }) => {
      await open(page, QUESTIONS);
      const rec = recorder(page, "create-fact-from-report", vp);
      await rec.begin();
      const row = page.locator("tbody tr").filter({ hasText: "Do you have a baby cot?" });
      const direct = row.getByRole("button", { name: "Create fact" });
      if (await direct.count()) await rec.tap(direct, "Create fact");
      else {
        await rec.tap(row.getByRole("combobox"), "Resolve (open)");
        await rec.tap(page.getByRole("option", { name: /^Create fact/ }), "Create fact…", { decision: true });
      }
      await expect(page.getByRole("dialog")).toBeVisible();
      rec.save();
    });

    test("task: ignore a report", async ({ page }) => {
      await open(page, QUESTIONS);
      const rec = recorder(page, "ignore-report", vp);
      await rec.begin();
      const row = page.locator("tbody tr").filter({ hasText: "Can I bring my dog?" });
      const direct = row.getByRole("button", { name: "Ignore", exact: true });
      if (await direct.count()) await rec.tap(direct, "Ignore");
      else {
        await rec.tap(row.getByRole("button", { name: /^More for/ }), "⋯");
        await rec.tap(page.getByRole("menuitem", { name: "Ignore" }), "Ignore", { decision: true });
      }
      await expect(page.getByTestId("undo-toast")).toContainText("Ignored");
      rec.save();
    });

    test("task: invite a cashier and set the discount limit", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = recorder(page, "i-invite-cashier-and-limit", vp);
      await rec.begin();
      const people = page.getByRole("region", { name: "People" });
      await rec.tap(people.getByRole("button", { name: "Invite" }), "Invite");
      await rec.type(people.getByRole("textbox", { name: "Email" }), "fon@auraliscove.co", "Email");
      await rec.tap(people.getByRole("button", { name: "Send invite" }), "Send invite");
      await expect(people.getByRole("status")).toContainText(/Invited (fon@auraliscove\.co|Fon)/);
      const rules = page.getByRole("form", { name: "Rules for all cashiers" });
      await rec.type(rules.getByRole("textbox", { name: "Discount without approval" }), "15", "Discount without approval");
      await rec.tap(rules.getByRole("button", { name: /^Save( rules)?$/ }), "Save");
      await expect(rules.getByRole("status")).toContainText("Saved");
      rec.save();
    });

    test("task: discount limit from a fresh Team tab", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = recorder(page, "discount-limit-only", vp);
      await rec.begin();
      const rules = page.getByRole("form", { name: "Rules for all cashiers" });
      await rec.type(rules.getByRole("textbox", { name: "Discount without approval" }), "15", "Discount without approval");
      await rec.tap(rules.getByRole("button", { name: /^Save( rules)?$/ }), "Save");
      await expect(rules.getByRole("status")).toContainText("Saved");
      rec.save();
    });

    test("task: give a person Marketing access", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = recorder(page, "i2-grant-marketing", vp);
      await rec.begin();
      const people = page.getByRole("region", { name: "People" });
      const change = people.getByRole("button", { name: /^Change roles for (Mint|mint@auraliscove\.co)$/ });
      if (await change.count()) await rec.tap(change, "Change");
      await rec.pick(people.getByRole("combobox", { name: /^Marketing role for (Mint|mint@auraliscove\.co)$/ }), "marketer", "Marketing role");
      await expect(people.getByRole("status")).toContainText("to Marketing as Marketer");
      rec.save();
    });

    test("screen + task: coupon → QR card → Print", async ({ page }) => {
      await page.addInitScript(() => { window.print = () => { document.body.dataset.printed = "1"; }; });
      await page.goto(COUPON);
      await page.locator("[data-fixture-ready]").waitFor();
      await page.waitForTimeout(300);
      results[`${vp} · New coupon`] = { page: await census(page), sentences: (await sentences(page)).length, typeToggle: await page.getByRole("radio", { name: "Percent" }).count() };
      await shot(page, `coupon-new-${vp}`);
      const rec = recorder(page, "j-create-coupon", vp);
      await rec.begin();
      await rec.type(page.getByRole("textbox", { name: "Code", exact: true }), "SPA20", "Code");
      const toggle = await page.getByRole("radio", { name: "Percent" }).count();
      await rec.type(page.getByRole("textbox", { name: "Discount", exact: true }), toggle ? "20" : "20%", "Discount");
      await rec.tap(page.getByRole("radio", { name: /^Spa services/ }), "Covers: Spa services", { decision: true });
      await rec.tap(page.getByRole("button", { name: "Save & publish", exact: true }).locator("visible=true"), "Save & publish");
      await rec.tap(page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }), "Confirm");
      const live = page.getByRole("status").filter({ hasText: "SPA20 is live" });
      await expect(live).toBeVisible();
      await page.waitForTimeout(300);
      results[`${vp} · Coupon published`] = {
        page: await census(page),
        sentences: (await sentences(page)).length,
        liveBannerDismiss: await page.getByRole("button", { name: "Dismiss" }).count(),
      };
      await shot(page, `coupon-published-${vp}`);
      await rec.tap(page.getByRole("button", { name: "QR card", exact: true }).locator("visible=true"), "QR card");
      const dialog = page.getByRole("dialog");
      await rec.tap(dialog.getByRole("combobox", { name: "Campaign" }), "Campaign (open)");
      await rec.tap(page.getByRole("option", { name: "Songkran spa week" }), "Songkran spa week", { decision: true });
      await rec.tap(dialog.getByRole("button", { name: "Publish the card" }), "Publish the card");
      const print = dialog.getByRole("button", { name: "Print" });
      await print.waitFor();
      await page.waitForTimeout(300);
      results[`${vp} · QR card`] = { printInView: await inView(print), dialog: await census(page, '[role="dialog"]') };
      await shot(page, `qr-card-${vp}`);
      await rec.tap(print, "Print");
      await expect(page.locator("body")).toHaveAttribute("data-printed", "1");
      // Long enough for an auto-hiding status line to go.
      await page.waitForTimeout(4500);
      (results[`${vp} · Coupon published`] as Record<string, unknown>).liveStatusAfter5s = await live.count();
      save();
      rec.save();
    });

    test("screen: Marketing dashboard", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(DASHBOARD);
      await expect(page.getByRole("heading", { name: "Breakdown" })).toBeVisible();
      await page.waitForTimeout(300);
      const kpi = page.locator('section[aria-labelledby="kpi-title"]');
      const before = await controlsAbove(page, kpi);
      results[`${vp} · Dashboard`] = {
        page: await census(page),
        controlsBeforeFirstNumber: before.length,
        controlsBeforeFirstNumberNames: before,
        rawRuleShown: await page.getByText("last_touch_30d@1").count(),
        firstNumberInView: await kpi.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight),
      };
      save();
      await shot(page, `dashboard-${vp}`);
    });

    test("screen: New partner", async ({ page }) => {
      await page.goto(AFFILIATES);
      await page.getByRole("button", { name: "New partner", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New partner", exact: true });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);
      const said = await sentences(page, '[role="dialog"]');
      results[`${vp} · New partner`] = {
        dialog: await census(page, '[role="dialog"]'),
        sentences: said.length,
        sentenceText: said,
        saveLabel: (await dialog.locator("button[type=submit]").innerText()).trim(),
      };
      save();
      await shot(page, `new-partner-${vp}`);
    });
  });
}
