import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";

/*
 * P7 · Settings and Team, measured on the staff-roles fixture (staff-roles-fixture.tsx).
 * Counting follows docs/reviews/ux-audit/click-audit.md: opening a native <select> and picking
 * from it is 2 taps; a filled text field is 1 field; a scroll is a target outside the viewport.
 */
const SIZES = { ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } } as const;

/**
 * Before P7 (measured on ux/integration at 54cc6f3, Marketing › Access, iPad): the Access tab
 * in Marketing's section nav (1; the page is not in the sidebar), the email retyped from Team
 * (1 field), the role select (2), Create invitation (1).
 */
const BEFORE_GRANT_MARKETING = { taps: 4, fields: 1, pageChanges: 1 } as const;

/**
 * Round 2 (docs/reviews/ux-audit/r2-admin.md), measured on the same fixture before the change:
 * People held 8 native selects (2 per person) and 11 controls; on the phone the discount limit
 * started below the fold (1 scroll to reach it, 1 more to reach Save).
 */
const BEFORE_R2 = { selects: 8, peopleControls: 11, phoneLimitScrolls: 2 } as const;

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

/** Counts each action and whether its target needed a scroll first. */
function recorder(page: Page) {
  const counts = { taps: 0, fields: 0, scrolls: 0 };
  async function inView(target: Locator) {
    const box = await target.boundingBox();
    const viewport = page.viewportSize()!;
    if (!box || box.y < 0 || box.y + box.height > viewport.height || box.x + box.width > viewport.width) counts.scrolls += 1;
  }
  return {
    counts,
    async tap(target: Locator) {
      await inView(target);
      counts.taps += 1;
      await target.click();
    },
    async pick(target: Locator, value: string) {
      await inView(target);
      counts.taps += 2;
      await target.click();
      await page.getByRole("option", { name: ({ marketer: "Editor", manager: "Manager", viewer: "Viewer" } as Record<string, string>)[value], exact: true }).click();
    },
  };
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`Settings › Team (${size})`, () => {
    test.use({ viewport });

    test("grant Marketing access: Change, then the role (3 taps), no typing, same page", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const people = page.getByRole("region", { name: "People" });
      const run = recorder(page);
      await run.tap(people.getByRole("button", { name: "Change roles for Mint" }));
      await run.pick(people.getByRole("combobox", { name: "Marketing role for Mint" }), "marketer");
      await expect(people.getByRole("status")).toHaveText("Invited Mint to Marketing as Editor.");
      expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({ email: "mint@auraliscove.co", role: "marketer" });
      const mint = people.getByTestId("team-person").filter({ hasText: "mint@" });
      await expect(mint.getByTestId("team-roles")).toHaveText("Cashier · Marketing Editor");
      await expect(mint).toContainText("Marketing: Invite expires");
      expect(await page.locator("body").getAttribute("data-navigation")).toBeNull();
      expect(run.counts).toEqual({ taps: 3, fields: 0, scrolls: 0 });
      expect(run.counts.taps).toBeLessThan(BEFORE_GRANT_MARKETING.taps);
    });

    test("people show names, roles as text and one Change each; no selects until asked", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const people = page.getByRole("region", { name: "People" });
      await expect(people.getByTestId("team-person")).toHaveCount(5);
      await expect(people.getByRole("combobox")).toHaveCount(0);
      expect(BEFORE_R2.selects).toBe(8);
      await expect(people.getByRole("button", { name: /^Change roles for / })).toHaveText(Array(4).fill("Change"));
      // ⓘ, Invite, 4 × Change and the pending invite's ⋯ (was ⓘ, Invite, 8 selects and ⋯ = 11).
      const controls = await people.evaluate((el) => el.querySelectorAll("button, select, a[href], input:not([type=hidden])").length);
      expect(controls).toBe(7);
      expect(controls).toBeLessThan(BEFORE_R2.peopleControls);
      const lek = people.getByTestId("team-person").first().locator("p");
      await expect(lek.nth(0)).toHaveText("Lek");
      await expect(lek.nth(1)).toHaveText("lek@auraliscove.co");
      await people.getByRole("button", { name: "Change roles for Ploy" }).click();
      await expect(people.getByRole("combobox")).toHaveCount(2);
      await expect(people.getByRole("combobox", { name: "Desk role for Ploy" })).toHaveText("Manager");
      await expect(people.getByRole("combobox", { name: "Marketing role for Ploy" })).toHaveText("Viewer");
    });

    test("the discount limit and its Save are on screen at the start, no scroll", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const rules = page.getByRole("form", { name: "Rules for all cashiers" });
      const run = recorder(page);
      const limit = rules.getByRole("textbox", { name: "Discount without approval" });
      await expect(limit).toBeInViewport({ ratio: 1 });
      await limit.fill("15");
      await run.tap(rules.getByRole("button", { name: "Save", exact: true }));
      await expect(rules.getByRole("status")).toHaveText("Saved");
      expect(run.counts.scrolls).toBe(0);
      if (size === "phone") expect(run.counts.scrolls).toBeLessThan(BEFORE_R2.phoneLimitScrolls);
    });

    test("cashier rules are named like the actions they gate", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const names = await page.getByRole("form", { name: "Rules for all cashiers" }).getByRole("radiogroup").evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")));
      expect(names).toEqual(["Refund permission", "Void permission", "Custom price permission", "Correct payment permission"]);
    });

    test("the Team tab starts on screen", async ({ page }) => {
      await open(page, "?view=settings");
      const team = page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "Team" });
      const box = (await team.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    });

    test("the cashier rules' Save stays in view while the rules are", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const rules = page.getByRole("form", { name: "Rules for all cashiers" });
      await expect(rules.getByTestId("rules-save-bar")).toHaveCount(0);
      await rules.getByRole("textbox", { name: "Discount without approval" }).fill("15");
      // Scroll so only the first rows of the rules show at the bottom of the screen.
      const scrollTop = await rules.evaluate((el) => Math.max(0, window.scrollY + el.getBoundingClientRect().top - window.innerHeight + 200));
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), scrollTop);
      // A compact page can already start above this target; it cannot scroll past its top.
      if (scrollTop > 0) expect((await rules.boundingBox())!.y).toBeGreaterThan(viewport.height - 260);
      const bar = (await rules.getByTestId("rules-save-bar").boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(rules.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
    });
  });
}

