import { expect, test, type Page } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";

async function settings(page: Page, tab: string, query = "") {
  await page.goto(`/tests/browser/staff-roles.html?view=settings&tab=${tab}${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

// Round 5 items 2, 6, 11 and 13: assertions cover the rendered defect and its recovery.
test("iPad catalog uses two columns and shows the entire room metadata", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/tests/browser/staff-roles.html?role=cashier&scenario=spa");
  await page.locator("[data-fixture-ready]").waitFor();
  await page.getByRole("tab", { name: "Rooms", exact: true }).click();
  const tile = page.getByRole("button", { name: /Garden Villa.*Add to order/ });
  await expect(tile).toBeVisible();
  const meta = tile.getByText("per night · up to 4 guests", { exact: true });
  const geometry = await meta.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { textHeight: text.height, height: box.height, textWidth: text.width, width: box.width,
      columns: getComputedStyle(element.closest("button")!.parentElement!).gridTemplateColumns.split(" ").length };
  });
  expect(geometry.columns).toBe(2);
  expect(geometry.textHeight).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.textWidth).toBeLessThanOrEqual(geometry.width + 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => tile.evaluate((element) => getComputedStyle(element.parentElement!).gridTemplateColumns.split(" ").length)).toBe(3);
});

test("hotel phone List scrolls with the page and has no nested agenda scroller", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  const agenda = page.locator('[data-slot="event-calendar-agenda-view"]');
  await expect(agenda).toBeVisible();
  await expect(agenda.locator('[data-slot="scroll-area-viewport"]')).toHaveCount(0);
  const calendar = page.locator('[data-slot="event-calendar"]');
  const last = agenda.locator('[data-slot="event-calendar-event"]').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await calendar.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
});

test("Channels explains an unavailable setup check without hiding observed delivery health", async ({ page }) => {
  let setupReady = false;
  await page.route("**/api/admin/config-status", (route) => {
    return route.fulfill(!setupReady
      ? { status: 404, contentType: "application/json", body: JSON.stringify({ error: "Request failed (404)" }) }
      : { status: 200, contentType: "application/json", body: JSON.stringify({ channels: {
        line: { configured: true, vars: {} }, whatsapp: { configured: true, vars: {} }, facebook: { configured: true, vars: {} },
        instagram: { configured: false, vars: { "INSTAGRAM_APP_SECRET or META_APP_SECRET": false } },
      } }) });
  });
  await settings(page, "channels", "&channelHealth=states");
  await expect(page.getByRole("heading", { name: "Channels", exact: true })).toBeVisible();
  await expect(page.getByText("Couldn't check channel setup. Recent message activity is still shown.", { exact: true })).toBeVisible();
  const technical = page.getByText("Request failed (404)", { exact: true });
  await expect(technical).not.toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(technical).toBeVisible();
  const rows = page.getByRole("region", { name: "Messaging channels", exact: true }).getByRole("listitem");
  await expect(rows.nth(0)).toContainText("Receiving");
  await expect(rows.nth(1)).toContainText("Needs attention");
  await expect(rows.nth(2)).toContainText("Failing");
  await expect(rows.nth(3)).toContainText("Not checked");
  await expect(page.getByText("Unknown", { exact: true })).toHaveCount(0);
  const services = page.getByRole("region", { name: "Backend services", exact: true });
  await expect(services).toContainText("Email sending");
  await expect(services).toContainText("Stripe payments");
  await expect(services).not.toContainText("RESEND_API_KEY");
  setupReady = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Technical details", { exact: true })).toHaveCount(0);
  await expect(rows.nth(0)).toContainText("Receiving");
  await expect(rows.nth(3)).toContainText("Not set up");
  await expect(rows.nth(3)).toContainText("Missing: Message verification");
  await expect(rows.nth(3)).not.toContainText("INSTAGRAM_APP_SECRET");
});

for (const width of [390, 1180]) {
  test(`Team role saves keep the person row and return focus to Change (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await settings(page, "team");
    const row = page.getByTestId("team-person").filter({ hasText: "mint@auraliscove.co" });
    await row.evaluate((element) => element.setAttribute("data-original-row", "true"));
    const change = row.getByRole("button", { name: "Change roles for Mint", exact: true });
    await change.click();
    await row.getByRole("combobox", { name: "Desk role for Mint", exact: true }).click();
    await page.getByRole("option", { name: "Manager", exact: true }).click();
    await expect(row.getByTestId("team-roles")).toHaveText("Manager");
    await expect(row).toHaveAttribute("data-original-row", "true");
    await expect(change).toHaveAttribute("aria-expanded", "false");
    await expect(change).toBeFocused();
    await change.click();
    await row.getByRole("combobox", { name: "Marketing role for Mint", exact: true }).click();
    await page.getByRole("option", { name: "Editor", exact: true }).click();
    await expect(row.getByTestId("team-roles")).toHaveText("Manager · Marketing Editor");
    await expect(change).toBeFocused();
    await expect(change).toHaveAttribute("aria-expanded", "false");
  });
}

test("Booking rules have visible and spoken units and an explicit empty cutoff", async ({ page }) => {
  await settings(page, "bookingRules");
  const panel = page.getByRole("region", { name: "Booking rules", exact: true });
  for (const [label, unit] of [["Reservation held while awaiting payment", "minutes"], ["Guest confirmation window for chat quotes", "minutes"], ["Pre-arrival email", "days before"], ["Review request email", "days after"], ["Minimum stay", "nights"], ["Book up to", "days ahead"]]) {
    const input = panel.getByRole("textbox", { name: label, exact: true });
    await expect(input).toHaveAccessibleDescription(unit);
    await expect(input.locator("..").getByText(unit === "minutes" ? "min" : unit, { exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: "Same-day booking cutoff, not set", exact: true })).toHaveText("No cutoff");
});

test("removing final Team access keeps confirmation and moves focus to the next person", async ({ page }) => {
  await settings(page, "team");
  const mint = page.getByTestId("team-person").filter({ hasText: "mint@auraliscove.co" });
  const change = mint.getByRole("button", { name: "Change roles for Mint", exact: true });
  await change.click();
  const role = mint.getByRole("combobox", { name: "Desk role for Mint", exact: true });
  await role.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove Mint from the desk?", exact: true });
  await confirm.getByRole("button", { name: "Keep access", exact: true }).click();
  await expect(mint.getByTestId("team-roles")).toHaveText("Cashier");
  await expect(change).toHaveAttribute("aria-expanded", "true");
  await role.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(mint).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change roles for Ploy", exact: true })).toBeFocused();
});

for (const theme of ["light", "dark"]) {
  test(`dashboard breakdown neighbours have at least 3:1 contrast and the range appears once (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`/tests/browser/marketing-dashboard.html?theme=${theme}`);
    await page.getByRole("heading", { name: "Marketing dashboard", exact: true }).waitFor();
    const bar = page.getByRole("img", { name: /^Net collected by tracking:/ });
    const contrast = await bar.locator(":scope > span").evaluateAll((parts) => {
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const [low, high] = [parts[1], parts[2]].map((part) => luminance(getComputedStyle(part).backgroundColor)).sort((a, b) => a - b);
      return (high + 0.05) / (low + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
    const subtitle = page.locator("#kpi-title + p");
    const range = (await subtitle.innerText()).split(" · ")[0];
    expect(range).toMatch(/\d.*2026/);
    expect((await page.locator("body").innerText()).split(range).length - 1).toBe(1);
  });
}
