import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import { CheckoutBackendProvider, COMMERCE_OFF, type CheckoutBackend, type HistoryEntry } from "@/components/checkout/backend";
import { previewBackend } from "@/components/checkout/CheckoutPreview";
import { receiptCommerce, receiptText } from "@/components/checkout/checkout-ui";
import { PENDING_COMMERCE_COPY } from "@/components/checkout/commerce-copy";
import { COMMERCE_RECEIPT_ID, commerceReceipt } from "@/components/checkout/design/commerce-receipt";
import { HistoryList } from "@/components/checkout/EditHistory";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { p95, resetTiming, timingRows, withTiming } from "@/components/checkout/timing";
import { Screen } from "@/components/display/DisplayScreens";
import { maskVoucherCodes } from "@/components/display/voucher-mask";
import en from "../../messages/en.json";
import commerceEn from "../../messages/commerce/en.json";
import displayEn from "../../messages/display/en.json";

/**
 * W1·L4 reader screens (plan v27): the receipt reads every Release 1 row kind and tender, the
 * display and every receipt show codes masked, Approvals shows both shapes of request, History has
 * a sealed guest view, and nothing new appears without the commerce readers.
 */

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

let root: Root;
const messages = { ...en, ...commerceEn, ...displayEn };
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
const render = (backend: CheckoutBackend, node: ReactNode) => act(async () => root.render(
  createElement(NextIntlClientProvider, intl, createElement(ConfirmProvider, null, createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, node))),
));
const receipt = (backend: CheckoutBackend, orderId = COMMERCE_RECEIPT_ID) => render(backend, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
const article = () => document.querySelector<HTMLElement>("article.pos-receipt")!;
const text = () => document.body.textContent ?? "";
const buttons = (name: string) => [...document.querySelectorAll("button")].filter((el) => el.textContent?.trim() === name);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
/** Lazy chunks (History, target approvals) load on demand: wait for them. */
async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
/** A full voucher code: two to four letters, then two groups of four with no bullets. */
const FULL_CODE = /\b[A-Z]{2,4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The commerce receipt with the commerce readers on, as the dark state ships (every switch Off). */
const dark = () => previewBackend("empty", "dark");
/** The same receipt document, read by a backend without commerce readers (COMMERCE_OFF). */
function offBackend(): CheckoutBackend {
  const base = createFixtureBackend("coupon-paid");
  return { ...base, useOrder: (id, view) => (id === COMMERCE_RECEIPT_ID ? commerceReceipt : base.useOrder(id, view)) };
}
const rowOf = (name: string) => [...article().querySelectorAll<HTMLElement>("ul > li")].find((li) => li.firstElementChild?.textContent?.startsWith(name));

describe("commerce receipt", () => {
  it("prints a package's contents with the D1 split, each issued code masked and the date it runs to", async () => {
    await receipt(dark());
    const gold = rowOf("Gold Wellness")!;
    expect(gold.dataset.receiptKind).toBe("package");
    expect(gold.textContent).toContain("฿6,900");
    expect(gold.textContent).toContain("5 × Thai massage 60 or Hot stone 60฿5,267.49");
    expect(gold.textContent).toContain("Spa robe · Sand / M฿1,132.51");
    expect(gold.textContent).toContain("฿500 voucher value฿500");
    expect(gold.textContent).toContain("GV-••••-H3LN");
    expect(gold.textContent).toContain("Valid until 18 May 2027");
  });

  it("prints products, the gift voucher, a session-covered visit and refunds, each as its own row kind", async () => {
    await receipt(dark());
    expect(rowOf("Spa robe · Blue / L")!.dataset.receiptKind).toBe("product");
    expect(rowOf("Spa robe · Blue / L")!.querySelector('[data-testid="receipt-line-refunded"]')?.textContent).toBe("Refunded-฿1,290");
    const voucher = rowOf("Gift voucher")!;
    expect(voucher.dataset.receiptKind).toBe("voucher");
    expect(voucher.textContent).toContain("GV-••••-Q9XD");
    expect(voucher.textContent).toContain("Valid until 19 Nov 2027");
    const covered = rowOf("Thai massage 60")!;
    expect(covered.dataset.receiptKind).toBe("covered");
    expect(covered.textContent).toContain("Session used · was ฿1,200");
  });

  it("keeps goodwill a discount and voucher spend apart from cash and cards", async () => {
    await receipt(dark());
    const totals = article().querySelector("dl")!;
    expect(totals.querySelector('[data-testid="receipt-goodwill-total"]')?.textContent).toBe("Goodwill credit-฿100");
    expect(rowOf("Lemongrass oil")!.querySelector('[data-testid="receipt-line-goodwill"]')?.textContent).toBe("Goodwill credit-฿100");
    const tenders = [...totals.querySelectorAll('[data-testid="receipt-voucher-tender"]')].map((row) => row.textContent);
    expect(tenders).toEqual(["Gift voucher GV-••••-7PAX฿2,000"]);
    expect(totals.textContent).toContain("Card฿7,480");
    // Goodwill is never a way of paying.
    expect(tenders.join()).not.toContain("Goodwill");
    expect(totals.textContent).toContain("Total฿9,480");
    expect(document.querySelector("header p")?.textContent).toContain("Paid by card + voucher");
  });

  it("shows the VAT the server worked out from frozen bases, and refunds against the total", async () => {
    await receipt(dark());
    const totals = article().querySelector("dl")!.textContent!;
    expect(totals).toContain("VAT 7% included฿522.06");
    expect(document.querySelector('[data-testid="receipt-refunded"]')?.textContent).toBe("Refunded-฿1,290");
    expect(document.querySelector('[data-testid="receipt-net"]')?.textContent).toBe("Net฿8,190");
  });

  it("marks a voucher-only sale as not a tax invoice (D9)", async () => {
    const voucherOnly = { ...commerceReceipt, lines: commerceReceipt.lines.filter((line) => line.kind === "voucher"), voucherPayments: [] };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? voucherOnly : null) });
    expect(document.querySelector('[data-testid="receipt-not-tax-invoice"]')?.textContent).toBe("Voucher sale · not a tax invoice");
    expect(article().textContent).not.toContain("VAT 7% included");
  });

  it("never shows a full voucher code, even if one reached the receipt by mistake", async () => {
    const leaked = { ...commerceReceipt, voucherPayments: [{ ...commerceReceipt.voucherPayments![0], codeMask: "GV-7K2M-7PAX" }] };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? leaked : null) });
    expect(text()).toContain("Gift voucher GV-••••-7PAX");
    expect(text()).not.toMatch(FULL_CODE);
  });

  it("reads the receipt the same with every switch Off, without Edit · History or payment status", async () => {
    await receipt(offBackend());
    const printed = article().innerHTML;
    expect(article().textContent).toContain("Gift voucher GV-••••-7PAX");
    expect(buttons("Edit · History")).toHaveLength(0);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await receipt(dark());
    expect(article().innerHTML).toBe(printed);
    expect(buttons("Edit · History").length).toBeGreaterThan(0);
  });

  it("shows an open return with each claim's state and due date, and payment detail when there is more to it", async () => {
    await receipt(previewBackend("empty", "return-open"));
    const open = document.querySelector('[data-testid="receipt-open-return"]')!;
    expect(open.textContent).toContain("Return in progress");
    expect(open.textContent).toContain("Gold Wellness · 3 unused sessions฿3,160.49");
    expect(open.textContent).toContain("฿4,793 to Card");
    expect(open.textContent).toContain("Waiting");
    expect(open.textContent).toContain("Refund due by");
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await receipt(previewBackend("empty", "sale-not-saved"));
    const attempt = document.querySelector('[data-testid="receipt-attempt"]')!;
    expect(attempt.textContent).toContain("Money taken · sale not saved");
    expect(attempt.textContent).toContain("What changed: Voucher GV-••••-Q9XD has nothing left on it.");
    expect(attempt.textContent).toContain("฿600 kept · ฿2,000 still due");
  });
});

