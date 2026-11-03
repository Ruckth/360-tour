import { expect, test } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";
import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

for (const [prefix, messages] of [
  ["", en],
  ["/th", th],
] as const) {
  test(`@smoke service catalog search preserves category and language (${prefix || "en"})`, async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_MODE === "integration",
      "This assertion requires the disconnected demo backend",
    );
    await page.goto(`${prefix}/services?category=Spa%20%26%20Wellness`);
    await expect(
      page.getByRole("heading", {
        name: messages.ServiceCatalog.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      messages.ServiceCatalog.unavailable,
    );
    await page
      .getByRole("textbox", {
        name: messages.ServiceCatalog.search,
        exact: true,
      })
      .fill("Massage");
    await page
      .getByRole("button", {
        name: messages.ServiceCatalog.search,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${prefix}/services\\?category=Spa.*q=Massage`),
    );
    await expect(
      page.getByRole("textbox", {
        name: messages.ServiceCatalog.search,
        exact: true,
      }),
    ).toHaveValue("Massage");
    await page
      .getByRole("link", { name: messages.ServiceCatalog.all, exact: true })
      .click();
    await expect(page).toHaveURL(`${prefix}/services?q=Massage`);
    await expect(page.locator("article")).toHaveCount(0);
  });
}
