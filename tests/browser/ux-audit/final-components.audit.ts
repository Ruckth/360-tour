import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { receiptCensus } from "../helpers/receipt-census";
import { census, VIEWPORTS, type ViewportName } from "./measure";
import { CHECKOUT, COUPON, DESK, OUT, SHELL, STAFF, light, open, sentences } from "./final-shared";

/*
 * Controls, words and explanatory sentences per component and per page on ux/integration, at iPad
 * and phone size: the pages of components.audit.ts (same tagging approach), plus the screens the plan
 * added (desk, stay popover and sheet, appointment sheet, approvals). Each page also gets its
 * "after" screenshot in final-screens/ (light; checkout and receipt also dark).
 *   BOOKING_UI_PORT=4361 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts final-components
 */

async function tagCommon(page: Page, name: string, a: Locator, b: Locator) {
  if ((await a.count()) === 0 || (await b.count()) === 0) return;
  const first = await a.first().elementHandle({ timeout: 2000 }).catch(() => null);
  const second = await b.first().elementHandle({ timeout: 2000 }).catch(() => null);
  if (!first || !second) return;
  await page.evaluate(([x, y, label]) => {
    let node: Element | null = x as Element;
    while (node && !node.contains(y as Element)) node = node.parentElement;
    node?.setAttribute("data-audit", label as string);
  }, [first, second, name] as const);
}
async function tag(name: string, target: Locator) {
  if ((await target.count()) === 0) return;
  await target.first().evaluate((el, label) => el.setAttribute("data-audit", label), name);
}
type Region = { name: string; file: string };
/** Tags several elements as one component (siblings with no shared wrapper of their own). */
async function tagAll(name: string, targets: Locator[]) {
  for (const target of targets) {
    for (const el of await target.all()) await el.evaluate((node, label) => node.setAttribute("data-audit", label), name).catch(() => undefined);
  }
}

async function measureRegions(page: Page, regions: Region[]) {
  const rows = [];
  for (const region of regions) {
    const roots = await page.locator(`[data-audit="${region.name}"]`).count();
    if (roots === 0) continue;
    const parts = [];
    for (let i = 0; i < roots; i += 1) parts.push(await census(page, `[data-audit="${region.name}"]`, i));
    const c = parts.reduce((a, b) => ({ controlsOnScreen: a.controlsOnScreen + b.controlsOnScreen, controlsOnPage: a.controlsOnPage + b.controlsOnPage, wordsOnScreen: a.wordsOnScreen + b.wordsOnScreen, wordsOnPage: a.wordsOnPage + b.wordsOnPage }), { controlsOnScreen: 0, controlsOnPage: 0, wordsOnScreen: 0, wordsOnPage: 0 });
    if (c.controlsOnPage === 0 && c.wordsOnPage === 0) continue;
    const said = await sentences(page, `[data-audit="${region.name}"]`);
    rows.push({ ...region, controls: c.controlsOnPage, words: c.wordsOnPage, controlsOnScreen: c.controlsOnScreen, wordsOnScreen: c.wordsOnScreen, sentences: said.length, sentenceText: said });
  }
  return rows.sort((x, y) => y.controls - x.controls || y.words - x.words);
}

/** A dialog form laid out as one column of field groups: each direct child is a component, named by its label. */
async function tagFormRows(page: Page, file: string): Promise<Region[]> {
  const names = await page.locator("[role=dialog] form").first().evaluate((form) => {
    const seen = new Map<string, number>();
    const flatten = (el: Element): Element[] => Array.from(el.children).flatMap((child) => (child.tagName === "FIELDSET" || child.querySelectorAll("label").length > 1 && !child.matches("[role=radiogroup],[role=group]") ? flatten(child) : [child]));
    return flatten(form).map((el) => {
      const raw = (el.querySelector("label, legend, h3, p, button") as HTMLElement | null)?.innerText.trim().replace(/\s+/g, " ").slice(0, 32) || el.tagName.toLowerCase();
      const n = (seen.get(raw) ?? 0) + 1;
      seen.set(raw, n);
      const name = n > 1 ? `${raw} (${n})` : raw;
      el.setAttribute("data-audit", `Row · ${name}`);
      return `Row · ${name}`;
    });
  });
  return names.map((name) => ({ name, file }));
}