describe("receipts from before commerce", () => {
  it("render without the Commerce copy, exactly as today, whatever the switches", async () => {
    const plain = createFixtureBackend("coupon-paid");
    const orderId = plain.useOrder("fxbill000011" as typeof COMMERCE_RECEIPT_ID)!.order._id;
    // No intl provider at all: today's receipt never reads commerce copy.
    await act(async () => root.render(createElement(ConfirmProvider, null, createElement(CheckoutBackendProvider, { backend: plain } as ComponentProps<typeof CheckoutBackendProvider>, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() })))));
    const today = article().innerHTML;
    expect(article().querySelector("[data-receipt-kind]")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await receipt(previewBackend("coupon-paid", "live"), orderId);
    expect(article().innerHTML).toBe(today);
    expect(buttons("Edit · History")).toHaveLength(0);
  });

  it("share the same text with or without commerce copy", () => {
    const view = createFixtureBackend("coupon-paid").useOrder("fxbill000011" as typeof COMMERCE_RECEIPT_ID)!;
    expect(receiptCommerce(view)).toBeNull();
    const copy = { t: (key: string) => key, money: String, date: String };
    expect(receiptText(view, "Auralis Cove Retreat", copy)).toBe(receiptText(view, "Auralis Cove Retreat"));
  });
});

