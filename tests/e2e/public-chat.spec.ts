import { expect, test } from "@playwright/test";

test("home page opens chat, shows fallback replies, and exposes contact capture", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Seaview Residence").first()).toBeVisible();
  await page.getByRole("button", { name: "Open concierge chat" }).click();

  await expect(page.getByText("Seaview concierge")).toBeVisible();
  await expect(page.getByText("Share contact details")).toBeVisible();

  await page.getByRole("button", { name: /Which villa is best for a couple/i }).click();
  await expect(page.getByText(/The Garden Suite is the quietest couples/i)).toBeVisible();

  await page.getByPlaceholder("Ask a question").fill("Do you have airport pickup?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Do you have airport pickup?")).toBeVisible();
  await expect(
    page.getByText(
      /live chat will connect once Convex is configured|Welcome to Seaview Residence|trouble connecting/i,
    ),
  ).toBeVisible();

  await page.getByText("Share contact details").click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Email").fill("visitor@example.com");
  await page.getByLabel("Phone").fill("+66 77 111 222");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});
