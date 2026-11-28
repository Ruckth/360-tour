import { api } from "../../convex/_generated/api";
import { addDaysIso } from "../../convex/shared/dates";
import { resortTodayIso } from "../../convex/shared/time";
import { formatRange } from "../../src/components/admin/marketing/marketing-format";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("Marketing dashboard restores copied scope after reload and browser history", async ({ page }) => {
  const owner = await signedInBackend(page);
  const [property] = await owner.query(api.catalog.properties.adminList, {});
  if (!property) throw new Error("The integration seed needs a property.");

  const today = resortTodayIso();
  const from = addDaysIso(today, -12);
  const to = addDaysIso(today, -4);
  const scope = new URLSearchParams({ from, to, preset: "last7", basis: "cash", property: property._id, touch: "first", breakdown: "campaign" });
  await page.goto(`/admin/marketing/dashboard?${scope}`);
  const title = page.getByRole("heading", { name: "Marketing dashboard" });
  await chooseBranchIfPrompted(page, title);
  await expect(title).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Property" })).toContainText(property.name);
  const dates = page.getByRole("button", { name: /^Dates:/ });
  await expect(dates).toContainText(formatRange(from, to));
  await expect(page.getByRole("radio", { name: /^Finance/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Attribution · First touch" })).toBeVisible();

  await page.reload();
  await expect(dates).toContainText(formatRange(from, to));
  await expect(page.getByRole("combobox", { name: "Property" })).toContainText(property.name);
  await page.getByRole("radio", { name: /^Marketing/ }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("basis") === "cohort" && url.searchParams.get("breakdown") === "campaign");
  await expect(dates).toContainText(formatRange(from, to));
  await page.goBack();
  await expect(page.getByRole("radio", { name: /^Finance/ })).toBeChecked();
  await page.goForward();
  await expect(page.getByRole("radio", { name: /^Marketing/ })).toBeChecked();

  await page.goto("/admin/marketing/dashboard?from=bad&to=invalid");
  await expect(dates).toContainText("Last 30 days");
});