describe("shared receipt text", () => {
  it("lists contents, cover, goodwill, refunds and the voucher spend, with masked codes", () => {
    const copy = {
      t: (key: string, values?: Record<string, string | number>) => {
        const messages = commerceEn.Commerce as unknown as Record<string, Record<string, string>>;
        const [group, name] = key.split(".");
        const template = messages[group]?.[name] ?? PENDING_COMMERCE_COPY[key] ?? key;
        return template.replace(/\{(\w+)\}/g, (_, field: string) => String(values?.[field] ?? ""));
      },
      money: (satang: number) => `฿${(satang / 100).toLocaleString("en", { minimumFractionDigits: satang % 100 ? 2 : 0 })}`,
      date: () => "date",
    };
    const shared = receiptText(commerceReceipt, "Auralis Cove Retreat", copy);
    expect(shared).toContain("Gold Wellness  ฿6,900");
    expect(shared).toContain("  5 × Thai massage 60 or Hot stone 60  ฿5,267.49");
    expect(shared).toContain("    GV-••••-H3LN");
    expect(shared).toContain("  Session used · was ฿1,200");
    expect(shared).toContain("  Goodwill credit  -฿100");
    expect(shared).toContain("  Refunded  -฿1,290");
    expect(shared).toContain("Goodwill credit  -฿100\nTotal  ฿9,480");
    expect(shared).toContain("Card  ฿7,480\nGift voucher GV-••••-7PAX  ฿2,000");
    expect(shared).not.toMatch(FULL_CODE);
  });
});

describe("customer display", () => {
  const shared = { businessName: "Auralis Cove Retreat", customerFirstName: "Maya", orderNumber: 1046, currency: "THB" };
  const show = (state: ComponentProps<typeof Screen>["state"]) => act(async () => root.render(createElement(NextIntlClientProvider, { ...intl, messages: displayEn } as ComponentProps<typeof NextIntlClientProvider>, createElement(Screen, { state }))));

  it("names issued vouchers by their masks only, even when sent a full code", async () => {
    await show({ ...shared, state: "paid", total: 948000, vat: 52206, amountPaid: 748000, receiptNumber: 145, paidAt: Date.now(), coupon: null, voucherCodeMasks: ["GV-••••-Q9XD", "GV-7K2M-H3LN"] } as ComponentProps<typeof Screen>["state"]);
    const codes = [...document.querySelectorAll('[data-testid="display-voucher-codes"] li')].map((li) => li.textContent);
    expect(codes).toEqual(["Gift voucher GV-••••-Q9XD", "Gift voucher GV-••••-H3LN"]);
    expect(text()).not.toMatch(FULL_CODE);
  });

  it("masks a code in a row's name or detail and shows no notes field", async () => {
    await show({
      ...shared, state: "order", subtotal: 100000, discount: 0, coupon: null, deposit: 0, total: 100000, vat: 0, due: 100000, activeAt: Date.now(),
      lines: [{ name: "Gift voucher GV-7K2M-Q9XD", detail: "Code GV-7K2M-Q9XD", qty: 1, unitPrice: 100000, price: 100000, discount: 0, couponDiscount: 0, total: 100000, deposit: 0 }],
    });
    expect(text()).toContain("Gift voucher GV-••••-Q9XD");
    expect(text()).not.toMatch(FULL_CODE);
  });

  it("masks every code shape the display could carry", () => {
    expect(maskVoucherCodes("GV-7K2M-Q9XD, GIFT-AB12-CD34 and GV-••••-Q9XD")).toBe("GV-••••-Q9XD, GIFT-••••-CD34 and GV-••••-Q9XD");
  });
});

describe("Approvals", () => {
  async function openPanel(backend: CheckoutBackend) {
    await render(backend, createElement(CheckoutStaffControls));
    const trigger = document.querySelector<HTMLElement>('[data-testid="approvals-button"]')!;
    await act(async () => trigger.click());
    await until(() => document.querySelectorAll('[data-testid="approval-request"]').length === 3 || !backend.commerce);
  }

  it("lists today's order requests and target-scoped returns and edits, marking a stale edit", async () => {
    await openPanel(previewBackend("spa", "live"));
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("3 waiting");
    const items = [...document.querySelectorAll<HTMLElement>('[data-testid="approval-request"]')];
    expect(items).toHaveLength(3);
    expect(items[0].dataset.approvalScope).toBeUndefined();
    expect(items[0].textContent).toContain("Ploy asks for a ฿180 discount (15%)");
    expect(items[1].textContent).toContain("Ploy asks to return items · ฿1,290");
    expect(items[1].textContent).toContain("Return items · Order #1046");
    expect(items[1].querySelector('[data-testid="approval-stale"]')).toBeNull();
    expect(items[2].textContent).toContain("Nok asks to extend · Massage 5 · Maya Lin");
    expect(items[2].textContent).toContain("Package sessions");
    expect(items[2].querySelector('[data-testid="approval-stale"]')?.textContent).toContain("Changed since asked");
    expect(items[2].textContent).toContain("Expected revision 6, now 7");
    // Deciding these opens with returns and edits; nothing here can approve them yet.
    expect(items[2].querySelectorAll("button")).toHaveLength(0);
  });

  it("shows only today's requests without the commerce readers", async () => {
    const base = previewBackend("spa", "live");
    await openPanel({ ...base, commerce: undefined });
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("1 waiting");
    expect(document.querySelectorAll('[data-testid="approval-request"]')).toHaveLength(1);
    expect(COMMERCE_OFF.useAccess()!.switches.vouchers).toBe("off");
  });
});

