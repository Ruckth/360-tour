import { expect, test, type Page } from "@playwright/test";

/* Staff roles on the fixture checkout, Settings › Team and navigation (staff-roles-fixture.tsx). */
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/staff-roles.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}
const orderPanel = (page: Page) => page.getByRole("complementary", { name: "Order", exact: true });

test.describe("cashier checkout", () => {
  test.use({ viewport: { width: 1360, height: 950 } });

  test("an over-limit discount asks a manager in place, then waits and blocks payment", async ({ page }) => {
    await open(page, "?role=cashier&scenario=spa");
    await expect(page.getByTestId("cashier-badge")).toHaveText("Cashier");
    const order = orderPanel(page);
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();

    // The limit explained behind the ⓘ, on tap.
    await order.getByRole("button", { name: "About the discount limit" }).click();
    await expect(page.getByRole("tooltip")).toHaveText("Up to 10% without a manager. Coupons don't count.");
    await page.keyboard.press("Escape");

    const discount = order.getByRole("textbox", { name: "Discount" });
    const echo = order.getByTestId("discount-echo");
    const ask = order.getByRole("group", { name: "Ask a manager" });
    // Exactly 10% of ฿1,200 is allowed; one satang more needs a manager.
    await discount.fill("120");
    await expect(echo).toHaveText("฿120 = 10%");
    await expect(order.getByRole("button", { name: "Apply ฿120 (10%)" })).toBeEnabled();
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
    await expect(ask).toHaveCount(0);
    await discount.fill("120.01");
    await expect(echo).toHaveText("฿120.01 = 10% · Over your 10% limit");
    await expect(ask.getByRole("button", { name: "Send ฿120.01 (10%) to manager" })).toBeVisible();
    await discount.fill("10%");
    await expect(echo).toHaveText("10% = ฿120");
    await expect(ask).toHaveCount(0);
    await discount.fill("15%%");
    await expect(echo).toHaveText("Type 15% or 150");
    await expect(order.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
    await discount.fill("15 %");
    await expect(echo).toHaveText("15% = ฿180 · Over your 10% limit");

    // The reason is required; a chip fills it and stays editable.
    const send = ask.getByRole("button", { name: "Send 15% (฿180) to manager" });
    await expect(send).toBeDisabled();
    await ask.getByRole("button", { name: "Guest complaint" }).click();
    await ask.getByRole("textbox", { name: "Reason" }).fill("Guest waited 40 minutes");
    await send.click();

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
    await expect(order.getByRole("textbox", { name: "Discount" })).toHaveValue("15%");
    await expect(order.getByTestId("discount-limit-hint")).toHaveCount(0);
    await expect(order.getByRole("group", { name: "Ask a manager" })).toHaveCount(0);
    // Changing it is a new request again.
    await order.getByRole("textbox", { name: "Discount" }).fill("16%");
    await expect(order.getByTestId("discount-echo")).toHaveText("16% = ฿192 · Over your 10% limit");
  });

  test("the server's NEEDS_APPROVAL opens the same request in place", async ({ page }) => {
    // The UI thinks 10%; the server enforces 5%.
    await open(page, "?role=cashier&scenario=spa&serverLimit=5");
    const order = orderPanel(page);
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();
    await order.getByRole("textbox", { name: "Discount" }).fill("80");
    await order.getByRole("button", { name: "Apply ฿80 (6.67%)" }).click();
    const ask = order.getByRole("group", { name: "Ask a manager" });
    await expect(ask.getByRole("button", { name: "Send ฿80 (6.67%) to manager" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("cashiers reopen open orders from a list, today's receipts by number, and see no profiles or archive", async ({ page }) => {
    await open(page, "?role=cashier&scenario=spa");
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Paid" })).toHaveCount(0);
    await expect(dialog.getByRole("list", { name: "Open orders" }).getByRole("button")).toHaveCount(2);
    await dialog.getByRole("textbox", { name: "Go to order #" }).fill("999");
    await dialog.getByRole("button", { name: "Go", exact: true }).click();
    await expect(dialog.getByText("Not available.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Go to order #" }).fill("1042");
    await dialog.getByRole("button", { name: "Go", exact: true }).click();
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
    // Another request waits, so the panel stays open with the result.
    await expect(panel.getByRole("status").first()).toHaveText("Approved 15% discount on #1043");
    await expect(requests).toHaveCount(1);

    const second = requests.filter({ hasText: "Regular guest" });
    await expect(second).toContainText("Mint asks for a ฿100 discount");
    await second.getByRole("button", { name: "Decline" }).click();
    // The last decision closes the panel and says what happened.
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("toast")).toHaveText("Declined ฿100 discount on #1044");
    await expect(page.getByTestId("approvals-button")).toHaveText("Approvals");
    await expect(page.getByTestId("approvals-button")).toBeFocused();
    // The approved discount is on the order; owners and managers get no limit hint.
    const order = orderPanel(page);
    await expect(order.getByTestId("order-due")).toHaveText("฿1,020");
    await expect(order.locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
    await order.getByRole("button", { name: /^Thai massage 60/ }).click();
    await order.getByRole("textbox", { name: "Discount" }).fill("50");
    await expect(order.getByRole("button", { name: "Apply ฿50 (4.17%)" })).toBeEnabled();
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
    await expect(people.getByRole("combobox", { name: "Marketing role for sun@auraliscove.co" })).toHaveValue("marketer");
    await expect(people.getByRole("link")).toHaveCount(0);
    const lek = people.getByTestId("team-person").filter({ hasText: "lek@" });
    await expect(lek.getByRole("button")).toHaveCount(1);
    await lek.getByRole("button", { name: "More for lek@auraliscove.co" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Copy sign-in link", "Renew invite"]);
    await page.keyboard.press("Escape");

    await people.getByRole("button", { name: "Invite" }).click();
    await people.getByRole("textbox", { name: "Email" }).fill("Fon@AuralisCove.co");
    await people.getByRole("combobox", { name: "Desk", exact: true }).selectOption("manager");
    await people.getByRole("button", { name: "Send invite" }).click();
    await expect(people.getByRole("status")).toContainText("Invited fon@auraliscove.co");
    const fon = people.getByTestId("team-person").filter({ hasText: "fon@auraliscove.co" });
    await expect(fon).toContainText(/Invited · expires/);
    await expect(fon.getByRole("combobox", { name: /^Desk role/ })).toHaveValue("manager");

    await people.getByRole("combobox", { name: "Desk role for mint@auraliscove.co" }).selectOption("manager");
    await expect(people.getByRole("status")).toHaveText("mint@auraliscove.co is now Manager.");
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({ email: "mint@auraliscove.co", role: "manager" });

    const rules = page.getByRole("form", { name: "Rules for all cashiers" });
    const save = rules.getByRole("button", { name: "Save rules" });
    await expect(save).toBeDisabled();
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("100.001");
    await expect(rules.getByText("Use 0–100, up to two decimals.")).toBeVisible();
    await expect(save).toBeDisabled();
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("12.5");
    await rules.getByRole("switch", { name: "Void a paid sale needs manager" }).click();
    await save.click();
    await expect(rules.getByRole("status")).toHaveText("Saved");
    await expect(save).toBeDisabled();
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toEqual({
      expectedRevision: 0, discountLimitPercent: 12.5, voidPaidSale: "cashier", customPrice: "manager", paymentFix: "manager", refund: "manager",
    });
  });

  test("cashier rules are Needs manager switches, refunds first and on by default", async ({ page }) => {
    await open(page, "?view=settings&tab=team");
    const rules = page.getByRole("form", { name: "Rules for all cashiers" });
    await expect(rules.getByRole("combobox")).toHaveCount(0);
    await expect(rules.locator("label")).toHaveText(["Discount without approval", "Refunds", "Void a paid sale", "Custom price", "Fix a payment"]);
    const switches = rules.getByRole("switch");
    await expect(switches).toHaveCount(4);
    for (const one of await switches.all()) await expect(one).toHaveAttribute("aria-checked", "true");
    const refunds = rules.getByRole("switch", { name: "Refunds needs manager" });
    await refunds.click();
    await expect(refunds).toHaveAttribute("aria-checked", "false");
    // Switching back is no change, so Save turns off again.
    await refunds.click();
    await expect(rules.getByRole("button", { name: "Save rules" })).toBeDisabled();
    await refunds.click();
    await rules.getByRole("button", { name: "Save rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Saved");
    await expect(refunds).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse((await page.locator("body").getAttribute("data-submission"))!)).toMatchObject({ expectedRevision: 0, refund: "cashier" });
  });

  test("a rules conflict reloads the latest rules", async ({ page }) => {
    await open(page, "?view=settings&tab=team&stale=1");
    const rules = page.getByRole("form", { name: "Rules for all cashiers" });
    await rules.getByRole("textbox", { name: "Discount without approval" }).fill("20");
    await rules.getByRole("button", { name: "Save rules" }).click();
    await expect(rules.getByRole("status")).toHaveText("Rules changed on another device. Reloaded.");
    await expect(rules.getByRole("textbox", { name: "Discount without approval" })).toHaveValue("12");
  });

  test("managers don't see Team, get a read-only banner and read settings without saving", async ({ page }) => {
    await open(page, "?view=settings&role=manager&tab=team");
    const tabs = page.getByRole("tablist", { name: "Settings sections" });
    await expect(tabs.getByRole("tab")).toHaveText(["Business", "Booking rules", "AI assistant", "Email", "Channels"]);
    await expect(page.getByRole("region", { name: "People" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
    await expect(page.getByLabel(/^Business name/)).toBeDisabled();
    const banner = page.getByTestId("read-only-banner");
    await expect(banner).toHaveText("Read only. Only owners can change settings.");
    // The banner is the first thing on the page.
    const top = await banner.boundingBox();
    const tabsTop = await tabs.boundingBox();
    expect(top!.y).toBeLessThan(tabsTop!.y);
  });
});

test.describe("navigation by role", () => {
  test("a cashier's sidebar and rail show only Checkout", async ({ page }) => {
    // The shell shows a cashier no navigation at all (admin-shell.spec.ts); the lists still filter.
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, "?view=nav&role=cashier");
    const sidebar = page.locator('[data-sidebar="sidebar"]').getByRole("navigation", { name: "Admin sections" });
    await expect(sidebar.getByRole("link")).toHaveText(["Checkout"]);
    await page.getByRole("searchbox", { name: "Search admin pages" }).fill("settings");
    await expect(page.getByText("No pages match “settings”.")).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 900 });
    const rail = page.locator("nav.xl\\:hidden:not(.md\\:hidden)");
    await expect(rail.getByRole("link")).toHaveText(["Checkout"]);
  });

  test("a manager sees every section but Team, with no approvals badge, and Checkout on the phone tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, "?view=nav&role=manager&path=/admin/settings");
    const sidebar = page.locator('[data-sidebar="sidebar"]').getByRole("navigation", { name: "Admin sections" });
    await expect(sidebar.getByRole("link", { name: "Checkout", exact: true })).toHaveText("Checkout");
    await expect(page.locator("[data-approval-count]")).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Business", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Marketing" })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const tabBar = page.locator("nav.md\\:hidden");
    await expect(tabBar.locator("a, button")).toHaveText(["Chats", "Hotel (Hotel bookings)", "Spa (Staff bookings)", "Checkout", "Menu"]);
  });
});
