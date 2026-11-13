import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * Release 3b marketing dashboard in a real browser (marketing-dashboard-fixture.tsx): every scenario
 * at phone, iPad, iPad landscape and desktop widths in light and dark, with axe, no sideways page
 * scroll and keyboard checks. Set MARKETING_EVIDENCE to a folder to keep screenshots.
 */

const WIDTHS = [390, 820, 1180, 1440];
const SCENARIOS = ["normal", "first-run", "untracked", "loading", "error", "no-spend", "refunds", "truncated"] as const;
const EVIDENCE = process.env.MARKETING_EVIDENCE;

async function open(page: Page, width: number, scenario: string, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: width < 1024 ? 900 : 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/tests/browser/marketing-dashboard.html?case=${scenario}${theme === "dark" ? "&theme=dark" : ""}`);
  await expect(page.getByRole("heading", { name: "Marketing dashboard" })).toBeAttached();
}

async function expectNoSideScroll(page: Page, width: number) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), "page scroll width").toBeLessThanOrEqual(width);
}

async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect.soft(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), `axe (${label})`).toEqual([]);
}

/** Export CSV: a toolbar button from 640 px, in ⋯ on a phone. */
async function openExport(page: Page, width: number) {
  if (width >= 640) return page.getByRole("button", { name: "Export CSV" }).click();
  await page.getByRole("button", { name: "More dashboard actions" }).click();
  await page.getByRole("menuitem", { name: "Export CSV" }).click();
}

async function shot(page: Page, name: string, fullPage = true) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    for (const scenario of SCENARIOS) {
      test(`${scenario} fits at ${width}px (${theme})`, async ({ page }) => {
        await open(page, width, scenario, theme);
        if (scenario === "loading") await expect(page.getByRole("status").filter({ hasText: "Loading marketing results" })).toBeAttached();
        if (scenario === "error") await expect(page.getByRole("alert")).toContainText("Couldn’t load marketing results");
        if (scenario === "first-run") await expect(page.getByText("See which links bring paid bookings")).toBeVisible();
        if (scenario === "untracked") {
          // Sales before the first campaign: the figures and export, with the setup steps beside them.
          await expect(page.getByRole("status").filter({ hasText: "No campaigns or links yet" })).toBeVisible();
          await expect(page.getByRole("link", { name: "Create a campaign" })).toBeVisible();
          await expect(page.getByText("Business total").first()).toBeVisible();
          if (width >= 640) await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
          else {
            await page.getByRole("button", { name: "More dashboard actions" }).click();
            await expect(page.getByRole("menuitem", { name: "Export CSV" })).toBeEnabled();
            await page.keyboard.press("Escape");
          }
          await expect(page.getByText("See which links bring paid bookings")).toHaveCount(0);
        }
        if (scenario === "truncated") await expect(page.getByText("These figures are incomplete")).toBeVisible();
        if (scenario === "refunds") await expect(page.getByRole("heading", { name: "Money in and out" })).toBeVisible();
        if (["normal", "untracked", "no-spend", "refunds", "truncated"].includes(scenario)) {
          await expect(page.getByRole("heading", { name: "Breakdown" })).toBeVisible();
          // The table where every column fits (iPad landscape up here), cards below; never cut off at the side.
          const table = page.locator("#breakdown table");
          await expect(table).toBeVisible({ visible: width >= 1024 });
          if (width >= 1024) expect.soft(await table.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth), "table cut off").toBeLessThanOrEqual(0);
        }
        if (scenario === "no-spend") await expect(page.getByRole("button", { name: "Add spend" }).first()).toBeVisible();
        await expectNoSideScroll(page, width);
        await expectAccessible(page, `${scenario} ${width} ${theme}`);
        await shot(page, `${scenario}-${width}-${theme}`);
      });
    }

    test(`sales sheet and export dialog fit at ${width}px (${theme})`, async ({ page }) => {
      await open(page, width, "normal", theme);
      await page.getByRole("tab", { name: "Link" }).click();
      await page.getByRole("button", { name: /^\/a1\b.*Show sales/ }).locator("visible=true").first().click();
      const sheet = page.getByRole("dialog", { name: "/a1" });
      await expect(sheet).toContainText("2 refunds reduced net by ฿9,600.");
      const box = (await sheet.boundingBox())!;
      expect.soft(box.x + box.width, "sheet inside the window").toBeLessThanOrEqual(width + 1);
      await expectAccessible(page, `sheet ${width} ${theme}`);
      await shot(page, `sheet-a1-${width}-${theme}`, false);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      await openExport(page, width);
      const dialog = page.getByRole("dialog", { name: "Export CSV" });
      await expect(dialog.getByTestId("csv-preview")).toContainText("# Time zone: Asia/Bangkok");
      await dialog.getByText("One row per sale").click();
      await expect(dialog.getByTestId("csv-preview")).toContainText("Kind,Id,Reference");
      await expectAccessible(page, `export ${width} ${theme}`);
      await shot(page, `export-${width}-${theme}`, false);
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download CSV" }).click();
      expect((await download).suggestedFilename()).toBe("marketing-sales-cohort-2026-10-08-to-2026-11-06.csv");
    });
  }
}

test("definitions sheet and the Finance view", async ({ page }) => {
  await open(page, 1440, "normal", "light");
  await page.getByRole("button", { name: "Definitions" }).click();
  const defs = page.getByRole("dialog", { name: "Metric definitions" });
  await expect(defs).toContainText("Net is not profit");
  await expect(defs).toContainText("not that the ad caused the sale");
  await expect(defs).toContainText("Sessions are visits, not people");
  await shot(page, "definitions-1440-light", false);
  await page.keyboard.press("Escape");

  await page.getByRole("radio", { name: "Finance" }).click();
  await expect(page.getByRole("heading", { name: "Money in and out" })).toBeVisible();
  expect(JSON.parse((await page.locator("body").getAttribute("data-requests")) ?? "[]").at(-1).basis).toBe("cash");
});

test("drill-down, chart table and range presets work from the keyboard", async ({ page }) => {
  await open(page, 1440, "normal", "light");
  // Everything up to the breakdown rows is reachable with Tab.
  const reached = new Set<string>();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 40)));
  }
  for (const name of ["Definitions", "Export CSV", "Show as table", "facebook"]) expect.soft([...reached].some((x) => x.startsWith(name)), name).toBe(true);

  await page.getByRole("button", { name: /^facebook\b.*Show campaigns/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Drill-down" })).toContainText("All sources");
  await page.getByRole("button", { name: /^Facebook · November escape\b.*Show links/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Drill-down" })).toContainText("Facebook · November escape");
  await page.getByRole("button", { name: /^\/f1\b.*Show sales/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "/f1" })).toBeVisible();
  await page.getByRole("button", { name: "Open booking" }).first().focus();
  await page.keyboard.press("Enter");
  expect(JSON.parse((await page.locator("body").getAttribute("data-stays")) ?? "[]")).toHaveLength(1);
  await page.keyboard.press("Escape");
  await shot(page, "drill-nov-escape-1440-light");

  await page.getByRole("button", { name: "Show as table" }).click();
  await expect(page.getByRole("table", { name: /Net collected by source, daily/ })).toBeVisible();

  await page.getByRole("button", { name: /^Dates:/ }).click();
  await page.getByRole("button", { name: /^Last 7 days/ }).click();
  await expect(page.getByRole("button", { name: /^Dates: Last 7 days/ })).toBeVisible();
  expect(JSON.parse((await page.locator("body").getAttribute("data-requests")) ?? "[]").at(-1).range).toEqual({ preset: "last7", from: "2026-10-31", to: "2026-11-06" });
});

test("the range is remembered on this device, Last week included, and attribution sits in View options", async ({ page }) => {
  await open(page, 1180, "normal", "light");
  await expect(page.getByRole("button", { name: /^Dates: Last 30 days/ })).toBeVisible();
  // Attribution is one tap away, not in the toolbar.
  await expect(page.getByRole("radio", { name: "First touch" })).toHaveCount(0);
  await page.getByRole("button", { name: /^View options/ }).click();
  await page.getByRole("radio", { name: "First touch" }).click();
  await expect(page.getByText(/Each sale goes to the first tracked link/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "View options: First touch" })).toBeVisible();

  await page.getByRole("button", { name: /^Dates:/ }).click();
  await page.getByRole("button", { name: /^Last week/ }).click();
  expect(JSON.parse((await page.locator("body").getAttribute("data-requests")) ?? "[]").at(-1).range).toEqual({ preset: "lastweek", from: "2026-10-26", to: "2026-11-01" });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Dates: Last week/ })).toBeVisible();
  await shot(page, "remembered-last-week-1180-light", false);
});

/*
 * Round 2 (docs/reviews/ux-audit/r2-admin.md): on a phone, 8 controls stood before the first number
 * (dates, property, Marketing, Finance, View options, Definitions, Export CSV, Refresh) and the
 * context line ended "(last_touch_30d@1)".
 */
const BEFORE_PHONE_CONTROLS_BEFORE_FIGURES = 8;

for (const width of [390, 1180]) {
  test(`controls before the first figure, and attribution in words (${width}px)`, async ({ page }) => {
    await open(page, width, "normal", "light");
    const kpi = page.locator('section[aria-labelledby="kpi-title"]');
    await expect(kpi).toBeVisible();
    const before = await kpi.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const selector = "button, a[href], input:not([type=hidden]), select, [role=radio], [role=combobox]";
      return Array.from(document.querySelectorAll(selector)).filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && node.checkVisibility() && !node.parentElement?.closest(selector) && r.top < top;
      }).length;
    });
    await expect(page.getByText("last_touch_30d@1")).toHaveCount(0);
    await expect(page.getByText("Last touch · 30 days")).toBeVisible();
    if (width < 640) {
      // Dates, property, Marketing, Finance, View options, ⋯.
      expect(before).toBe(6);
      expect(before).toBeLessThan(BEFORE_PHONE_CONTROLS_BEFORE_FIGURES);
      await expect(page.getByRole("button", { name: "Export CSV" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Definitions" })).toBeHidden();
      await page.getByRole("button", { name: "More dashboard actions" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Refresh", "Definitions", "Export CSV"]);
      await page.getByRole("menuitem", { name: "Refresh" }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
    } else {
      expect(before).toBe(BEFORE_PHONE_CONTROLS_BEFORE_FIGURES);
      await expect(page.getByRole("button", { name: "More dashboard actions" })).toBeHidden();
    }
  });
}
