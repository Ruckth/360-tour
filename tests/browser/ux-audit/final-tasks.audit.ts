import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Recorder } from "./measure";
import { VIEWPORTS, type ViewportName } from "./measure";
import { CHECKOUT, COUPON, DESK, SHELL, STAFF, light, open, recorder, uncovered } from "./final-shared";

/*
 * The click audit's tasks (tasks.audit.ts, run on ux/click-audit at 2a08d77) driven again on
 * ux/integration, with the same counting rules, plus the plan's journeys that needed the desk
 * fixture. Results go to docs/reviews/ux-audit/results-final/, screens to .../final-screens/.
 *   BOOKING_UI_PORT=4361 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts final-tasks
 */

/** The order panel: the side panel on iPad, the bottom sheet on a phone (one counted tap to open). */
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
const more = (page: Page) => page.getByRole("button", { name: "More receipt actions" });
const printed = (page: Page) => page.evaluate(() => (window as unknown as { printed: number }).printed);

/** The manager takes the same till (window.fixture.setRole), as in the original c and e2. */
async function managerApproves(page: Page, rec: Recorder) {
  const cashierSteps = rec.steps.length;
  await page.evaluate(() => window.fixture.setRole("manager"));
  await page.waitForTimeout(300);
  const button = page.getByTestId("approvals-button");
  const free = await uncovered(button);
  rec.note(`Approvals button uncovered after the role switch: ${free}.`);
  if (!free) await page.keyboard.press("Escape");
  await rec.tap(button, "Manager: Approvals");
  const approvals = page.getByRole("dialog", { name: "Approvals" });
  await rec.shot("approvals");
  await rec.dump("approvals");
  await rec.measure("approvals", '[role="dialog"][aria-label="Approvals"], [role="dialog"]:has([data-testid="approval-request"])');
  await rec.tap(approvals.getByTestId("approval-request").getByRole("button", { name: "Approve" }), "Manager: Approve", { decision: true });
  await expect(approvals).toHaveCount(0);
  await expect(page.getByTestId("toast")).toBeVisible();
  rec.note(`Cashier steps: ${cashierSteps}; manager steps: ${rec.steps.length - cashierSteps}. The panel closes itself after the last decision.`);
}

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  test.describe(vp, () => {
    test.use({ viewport: VIEWPORTS[vp] });

    test("a-cash-sale", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier`);
      const rec = recorder(page, "a-cash-sale", vp);
      await rec.begin();
      await rec.dump("start");
      await rec.tap(tile(page, "Thai massage 60"), "Thai massage 60 tile", { decision: true });
      const panel = await orderPanel(page, rec);
      await rec.shot("order");
      await rec.tap(panel.getByRole("button", { name: "Cash", exact: true }), "Cash", { decision: true });
      await rec.dump("cash-panel");
      await rec.shot("cash-panel");
      await rec.measure("cash-panel", '[data-testid="pay-panel"]');
      await rec.tap(panel.getByRole("button", { name: "Confirm cash ฿1,200 · no change" }), "Confirm cash ฿1,200 · no change");
      await expect(receipt(page)).toBeVisible();
      await page.waitForTimeout(300);
      await rec.shot("receipt");
      await rec.measure("receipt");
      await rec.dump("receipt");
      rec.save();
    });

    test("a2-cash-with-change", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier`);
      const rec = recorder(page, "a2-cash-with-change", vp);
      await rec.begin();
      await rec.tap(tile(page, "Thai massage 60"), "Thai massage 60 tile", { decision: true });
      const panel = await orderPanel(page, rec);
      await rec.tap(panel.getByRole("button", { name: "Cash", exact: true }), "Cash", { decision: true });
      await rec.tap(panel.getByRole("button", { name: "฿1,500", exact: true }), "฿1,500 note chip", { decision: true });
      await rec.shot("change");
      await rec.tap(panel.getByRole("button", { name: "Confirm cash ฿1,500 · change ฿300" }), "Confirm cash ฿1,500 · change ฿300");
      await expect(receipt(page)).toContainText("฿300");
      rec.note("The change is on the Confirm button: no sum to do.");
      rec.save();
    });

    test("b-two-services-coupon-card", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier`);
      const rec = recorder(page, "b-two-services-coupon-card", vp);
      await rec.begin();
      await rec.tap(tile(page, "Thai massage 60"), "Thai massage 60 tile", { decision: true });
      await rec.tap(tile(page, "Foot spa 45"), "Foot spa 45 tile", { decision: true });
      const panel = await orderPanel(page, rec);
      await rec.shot("two-lines");
      await rec.dump("two-lines");
      await rec.tap(panel.getByRole("button", { name: /^Add coupon/ }).filter({ visible: true }).first(), "Add coupon");
      const field = panel.getByRole("textbox", { name: "Coupon code or offer link" });
      await rec.type(field, "DCNT-SPA-500", "Coupon code");
      await rec.key(field, "Enter", "Enter to apply");
      await expect(panel.getByTestId("order-coupon")).toContainText("Saves ฿500");
      await rec.shot("coupon-applied");
      await rec.measure("coupon-applied");
      await rec.tap(panel.getByRole("button", { name: "Card", exact: true }), "Card", { decision: true });
      await rec.dump("card-panel");
      await rec.shot("card-panel");
      await rec.tap(panel.getByRole("button", { name: /^Confirm card ฿/ }), "Confirm card ฿1,300");
      await expect(receipt(page)).toBeVisible();
      await rec.shot("receipt");
      rec.save();
    });

    test("c-discount-over-limit-approval", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=spa`);
      const rec = recorder(page, "c-discount-over-limit-approval", vp);
      await rec.begin();
      const panel = await orderPanel(page, rec);
      await rec.tap(panel.getByRole("button", { name: /^Thai massage 60/ }), "Open the Thai massage row");
      await page.waitForTimeout(300);
      await rec.shot("row-open");
      await rec.dump("row-open");
      await rec.measure("row-open");
      await rec.type(panel.getByRole("textbox", { name: "Discount" }), "15%", "Discount 15%");
      await expect(panel.getByTestId("discount-echo")).toContainText("15% = ฿180");
      await rec.shot("over-limit");
      await rec.measure("over-limit");
      const ask = panel.getByRole("group", { name: "Ask a manager" });
      await rec.tap(ask.getByRole("button", { name: "Service delay" }), "Reason chip: Service delay", { decision: true });
      await rec.tap(ask.getByRole("button", { name: "Send 15% (฿180) to manager" }), "Send 15% (฿180) to manager");
      await expect(panel.locator('[data-approval-status="pending"]')).toBeVisible();
      await rec.shot("waiting");
      await managerApproves(page, rec);
      await expect(panel.getByTestId("order-due")).toHaveText("฿1,020");
      await rec.shot("approved");
      rec.save();
    });

    test("d-print-receipt", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=paid`);
      const rec = recorder(page, "d-print-receipt", vp);
      await rec.begin();
      await rec.dump("start");
      await rec.tap(page.getByRole("button", { name: "Print", exact: true }), "Print", { decision: true });
      expect(await printed(page)).toBe(1);
      rec.save();
    });

    test("d2-print-58mm-first-time", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=paid`);
      const rec = recorder(page, "d2-print-58mm-first-time", vp);
      await rec.begin();
      await rec.tap(more(page), "⋯ More receipt actions");
      await rec.shot("menu");
      await rec.dump("menu");
      await rec.tap(page.getByRole("menuitem", { name: "Use 58 mm paper" }), "Use 58 mm paper", { decision: true });
      await rec.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      expect(await printed(page)).toBe(1);
      rec.note("The next receipt on this device prints on 58 mm with Print alone (1 tap; ux-p4-receipt.spec.ts asserts it).");
      rec.save();
    });

    test("e-refund-one-line-manager", async ({ page }) => {
      await open(page, `${STAFF}?role=manager&scenario=refund`);
      const rec = recorder(page, "e-refund-one-line-manager", vp);
      await rec.begin();
      await rec.tap(receipt(page).getByRole("button", { name: "Refund Foot spa 45" }), "Refund Foot spa 45", { decision: true });
      const form = receipt(page).getByRole("form", { name: "Refund", exact: true });
      await page.waitForTimeout(300);
      await rec.shot("form");
      await rec.dump("form");
      await rec.measure("form");
      await rec.tap(form.getByRole("button", { name: "Shortened treatment" }), "Reason chip: Shortened treatment", { decision: true });
      await rec.tap(form.getByRole("button", { name: "Record refund ฿600" }), "Record refund ฿600");
      await expect(receipt(page).locator("[data-line-note]")).toHaveText("Refunded ฿600 · Shortened treatment");
      await rec.shot("done");
      rec.save();
    });

    test("e2-refund-one-line-cashier-asks", async ({ page }) => {
      await open(page, `${STAFF}?role=cashier&scenario=refund`);
      const rec = recorder(page, "e2-refund-one-line-cashier-asks", vp);
      await rec.begin();
      await rec.tap(receipt(page).getByRole("button", { name: "Refund Foot spa 45" }), "Refund Foot spa 45", { decision: true });
      const form = receipt(page).getByRole("form", { name: "Ask a manager", exact: true });
      await rec.tap(form.getByRole("button", { name: "Shortened treatment" }), "Reason chip: Shortened treatment", { decision: true });
      await rec.tap(form.getByRole("button", { name: "Send refund ฿600 to manager" }), "Send refund ฿600 to manager");
      await expect(page.locator('[data-approval-status="pending"]').first()).toBeVisible();
      await rec.shot("waiting");
      await managerApproves(page, rec);
      await expect(receipt(page).getByTestId("receipt-refunded")).toBeVisible();
      rec.note("An approver at the till can also approve on the Waiting for a manager bar: 1 tap.");
      rec.save();
    });

    test("f-link-appointment", async ({ page }) => {
      await open(page, `${CHECKOUT}?scenario=unscheduled-paid`);
      const rec = recorder(page, "f-link-appointment", vp);
      await rec.begin();
      await rec.tap(receipt(page).getByRole("button", { name: "Link appointment" }), "Link appointment");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("link-review")).toContainText("SVC-0002");
      await page.waitForTimeout(300);
      await rec.shot("review");
      await rec.dump("review");
      await rec.measure("review", '[role="dialog"]');
      await rec.tap(dialog.getByRole("button", { name: "Guest asked" }), "Reason chip: Guest asked", { decision: true });
      await rec.tap(dialog.getByRole("button", { name: "Confirm link" }), "Confirm link");
      await expect(receipt(page).getByTestId("line-link")).toHaveText("Linked · SVC-0002");
      await rec.shot("linked");
      rec.save();
    });

    test("g-correct-payment-method", async ({ page }) => {
      // Paid by cash; it was really PromptPay.
      await open(page, `${STAFF}?role=manager&scenario=paid`);
      const rec = recorder(page, "g-correct-payment-method", vp);
      await rec.begin();
      await rec.tap(more(page), "⋯ More receipt actions");
      await rec.tap(page.getByRole("menuitem", { name: "Correct payment" }), "Correct payment", { decision: true });
      const form = page.getByTestId("correct-payment");
      await page.waitForTimeout(300);
      await rec.shot("form");
      await rec.dump("form");
      await rec.measure("form");
      await rec.measure("form-only", '[data-testid="correct-payment"]');
      await rec.tap(form.getByRole("button", { name: "PromptPay QR", exact: true }), "PromptPay QR", { decision: true });
      await rec.tap(form.getByRole("button", { name: "Wrong method picked" }), "Reason chip: Wrong method picked", { decision: true });
      await rec.shot("filled");
      await rec.tap(form.getByRole("button", { name: /^Save · PromptPay QR ฿/ }), "Save · PromptPay QR");
      await expect(form).toHaveCount(0);
      await page.waitForTimeout(300);
      await rec.shot("done");
      rec.save();
    });

    test("h1-staff-villa-booking", async ({ page }) => {
      // NewBookingDialog with the dates prefilled, as from a calendar selection (index.html, as before).
      await page.addInitScript(() => window.addEventListener("fixture-mutation", (event) => { document.body.dataset.submission = JSON.stringify((event as CustomEvent).detail); }));
      await page.goto("/tests/browser/index.html");
      await page.getByRole("dialog", { name: "New booking" }).waitFor();
      await light(page);
      await page.waitForTimeout(300);
      const rec = recorder(page, "h1-staff-villa-booking", vp);
      rec.note("Dialog opened by the fixture with check-in/out prefilled; on the desk it is New booking (1 tap) or a calendar drag.");
      await rec.begin();
      await rec.dump("start");
      const dialog = page.getByRole("dialog", { name: "New booking" });
      await rec.tap(dialog.getByRole("button", { name: "Villa Tideglass Pool Residence" }), "Villa (open)");
      await rec.tap(page.getByRole("option", { name: /Garden Villa/ }), "Garden Villa", { decision: true });
      await rec.type(dialog.getByLabel("Phone", { exact: true }), "0812345678", "Phone");
      await rec.type(dialog.getByLabel("Guest name", { exact: true }), "Walk-in Guest", "Guest name");
      await rec.shot("filled");
      await rec.measure("filled", '[role="dialog"]');
      await rec.tap(dialog.getByRole("button", { name: "Create booking", exact: true }), "Create booking");
      await expect(page.locator("body")).toHaveAttribute("data-submission", /"propertySlug":"garden-villa"/);
      rec.save();
    });

    test("h2-staff-appointment", async ({ page }) => {
      // As before: index.html passes no staff and no open times, so it stops at the guest name.
      await page.goto("/tests/browser/index.html?mode=service");
      await page.getByRole("dialog").first().waitFor();
      await light(page);
      await page.waitForTimeout(300);
      const rec = recorder(page, "h2-staff-appointment", vp);
      await rec.begin();
      await rec.dump("start");
      await rec.tap(page.getByRole("button", { name: "Service Thai Massage" }), "Service (open)");
      await rec.type(page.getByRole("combobox").filter({ visible: true }).last(), "Yoga 03", "Search services");
      await rec.tap(page.getByRole("option", { name: /Yoga 03/ }), "Yoga 03", { decision: true });
      await rec.type(page.getByLabel("Guest name (optional)"), "Walk-in Guest", "Guest name");
      await rec.shot("filled");
      await rec.dump("filled");
      await rec.measure("filled", '[role="dialog"]');
      rec.note(`Book appointment enabled: ${await page.getByRole("button", { name: "Book appointment" }).isEnabled()} (no staff, no open times in this fixture; see h2b).`);
      rec.save();
    });

    test("h2b-staff-appointment-desk", async ({ page }) => {
      // New on ux/integration: the desk fixture has staff and open times, so the booking finishes.
      await open(page, `${DESK}?view=staff`, { clock: true });
      const rec = recorder(page, "h2b-staff-appointment-desk", vp);
      await rec.begin();
      await rec.tap(page.getByRole("button", { name: "New appointment" }), "New appointment");
      const dialog = page.getByRole("dialog").last();
      await page.waitForTimeout(300);
      await rec.shot("dialog");
      await rec.dump("dialog");
      await rec.measure("dialog", '[role="dialog"]');
      // Services are tiles and the first open time is preselected; pick another service and time.
      await rec.tap(dialog.getByRole("group", { name: "Service" }).getByRole("button", { name: /^Hot stone 60/ }), "Hot stone 60", { decision: true });
      await page.waitForTimeout(300);
      await rec.tap(dialog.getByRole("button", { name: "3:00 PM" }), "3:00 PM", { decision: true });
      await rec.type(dialog.getByLabel("Guest name (optional)"), "Walk-in Guest", "Guest name");
      await rec.shot("filled");
      await rec.measure("filled", '[role="dialog"]');
      const book = dialog.getByRole("button", { name: /^Book/ }).last();
      rec.note(`Book enabled after service, time and name: ${await book.isEnabled()}.`);
      if (!(await book.isEnabled())) {
        await rec.tap(dialog.getByRole("combobox", { name: "Staff" }), "Staff (open)");
        await rec.tap(page.getByRole("option").first(), "First staff", { decision: true });
      }
      await rec.tap(book, "Book appointment");
      await expect.poll(async () => (await page.evaluate(() => window.desk.calls())).some((call) => call.name === "createAppointment")).toBe(true);
      rec.save();
    });

    test("i-invite-cashier-and-limit", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = recorder(page, "i-invite-cashier-and-limit", vp);
      rec.note("Starts on Settings › Team; reaching it is Settings in the nav + the Team tab (2 taps).");
      await rec.begin();
      const people = page.getByRole("region", { name: "People" });
      await rec.tap(people.getByRole("button", { name: "Invite" }), "Invite");
      await rec.shot("invite-form");
      await rec.dump("invite-form");
      await rec.type(people.getByRole("textbox", { name: "Email" }), "fon@auraliscove.co", "Email");
      const desk = people.getByRole("combobox", { name: "Desk", exact: true });
      rec.note(`Invite Desk role default: ${await desk.inputValue()}`);
      if ((await desk.inputValue()) !== "cashier") await rec.pick(desk, "cashier", "Desk role");
      await rec.tap(people.getByRole("button", { name: "Send invite" }), "Send invite");
      await expect(people.getByRole("status")).toContainText("Invited fon@auraliscove.co");
      await rec.shot("invited");
      const rules = page.getByRole("form", { name: "Rules for all cashiers" });
      await rec.type(rules.getByRole("textbox", { name: "Discount without approval" }), "15", "Discount without approval");
      await rec.tap(rules.getByRole("button", { name: "Save rules" }), "Save rules");
      await expect(rules.getByRole("status")).toContainText("Saved");
      await rec.shot("saved");
      rec.save();
    });

    test("i2-grant-marketing", async ({ page }) => {
      await open(page, `${STAFF}?view=settings&tab=team`);
      const rec = recorder(page, "i2-grant-marketing", vp);
      await rec.begin();
      const people = page.getByRole("region", { name: "People" });
      await rec.pick(people.getByRole("combobox", { name: "Marketing role for mint@auraliscove.co" }), "marketer", "Marketing role for mint");
      await expect(people.getByRole("status")).toContainText("Invited mint@auraliscove.co to Marketing");
      rec.save();
    });

    test("j-create-coupon", async ({ page }) => {
      await page.addInitScript(() => { window.print = () => { document.body.dataset.printed = "1"; }; });
      await page.goto(COUPON);
      await page.locator("[data-fixture-ready]").waitFor();
      await page.waitForTimeout(400);
      const rec = recorder(page, "j-create-coupon", vp);
      rec.note("Starts on the New coupon page (marketing-coupon.html, the real page; the original used an audit-only CouponEditor fixture). Reaching it is Marketing › Coupons › New coupon (2–3 taps).");
      await rec.begin();
      await rec.dump("start");
      await rec.type(page.getByRole("textbox", { name: "Code", exact: true }), "SPA20", "Code");
      await rec.type(page.getByRole("textbox", { name: "Discount", exact: true }), "20", "Discount %");
      await rec.tap(page.getByRole("radio", { name: /^Spa services/ }), "Covers: Spa services", { decision: true });
      await rec.shot("filled");
      await rec.tap(page.getByRole("button", { name: "Save & publish", exact: true }).locator("visible=true"), "Save & publish");
      const confirm = page.getByRole("alertdialog");
      await rec.shot("confirm");
      await rec.tap(confirm.getByRole("button", { name: "Save & publish" }), "Confirm: Save & publish");
      await expect(page.getByRole("status").filter({ hasText: "SPA20 is live" })).toBeVisible();
      await page.waitForTimeout(300);
      await rec.shot("created");
      await rec.measure("created");
      await rec.dump("created");
      // On to the QR card, as P8 measures (coupon → publish → QR card → Print on one page).
      await rec.tap(page.getByRole("button", { name: "QR card", exact: true }).locator("visible=true"), "QR card");
      const dialog = page.getByRole("dialog");
      await rec.tap(dialog.getByRole("combobox", { name: "Campaign" }), "Campaign (open)");
      await rec.tap(page.getByRole("option", { name: "Songkran spa week" }), "Songkran spa week", { decision: true });
      await rec.tap(dialog.getByRole("button", { name: "Publish the card" }), "Publish the card");
      await rec.shot("qr-card");
      await rec.tap(dialog.getByRole("button", { name: "Print" }), "Print");
      rec.note("Create = the first 5 steps (2 fields, 3 taps). The QR card and Print add 5 taps; P8's journey is 8 taps and 2 fields in total.");
      rec.save();
    });

    test("k-approve-from-chats", async ({ page }) => {
      await open(page, `${SHELL}?role=manager&path=/admin/chats&pending=1`);
      const rec = recorder(page, "k-approve-from-chats", vp);
      await rec.begin();
      await page.getByRole("textbox", { name: "Type an admin reply" }).fill("Yes, 10:00 tomorrow works.");
      await rec.tap(page.locator("header").getByTestId("approvals-button"), "Approvals");
      await rec.shot("approvals");
      await rec.tap(page.getByRole("dialog", { name: "Approvals" }).getByRole("button", { name: "Approve" }), "Approve", { decision: true });
      await expect(page.getByTestId("toast")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Type an admin reply" })).toHaveValue("Yes, 10:00 tomorrow works.");
      rec.note("Same page, reply draft kept (the draft typing is set-up, not counted).");
      rec.save();
    });

    test("m-book-spa-for-staying-guest", async ({ page }) => {
      await open(page, DESK, { clock: true });
      const rec = recorder(page, "m-book-spa-for-staying-guest", vp);
      await rec.begin();
      await rec.dump("start");
      await rec.tap(page.locator("[data-slot=event-calendar-event]", { hasText: "Maya Lin" }).first(), "Maya's stay");
      const popover = page.getByRole("dialog", { name: "Booking for Maya Lin" });
      await rec.shot("popover");
      await rec.dump("popover");
      await rec.measure("popover", '[role="dialog"]');
      await rec.tap(popover.getByRole("button", { name: "Book spa" }), "Book spa", { decision: true });
      const dialog = page.getByRole("dialog", { name: "Book spa" });
      await page.waitForTimeout(300);
      await rec.shot("book-spa");
      await rec.measure("book-spa", '[role="dialog"]');
      await rec.tap(dialog.getByRole("button", { name: /^Hot stone 60/ }), "Hot stone 60", { decision: true });
      await rec.tap(dialog.getByRole("button", { name: "3:00 PM" }), "3:00 PM", { decision: true });
      await rec.tap(dialog.getByRole("button", { name: /^Book Hot stone 60 · 3:00/ }), "Book Hot stone 60 · 3:00 PM");
      await expect(dialog).toHaveCount(0);
      rec.save();
    });

    test("n-guest-leaves", async ({ page }) => {
      await open(page, DESK, { clock: true });
      const rec = recorder(page, "n-guest-leaves", vp);
      await rec.begin();
      await rec.tap(page.locator("[data-slot=event-calendar-event]", { hasText: "Anna Schmidt" }).first(), "Anna's stay");
      await rec.tap(page.getByRole("dialog", { name: "Booking for Anna Schmidt" }).getByRole("button", { name: "Checkout ฿27,500" }), "Checkout ฿27,500");
      await expect(page.locator("[data-route=order]")).toBeVisible();
      await page.waitForTimeout(300);
      if (vp === "phone") await rec.tap(page.getByRole("button", { name: /^View order/ }), "View order");
      await rec.shot("order");
      await rec.measure("order");
      await rec.tap(page.getByRole("button", { name: "Cash", exact: true }), "Cash");
      await rec.tap(page.getByRole("button", { name: /^Confirm cash/ }), "Confirm cash ฿27,500");
      await rec.tap(page.getByRole("button", { name: "Print", exact: true }), "Print");
      await expect(page.getByRole("article", { name: "Receipt" })).toContainText("27,500");
      await rec.shot("receipt");
      rec.save();
    });

    test("o-arrivals", async ({ page }) => {
      await open(page, DESK, { clock: true });
      const rec = recorder(page, "o-arrivals", vp);
      await rec.begin();
      const today = page.getByRole("region", { name: "Today" });
      await rec.tap(today.getByRole("button", { name: /Arriving/ }), "Arriving");
      await rec.shot("arriving");
      const list = today.getByRole("list", { name: "Arriving" });
      await rec.tap(list.getByRole("button", { name: /Ken Tanaka/ }), "Ken Tanaka");
      await page.keyboard.press("Escape");
      await rec.tap(list.getByRole("button", { name: /Maya Lin/ }), "Maya Lin");
      rec.note("Escape between guests (closing the popover) is not counted, as in desk-taps.ts.");
      rec.save();
    });

    test("p-record-stay-payment", async ({ page }) => {
      await open(page, DESK, { clock: true });
      const rec = recorder(page, "p-record-stay-payment", vp);
      await rec.begin();
      await rec.tap(page.locator("[data-slot=event-calendar-event]", { hasText: "Maya Lin" }).first(), "Maya's stay");
      await rec.tap(page.getByRole("dialog", { name: "Booking for Maya Lin" }).getByRole("button", { name: "Record payment" }), "Record payment");
      await page.waitForTimeout(300);
      await rec.shot("dialog");
      await rec.measure("dialog", '[role="dialog"]');
      await rec.tap(page.getByRole("button", { name: "Record ฿8,500" }), "Record ฿8,500");
      await expect(page.getByRole("status")).toContainText("Payment recorded");
      rec.save();
    });

    test("q-appointment-sheet", async ({ page }) => {
      await open(page, `${DESK}?view=staff`, { clock: true });
      const rec = recorder(page, "q-appointment-sheet", vp);
      await rec.begin();
      await rec.tap(page.locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" }).first(), "Ken's appointment");
      await page.waitForTimeout(300);
      await rec.shot("sheet");
      await rec.dump("sheet");
      await rec.measure("sheet", '[role="dialog"]');
      await rec.tap(page.getByRole("dialog", { name: /Ken Tanaka/ }).getByRole("button", { name: "Mark arrived" }), "Mark arrived", { decision: true });
      rec.save();
    });
  });
}
