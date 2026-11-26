import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { chooseBranchIfPrompted } from "./backend";
import { expect, test, type Page } from "./fixtures";

test.skip(process.env.E2E_START_ADMIN_IDENTITY !== "1", "Requires the isolated Start integration entry");

const anonymousAdminPaths = [
  "/admin/chats", "/admin/checkout", "/admin/checkout/preview", "/admin/hotel", "/admin/leads",
  "/admin/marketing/access", "/admin/marketing/affiliates", "/admin/marketing/campaigns",
  "/admin/marketing/coupons/anonymous-placeholder", "/admin/marketing/coupons",
  "/admin/marketing/dashboard", "/admin/marketing/links", "/admin/properties/anonymous-placeholder",
  "/admin/properties", "/admin/questions", "/admin/receipt/anonymous-placeholder",
  "/admin/settings", "/admin/staff/calendar",
] as const;

test("anonymous admin documents omit commerce messages and preserve route status", async ({ request }) => {
  test.setTimeout(90_000);
  for (const path of anonymousAdminPaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    // The isolated production-mode server does not enable the checkout design fixture.
    expect(response.status(), path).toBe(path === "/admin/checkout/preview" ? 404 : 200);
    expect(response.headers()["cache-control"], path).toContain("no-store");
    const html = await response.text();
    expect(html, path).not.toContain("Money taken · sale not saved");
    expect(html, path).not.toContain("Owners and managers can sell these, for a rehearsal at the desk.");
  }
});

async function openSignInGate(page: Page, path: string) {
  await setupClerkTestingToken({ page });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === path);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === path);
}

test("the same checkout pathname loads commerce on modal sign-in and clears it on sign-out", async ({ page }) => {
  test.setTimeout(90_000);
  try {
    await openSignInGate(page, "/admin/checkout");
    const [commerce] = await Promise.all([
      page.waitForResponse(async (response) =>
        new URL(response.url()).pathname.startsWith("/_serverFn") &&
        (await response.text().catch(() => "")).includes("Money taken · sale not saved"),
      ),
      clerk.signIn({ page, emailAddress: process.env.E2E_CASHIER_EMAIL! }),
    ]);
    expect(commerce.headers()["cache-control"]).toBe("private, no-store");
    await expect(page).toHaveURL((url) => url.pathname === "/admin/checkout");
    const order = page.getByRole("complementary", { name: "Order", exact: true });
    await chooseBranchIfPrompted(page, order);
    await expect(order).toBeVisible();
    await expect(page.getByRole("tab", { name: "Frequent", exact: true })).toBeVisible();
    // Clerk's programmatic fixture sets the session without completing the modal's UI.
    await page.evaluate(() => window.Clerk?.closeSignIn());
    await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Frequent", exact: true })).toHaveCount(0);
  } finally {
    await clerk.signOut({ page }).catch(() => undefined);
  }
});

test("legacy Marketing access redirects to Settings Team after the signed-out gate admits an owner", async ({ page }) => {
  test.setTimeout(90_000);
  try {
    await openSignInGate(page, "/admin/marketing/access");
    await clerk.signIn({ page, emailAddress: process.env.E2E_OWNER_EMAIL! });
    await expect(page).toHaveURL((url) => url.pathname === "/admin/settings" && url.searchParams.get("tab") === "team");
    const invite = page.getByRole("button", { name: "Invite", exact: true });
    await chooseBranchIfPrompted(page, invite);
    await expect(invite).toBeVisible();
  } finally {
    await clerk.signOut({ page }).catch(() => undefined);
  }
});
