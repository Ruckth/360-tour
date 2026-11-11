import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const width of [390, 1180])
  for (const theme of ["light", "dark"]) {
    test(`affiliate setup and conflict review ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/marketing-affiliates.html?theme=${theme}`,
      );
      await page
        .getByRole("button", { name: "New partner", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "New partner",
        exact: true,
      });
      await dialog.getByRole("button", { name: "Save partner" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Enter a partner name",
      );
      await dialog.getByLabel("Partner name", { exact: true }).fill("Carla");
      await dialog.getByLabel("Permanent link name").fill("carla");
      await dialog
        .getByLabel("Contact email (optional)")
        .fill("carla@example.com");
      await dialog.getByRole("button", { name: "Save partner" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("/r/carla", { exact: true })).toBeVisible();
      expect(
        JSON.parse((await page.locator("body").getAttribute("data-saved"))!),
      ).toMatchObject({
        name: "Carla",
        slug: "carla",
        campaignId: "campaign1",
      });
      await page.getByRole("button", { name: "Review Order #1" }).click();
      const review = page.getByRole("dialog", {
        name: "Referral Order #1",
        exact: true,
      });
      await expect(
        review.getByRole("button", { name: "Approve referral credit" }),
      ).toBeDisabled();
      await review
        .getByLabel("Decision reason")
        .fill("Guest confirmed partner Ben");
      await expect(
        review.getByRole("button", { name: "Approve referral credit" }),
      ).toBeDisabled();
      await review.getByLabel("Partner to credit").selectOption("ben");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await review
        .getByRole("button", { name: "Approve referral credit" })
        .click();
      await expect(
        review.getByRole("button", { name: "Approve referral credit" }),
      ).toHaveCount(0);
      await expect(
        review.getByText("Revision 5 · reviewed · approved"),
      ).toBeVisible();
      expect(
        JSON.parse((await page.locator("body").getAttribute("data-reviewed"))!),
      ).toMatchObject({
        expectedRevision: 4,
        affiliateId: "ben",
        reason: "Guest confirmed partner Ben",
      });
    });
  }
test("viewer can inspect referral evidence without partner or review mutations", async ({
  page,
}) => {
  await page.goto("/tests/browser/marketing-affiliates.html?role=viewer");
  await expect(
    page.getByRole("button", { name: "New partner", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit Anna", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review Order #1" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved candidates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve referral credit" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh eligibility" }),
  ).toHaveCount(0);
});

test("newly eligible referral buttons are immediately readable", async ({ page }) => {
  await page.goto("/tests/browser/marketing-affiliates.html?theme=dark");
  await page.addStyleTag({ content: "button { transition-duration: 2s !important; }" });
  await page.getByRole("button", { name: "Review Order #1" }).click();
  const review = page.getByRole("dialog", { name: "Referral Order #1", exact: true });
  await review.getByLabel("Decision reason").fill("Guest confirmed partner Ben");
  await review.getByLabel("Partner to credit").selectOption("ben");
  const approve = review.getByRole("button", { name: "Approve referral credit" });
  const reject = review.getByRole("button", { name: "Reject referral credit" });
  await expect(approve).toBeEnabled();
  await expect(reject).toBeEnabled();
  expect(await approve.evaluate(button => getComputedStyle(button).opacity)).toBe("1");
  expect(await reject.evaluate(button => getComputedStyle(button).opacity)).toBe("1");
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
});
