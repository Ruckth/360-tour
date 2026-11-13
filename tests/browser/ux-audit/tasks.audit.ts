import { expect, test, type Locator, type Page } from "@playwright/test";
import { Recorder, VIEWPORTS, type ViewportName } from "./measure";

/*
 * The measured click audit: each top task driven on the offline fixtures at iPad landscape and
 * phone size. Results go to docs/reviews/ux-audit/results/*.json, screenshots to .../screens/.
 *   pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts tasks
 */

const STAFF = "/tests/browser/staff-roles.html";
const CHECKOUT = "/tests/browser/checkout.html";

async function open(page: Page, url: string) {
  // Print opens the OS dialog; count the call instead.
  await page.addInitScript(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed += 1; }; });
  await page.goto(url);
  await page.locator("[data-fixture-ready]").first().waitFor();
  await page.waitForTimeout(400);
}

/** The order panel: the side panel on iPad, the bottom sheet on a phone (one tap to open). */
async function orderPanel(page: Page, rec: Recorder): Promise<Locator> {
  if (rec.viewport === "ipad") return page.getByRole("complementary", { name: "Order", exact: true });
  const sheet = page.getByRole("dialog");
  if (await sheet.isVisible()) return sheet;
  await rec.tap(page.getByRole("button", { name: /open the order/ }), "Open the order sheet");
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  return sheet;
}

