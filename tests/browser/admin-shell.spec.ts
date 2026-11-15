import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";

/*
 * P1 · Shell and approvals, on the real admin frame (admin-shell-fixture.tsx). Taps are counted the
 * following the admin UX conventions (docs/guides/admin-ux.md):
 *   approve from Chats   before: 3 taps + a page change (Checkout, N approvals, Approve) → 2, same page
 *   Checkout on a phone  before: 2 taps (Menu, Checkout) → 1
 */
const IPAD = { width: 1180, height: 820 };
const PHONE = { width: 390, height: 844 };
const DRAFT = "Yes, 10:00 tomorrow works. Shall I book it?";

async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/admin-shell.html${query}`);
  await page.locator("header h1").waitFor();
}

/** Counts taps like the audit: one per click. */
function tapper() {
  const counter = { taps: 0, tap: async (target: Locator) => { await target.click(); counter.taps += 1; } };
  return counter;
}

const approvalsButton = (page: Page) => page.locator("header").getByTestId("approvals-button");
const panel = (page: Page) => page.getByRole("dialog", { name: "Approvals" });
const sections = (page: Page) => page.getByRole("navigation", { name: "Admin sections" });

for (const [device, viewport] of [["iPad", IPAD], ["phone", PHONE]] as const) {
  test.describe(`manager on ${device}`, () => {
    test.use({ viewport });

    test("approves from Chats in 2 taps without leaving the page or losing the reply draft", async ({ page }) => {
      await open(page, "?role=manager&path=/admin/chats&pending=1");
      await expect(page.locator("header h1")).toHaveText("Chats");
      // The nav badge is gone; the count sits on Approvals.
      await expect(page.locator("nav [data-approval-count], [data-sidebar] [data-approval-count]")).toHaveCount(0);
      await expect(approvalsButton(page)).toHaveText("Approvals1 waiting");
      const reply = page.getByRole("textbox", { name: "Type an admin reply" });
      await reply.fill(DRAFT);

      const count = tapper();
      await count.tap(approvalsButton(page));
      await expect(panel(page).getByTestId("approval-request")).toContainText("Mint asks for a ฿180 discount (15%)");
      await expectAtMostSentences(panel(page), 1);
      await count.tap(panel(page).getByRole("button", { name: "Approve" }));

      // The last decision closes the panel and says what happened.
      await expect(panel(page)).toHaveCount(0);
      await expect(page.getByTestId("toast")).toHaveText("Approved 15% discount on #1043");
      expect(count.taps).toBe(2);
      // Same page: no navigation, and the draft is still there.
      expect(await page.locator("body").getAttribute("data-navigation")).toBeNull();
      await expect(page.locator("header h1")).toHaveText("Chats");
      await expect(reply).toHaveValue(DRAFT);
      await expect(approvalsButton(page)).toHaveText("Approvals");
    });

    test("the approvals panel keeps to one sentence and stays open while others wait", async ({ page }) => {
      await open(page, "?role=manager&path=/admin/chats&pending=2");
      await approvalsButton(page).click();
      const requests = panel(page).getByTestId("approval-request");
      await expect(requests).toHaveCount(2);
      await expectAtMostSentences(panel(page), 1);
      await requests.filter({ hasText: "Guest waited 40 minutes" }).getByRole("button", { name: "Decline" }).click();
      await expect(panel(page).getByRole("status").first()).toHaveText("Declined 15% discount on #1043");
      await expect(requests).toHaveCount(1);
      await expectAtMostSentences(panel(page), 1);
      await requests.getByRole("button", { name: "Approve" }).click();
      await expect(panel(page)).toHaveCount(0);
      await expect(page.getByTestId("toast")).toHaveText("Approved ฿100 discount on #1044");
    });
  });
}

test.describe("manager on a phone", () => {
  test.use({ viewport: PHONE });

  test("opens Checkout from any page in 1 tap: Checkout replaces Search on the tab bar", async ({ page }) => {
    await open(page, "?role=manager&path=/admin/chats&pending=0");
    const tabBar = sections(page);
    await expect(tabBar.locator("a, button")).toHaveText(["Chats", "Hotel (Hotel bookings)", "Spa (Staff bookings)", "Checkout", "Menu"]);
    const count = tapper();
    await count.tap(tabBar.getByRole("link", { name: "Checkout" }));
    await expect(page).toHaveURL(/\/admin\/checkout$/);
    expect(count.taps).toBe(1);
  });

  test("the order sheet leaves Approvals usable: approve over an open order in 2 taps", async ({ page }) => {
    await open(page, "?role=manager&path=/admin/checkout&pending=1");
    await page.getByRole("button", { name: /^View order/ }).click();
    const sheet = page.getByRole("dialog", { name: "Order #1043" });
    await expect(sheet).toBeVisible();

    // The button is on screen and nothing sits on top of it.
    const button = approvalsButton(page);
    await expect(button).toBeInViewport();
    const box = (await button.boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid='approvals-button']") !== null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(onTop).toBe(true);

    const count = tapper();
    await count.tap(button);
    await count.tap(panel(page).getByRole("button", { name: "Approve" }));
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId("toast")).toHaveText("Approved 15% discount on #1043");
    expect(count.taps).toBe(2);
    // The order stayed open, with the discount applied.
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-approval-status="applied"]')).toHaveText("Approved by Ploy");
    await expect(sheet.getByTestId("order-due")).toHaveText("฿1,020");
  });
});

for (const [device, viewport] of [["iPad", IPAD], ["phone", PHONE]] as const) {
  test.describe(`cashier on ${device}`, () => {
    test.use({ viewport });

    test("gets the till alone with Sign out in the account menu on phone", async ({ page }) => {
      await open(page, "?role=cashier&path=/admin/checkout");
      const header = page.locator("header");
      await expect(header.locator("h1")).toHaveText("Checkout");
      await expect(sections(page)).toHaveCount(0);
      await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0);
      await expect(page.getByTestId("approvals-button")).toHaveCount(0);
      await expect(header.getByTestId("cashier-badge")).toHaveText("Cashier");
      if (device === "phone") {
        await expect(header.getByRole("button", { name: "Sign out" })).toBeHidden();
        await header.getByRole("button", { name: "Account menu", exact: true }).click();
        await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      } else await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(page.getByText("Concierge operations")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Thai massage 60" }).first()).toBeVisible();
    });
  });
}
