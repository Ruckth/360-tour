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
        if (scenario === "first-run") await expect(page.getByText("No marketing activity in the selected dates")).toBeVisible();
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
          await expect(page.getByText("No marketing activity in the selected dates")).toHaveCount(0);
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
      await expect(sheet).toContainText("2 sales with refunds reduced net by ฿9,600.");
      const box = (await sheet.boundingBox())!;
      expect.soft(box.x + box.width, "sheet inside the window").toBeLessThanOrEqual(width + 1);
      await expectAccessible(page, `sheet ${width} ${theme}`);
      await shot(page, `sheet-a1-${width}-${theme}`, false);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      await openExport(page, width);
      const dialog = page.getByRole("dialog", { name: "Export CSV" });
      await dialog.getByText("File metadata", { exact: true }).click();
      await expect(dialog.getByText("# Time zone: Asia/Bangkok")).toBeVisible();
      await dialog.getByText("All filtered sales").click();
      const preview = dialog.getByTestId("csv-preview");
      await expect(preview.getByRole("columnheader").first()).toHaveText("Kind");
      await expect(preview.getByRole("cell").first()).toBeVisible();
      await expectAccessible(page, `export ${width} ${theme}`);
      await shot(page, `export-${width}-${theme}`, false);
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download CSV" }).click();
      expect((await download).suggestedFilename()).toBe("marketing-sales-cohort-2026-10-08-to-2026-11-06.csv");
    });
  }
}

test("a below-fold tab list does not scroll the dashboard away from its toolbar", async ({ page }) => {
  await open(page, 1440, "normal", "light");
  await page.getByRole("tablist", { name: "Breakdown by" }).waitFor();
  const scroll = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return window.scrollY;
  });
  expect(scroll).toBe(0);
  await expect(page.getByRole("button", { name: /^Dates:/ })).toBeInViewport();
});

test("metric explanations and the Finance view", async ({ page }) => {
  await open(page, 1440, "normal", "light");
  const definitions = page.getByRole("button", { name: "Metric definitions" });
  await definitions.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Metric definitions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(definitions).toBeFocused();
  await page.getByRole("button", { name: "About tracked net", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("not profit");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "About return on ad spend" }).click();
  await expect(page.getByRole("tooltip")).toContainText("spend");
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Finance" }).click();
  await expect(page.getByRole("heading", { name: "Money in and out" })).toBeVisible();
  expect(JSON.parse((await page.locator("body").getAttribute("data-requests")) ?? "[]").at(-1).basis).toBe("cash");
});

test("drill-down, chart table and range presets work from the keyboard", async ({ page }) => {
  await open(page, 1440, "normal", "light");
  // Everything up to the breakdown rows is reachable with Tab.
  const reached = new Set<string>();
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 40)));
  }
  for (const name of ["About tracked net", "Export CSV", "Show as table", "Facebook"]) expect.soft([...reached].some((x) => x.startsWith(name)), name).toBe(true);

  await page.getByRole("button", { name: /^Facebook\b.*Show campaigns/ }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Drill-down" })).toContainText("All sources");
  await expect(page.getByRole("heading", { name: "Breakdown · Campaigns for Facebook" })).toBeFocused();
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

test("the range is remembered on this device, Last week included, and attribution sits beside report scope", async ({ page }) => {
  await open(page, 1180, "normal", "light");
  await expect(page.getByRole("button", { name: /^Dates: Last 30 days/ })).toBeVisible();
  // The applied attribution is adjacent to the report scope.
  await expect(page.getByRole("radio", { name: "First touch" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Attribution/ }).click();
  await page.getByRole("radio", { name: "First touch" }).click();
  await expect(page.getByText(/Each sale goes to the first tracked link/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Attribution · First touch" })).toBeVisible();

  await page.getByRole("button", { name: /^Dates:/ }).click();
  await page.getByRole("button", { name: /^Last week/ }).click();
  expect(JSON.parse((await page.locator("body").getAttribute("data-requests")) ?? "[]").at(-1).range).toEqual({ preset: "lastweek", from: "2026-10-26", to: "2026-11-01" });
  await page.reload();
  await expect(page.getByRole("button", { name: /^Dates: Last week/ })).toBeVisible();
  await shot(page, "remembered-last-week-1180-light", false);
});

/*
 * Before the dashboard simplification, on a phone, 8 controls stood before the first number
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
    await expect(page.getByText("Last touch · 30 days")).toHaveCount(0);
    if (width < 640) {
      expect((await page.getByRole("button", { name: /^Dates:/ }).boundingBox())!.width).toBeGreaterThan(140);
      expect((await page.getByRole("combobox", { name: "Property", exact: true }).boundingBox())!.width).toBeGreaterThan(140);
      // Dates, property, Marketing, Finance, attribution, breakdown jump, ⋯.
      expect(before).toBe(7);
      const attribution = page.getByRole("button", { name: "Attribution · Last touch", exact: true });
      await expect(attribution).toBeVisible();
      await attribution.click();
      await expect(page.getByRole("radiogroup", { name: "Attribution" })).toBeVisible();
      await page.keyboard.press("Escape");
      expect(before).toBeLessThan(BEFORE_PHONE_CONTROLS_BEFORE_FIGURES);
      await expect(page.getByRole("button", { name: "Export CSV" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Metric definitions" })).toBeVisible();
      await page.getByRole("button", { name: "More dashboard actions" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Refresh", "Export CSV"]);
      await page.getByRole("menuitem", { name: "Refresh" }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
    } else {
      expect(before).toBe(8);
      await expect(page.getByRole("button", { name: "More dashboard actions" })).toBeHidden();
    }
  });
}

test("the jump, drill back and date inspector move keyboard focus", async ({ page }) => {
  await open(page, 1280, "normal", "light");
  await page.setViewportSize({ width: 1280, height: 800 });
  const jump = page.getByRole("link", { name: "Jump to breakdown" });
  await expect(jump).toBeInViewport();
  await jump.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Breakdown", exact: true })).toBeFocused();

  const source = page.getByRole("button", { name: /^Facebook\b.*Show campaigns/ }).first();
  await source.press("Enter");
  await expect(page.getByRole("heading", { name: "Breakdown · Campaigns for Facebook" })).toBeFocused();
  await page.getByRole("button", { name: "All sources" }).press("Enter");
  await expect(source).toBeFocused();

  const chart = page.getByRole("region", { name: "Net collected by source" });
  await chart.getByRole("button", { name: "Inspect dates" }).press("Enter");
  const dates = chart.getByRole("combobox", { name: "Inspect date" });
  await expect(dates).toBeFocused();
  const initial = await dates.inputValue();
  const next = await dates.locator("option").nth(1).getAttribute("value");
  await dates.press("ArrowDown");
  await expect(dates).toHaveValue(next!);
  await dates.press("ArrowUp");
  await expect(dates).toHaveValue(initial);
  await expect(chart.getByRole("status")).toContainText("Total");
  await chart.getByRole("button", { name: "Close date inspector" }).press("Enter");
  await expect(chart.getByRole("group", { name: /^Net collected by source\./ })).toBeFocused();
});
