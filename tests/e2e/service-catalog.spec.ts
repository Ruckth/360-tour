import { expect, test } from "./fixtures";
import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };


for (const [prefix, messages] of [
  ["", en],
  ["/th", th],
] as const) {
  test(`@smoke service catalog search preserves category and language (${prefix || "en"})`, async ({
    page,
  }) => {
    await page.goto(`${prefix}/services?category=Wellness`);
    await expect(
      page.getByRole("heading", {
        name: messages.ServiceCatalog.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();
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
      new RegExp(`${prefix}/services\\?category=Wellness.*q=Massage`),
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
    await expect(page.locator("article")).toHaveCount(2);
  });
}
