import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Locator, type Page } from "@playwright/test";
import { census, RESULTS, VIEWPORTS, type ViewportName } from "./measure";
import { receiptCensus } from "../helpers/receipt-census";
import { visibleSentences } from "../helpers/sentence-count";

/*
 * Controls and words per component, per page, at iPad and phone size. A component is tagged with
 * data-audit (its own element, or the nearest element holding two of its known controls), then
 * counted with the same census as the tasks.
 *
 * This is the "before" script: it drives the UI of ux/click-audit (2a08d77) and fails on
 * ux/integration, where final-components.audit.ts takes over. Explanatory sentences
 * (helpers/sentence-count.ts) were added afterwards for final-audit.md; with UX_AUDIT_RESULTS set,
 * results go there instead of results/.
 */
const OUT_DIR = process.env.UX_AUDIT_RESULTS ?? RESULTS;
async function sentences(page: Page, scope?: string) {
  await page.evaluate(() => document.querySelectorAll(".pos-receipt").forEach((el) => el.setAttribute("data-sentence-budget", "ignore")));
  const root = page.locator(scope ?? "body").first();
  return (await root.count()) ? root.evaluate(visibleSentences) : [];
}

/** Tags the smallest element containing both locators. */
async function tagCommon(page: Page, name: string, a: Locator, b: Locator) {
  // Missing or hidden (e.g. behind the phone order sheet): the component isn't measured on this page.
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
    const parts = [];
    for (let i = 0; i < roots; i += 1) parts.push(await census(page, `[data-audit="${region.name}"]`, i));
    const c = parts.reduce((a, b) => ({ controlsOnScreen: a.controlsOnScreen + b.controlsOnScreen, controlsOnPage: a.controlsOnPage + b.controlsOnPage, wordsOnScreen: a.wordsOnScreen + b.wordsOnScreen, wordsOnPage: a.wordsOnPage + b.wordsOnPage, wordsInnerText: 0 }), { controlsOnScreen: 0, controlsOnPage: 0, wordsOnScreen: 0, wordsOnPage: 0, wordsInnerText: 0 });
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
    // Descend through wrappers holding several labelled fields until each row has one label.
    const flatten = (el: Element): Element[] => Array.from(el.children).flatMap((child) => (child.tagName === "FIELDSET" || child.querySelectorAll("label").length > 1 && !child.matches("[role=radiogroup],[role=group]") ? flatten(child) : [child]));
    const rows = flatten(form);
    return rows.map((el) => {
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

type PageSpec = { url: string; prep?: (page: Page, vp: ViewportName) => Promise<void>; tag: (page: Page) => Promise<Region[]> };

const openSheet = async (page: Page, vp: ViewportName) => {
  if (vp === "phone") { await page.getByRole("button", { name: /open the order/ }).click(); await page.waitForTimeout(400); }
};
const orderScope = (page: Page, vp: ViewportName) => (vp === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true }));

const checkoutRegions = async (page: Page) => {
  await tag("CatalogPane", page.locator('section[aria-label="Catalog"]'));
  await tagCommon(page, "OrderStrip", btn(page, "Add customer"), btn(page, "New order"));
  await tagCommon(page, "OrderPanel · header", btn(page, "Save & close"), btn(page, "Clear order"));
  await tag("OrderPanel · rows", page.locator("li:has(button[aria-expanded])").filter({ visible: true }).locator("xpath=..").first());
  await tagCommon(page, "OrderPanel · coupon, totals, tenders", btn(page, /^Add coupon|^Remove$/), btn(page, "Split payment"));
  return [
    { name: "CatalogPane", file: "src/components/checkout/CatalogPane.tsx" },
    { name: "OrderStrip", file: "src/components/checkout/OrderStrip.tsx" },
    { name: "OrderPanel · header", file: "src/components/checkout/OrderPanel.tsx" },
    { name: "OrderPanel · rows", file: "src/components/checkout/OrderPanel.tsx" },
    { name: "OrderPanel · coupon, totals, tenders", file: "src/components/checkout/OrderPanel.tsx + OrderCoupon.tsx" },
  ];
};

const PAGES: Record<string, PageSpec> = {
  "Checkout · new sale": { url: "/tests/browser/staff-roles.html?role=cashier&scenario=spa", prep: openSheet, tag: checkoutRegions },
  // Added for final-audit.md: the start screens of tasks a, d and f, for their sentence counts.
  "Checkout · empty till": { url: "/tests/browser/staff-roles.html?role=cashier", tag: checkoutRegions },
  "Receipt (paid by cash) · cashier": { url: "/tests/browser/staff-roles.html?role=cashier&scenario=paid", tag: async () => [] },
  "Link appointment (after payment)": {
    url: "/tests/browser/checkout.html?scenario=unscheduled-paid",
    prep: async (page) => { await page.getByRole("region", { name: "After payment", exact: true }).getByRole("button", { name: "Link appointment" }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("Link dialog", page.getByRole("dialog"));
      return [{ name: "Link dialog", file: "src/components/checkout/AfterPayment.tsx" }];
    },
  },
  "Checkout · line open": {
    url: "/tests/browser/staff-roles.html?role=cashier&scenario=spa",
    prep: async (page, vp) => { await openSheet(page, vp); await orderScope(page, vp).getByRole("button", { name: /^Thai massage 60/ }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      const regions = await checkoutRegions(page);
      await tag("OrderPanel · line editor", page.locator("li").filter({ has: page.getByRole("textbox", { name: "Discount" }) }).filter({ visible: true }));
      return [...regions, { name: "OrderPanel · line editor", file: "src/components/checkout/OrderPanel.tsx" }];
    },
  },
  "Checkout · cash": {
    url: "/tests/browser/staff-roles.html?role=cashier&scenario=spa",
    prep: async (page, vp) => { await openSheet(page, vp); await orderScope(page, vp).getByRole("button", { name: "Cash", exact: true }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("CatalogPane", page.locator('section[aria-label="Catalog"]'));
      await tagCommon(page, "OrderStrip", btn(page, "Add customer"), btn(page, "New order"));
      await tagCommon(page, "PayPanel · cash", btn(page, "Back to order"), btn(page, "Confirm cash"));
      return [
        { name: "PayPanel · cash", file: "src/components/checkout/PayPanel.tsx" },
        { name: "CatalogPane", file: "src/components/checkout/CatalogPane.tsx" },
        { name: "OrderStrip", file: "src/components/checkout/OrderStrip.tsx" },
      ];
    },
  },
  "Receipt (paid, 2 lines)": {
    url: "/tests/browser/staff-roles.html?role=manager&scenario=refund",
    tag: async (page) => {
      await tagCommon(page, "ReceiptView · header", btn(page, "Checkout"), btn(page, "New sale"));
      await tagAll("ReceiptView · print toolbar", [page.getByRole("radiogroup", { name: "Paper width" }), btn(page, "Print"), btn(page, "Share"), btn(page, "Copy receipt text"), page.locator("details").filter({ has: page.getByText(/^Print setup for/) })]);
      await tag("ReceiptView · receipt paper", page.getByRole("article", { name: "Receipt" }));
      await tag("AfterPayment", page.locator('section[aria-label="After payment"]'));
      await tag("PaymentRecord", page.locator('section[aria-label="Payment recording"]'));
      await tagAll("History disclosures + Void", [page.locator("details").filter({ has: page.locator("summary", { hasText: /^(Browse all financial history|Order history)$/ }) }), btn(page, "Void…"), btn(page, "Why void is off")]);
      return [
        { name: "ReceiptView · header", file: "src/components/checkout/ReceiptView.tsx" },
        { name: "ReceiptView · print toolbar", file: "src/components/checkout/ReceiptView.tsx" },
        { name: "ReceiptView · receipt paper", file: "src/components/checkout/ReceiptView.tsx + RefundForm.tsx" },
        { name: "AfterPayment", file: "src/components/checkout/AfterPayment.tsx" },
        { name: "PaymentRecord", file: "src/components/checkout/PaymentRecord.tsx" },
        { name: "History disclosures + Void", file: "FinancialHistory.tsx, OrderHistory.tsx, ReceiptView.tsx" },
      ];
    },
  },
  "Receipt · correcting payment": {
    url: "/tests/browser/staff-roles.html?role=manager&scenario=paid",
    prep: async (page) => { await page.getByRole("button", { name: "Correct payment recording" }).click(); await page.waitForTimeout(300); },
    tag: async (page) => {
      await tag("PaymentRecord · correction form", page.getByRole("form", { name: "Correct payment recording" }));
      await tag("ReceiptView · receipt paper", page.getByRole("article", { name: "Receipt" }));
      await tag("AfterPayment", page.locator('section[aria-label="After payment"]'));
      return [
        { name: "PaymentRecord · correction form", file: "src/components/checkout/PaymentRecord.tsx" },
        { name: "ReceiptView · receipt paper", file: "src/components/checkout/ReceiptView.tsx" },
        { name: "AfterPayment", file: "src/components/checkout/AfterPayment.tsx" },
      ];
    },
  },
  "Settings › Team": {
    url: "/tests/browser/staff-roles.html?view=settings&tab=team",
    tag: async (page) => {
      await tag("Settings tabs", page.getByRole("tablist", { name: "Settings sections" }));
      await tag("TeamSettings · People", page.getByRole("region", { name: "People" }));
      await tag("TeamSettings · Cashier rules", page.locator('section:has(form[aria-label="Cashier rules"])'));
      return [
        { name: "TeamSettings · People", file: "src/components/admin/TeamSettings.tsx" },
        { name: "TeamSettings · Cashier rules", file: "src/components/admin/TeamSettings.tsx" },
        { name: "Settings tabs", file: "src/components/admin/AdminSettingsView.tsx" },
      ];
    },
  },
  "New booking": { url: "/tests/browser/index.html", tag: (page) => tagFormRows(page, "src/components/admin/NewBookingDialog.tsx") },
  "New appointment": { url: "/tests/browser/index.html?mode=service", tag: (page) => tagFormRows(page, "src/components/admin/NewAppointmentDialog.tsx") },
  "New coupon": {
    url: "/tests/browser/ux-audit/coupon.html", // the audit-only fixture on ux/click-audit
    tag: async (page) => {
      const names = ["Code", "Benefit", "Scope", "Dates", "Minimums and limits", "Customer terms", "Summary", "Test a quote"];
      for (const name of names) await tag(`Section · ${name}`, page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) }).last());
      return names.map((name) => ({ name: `Section · ${name}`, file: "src/components/admin/marketing/CouponEditor.tsx" + (name === "Test a quote" ? " + TestQuotePanel.tsx" : "") }));
    },
  },
};

const results: Record<string, unknown> = {};
for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const [name, spec] of Object.entries(PAGES)) {
    test(`${vp} ${name}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[vp]);
      await page.goto(spec.url);
      await page.locator("[data-fixture-ready], [role=dialog]").first().waitFor();
      await page.waitForTimeout(500);
      if (spec.prep) await spec.prep(page, vp);
      const regions = await spec.tag(page);
      const said = await sentences(page);
      const receipt = (await page.locator(".pos-receipt").count()) ? { receipt: await receiptCensus(page) } : {};
      results[`${vp} · ${name}`] = { page: { ...(await census(page)), sentences: said.length, sentenceText: said, ...receipt }, components: await measureRegions(page, regions) };
      writeFileSync(path.join(OUT_DIR, "components.json"), JSON.stringify(results, null, 2));
    });
  }
}
