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
      await target.selectOption(value);
    },
  };
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`Settings › Team (${size})`, () => {
    test.use({ viewport });

    test("grant Marketing access: 2 taps, no typing, same page", async ({ page }) => {
      await open(page, "?view=settings&tab=team");
      const people = page.getByRole("region", { name: "People" });
      const run = recorder(page);
      await run.pick(people.getByRole("combobox", { name: "Marketing role for mint@auraliscove.co" }), "marketer");
      await expect(people.getByRole("status")).toHaveText("Invited mint@auraliscove.co to Marketing as Marketer.");
      expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({ email: "mint@auraliscove.co", role: "marketer" });
      await expect(people.getByRole("combobox", { name: "Marketing role for mint@auraliscove.co" })).toHaveValue("marketer");
      await expect(people.getByTestId("team-person").filter({ hasText: "mint@" })).toContainText("Marketing: Invited · expires");
      expect(await page.locator("body").getAttribute("data-navigation")).toBeNull();
      expect(run.counts).toEqual({ taps: 2, fields: 0, scrolls: 0 });
      expect(run.counts.taps).toBeLessThan(BEFORE_GRANT_MARKETING.taps);
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
      // Scroll so only the first rows of the rules show at the bottom of the screen.
      await rules.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - window.innerHeight + 200, behavior: "instant" }));
      const formTop = (await rules.boundingBox())!.y;
      expect(formTop).toBeGreaterThan(viewport.height - 260);
      const bar = (await rules.getByTestId("rules-save-bar").boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(rules.getByRole("button", { name: "Save rules" })).toBeInViewport();
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
    test(`${title}: hints behind ⓘ, Save only after a change, history one closed section`, async ({ page }) => {
      await open(page, `?view=settings&tab=${tab}`);
      const panel = page.getByRole("region", { name: title });
      await expectAtMostSentences(panel, 1);
      const save = panel.getByRole("button", { name: `Save ${title.toLowerCase()}` });
      await expect(save).toBeDisabled();
      const field = panel.locator("input:not([type=hidden]), textarea").first();
      const value = await field.inputValue();
      await field.fill(`${value}1`);
      await expect(save).toBeEnabled();
      await field.fill(value);
      await expect(save).toBeDisabled();
      const history = panel.locator("details").filter({ has: page.locator("summary", { hasText: /^Settings history$/ }) });
      await expect(history).toHaveCount(1);
      await expect(history).not.toHaveAttribute("open", /.*/);
    });
  }

  test("Business hints open from their ⓘ", async ({ page }) => {
    await open(page, "?view=settings&tab=business");
    await page.getByRole("button", { name: "About cancellation policy" }).click();
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
    await expectAtMostSentences(page.getByRole("region", { name: "Business profile" }), 0);
  });
});
