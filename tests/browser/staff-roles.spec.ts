import { expect, test, type Page } from "@playwright/test";

/* Staff roles on the fixture checkout, Settings › Team and navigation (staff-roles-fixture.tsx). */
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const orderPanel = (page: Page) => page.getByRole("complementary", { name: "Order", exact: true });

test.describe("cashier checkout", () => {
  test.use({ viewport: { width: 1360, height: 950 } });

  test("an over-limit discount becomes Ask manager, then waits and blocks payment", async ({ page }) => {
    await open(page, "?role=cashier&scenario=spa");
    await expect(page.getByTestId("cashier-badge")).toHaveText("Cashier");
    const order = orderPanel(page);
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();

    // The limit explained behind the ⓘ, on tap.
    await order.getByRole("button", { name: "About the discount limit" }).click();
    await expect(page.getByRole("tooltip")).toHaveText("Up to 10% without a manager. Coupons don't count.");
    await page.keyboard.press("Escape");

    const discount = order.getByRole("textbox", { name: "Discount" });
    // Exactly 10% of ฿1,200 is allowed; one satang more needs a manager.
    await discount.fill("120");
    await expect(order.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
    await discount.fill("120.01");
    await expect(order.getByTestId("discount-limit-hint")).toHaveText("฿120.01 is over your 10% limit.");
    await order.getByRole("radio", { name: "%" }).click();
    await discount.fill("10");
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
    await discount.fill("15");
    await expect(order.getByTestId("discount-limit-hint")).toHaveText("฿180 is over your 10% limit.");

    await order.getByRole("button", { name: "Ask manager", exact: true }).click();
    const form = order.getByRole("group", { name: "Ask a manager · ฿180 discount" });
    await expect(form.getByRole("button", { name: "Send request" })).toBeDisabled();
    await form.getByRole("textbox", { name: "Reason" }).fill("Guest waited 40 minutes");
    await form.getByRole("button", { name: "Send request" }).click();

    await expect(order.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager · ฿180 discount");
    await expect(order.getByTestId("waiting-for-approval")).toBeDisabled();
    await expect(order.getByRole("button", { name: "Cash", exact: true })).toHaveCount(0);
    // Nothing changed on the order before approval.
    await expect(order.getByTestId("order-due")).toHaveText("฿1,200");

    await order.locator('[data-approval-status="pending"]').getByRole("button", { name: "Cancel" }).click();
    await expect(order.locator('[data-approval-status="cancelled"]')).toHaveText("Request cancelled.");
    await expect(order.getByRole("button", { name: "Cash", exact: true })).toBeEnabled();
  });

  test("a discount already on the line is not treated as a new over-limit request", async ({ page }) => {
    await open(page, "?role=cashier&scenario=discounted&serverLimit=100");
    const order = orderPanel(page);
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();
    await expect(order.getByRole("textbox", { name: "Discount" })).toHaveValue("15");
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
    await expect(order.getByRole("button", { name: "Ask manager", exact: true })).toHaveCount(0);
    // Changing it is a new request again.
    await order.getByRole("textbox", { name: "Discount" }).fill("16");
    await expect(order.getByTestId("discount-limit-hint")).toHaveText("฿192 is over your 10% limit.");
  });

  test("the server's NEEDS_APPROVAL opens the same request form", async ({ page }) => {
    // The UI thinks 10%; the server enforces 5%.
    await open(page, "?role=cashier&scenario=spa&serverLimit=5");
    const order = orderPanel(page);
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();
    await order.getByRole("textbox", { name: "Discount" }).fill("80");
    await order.getByRole("button", { name: "Apply", exact: true }).click();
    const form = order.getByRole("group", { name: "Ask a manager · ฿80 discount" });
    await expect(form).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("cashiers open orders by number and see no order list, profiles or archive", async ({ page }) => {
    await open(page, "?role=cashier&scenario=spa");
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Paid" })).toHaveCount(0);
    await dialog.getByRole("textbox", { name: "Order number" }).fill("999");
    await dialog.getByRole("button", { name: "Open" }).click();
    await expect(dialog.getByText("Not available.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Order number" }).fill("1042");
    await dialog.getByRole("button", { name: "Open" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(orderPanel(page).getByTestId("order-panel-title")).toHaveText("Order #1042");

    await page.getByRole("button", { name: /^Customer: Somchai/ }).click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("button", { name: "View / edit" })).toHaveCount(0);
    await expect(picker.getByRole("button", { name: "Show archived customers" })).toHaveCount(0);
  });

  test("a cashier's void of a paid sale is sent as a request", async ({ page }) => {
    await open(page, "?role=cashier&scenario=paid");
    await page.getByRole("button", { name: "Void…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText(/^Ask a manager to void R-/);
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Charged the wrong guest");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator('[data-approval-status="pending"]')).toContainText("Waiting for a manager · void");
    await expect(page.getByRole("button", { name: "Link appointment" })).toHaveCount(0);
  });
});

test.describe("manager approvals", () => {
  test.use({ viewport: { width: 1360, height: 950 } });

  test("the approvals panel approves one request and declines another", async ({ page }) => {
    await open(page, "?role=manager&scenario=pending");
    await page.getByTestId("approvals-button").click();
    const panel = page.getByRole("dialog", { name: "Approvals" });
    const requests = panel.getByTestId("approval-request");
    await expect(requests).toHaveCount(2);

    const first = requests.filter({ hasText: "Guest waited 40 minutes" });
    await expect(first).toContainText("Mint asks for a ฿180 discount (15%)");
    await expect(first).toContainText("“Guest waited 40 minutes”");
    await expect(first).toContainText("Order #1043 · Total ฿1,200 → ฿1,020");
    await expect(first).toContainText("Expires in 5 min");
    await first.getByRole("button", { name: "About approvals" }).click();
    await expect(page.getByRole("tooltip")).toHaveText("Works once, for this order as it is now.");
    await page.keyboard.press("Escape");
    await first.getByRole("button", { name: "Approve" }).click();
    await expect(panel.getByRole("status").first()).toHaveText("Approved · Order #1043");
    await expect(requests).toHaveCount(1);

    const second = requests.filter({ hasText: "Regular guest" });
    await expect(second).toContainText("Mint asks for a ฿100 discount");
    await second.getByRole("button", { name: "Decline" }).click();
    await expect(panel.getByRole("status").first()).toHaveText("Declined · Order #1044");
    await expect(panel.getByText("No requests waiting.")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("approvals-button")).toHaveCount(0);
    // The approved discount is on the order; owners and managers get no limit hint.
    const order = orderPanel(page);
    await expect(order.getByTestId("order-due")).toHaveText("฿1,020");
    await expect(order.locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();
    await order.getByRole("textbox", { name: "Discount" }).fill("50");
    await expect(order.getByRole("button", { name: "About the discount limit" })).toHaveCount(0);
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
  });
});

test.describe("Settings › Team", () => {
  test.use({ viewport: { width: 1280, height: 950 } });

  test("an owner invites, changes a role and saves the cashier rules", async ({ page }) => {
    await open(page, "?view=settings&tab=team");
    const people = page.getByRole("region", { name: "People" });
    await expect(people.getByTestId("team-person").filter({ hasText: "narin@" })).toContainText("Owner");
    await expect(people.getByTestId("team-person").filter({ hasText: "sun@" })).toContainText("Marketing · Marketer");
    await expect(people.getByRole("link", { name: "Manage" }).first()).toHaveAttribute("href", "/admin/marketing/access");

    await people.getByRole("button", { name: "Invite" }).click();
    await people.getByRole("textbox", { name: "Email" }).fill("Fon@AuralisCove.co");
    await people.getByRole("combobox", { name: "Role", exact: true }).selectOption("manager");
    await people.getByRole("button", { name: "Send invite" }).click();
    await expect(people.getByRole("status")).toContainText("Invited fon@auraliscove.co");
    const fon = people.getByTestId("team-person").filter({ hasText: "fon@auraliscove.co" });
    await expect(fon).toContainText(/Invited · expires/);
    await expect(fon.getByRole("combobox")).toHaveValue("manager");

    await people.getByRole("combobox", { name: "Role for mint@auraliscove.co" }).selectOption("manager");
    await expect(people.getByRole("status")).toHaveText("mint@auraliscove.co is now Manager.");
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({ email: "mint@auraliscove.co", role: "manager" });

    const rules = page.getByRole("form", { name: "Cashier rules" });
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("100.001");
    await expect(rules.getByText("Use 0–100, up to two decimals.")).toBeVisible();
    await expect(rules.getByRole("button", { name: "Save rules" })).toBeDisabled();
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("12.5");
    await rules.getByRole("combobox", { name: "Void a paid sale" }).selectOption("cashier");
    await rules.getByRole("button", { name: "Save rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved");
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({
      expectedRevision: 0, discountLimitPercent: 1250, voidPaidSale: "cashier", customPrice: "manager", paymentFix: "manager", refund: "manager",
    });
  });

  test("refunds come first in the cashier rules, default to Manager approves, and save", async ({ page }) => {
    await open(page, "?view=settings&tab=team");
    const rules = page.getByRole("form", { name: "Cashier rules" });
    await expect(rules.getByRole("combobox")).toHaveCount(4);
    await expect(rules.locator("label")).toHaveText(["Discount without approval", "Refunds", "Void a paid sale", "Custom price", "Fix a payment"]);
    const refunds = rules.getByRole("combobox", { name: "Refunds" });
    await expect(refunds).toHaveValue("manager");
    await expect(refunds.locator("option")).toHaveText(["Manager approves", "Cashier can"]);
    await refunds.selectOption("cashier");
    await rules.getByRole("button", { name: "Save rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved");
    await expect(refunds).toHaveValue("cashier");
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toMatchObject({ expectedRevision: 0, refund: "cashier" });
  });

  test("a rules conflict reloads the latest rules", async ({ page }) => {
    await open(page, "?view=settings&tab=team&stale=1");
    const rules = page.getByRole("form", { name: "Cashier rules" });
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("20");
    await rules.getByRole("button", { name: "Save rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Rules changed on another device. Reloaded.");
    await expect(rules.getByRole("textbox", { name: "Discount without approval" })).toHaveValue("12");
  });

  test("managers don't see Team and read settings without saving", async ({ page }) => {
    await open(page, "?view=settings&role=manager&tab=team");
    const tabs = page.getByRole("tablist", { name: "Settings sections" });
    await expect(tabs.getByRole("tab")).toHaveText(["Business", "Booking rules", "AI assistant", "Email", "Channels"]);
    await expect(page.getByRole("region", { name: "People" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
    await expect(page.getByLabel(/^Business name/)).toBeDisabled();
    await page.getByRole("button", { name: "Why read only" }).click();
    await expect(page.getByRole("tooltip")).toHaveText("Only owners can change settings.");
  });
});

test.describe("navigation by role", () => {
  test("a cashier's sidebar, rail and tab bar show only Checkout", async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, "?view=nav&role=cashier");
    const sidebar = page.locator('[data-sidebar="sidebar"]').getByRole("navigation", { name: "Admin sections" });
    await expect(sidebar.getByRole("link")).toHaveText(["Checkout"]);
    await page.getByRole("searchbox", { name: "Search admin pages" }).fill("settings");
    await expect(page.getByText("No pages match “settings”.")).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 900 });
    const rail = page.locator("nav.xl\\:hidden:not(.md\\:hidden)");
    await expect(rail.getByRole("link")).toHaveText(["Checkout"]);

    await page.setViewportSize({ width: 390, height: 844 });
    const tabBar = page.locator("nav.md\\:hidden");
    await expect(tabBar.locator("a, button")).toHaveText(["Checkout", "Search", "Menu"]);
  });

  test("a manager sees every section but Team, with the approvals badge on Checkout", async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, "?view=nav&role=manager&pending=2&path=/admin/settings");
    const sidebar = page.locator('[data-sidebar="sidebar"]').getByRole("navigation", { name: "Admin sections" });
    await expect(sidebar.getByRole("link", { name: /^Checkout/ })).toHaveText("Checkout2 approvals waiting");
    await expect(sidebar.getByRole("link", { name: "Business", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Marketing" })).toHaveCount(0);
  });
});