describe("Edit · History", () => {
  it("opens from a receipt row with Edit switched off, and Show guest hides staff", async () => {
    await receipt(dark());
    const trigger = document.querySelector<HTMLElement>('button[aria-label="Edit · History: Gold Wellness · 5 × Thai massage 60 or Hot stone 60"]')!;
    await act(async () => trigger.click());
    await until(() => document.querySelectorAll('[data-testid="history-entry"]').length > 0);
    const sheet = document.querySelector('[data-testid="edit-history"]')!;
    expect(sheet.textContent).toContain("Extended to 30 Dec 2026");
    expect(sheet.textContent).toContain("3 → 4 sessions · 3 paid + 1 goodwill");
    expect(sheet.querySelectorAll('[data-testid="history-staff"]').length).toBe(4);
    expect(sheet.textContent).toContain("By Ploy · Health pause or extension");
    const edit = [...sheet.querySelectorAll("button")].find((el) => el.textContent === "Edit")!;
    expect(edit.disabled).toBe(true);
    const guest = [...sheet.querySelectorAll("button")].find((el) => el.textContent === "Show guest")!;
    await act(async () => guest.click());
    await settle();
    const guestSheet = document.querySelector('[data-testid="edit-history"]')!;
    expect(guestSheet.querySelector("h2")?.textContent).toBe("Your history");
    expect(guestSheet.querySelector('[data-audience="guest"]')).not.toBeNull();
    expect(guestSheet.querySelectorAll('[data-testid="history-staff"]')).toHaveLength(0);
    expect(guestSheet.textContent).not.toContain("Ploy");
    expect(guestSheet.textContent).toContain("Thai massage 60 visit");
  });

  it("never draws staff, reasons or full codes in the guest view, even if the server sent them", async () => {
    const leaked: HistoryEntry[] = [
      { entryId: "x1", at: Date.UTC(2026, 10, 18), fact: { key: "renamed", name: "Mia GV-7K2M-Q9XD" }, balance: null, staff: { actorName: "Ploy", reason: "spellingCorrection", reasonText: "private note" } },
    ];
    const base = dark();
    const backend = { ...base, commerce: { ...base.commerce!, useHistory: () => ({ results: leaked, status: "Exhausted" as const, loadMore: () => {} }) } };
    await render(backend, createElement(HistoryList, { target: { targetType: "voucher", targetId: "fxvch" as never }, audience: "guest" }));
    expect(text()).toContain("Name changed to Mia GV-••••-Q9XD");
    expect(text()).not.toContain("Ploy");
    expect(text()).not.toContain("private note");
    expect(text()).not.toMatch(FULL_CODE);
  });
});

describe("?timing=1", () => {
  it("records each checkout write and reports its p95 on this device", async () => {
    resetTiming();
    const base = createFixtureBackend("spa");
    const actions = withTiming(base).useActions();
    await actions.addItem({ item: { kind: "extra", name: "Tea", price: 10000 } }).catch(() => undefined);
    await actions.addItem({ item: { kind: "extra", name: "Tea", price: 10000 } }).catch(() => undefined);
    expect(timingRows()).toEqual([{ action: "addItem", runs: 2, p95: expect.any(Number) }]);
    // The same actions object always gets the same timed wrapper, so memoized consumers stay stable.
    expect(withTiming(base).useActions()).toBe(actions);
  });

  it("uses the nearest-rank 95th percentile", () => {
    expect(p95([])).toBe(0);
    expect(p95([5])).toBe(5);
    expect(p95(Array.from({ length: 20 }, (_, index) => index + 1))).toBe(19);
    expect(p95(Array.from({ length: 100 }, (_, index) => 100 - index))).toBe(95);
  });
});

describe("Commerce copy patch", () => {
  it("matches the keys and English this lane sent the lead", () => {
    const patch = JSON.parse(readFileSync("docs/commerce/copy-patches/commerce-w1-l4-screens.json", "utf8")) as Record<string, { en: string }>;
    const commerce = Object.fromEntries(Object.entries(patch).filter(([key]) => key.startsWith("Commerce.")).map(([key, value]) => [key.slice("Commerce.".length), value.en]));
    expect(PENDING_COMMERCE_COPY).toEqual(commerce);
    expect(Object.keys(patch).filter((key) => !key.startsWith("Commerce."))).toEqual(["Display.giftVoucherCode"]);
  });
});