test.describe("Settings panels", () => {
  test.use({ viewport: SIZES.ipad });

  test("Team panels show at most one sentence", async ({ page }) => {
    await open(page, "?view=settings&tab=team");
    await expectAtMostSentences(page.getByRole("region", { name: "People" }), 1);
    await expectAtMostSentences(page.getByRole("region", { name: "Rules for all cashiers" }), 1);
  });

  for (const [tab, title] of [["business", "Business profile"], ["bookingRules", "Booking rules"], ["ai", "AI assistant"], ["email", "Email"]] as const) {
    test(`${title}: visible context, Save only after a change, history one closed section`, async ({ page }) => {
      await open(page, `?view=settings&tab=${tab}`);
      const panel = page.getByRole("region", { name: title });
      await expectAtMostSentences(panel, tab === "business" ? 2 : 1);
      const save = panel.getByRole("button", { name: "Save", exact: true });
      // Deleted villa history lives on Properties, not under every Settings tab.
      await expect(page.getByText("deleted villas")).toHaveCount(0);
      await expect(save).toHaveCount(0);
      const field = panel.locator("input:not([type=hidden]), textarea").first();
      const value = await field.inputValue();
      await field.fill(`${value}1`);
      await expect(save).toBeEnabled();
      await field.fill(value);
      await expect(save).toHaveCount(0);
      const history = panel.locator("details").filter({ has: page.locator("summary", { hasText: /^History$/ }) });
      await expect(history).toHaveCount(1);
      await expect(history).not.toHaveAttribute("open", /.*/);
    });
  }

  test("Business hints open from their ⓘ", async ({ page }) => {
    await open(page, "?view=settings&tab=business");
    const tip = page.getByRole("button", { name: "About cancellation policy" });
    await tip.scrollIntoViewIfNeeded();
    await tip.click();
    await expect(page.getByRole("tooltip")).toHaveText("The AI concierge quotes this to guests. Leave blank to not mention a policy.");
  });

  test("Channels has no duplicate iCal panel, and each panel shows at most one sentence", async ({ page }) => {
    await open(page, "?view=settings&tab=channels");
    await expect(page.getByRole("region", { name: "Messaging channels" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /iCal/ })).toHaveCount(0);
    for (const title of ["Messaging channels", "Backend services"]) await expectAtMostSentences(page.getByRole("region", { name: title }), 1);
  });

  test("a manager's read-only banner is the page's one sentence", async ({ page }) => {
    await open(page, "?view=settings&role=manager&tab=business");
    await expect(page.getByTestId("read-only-banner")).toBeVisible();
    await expectAtMostSentences(page.getByRole("region", { name: "Business profile" }), 2);
  });
});

test.describe("Round 1 settings drafts", () => {
  test.use({ viewport: SIZES.ipad });

  test("tab changes keep drafts until discarded and unload is guarded", async ({ page }) => {
    await open(page, "?view=settings&tab=business");
    const name = page.getByRole("textbox", { name: "Business name", exact: true });
    await name.fill("My unsaved resort");
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(name).toHaveValue("My unsaved resort");
    await expect(page.locator("body")).not.toHaveAttribute("data-navigation");
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    await dialog.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-navigation", /tab=team/);
  });

  test("Discard resets fields and Save stays visible briefly after success", async ({ page }) => {
    await open(page, "?view=settings&tab=business");
    const name = page.getByRole("textbox", { name: "Business name", exact: true });
    const original = await name.inputValue();
    await name.fill("Changed name");
    await expect(page.getByRole("status")).toHaveText("Unsaved changes");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(name).toHaveValue(original);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(false);
    await name.fill("Saved name");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeInViewport();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(0, { timeout: 5000 });
  });

  test("currency, searchable time zone and required half-hour times use structured pickers", async ({ page }) => {
    await open(page, "?view=settings&tab=business");
    await page.getByRole("combobox", { name: "Currency", exact: true }).click();
    await page.getByRole("option", { name: "THB", exact: true }).click();
    const zone = page.getByRole("combobox", { name: "Time zone", exact: true });
    await zone.fill("Tokyo");
    await page.getByRole("option", { name: "Asia/Tokyo", exact: true }).click();
    await expect(zone).toHaveValue("Asia/Tokyo");
    const checkIn = page.getByRole("combobox", { name: /^Check-in time,/ });
    await checkIn.click();
    await expect(page.getByRole("option")).toHaveCount(48);
    await page.getByRole("option", { name: "15:30", exact: true }).click();
    await expect(checkIn).toHaveAccessibleName("Check-in time, 15:30");
    await expect(page.getByRole("button", { name: /Clear check-/ })).toHaveCount(0);
  });

  test("rules draft uses the same tab guard and Discard restores the approval requirements", async ({ page }) => {
    await open(page, "?view=settings&tab=team");
    const rule = page.getByRole("radiogroup", { name: "Refund permission", exact: true });
    await rule.getByRole("radio", { name: "Cashier", exact: true }).click();
    await page.getByRole("tab", { name: "Business", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();
    await expect(rule.getByRole("radio", { name: "Cashier", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(rule.getByRole("radio", { name: "Manager", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("rules-save-bar")).toHaveCount(0);
  });
});
