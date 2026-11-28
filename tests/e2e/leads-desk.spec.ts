import { api } from "../../convex/_generated/api";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { localBackend, signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("a phone lead search exposes the same row for export and cancelling deletion keeps it", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `guest-${crypto.randomUUID()}@example.test`;
  await localBackend().mutation(api.messaging.leads.save, { email, source: "chat" });
  await signedInBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/leads");
  const input = page.getByRole("textbox", { name: "Email address" });
  await chooseBranchIfPrompted(page, input);
  await input.fill(email);
  await input.press("Enter");
  const cards = page.getByRole("list", { name: "Leads" });
  const actions = cards.getByRole("button", { name: `Actions for lead ${email}` });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(cards.getByRole("link", { name: email })).toBeVisible();
    await expect(actions).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await actions.click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  const confirmation = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Delete this lead permanently?" }));
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(cards.getByRole("listitem")).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The CSV download must be readable");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const rows = Buffer.concat(chunks).toString("utf8").trim().split(/\r?\n/);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toContain(email);
});