const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" }).filter({ visible: true });
const openSheet = async (page: Page, vp: ViewportName) => {
  if (vp === "phone") { await page.getByRole("button", { name: /open the order/ }).click(); await page.waitForTimeout(400); }
};
const orderScope = (page: Page, vp: ViewportName) => (vp === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true }));
const F = "src/components/checkout/";

const checkoutRegions = async (page: Page): Promise<Region[]> => {
  await tag("CatalogPane", page.locator('section[aria-label="Catalog"]'));
  await tagCommon(page, "OrderStrip", btn(page, "Add customer"), btn(page, "New order"));
  await tagCommon(page, "OrderPanel · header", page.getByTestId("order-panel-title").filter({ visible: true }), btn(page, "More order actions"));
  await tag("OrderPanel · rows", page.locator("li:has(button[aria-expanded])").filter({ visible: true }).locator("xpath=..").first());
  await tagCommon(page, "OrderPanel · coupon, totals, tenders", btn(page, /^Add coupon/), btn(page, "Split payment"));
  return [
    { name: "CatalogPane", file: `${F}CatalogPane.tsx` },
    { name: "OrderStrip", file: `${F}OrderStrip.tsx` },
    { name: "OrderPanel · header", file: `${F}OrderPanel.tsx` },
    { name: "OrderPanel · rows", file: `${F}OrderPanel.tsx` },
    { name: "OrderPanel · coupon, totals, tenders", file: `${F}OrderPanel.tsx + OrderCoupon.tsx + PayPanel.tsx (tender row)` },
  ];
};

const receiptRegions = async (page: Page): Promise<Region[]> => {
  await tag("ReceiptView · toolbar", page.getByRole("toolbar", { name: "Receipt actions" }));
  await tag("ReceiptView · receipt paper (with line actions)", page.getByRole("article", { name: "Receipt" }));
  await tag("ReceiptView · side column", page.getByTestId("receipt-side"));
  await tag("History (closed)", page.getByTestId("receipt-history"));
  await tag("Correct payment", page.getByTestId("correct-payment"));
  await tag("Void panel", page.getByTestId("void-panel"));
  return [
    { name: "ReceiptView · toolbar", file: `${F}ReceiptView.tsx` },
    { name: "ReceiptView · receipt paper (with line actions)", file: `${F}ReceiptView.tsx + RefundForm.tsx` },
    { name: "ReceiptView · side column", file: `${F}ReceiptView.tsx` },
    { name: "History (closed)", file: `${F}ReceiptHistory / FinancialHistory.tsx, OrderHistory.tsx` },
    { name: "Correct payment", file: `${F}PaymentRecord.tsx` },
    { name: "Void panel", file: `${F}ReceiptView.tsx` },
  ];
};

type PageSpec = { url: string; clock?: boolean; dark?: boolean; prep?: (page: Page, vp: ViewportName) => Promise<void>; tag: (page: Page, vp: ViewportName) => Promise<Region[]>; receipt?: boolean };