const tile = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^(\\d+ on the order )?${name}.*Add to order`) });
const receipt = (page: Page) => page.getByRole("article", { name: "Receipt" });

async function payCash(page: Page, rec: Recorder, panel: Locator) {
  await rec.tap(panel.getByRole("button", { name: "Cash", exact: true }), "Cash", { decision: true });
  await rec.dump("cash-panel");
  await rec.shot("cash-panel");
  await rec.tap(panel.getByRole("button", { name: "Exact", exact: true }), "Exact");
  await rec.tap(panel.getByRole("button", { name: "Confirm cash", exact: true }), "Confirm cash");
  await expect(receipt(page)).toBeVisible();
}

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  test.describe(vp, () => {
    test.use({ viewport: VIEWPORTS[vp] });

    test("a-cash-sale", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier`);
      const rec = new Recorder(page, "a-cash-sale", vp);
      await rec.begin();
      await rec.dump("start");
      await rec.tap(tile(page, "Thai massage 60"), "Thai massage 60 tile", { decision: true });
      const panel = await orderPanel(page, rec);
      await rec.shot("order");
      await payCash(page, rec, panel);
      await rec.shot("receipt");
      await rec.measure("receipt");
      await rec.dump("receipt");
      rec.save();
    });

    test("b-two-services-coupon-card", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier`);
      const rec = new Recorder(page, "b-two-services-coupon-card", vp);
      await rec.begin();
      await rec.tap(tile(page, "Thai massage 60"), "Thai massage 60 tile", { decision: true });
      await rec.tap(tile(page, "Foot spa 45"), "Foot spa 45 tile", { decision: true });
      const panel = await orderPanel(page, rec);
      await rec.shot("two-lines");
      await rec.dump("two-lines");
      await rec.tap(panel.getByRole("button", { name: /^Add coupon/ }).first(), "Add coupon");
      await rec.type(panel.getByRole("textbox", { name: "Coupon code or offer link" }), "DCNT-SPA-500", "Coupon code");
      await rec.key(panel.getByRole("textbox", { name: "Coupon code or offer link" }), "Enter", "Enter to apply");
      await expect(panel.getByTestId("order-coupon")).toContainText("Saves ฿500");
      await rec.shot("coupon-applied");
      await rec.measure("coupon-applied");
      await rec.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card", { decision: true });
      await rec.dump("card-panel");
      await rec.shot("card-panel");
      await rec.tap(panel.getByRole("button", { name: /^Confirm .* received$/ }), "Confirm card received");
      await expect(receipt(page)).toBeVisible();
      await rec.shot("receipt");
      rec.save();
    });

    test("c-discount-over-limit-approval", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=spa`);
      const rec = new Recorder(page, "c-discount-over-limit-approval", vp);
      await rec.begin();
      const panel = await orderPanel(page, rec);
      await rec.tap(panel.getByRole("button", { name: /^Thai massage 60/ }), "Open the Thai massage row");
      await rec.shot("row-open");
      await rec.dump("row-open");
      await rec.measure("row-open");
      await rec.tap(panel.getByRole("radio", { name: "%" }), "% instead of ฿", { decision: true });
      await rec.type(panel.getByRole("textbox", { name: "Discount" }), "15", "Discount 15");
      await expect(panel.getByTestId("discount-limit-hint")).toBeVisible();
      await rec.shot("over-limit");
      await rec.tap(panel.getByRole("button", { name: "Ask manager", exact: true }), "Ask manager");
      const form = panel.getByRole("group", { name: /^Ask a manager/ });
      await rec.type(form.getByRole("textbox", { name: "Reason" }), "Guest waited 40 minutes", "Reason");
      await rec.tap(form.getByRole("button", { name: "Send request" }), "Send request");
      await expect(panel.locator('[data-approval-status="pending"]')).toBeVisible();
      await rec.shot("waiting");
      const cashierSteps = rec.steps.length;
      rec.note(`Cashier steps: ${cashierSteps}. Manager steps follow (same till, window.fixture.setRole).`);
      // The manager takes the till.
      await page.evaluate(() => window.fixture.setRole("manager"));
      if (vp === "phone") await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await rec.tap(page.getByTestId("approvals-button"), "Manager: Approvals");
      const approvals = page.getByRole("dialog", { name: "Approvals" });
      await rec.shot("approvals");
      await rec.dump("approvals");
      await rec.measure("approvals", '[role="dialog"]');
      await rec.tap(approvals.getByTestId("approval-request").getByRole("button", { name: "Approve" }), "Manager: Approve", { decision: true });
      await expect(approvals.getByRole("status").first()).toHaveText(/^Approved/);
      await rec.key(approvals, "Escape", "Manager: close Approvals");
      await rec.shot("approved");
      rec.note(`Manager steps: ${rec.steps.length - cashierSteps}.`);
      rec.save();
    });

    test("d-print-receipt", async ({ page }) => {
      // Straight after a cash sale: the receipt is on screen.
      await open(page, `${STAFF}?role=cashier&scenario=paid`);
      const rec = new Recorder(page, "d-print-receipt", vp);
      await rec.begin();
      await rec.tap(page.getByRole("button", { name: "Print", exact: true }), "Print", { decision: true });
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      rec.save();
    });

    test("e-refund-one-line-manager", async ({ page }) => {
      await open(page, `${STAFF}?role=manager&scenario=refund`);
      const rec = new Recorder(page, "e-refund-one-line-manager", vp);
      await rec.begin();
      await rec.tap(receipt(page).getByRole("button", { name: "Refund Foot spa 45" }), "Refund Foot spa 45", { decision: true });
      const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
      await rec.shot("form");
      await rec.dump("form");
      await rec.type(form.getByRole("textbox", { name: "Reason" }), "Not given", "Reason");
      await rec.tap(form.getByRole("button", { name: "Record refund" }), "Record refund");
      await expect(page.getByText("Refunded ฿600.")).toBeVisible();
      await rec.shot("done");
      rec.save();
    });

    test("e2-refund-one-line-cashier-asks", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=refund`);
      const rec = new Recorder(page, "e2-refund-one-line-cashier-asks", vp);
      await rec.begin();
      await rec.tap(receipt(page).getByRole("button", { name: "Refund Foot spa 45" }), "Refund Foot spa 45", { decision: true });
      const form = receipt(page).getByRole("form", { name: "Ask a manager", exact: true });
      await rec.type(form.getByRole("textbox", { name: "Reason" }), "Not given", "Reason");
      await rec.tap(form.getByRole("button", { name: "Send request" }), "Send request");
      await expect(page.locator('[data-approval-status="pending"]')).toBeVisible();
      await rec.shot("waiting");
      const cashierSteps = rec.steps.length;
      await page.evaluate(() => window.fixture.setRole("manager"));
      await page.waitForTimeout(300);
      await rec.tap(page.getByTestId("approvals-button"), "Manager: Approvals");
      const approvals = page.getByRole("dialog", { name: "Approvals" });
      await rec.tap(approvals.getByTestId("approval-request").getByRole("button", { name: "Approve" }), "Manager: Approve", { decision: true });
      await expect(approvals.getByRole("status").first()).toHaveText(/^Approved/);
      await rec.key(approvals, "Escape", "Manager: close Approvals");
      await expect(receipt(page).getByTestId("receipt-refunded")).toBeVisible();
      rec.note(`Cashier steps: ${cashierSteps}; manager steps: ${rec.steps.length - cashierSteps}.`);
      rec.save();
    });

    test("f-link-appointment", async ({ page }) => {
      await open(page, `${CHECKOUT}?scenario=unscheduled-paid`);
      const rec = new Recorder(page, "f-link-appointment", vp);
      await rec.begin();
      const after = page.getByRole("region", { name: "After payment", exact: true });
      await rec.tap(after.getByRole("button", { name: "Link appointment" }), "Link appointment");
      const dialog = page.getByRole("dialog");
      await rec.shot("candidates");
      await rec.dump("candidates");
      await rec.measure("candidates", '[role="dialog"]');
      await rec.tap(dialog.getByTestId("link-candidate").filter({ hasText: "SVC-0002" }).getByRole("button", { name: "Review" }), "Review SVC-0002", { decision: true });
      await rec.shot("review");
      await rec.dump("review");
      await rec.type(dialog.getByLabel("Reason (required)"), "Guest booked the prepaid massage", "Reason");
      await rec.tap(dialog.getByRole("button", { name: "Confirm link" }), "Confirm link");
      await expect(after).toContainText("Linked · SVC-0002");
      await rec.shot("linked");
      rec.save();
    });

    test("g-correct-payment-method", async ({ page }) => {
      // Paid by cash; it was really PromptPay.
      await open(page, `${STAFF}?role=manager&scenario=paid`);
      const rec = new Recorder(page, "g-correct-payment-method", vp);
      await rec.begin();
      await rec.tap(page.getByRole("button", { name: "Correct payment recording" }), "Correct payment recording");
      await rec.shot("form");
      await rec.dump("form");
      await rec.measure("form");
      const method = page.getByRole("combobox", { name: /method/i }).first();
      await rec.tap(method, "Method (open)");
      await rec.tap(page.getByRole("option", { name: "PromptPay" }), "PromptPay", { decision: true });
      await rec.dump("method-picked");
      await rec.type(page.getByRole("textbox", { name: /reason/i }).first(), "Guest paid by PromptPay", "Reason");
      await rec.shot("filled");
      await rec.tap(page.getByRole("button", { name: "Save recording correction" }), "Save recording correction");
      await expect(page.getByRole("form", { name: "Correct payment recording" })).toHaveCount(0);
      await page.waitForTimeout(300);
      await rec.shot("done");
      await rec.dump("done");
      rec.save();
    });

    test("h1-staff-villa-booking", async ({ page }) => {
      // NewBookingDialog, already open with dates prefilled as from a calendar selection.
      await page.addInitScript(() => window.addEventListener("fixture-mutation", (event) => { document.body.dataset.submission = JSON.stringify((event as CustomEvent).detail); }));
      await page.setViewportSize(VIEWPORTS[vp]);
      await page.goto("/tests/browser/index.html");
      await page.getByRole("dialog", { name: "New booking" }).waitFor();
      await page.waitForTimeout(400);
      const rec = new Recorder(page, "h1-staff-villa-booking", vp);
      rec.note("Dialog opened by the fixture with check-in/out prefilled; reaching it in the app is at least 1 more tap (or a calendar drag).");
      await rec.begin();
      await rec.dump("start");
      await rec.tap(page.getByRole("button", { name: /^Villa / }), "Villa (open)");
      await rec.tap(page.getByRole("option", { name: /Garden Villa/ }), "Garden Villa", { decision: true });
      await rec.type(page.getByLabel("Phone", { exact: true }), "0812345678", "Phone");
      await rec.type(page.getByLabel("Guest name", { exact: true }), "Walk-in Guest", "Guest name");
      await rec.shot("filled");
      await rec.tap(page.getByRole("button", { name: "Create booking", exact: true }), "Create booking");
      await expect(page.locator("body")).toHaveAttribute("data-submission", /"propertySlug":"garden-villa"/);
      rec.save();
    });

    test("h2-staff-appointment", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[vp]);
      await page.goto("/tests/browser/index.html?mode=service");
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(400);
      const rec = new Recorder(page, "h2-staff-appointment", vp);
      await rec.begin();
      await rec.tap(page.getByRole("button", { name: /^Service / }), "Service (open)");
      await rec.type(page.getByRole("combobox"), "Yoga 03", "Search services");
      await rec.tap(page.getByRole("option", { name: /Yoga 03/ }), "Yoga 03", { decision: true });
      await rec.type(page.getByLabel("Guest name (optional)"), "Walk-in Guest", "Guest name");
      await rec.shot("filled");
      await rec.dump("filled");
      const book = page.getByRole("button", { name: "Book appointment" });
      rec.note(`Book appointment enabled: ${await book.isEnabled()} (the fixture passes no staff and no open times).`);
      rec.save();
    });

    test("i-invite-cashier-and-limit", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = new Recorder(page, "i-invite-cashier-and-limit", vp);
      rec.note("Starts on Settings › Team; reaching it is Settings in the nav + the Team tab (2 taps).");
      await rec.begin();
      const people = page.getByRole("region", { name: "People" });
      await rec.tap(people.getByRole("button", { name: "Invite" }), "Invite");
      await rec.shot("invite-form");
      await rec.dump("invite-form");
      await rec.type(people.getByRole("textbox", { name: "Email" }), "fon@auraliscove.co", "Email");
      const role = people.getByRole("combobox", { name: "Role", exact: true });
      rec.note(`Invite role default: ${await role.inputValue()}`);
      if ((await role.inputValue()) !== "cashier") await rec.pick(role, "cashier", "Role");
      await rec.tap(people.getByRole("button", { name: "Send invite" }), "Send invite");
      await expect(people.getByRole("status")).toContainText("Invited fon@auraliscove.co");
      await rec.shot("invited");
      const rules = page.getByRole("form", { name: "Cashier rules" });
      await rec.type(rules.getByRole("textbox", { name: "Discount without approval" }), "15", "Discount without approval");
      await rec.tap(rules.getByRole("button", { name: "Save rules" }), "Save rules");
      await expect(rules.getByRole("status")).toHaveText("Saved");
      await rec.shot("saved");
      rec.save();
    });

    test("j-create-coupon", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[vp]);
      await page.goto("/tests/browser/ux-audit/coupon.html");
      await page.locator("[data-fixture-ready]").waitFor();
      await page.waitForTimeout(400);
      const rec = new Recorder(page, "j-create-coupon", vp);
      rec.note("Starts on the New coupon page; reaching it is Marketing › Coupons › New coupon (2–3 taps).");
      await rec.begin();
      await rec.type(page.getByRole("textbox", { name: "Code", exact: true }), "SPA20", "Code");
      await rec.type(page.getByRole("textbox", { name: "Discount", exact: true }), "20", "Discount %");
      await rec.tap(page.getByRole("radio", { name: /^Spa services/ }), "Covers: Spa services", { decision: true });
      await rec.shot("filled");
      await rec.dump("filled");
      await rec.tap(page.getByRole("button", { name: "Create coupon" }), "Create coupon");
      await expect(page.locator("body")).toHaveAttribute("data-submission", /SPA20/);
      await page.waitForTimeout(300);
      await rec.shot("created");
      await rec.dump("created");
      rec.save();
    });
  });
}
