import { expect, test } from "@playwright/test";

for (const width of [390, 1180, 1440]) {
  test.describe(`Round 6 settings and marketing (${width}px)`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width !== 1440, isMobile: width !== 1440 });

    test("expired invite renews from the reserved icon slot without wrapping Change", async ({ page }) => {
      await page.goto("/tests/browser/staff-roles.html?view=settings&tab=team&teamInvite=expired");
      const lek = page.getByTestId("team-person").filter({ hasText: "lek@auraliscove.co" });
      await expect(lek).toContainText("Invite expired");
      const renew = lek.getByRole("button", { name: "Renew invitation for Lek", exact: true });
      const change = lek.getByRole("button", { name: "Change roles for Lek", exact: true });
      await expect(renew).toHaveText("");
      const renewBox = (await renew.boundingBox())!;
      const changeBox = (await change.boundingBox())!;
      expect(renewBox.width).toBe(44);
      expect(renewBox.height).toBe(44);
      expect(Math.abs((renewBox.y + renewBox.height / 2) - (changeBox.y + changeBox.height / 2))).toBeLessThanOrEqual(1);
      expect(renewBox.x).toBeGreaterThanOrEqual(changeBox.x + changeBox.width);
      expect((await renew.locator("..").boundingBox())!.height).toBe(44);
      const mint = page.getByTestId("team-person").filter({ hasText: "mint@auraliscove.co" });
      expect((await mint.getByRole("button", { name: "Change roles for Mint", exact: true }).boundingBox())!.x).toBe(changeBox.x);
      await renew.hover();
      await expect(page.getByRole("tooltip", { name: "Renew invitation", exact: true })).toBeVisible();
      await renew.click();
      await expect(lek.getByRole("status")).toHaveText("Invite renewed for Lek.");
      await expect(lek).not.toContainText("Invite expired");
      await expect(lek.getByRole("button", { name: "More for Lek", exact: true })).toBeVisible();
    });

    test("booking units fit beside the number and are announced once", async ({ page }) => {
      await page.goto("/tests/browser/staff-roles.html?view=settings&tab=bookingRules");
      for (const [label, suffix, spoken] of [
        ["Hold unpaid bookings for", "min", "minutes"],
        ["Chat booking quote expires after", "min", "minutes"],
        ["Pre-arrival email", "days before", "days before"],
        ["Review request email", "days after", "days after"],
        ["Minimum stay", "nights", "nights"],
        ["Book up to", "days ahead", "days ahead"],
      ]) {
        const input = page.getByRole("textbox", { name: label, exact: true });
        await expect(input).toHaveAccessibleDescription(spoken);
        const unit = input.locator("..").getByText(suffix, { exact: true });
        await expect(unit).toBeVisible();
        const inputBox = (await input.boundingBox())!;
        const unitBox = (await unit.boundingBox())!;
        const padding = await input.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingRight));
        expect(unitBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - padding);
        expect(unitBox.x + unitBox.width).toBeLessThan(inputBox.x + inputBox.width);
        if (width >= 640) expect(inputBox.width).toBeLessThanOrEqual(224);
      }
    });

    test("refund-heavy dashboard shows every signed source without a proportion strip", async ({ page }) => {
      await page.goto("/tests/browser/marketing-dashboard.html?case=negative-net");
      const kpis = page.getByRole("region", { name: "Money in and out", exact: true });
      await expect(kpis.getByText("Refunds exceed income for some sources.", { exact: true })).toBeVisible();
      await expect(kpis.getByRole("img", { name: /^Net collected by tracking:/ })).toHaveCount(0);
      const breakdown = kpis.getByRole("list", { name: "Net collected by tracking", exact: true });
      await expect(breakdown.getByRole("listitem")).toHaveCount(4);
      for (const [label, amount] of [["Tracked links", "฿1,000"], ["Not tracked", "฿2,000"], ["Staff-entered", "−฿3,000"], ["Messaging", "−฿500"]]) {
        const row = breakdown.getByRole("listitem").filter({ hasText: label });
        await expect(row.getByText(amount, { exact: true })).toBeVisible();
      }
    });
  });
}

test("Channels uses plain labels, warning totals and an explanation when error details are absent", async ({ page }) => {
  await page.goto("/tests/browser/staff-roles.html?view=settings&tab=channels&channelHealth=states");
  const channels = page.getByRole("region", { name: "Messaging channels", exact: true });
  const rows = channels.getByRole("listitem");
  for (const row of [rows.nth(1), rows.nth(2)]) {
    await expect(row.locator("dt")).toHaveText(["Last message in", "Last reply", "Failed replies · 24 h", "Failed replies · 7 d"]);
  }
  await expect(rows.nth(1).getByText("2 replies failed in the last 7 days", { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("1 reply failed in the last 7 days", { exact: true })).toBeVisible();
  expect(await rows.nth(1).locator("dd").nth(3).evaluate((el) => getComputedStyle(el).color)).toBe(await rows.nth(1).getByText("Needs attention", { exact: true }).evaluate((el) => getComputedStyle(el).color));
  await expect(rows.nth(2).locator("dd").nth(2)).toHaveClass(/text-destructive/);
  await expect(rows.nth(0).getByText(/replies failed in the last 7 days/)).toHaveCount(0);
});