const PAGES: Record<string, PageSpec> = {
  "Checkout · new sale": { url: `${STAFF}?role=cashier&scenario=spa`, dark: true, prep: openSheet, tag: checkoutRegions },
  "Checkout · empty till": { url: `${STAFF}?role=cashier`, dark: true, tag: checkoutRegions },
  "Checkout · line open": {
    url: `${STAFF}?role=cashier&scenario=spa`, dark: true,
    prep: async (page, vp) => { await openSheet(page, vp); await orderScope(page, vp).getByRole("button", { name: /^Thai massage 60/ }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      const regions = await checkoutRegions(page);
      await tag("OrderPanel · line editor", page.locator("li").filter({ has: page.getByRole("textbox", { name: "Discount" }) }).filter({ visible: true }));
      return [...regions, { name: "OrderPanel · line editor", file: `${F}OrderPanel.tsx` }];
    },
  },
  "Checkout · over the limit": {
    url: `${STAFF}?role=cashier&scenario=spa`, dark: true,
    prep: async (page, vp) => {
      await openSheet(page, vp);
      const scope = orderScope(page, vp);
      await scope.getByRole("button", { name: /^Thai massage 60/ }).click();
      await scope.getByRole("textbox", { name: "Discount" }).fill("15%");
      await page.waitForTimeout(300);
    },
    tag: async (page) => {
      const regions = await checkoutRegions(page);
      await tag("OrderPanel · line editor", page.locator("li").filter({ has: page.getByRole("textbox", { name: "Discount" }) }).filter({ visible: true }));
      await tag("Ask a manager (inline)", page.getByRole("group", { name: "Ask a manager" }).filter({ visible: true }));
      return [...regions, { name: "OrderPanel · line editor", file: `${F}OrderPanel.tsx` }, { name: "Ask a manager (inline)", file: `${F}OrderPanel.tsx + ApprovalRequest.tsx` }];
    },
  },
  "Checkout · cash": {
    url: `${STAFF}?role=cashier&scenario=spa`, dark: true,
    prep: async (page, vp) => { await openSheet(page, vp); await orderScope(page, vp).getByRole("button", { name: "Cash", exact: true }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("CatalogPane", page.locator('section[aria-label="Catalog"]'));
      await tagCommon(page, "OrderStrip", btn(page, "Add customer"), btn(page, "New order"));
      await tag("PayPanel · cash (Cash payment group)", page.getByRole("group", { name: "Cash payment" }).filter({ visible: true }));
      await tag("PayPanel · tender row", page.getByTestId("pay-panel").getByRole("group", { name: "Take payment by" }).filter({ visible: true }));
      return [
        { name: "PayPanel · cash (Cash payment group)", file: `${F}PayPanel.tsx` },
        { name: "PayPanel · tender row", file: `${F}PayPanel.tsx` },
        { name: "CatalogPane", file: `${F}CatalogPane.tsx` },
        { name: "OrderStrip", file: `${F}OrderStrip.tsx` },
      ];
    },
  },
  "Checkout · split": {
    url: `${STAFF}?role=cashier&scenario=spa`,
    prep: async (page, vp) => { await openSheet(page, vp); await orderScope(page, vp).getByRole("button", { name: "Split payment", exact: true }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("PayPanel · split", page.getByTestId("pay-panel").filter({ visible: true }));
      return [{ name: "PayPanel · split", file: `${F}PayPanel.tsx` }];
    },
  },
  "Receipt (paid, 2 lines) · manager": { url: `${STAFF}?role=manager&scenario=refund`, dark: true, receipt: true, tag: receiptRegions },
  "Receipt (paid, 2 lines) · cashier": { url: `${STAFF}?role=cashier&scenario=refund`, dark: true, receipt: true, tag: receiptRegions },
  "Receipt · refund form": {
    url: `${STAFF}?role=manager&scenario=refund`, receipt: true,
    prep: async (page) => { await page.getByRole("article", { name: "Receipt" }).getByRole("button", { name: "Refund Foot spa 45" }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      const regions = await receiptRegions(page);
      await tag("RefundForm", page.getByRole("form", { name: "Refund", exact: true }));
      return [...regions, { name: "RefundForm", file: `${F}RefundForm.tsx` }];
    },
  },
  "Receipt · correcting payment": {
    url: `${STAFF}?role=manager&scenario=paid`, dark: true, receipt: true,
    prep: async (page) => { await page.getByRole("button", { name: "More receipt actions" }).click(); await page.getByRole("menuitem", { name: "Correct payment" }).click(); await page.waitForTimeout(300); },
    tag: receiptRegions,
  },
  "Receipt · void": {
    url: `${STAFF}?role=manager&scenario=refund`, receipt: true,
    prep: async (page) => { await page.getByRole("button", { name: "More receipt actions" }).click(); await page.getByRole("menuitem", { name: "Void…" }).click(); await page.waitForTimeout(300); },
    tag: receiptRegions,
  },
  "Receipt · ⋯ menu": {
    url: `${STAFF}?role=manager&scenario=refund`, receipt: true,
    prep: async (page) => { await page.getByRole("button", { name: "More receipt actions" }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("Receipt ⋯ menu", page.getByRole("menu"));
      return [{ name: "Receipt ⋯ menu", file: `${F}ReceiptView.tsx` }];
    },
  },
  "Link appointment (review)": {
    url: `${CHECKOUT}?scenario=unscheduled-paid`, receipt: true,
    prep: async (page) => { await page.getByRole("article", { name: "Receipt" }).getByRole("button", { name: "Link appointment" }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("Link dialog", page.getByRole("dialog"));
      return [{ name: "Link dialog", file: `${F}AfterPayment.tsx / LinkDialog` }];
    },
  },
  "Settings › Team": {
    url: `${STAFF}?view=settings&tab=team`,
    tag: async (page) => {
      await tag("Settings tabs", page.getByRole("tablist", { name: "Settings sections" }));
      await tag("TeamSettings · People", page.getByRole("region", { name: "People" }));
      await tag("TeamSettings · Rules for all cashiers", page.getByRole("region", { name: "Rules for all cashiers" }));
      return [
        { name: "TeamSettings · People", file: "src/components/admin/TeamSettings.tsx" },
        { name: "TeamSettings · Rules for all cashiers", file: "src/components/admin/TeamSettings.tsx" },
        { name: "Settings tabs", file: "src/components/admin/AdminSettingsView.tsx" },
      ];
    },
  },
  "New booking": {
    url: "/tests/browser/index.html",
    prep: async (page) => light(page),
    tag: (page) => tagFormRows(page, "src/components/admin/NewBookingDialog.tsx"),
  },
  "New appointment": {
    url: "/tests/browser/index.html?mode=service",
    prep: async (page) => light(page),
    tag: (page) => tagFormRows(page, "src/components/admin/NewAppointmentDialog.tsx"),
  },
  "New appointment (desk, today)": {
    url: `${DESK}?view=staff`, clock: true,
    prep: async (page) => { await page.getByRole("button", { name: "New appointment" }).click(); await page.waitForTimeout(400); },
    tag: (page) => tagFormRows(page, "src/components/admin/NewAppointmentDialog.tsx"),
  },
  "New coupon": {
    url: COUPON,
    tag: async (page) => {
      await tagAll("Header (back, title, Save & publish, ⋯)", [page.getByRole("link", { name: "Coupons" }), page.getByRole("heading", { name: "New coupon" }), btn(page, "Save & publish"), btn(page, "More save options")]);
      await tagCommon(page, "Code · Type · Discount", page.getByRole("textbox", { name: "Code", exact: true }), page.getByRole("textbox", { name: "Discount", exact: true }));
      await tagCommon(page, "Covers", page.getByRole("radio", { name: /^Villa nights/ }), page.getByRole("radio", { name: /^Both/ }));
      await tag("More rules (closed)", page.locator("details").filter({ has: page.locator("summary", { hasText: "More · campaign" }) }));
      await tag("Summary", page.locator("section, aside, div").filter({ has: page.getByRole("heading", { name: "Summary", exact: true }) }).last());
      const f = "src/components/admin/marketing/CouponEditor.tsx";
      return ["Header (back, title, Save & publish, ⋯)", "Code · Type · Discount", "Covers", "More rules (closed)", "Summary"].map((name) => ({ name, file: f }));
    },
  },
  "Coupon · published": {
    url: COUPON,
    prep: async (page) => {
      await page.getByRole("textbox", { name: "Code", exact: true }).fill("SPA20");
      await page.getByRole("textbox", { name: "Discount", exact: true }).fill((await page.getByRole("radio", { name: "Percent" }).count()) ? "20" : "20%");
      await page.getByRole("button", { name: "Save & publish", exact: true }).locator("visible=true").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Save & publish" }).click();
      await expect(page.getByRole("heading", { name: "SPA20" })).toBeVisible();
      await page.waitForTimeout(300);
    },
    tag: async (page) => {
      await tag("Test a quote", page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Test a quote", exact: true }) }).last());
      await tag("Summary", page.locator("section, aside, div").filter({ has: page.getByRole("heading", { name: "Summary", exact: true }) }).last());
      const f = "src/components/admin/marketing/CouponEditor.tsx";
      return [{ name: "Test a quote", file: `${f} + TestQuotePanel.tsx` }, { name: "Summary", file: f }];
    },
  },
  "Orders dialog · manager": {
    url: `${STAFF}?role=manager`, dark: false,
    prep: async (page) => { await page.getByRole("button", { name: "Orders", exact: true }).click(); await page.waitForTimeout(400); },
    tag: async (page) => {
      await tag("Orders dialog", page.getByRole("dialog"));
      return [{ name: "Orders dialog", file: `${F}OrderStrip.tsx` }];
    },
  },
  "Orders dialog · cashier": {
    url: `${STAFF}?role=cashier`,
    prep: async (page) => { await page.getByRole("button", { name: "Orders", exact: true }).click(); await page.waitForTimeout(400); },
    tag: async (page) => {
      await tag("Orders dialog", page.getByRole("dialog"));
      return [{ name: "Orders dialog", file: `${F}OrderStrip.tsx` }];
    },
  },
  "Desk · staff calendar": {
    url: `${DESK}?view=staff`, clock: true,
    tag: async (page) => {
      await tagCommon(page, "Calendar toolbar", btn(page, "Today"), btn(page, "New appointment"));
      return [{ name: "Calendar toolbar", file: "src/components/admin/AdminStaffBookingsView.tsx" }];
    },
  },
  "Desk · hotel calendar": {
    url: DESK, clock: true,
    tag: async (page) => {
      await tag("Today strip", page.getByRole("region", { name: "Today" }));
      await tagCommon(page, "Calendar toolbar", btn(page, "Today"), btn(page, "More calendar tools"));
      return [{ name: "Today strip", file: "src/components/admin/AdminBookingsView.tsx" }, { name: "Calendar toolbar", file: "src/components/admin/AdminBookingsView.tsx" }];
    },
  },
  "Desk · stay popover": {
    url: DESK, clock: true,
    prep: async (page) => { await page.locator("[data-slot=event-calendar-event]", { hasText: "Anna Schmidt" }).first().click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("Stay popover", page.getByRole("dialog", { name: "Booking for Anna Schmidt" }));
      return [{ name: "Stay popover", file: "src/components/admin/AdminBookingsView.tsx (booking popover)" }];
    },
  },
  "Desk · stay sheet": {
    url: DESK, clock: true,
    prep: async (page) => {
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Anna Schmidt" }).first().click();
      await page.getByRole("dialog", { name: "Booking for Anna Schmidt" }).getByRole("button", { name: "Details" }).click();
      await page.waitForTimeout(400);
    },
    tag: async (page) => {
      await tag("Stay sheet", page.getByRole("dialog", { name: "Anna Schmidt" }));
      await tag("Balance due block", page.getByRole("dialog", { name: "Anna Schmidt" }).getByRole("region", { name: "Balance due" }));
      return [{ name: "Stay sheet", file: "src/components/admin/BookingSheet.tsx" }, { name: "Balance due block", file: "src/components/admin/BookingSheet.tsx" }];
    },
  },
  "Desk · appointment sheet": {
    url: `${DESK}?view=staff`, clock: true,
    prep: async (page) => { await page.locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" }).first().click(); await page.waitForTimeout(400); },
    tag: async (page) => {
      await tag("Appointment sheet", page.getByRole("dialog", { name: /Ken Tanaka/ }));
      return [{ name: "Appointment sheet", file: "src/components/admin/AppointmentSheet.tsx" }];
    },
  },
  "Desk · book spa": {
    url: DESK, clock: true,
    prep: async (page) => {
      await page.locator("[data-slot=event-calendar-event]", { hasText: "Maya Lin" }).first().click();
      await page.getByRole("dialog", { name: "Booking for Maya Lin" }).getByRole("button", { name: "Book spa" }).click();
      await page.waitForTimeout(400);
    },
    tag: async (page) => {
      await tag("Book spa dialog", page.getByRole("dialog", { name: "Book spa" }));
      return [{ name: "Book spa dialog", file: "src/components/admin/NewAppointmentDialog.tsx (stay)" }];
    },
  },
  "Approvals panel (from Chats)": {
    url: `${SHELL}?role=manager&path=/admin/chats&pending=2`,
    prep: async (page) => { await page.locator("header").getByTestId("approvals-button").click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("Approvals panel", page.getByRole("dialog", { name: "Approvals" }));
      return [{ name: "Approvals panel", file: `${F}ApprovalsPanel.tsx` }];
    },
  },
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const results: Record<string, unknown> = {};

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const [name, spec] of Object.entries(PAGES)) {
    test(`${vp} ${name}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[vp]);
      await open(page, spec.url, { clock: spec.clock });
      if (spec.prep) await spec.prep(page, vp);
      const regions = await spec.tag(page, vp);
      const said = await sentences(page);
      results[`${vp} · ${name}`] = {
        page: { ...(await census(page)), sentences: said.length, sentenceText: said, ...(spec.receipt ? { receipt: await receiptCensus(page) } : {}) },
        components: await measureRegions(page, regions),
      };
      writeFileSync(path.join(OUT.results, "components.json"), JSON.stringify(results, null, 2));
      await page.screenshot({ path: path.join(OUT.screens, `screen-${slug(name)}-${vp}.png`) });
      if (spec.dark) {
        // Same state, dark theme (the fixtures read theme=dark at load; toggling the class is equivalent).
        await page.evaluate(() => document.documentElement.classList.add("dark"));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT.screens, `screen-${slug(name)}-${vp}-dark.png`) });
      }
    });
  }
}
