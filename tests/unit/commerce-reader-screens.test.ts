import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { AUTO_PAGES, CheckoutStaffControls } from "@/components/checkout/ApprovalsPanel";
import { CheckoutBackendProvider, COMMERCE_OFF, type CheckoutBackend, type HistoryEntry } from "@/components/checkout/backend";
import { previewBackend } from "@/components/checkout/CheckoutPreview";
import { maskReceiptCodes, receiptCommerce, receiptText } from "@/components/checkout/checkout-ui";
import { COMMERCE_RECEIPT_ID, COMMERCE_REDEMPTION_ID, commerceReceipt, commerceRedemptionReceipt } from "@/components/checkout/design/commerce-receipt";
import { HistoryList } from "@/components/checkout/EditHistory";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { HEADER_TOOLS, p95, resetTiming, TimingReadout, timingRows, withTiming } from "@/components/checkout/timing";
import { timingOptIn, useCheckoutTiming } from "@/components/checkout/timing-gate";
import { fieldChanges, historyEntry, receiptAttempt, receiptReturnable } from "@/components/checkout/commerce-readers";
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
const searchParams = vi.hoisted(() => ({ get: (): string | null => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));

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
/** A full voucher code in any spelling: any case, with or without separators, never bullets. */
const FULL_CODE = /GV[\s\-\u2010-\u2015._]{0,3}[A-Z0-9]{4}[\s\-\u2010-\u2015._]{0,3}[A-Z0-9]{4}/i;
/** Audit r2 blocker 1: uppercase with hyphens, lowercase with hyphens, uppercase without separators, and more. */
const SPELLINGS = ["GV-7K2M-Q9XD", "gv-7k2m-q9xd", "GV7K2MQ9XD", "gv7k2mq9xd", "GV 7K2M Q9XD"];

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
    await receipt(dark(), COMMERCE_REDEMPTION_ID);
    const totals = article().querySelector("dl")!;
    expect(totals.querySelector('[data-testid="receipt-goodwill-total"]')?.textContent).toBe("Goodwill credit-฿100");
    expect(rowOf("Lemongrass oil")!.querySelector('[data-testid="receipt-line-goodwill"]')?.textContent).toBe("Goodwill credit-฿100");
    const tenders = [...totals.querySelectorAll('[data-testid="receipt-voucher-tender"]')].map((row) => row.textContent);
    expect(tenders).toEqual(["Gift voucher GV-••••-7PAX฿1,000"]);
    expect(totals.textContent).toContain("Card฿790");
    // Goodwill is never a way of paying.
    expect(tenders.join()).not.toContain("Goodwill");
    expect(totals.textContent).toContain("Total฿1,790");
    expect(totals.textContent).toContain("VAT 7% included฿117.10");
    // Goodwill is the only discount here, so no staff Discounts row.
    expect(totals.textContent).not.toContain("Discounts");
    expect(document.querySelector("header p")?.textContent).toContain("Paid by card + voucher");
  });

  it("shows the VAT the server worked out from frozen bases, and refunds against the total", async () => {
    await receipt(dark());
    const totals = article().querySelector("dl")!.textContent!;
    expect(totals).toContain("VAT 7% included฿503.08");
    expect(totals).toContain("Card฿9,190");
    expect(document.querySelector('[data-testid="receipt-refunded"]')?.textContent).toBe("Refunded-฿1,290");
    expect(document.querySelector('[data-testid="receipt-net"]')?.textContent).toBe("Net฿7,900");
  });

  it("issues and spends voucher value on separate sales, as v27 requires (no voucher in either bucket on an issuing sale)", async () => {
    const issues = (view: typeof commerceReceipt) => view.lines.some((line) => line.kind === "voucher" || line.saleSnapshot?.contents.some((content) => content.voucherId));
    const spends = (view: typeof commerceReceipt) => Boolean(view.voucherPayments?.length) || view.lines.some((line) => line.saleSnapshot?.goodwillDiscounts.length);
    expect(issues(commerceReceipt)).toBe(true);
    expect(spends(commerceReceipt)).toBe(false);
    expect(issues(commerceRedemptionReceipt)).toBe(false);
    expect(spends(commerceRedemptionReceipt)).toBe(true);
    // Both still render in the Preview, from its own receipt buttons.
    await receipt(dark());
    expect(document.querySelector("header p")?.textContent).toContain("Paid by card");
    expect(document.querySelectorAll('[data-testid="receipt-voucher-tender"]')).toHaveLength(0);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await receipt(dark(), COMMERCE_REDEMPTION_ID);
    expect(document.querySelector("header p")?.textContent).toContain("Paid by card + voucher");
  });

  it("marks a voucher-only sale as not a tax invoice (D9)", async () => {
    const voucherOnly = { ...commerceReceipt, lines: commerceReceipt.lines.filter((line) => line.kind === "voucher"), voucherPayments: [] };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? voucherOnly : null) });
    expect(document.querySelector('[data-testid="receipt-not-tax-invoice"]')?.textContent).toBe("Voucher sale · not a tax invoice");
    expect(article().textContent).not.toContain("VAT 7% included");
  });

  it("never shows a full voucher code, even if one reached the receipt by mistake", async () => {
    const leaked = { ...commerceRedemptionReceipt, voucherPayments: [{ ...commerceRedemptionReceipt.voucherPayments![0], codeMask: "GV-7K2M-7PAX" }] };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? leaked : null) });
    expect(text()).toContain("Gift voucher GV-••••-7PAX");
    expect(text()).not.toMatch(FULL_CODE);
  });

  // Audit r1 finding 1: a synthetic full code typed into an item name, then Receipt preview.
  it("masks a full code typed into a row name, part, staff name, customer or void reason on the paper", async () => {
    const code = "GV-7K2M-Q9XD";
    const [gold, ...rest] = commerceReceipt.lines;
    const typed = {
      ...commerceReceipt,
      receiptCustomer: { name: `Maya ${code}` },
      lines: [
        { ...gold, name: `Gold Wellness ${code}`, saleSnapshot: { ...gold.saleSnapshot!, contents: gold.saleSnapshot!.contents.map((content, index) => (index ? content : { ...content, label: `Massage ${code}` })) } },
        ...rest.map((line) => (line.kind === "service" ? { ...line, staffName: `Ploy ${code}` } : line)),
      ],
    };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? typed : null) });
    expect(article().textContent).toContain("Gold Wellness GV-••••-Q9XD");
    expect(article().textContent).toContain("Customer: Maya GV-••••-Q9XD");
    expect(text()).not.toMatch(FULL_CODE);
  });

  // Audit r2 blocker 1: the dark receipt, a code appended to the item name in each spelling.
  it.each(SPELLINGS)("masks %s typed into an item name on the paper and in the shared text", async (code) => {
    const typed = { ...commerceReceipt, lines: commerceReceipt.lines.map((line, index) => (index ? line : { ...line, name: `${line.name} ${code}` })) };
    const base = dark();
    await receipt({ ...base, useOrder: (id) => (id === COMMERCE_RECEIPT_ID ? typed : null) });
    expect(article().textContent).toContain("Gold Wellness GV-••••-Q9XD");
    expect(text()).not.toMatch(FULL_CODE);
    const shared = receiptText(typed, "Auralis Cove Retreat");
    expect(shared).toContain("Gold Wellness GV-••••-Q9XD");
    expect(shared).not.toMatch(FULL_CODE);
  });

  it("leaves room numbers, phone numbers, amounts and names on the paper as they are", () => {
    const plain = createFixtureBackend("coupon-paid");
    const view = plain.useOrder("fxbill000011" as typeof COMMERCE_RECEIPT_ID)!;
    const ordinary = ["Room 1204 minibar", "Call +66 81 234 5678", "Tip ฿2,600.00", "Mia Tanaka", "Gvantsa Beridze", "Booking SPA-2026-AB12CD"];
    const typed = { ...view, receiptCustomer: { name: "Maya Lin" }, lines: view.lines.map((line, index) => ({ ...line, name: ordinary[index % ordinary.length] })) };
    expect(maskReceiptCodes(typed)).toBe(typed);
  });

  it("masks a full code typed into an extra on a receipt from before commerce, and changes nothing else", async () => {
    const plain = createFixtureBackend("coupon-paid");
    const view = plain.useOrder("fxbill000011" as typeof COMMERCE_RECEIPT_ID)!;
    expect(maskReceiptCodes(view)).toBe(view);
    const typed = { ...view, lines: view.lines.map((line, index) => (index ? line : { ...line, name: "Gift for GV-7K2M-Q9XD" })) };
    await receipt({ ...plain, useOrder: (id) => (id ? typed : null) }, view.order._id);
    expect(article().textContent).toContain("Gift for GV-••••-Q9XD");
    expect(text()).not.toMatch(FULL_CODE);
    expect(receiptText(typed, "Auralis Cove Retreat")).toContain("Gift for GV-••••-Q9XD");
    expect(receiptText(typed, "Auralis Cove Retreat")).not.toMatch(FULL_CODE);
    // The masked copy differs from the original only in that name.
    expect(receiptText(typed, "Auralis Cove Retreat").replace("Gift for GV-••••-Q9XD", view.lines[0].name)).toBe(receiptText(view, "Auralis Cove Retreat"));
  });

  it("reads the receipt the same with every switch Off, without Edit · History or payment status", async () => {
    await receipt(offBackend());
    const printed = article().innerHTML;
    expect(article().textContent).toContain("GV-••••-Q9XD");
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

// Sol audit r1 major: getOrder projects paymentAttempt and activeReturn; the live receipt reads them.
describe("live receipt status (getOrder's projection)", () => {
  type OrderRead = Parameters<typeof receiptAttempt>[0];
  const ORDER = commerceReceipt.order._id;
  const projected = (extra: object) => ({ ...commerceReceipt, voucherPayments: [{ _id: "p", amount: 50000, voucherId: "fxvchgold", codeMask: "GV-••••-H3LN" }], ...extra }) as unknown as OrderRead;
  const attempt = {
    _id: "fxatt1", status: "refused", ownerRevision: 2, owner: "https://clerk|user_ploy", tillId: "till-1", due: 260000, updatedAt: 1_700_000_000_000,
    legs: [{ key: "cash", method: "cash", amount: 60000, state: "taken", received: 100000, change: 40000 }],
    refusal: { code: "VOUCHER_USED_UP", message: "used up", args: { maskedCode: "GV-••••-Q9XD" } },
    resolution: { giveBackLegs: [{ key: "back", method: "cash", amount: 10000, state: "planned" }], resolvedAt: 1 },
  };
  const activeReturn = {
    _id: "fxret1", status: "authorized", operator: "https://clerk|user_ploy", tillId: "till-1", operatorRevision: 1, approvalId: undefined, reason: "Too small", createdAt: 1_700_000_000_000,
    parts: [{ kind: "content", lineId: commerceReceipt.lines[0]._id, contentKey: "robe", units: 1, disposition: "sellable" }],
    claims: [{ key: "card", method: "card", amount: 113251, operator: "x", state: "instructed", instructedAt: 1_700_000_000_000, dueAt: 1_700_000_000_000 + 45 * 86_400_000 }],
    voucherCredits: [{ voucherId: "fxvchgold", paid: 50000, goodwill: 0 }],
  };

  it("maps the attempt's legs, give-backs and refusal, and never shows the owner's token", () => {
    const view = receiptAttempt(projected({ paymentAttempt: attempt }))!;
    expect(view).toMatchObject({ attemptId: "fxatt1", orderId: ORDER, status: "refused", ownerRevision: 2, due: 260000, mine: false, recovery: null, startedAt: 1_700_000_000_000 });
    expect(view.legs).toEqual([
      { key: "cash", direction: "collect", method: "cash", amount: 60000, state: "taken", received: 100000, change: 40000, reference: null, instructedAt: null },
      { key: "back", direction: "giveBack", method: "cash", amount: 10000, state: "planned", received: null, change: null, reference: null, instructedAt: null },
    ]);
    expect(view.refusal).toEqual({ code: "VOUCHER_USED_UP", maskedCode: "GV-••••-Q9XD" });
    expect(JSON.stringify(view)).not.toContain("user_ploy");
    expect(receiptAttempt(projected({}))).toBeNull();
    expect(receiptAttempt(projected({ paymentAttempt: { ...attempt, refusal: { code: "SOMETHING_NEW", message: "?" } } }))!.refusal).toBeNull();
  });

  it("maps an open return's parts by row name, claims and voucher credits by their receipt mask", () => {
    const { open, parts } = receiptReturnable(projected({ activeReturn }));
    expect(parts).toEqual([]);
    expect(open).toMatchObject({ returnId: "fxret1", orderId: ORDER, status: "authorized", operatorName: "", approvalId: null, total: 163251 });
    expect(open!.parts).toEqual([{ partKey: `0:content:${commerceReceipt.lines[0]._id}`, label: "Gold Wellness · Spa robe · Sand / M", units: 1, amount: 163251 }]);
    expect(open!.claims).toEqual([{ key: "card", method: "card", amount: 113251, state: "instructed", reference: null, instructedAt: 1_700_000_000_000, dueAt: 1_700_000_000_000 + 45 * 86_400_000 }]);
    expect(open!.voucherCredits).toEqual([{ voucherId: "fxvchgold", maskedCode: "GV-••••-H3LN", paid: 50000, goodwill: 0, newVoucher: false }]);
    expect(JSON.stringify(open)).not.toContain("user_ploy");
    expect(receiptReturnable(projected({})).open).toBeNull();
    // Two parts: no per-part amount is invented.
    const two = receiptReturnable(projected({ activeReturn: { ...activeReturn, parts: [...activeReturn.parts, { kind: "line", lineId: commerceReceipt.lines[1]._id, units: 1 }] } }));
    expect(two.open!.parts.map((part) => part.amount)).toEqual([null, null]);
  });

  // Sol r2: goodwill going back onto a voucher the guest holds has no tender to read a mask from.
  it("names an existing voucher as the credit's destination when the return says so, and a new one otherwise", async () => {
    const credit = { voucherId: "fxvchgold", paid: 0, goodwill: 10000 };
    const existing = { ...activeReturn, voucherCredits: [{ ...credit, destination: { kind: "existingVoucher", voucherId: "fxvchgold", codeMask: "GV-••••-7PAX" } }] };
    const plain = (extra: object) => ({ ...commerceReceipt, voucherPayments: [], ...extra }) as unknown as OrderRead;
    expect(receiptReturnable(plain({ activeReturn: existing })).open!.voucherCredits).toEqual([{ ...credit, maskedCode: "GV-••••-7PAX", newVoucher: false, existingVoucher: true }]);
    expect(receiptReturnable(plain({ activeReturn: { ...activeReturn, voucherCredits: [{ ...credit, destination: { kind: "newVoucher" } }] } })).open!.voucherCredits)
      .toEqual([{ ...credit, maskedCode: "", newVoucher: true }]);
    // Before the backend says where it goes, the receipt's masks decide, as before.
    expect(receiptReturnable(plain({ activeReturn: { ...activeReturn, voucherCredits: [credit] } })).open!.voucherCredits).toEqual([{ ...credit, maskedCode: "", newVoucher: false }]);
    // An existing voucher whose mask the server couldn't read still isn't called new.
    const unknown = { ...activeReturn, voucherCredits: [{ ...credit, destination: { kind: "existingVoucher", voucherId: "fxvchgold", codeMask: null } }] };
    expect(receiptReturnable(plain({ activeReturn: unknown })).open!.voucherCredits).toEqual([{ ...credit, maskedCode: "", newVoucher: false, existingVoucher: true }]);
    // A full code sent by mistake is masked.
    const leaked = { ...activeReturn, voucherCredits: [{ ...credit, destination: { kind: "existingVoucher", voucherId: "fxvchgold", codeMask: "gv7k2m7pax" } }] };
    expect(receiptReturnable(plain({ activeReturn: leaked })).open!.voucherCredits[0].maskedCode).toBe("GV-••••-7PAX");

    const render = async (open: object) => {
      const view = plain({ activeReturn: open });
      const base = dark();
      await receipt({ ...base, useOrder: () => view, commerce: { ...base.commerce!, useReturnable: () => receiptReturnable(view) } } as CheckoutBackend);
      return document.querySelector('[data-testid="receipt-open-return"]')!.textContent;
    };
    expect(await render(existing)).toContain("฿100 back to voucher GV-••••-7PAX");
    expect(await render(existing)).not.toContain("new voucher");
    expect(await render({ ...activeReturn, voucherCredits: [{ ...credit, destination: { kind: "newVoucher" } }] })).toContain("฿100 on a new voucher (90 days)");
    expect(await render(unknown)).toContain("฿100 back to voucher GV-••••");
    expect(await render(unknown)).not.toContain("new voucher");
  });

  it("renders the live cards on the real receipt from the same order read", async () => {
    const view = projected({ paymentAttempt: attempt, activeReturn });
    const base = dark();
    const live = { ...base, useOrder: () => view, commerce: { ...base.commerce!, usePaymentAttempt: () => receiptAttempt(view), useReturnable: () => receiptReturnable(view) } } as CheckoutBackend;
    await receipt(live);
    expect(document.querySelector('[data-testid="receipt-attempt"]')?.textContent).toContain("Money taken · sale not saved");
    const open = document.querySelector('[data-testid="receipt-open-return"]')!;
    expect(open.textContent).toContain("Gold Wellness · Spa robe · Sand / M");
    expect(open.textContent).toContain("฿1,132.51 to Card");
    expect(open.textContent).toContain("฿500 back to voucher GV-••••-H3LN");
    expect(text()).not.toContain("user_ploy");
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
        const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], commerceEn.Commerce);
        const template = typeof found === "string" ? found : key;
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
    expect(shared).toContain("  Refunded  -฿1,290");
    expect(shared).toContain("Total  ฿9,190");
    expect(shared).not.toMatch(FULL_CODE);
    const spent = receiptText(commerceRedemptionReceipt, "Auralis Cove Retreat", copy);
    expect(spent).toContain("  Goodwill credit  -฿100");
    expect(spent).toContain("Goodwill credit  -฿100\nTotal  ฿1,790");
    expect(spent).toContain("Card  ฿790\nGift voucher GV-••••-7PAX  ฿1,000");
    // A code typed into a name is masked in the shared text too (audit r1 finding 1).
    const typed = { ...commerceReceipt, lines: commerceReceipt.lines.map((line) => (line.kind === "voucher" ? { ...line, name: "Gift voucher GV-7K2M-Q9XD" } : line)) };
    expect(receiptText(typed, "Auralis Cove Retreat", copy)).toContain("Gift voucher GV-••••-Q9XD  ฿1,000");
    expect(receiptText(typed, "Auralis Cove Retreat", copy)).not.toMatch(FULL_CODE);
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
    expect(maskVoucherCodes("GV-7K2M-Q9XD, gv-ab12-cd34, GV7K2MH3LN and GV-••••-Q9XD")).toBe("GV-••••-Q9XD, GV-••••-CD34, GV-••••-H3LN and GV-••••-Q9XD");
    expect(maskVoucherCodes("Room 1204 · +66 81 234 5678 · ฿2,600")).toBe("Room 1204 · +66 81 234 5678 · ฿2,600");
  });

  // Audit r2 blocker 1: a room order with the code appended to an extra, on the paired display.
  it.each(SPELLINGS)("masks %s in a row's name, detail and the customer's name", async (code) => {
    await show({
      ...shared, customerFirstName: `Maya ${code}`, state: "order", subtotal: 100000, discount: 0, coupon: null, deposit: 0, total: 100000, vat: 0, due: 100000, activeAt: Date.now(),
      lines: [{ name: `Tideglass Pool Residence ${code}`, detail: `Extra ${code}`, qty: 1, unitPrice: 100000, price: 100000, discount: 0, couponDiscount: 0, total: 100000, deposit: 0 }],
    });
    expect(text()).toContain("Tideglass Pool Residence GV-••••-Q9XD");
    expect(text()).not.toMatch(FULL_CODE);
  });
});

describe("Approvals", () => {
  async function openPanel(backend: CheckoutBackend) {
    await render(backend, createElement(CheckoutStaffControls));
    const trigger = document.querySelector<HTMLElement>('[data-testid="approvals-button"]')!;
    await act(async () => trigger.click());
    await until(() => document.querySelectorAll('[data-testid="approval-request"]').length === 3 || !backend.commerce);
  }
  const items = () => [...document.querySelectorAll<HTMLElement>('[data-testid="approval-request"]')];
  /** Counts what the panel reads: the queue once, a detail per selected request, never an order. */
  function counted(backend: CheckoutBackend) {
    const details = new Set<string>();
    const orders = vi.fn();
    return {
      details, orders,
      backend: {
        ...backend,
        useOrder: (id: Parameters<CheckoutBackend["useOrder"]>[0], view?: Parameters<CheckoutBackend["useOrder"]>[1]) => { orders(id); return backend.useOrder(id, view); },
        useApprovalDetail: (id: Parameters<CheckoutBackend["useApprovalDetail"]>[0]) => { if (id) details.add(id); return backend.useApprovalDetail(id); },
      } satisfies CheckoutBackend,
    };
  }

  it("lists every request as one compact page and opens only the selected one's detail", async () => {
    const { backend, details, orders } = counted(previewBackend("spa", "live"));
    await openPanel(backend);
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("3 waiting");
    expect(items()).toHaveLength(3);
    // The one that expires first is open: the stale extension, with what changed.
    await until(() => Boolean(items()[2].querySelector('[data-testid="approval-stale"]')));
    expect(items().map((item) => item.dataset.approvalSelected)).toEqual(["false", "false", "true"]);
    expect(items()[2].textContent).toContain("Nok asks to extend · Massage 5 · Maya Lin");
    expect(items()[2].textContent).toContain("Package sessions");
    expect(items()[2].querySelector('[data-testid="approval-stale"]')?.textContent).toContain("Changed since asked");
    expect(items()[2].textContent).toContain("Expected revision 6, now 7");
    // Deciding these opens with returns and edits; nothing here can approve them yet.
    expect(items()[2].querySelectorAll("button")).toHaveLength(0);
    // The others are compact rows from the queue alone.
    expect(items()[0].dataset.approvalScope).toBeUndefined();
    expect(items()[0].textContent).toContain("Ploy asks for a ฿180 discount (15%)");
    expect(items()[0].textContent).not.toContain("Regular guest, birthday");
    expect(items()[1].textContent).toContain("Ploy asks to return items · ฿1,290");
    expect(items()[1].textContent).not.toContain("Robe too small");
    expect([...details]).toEqual(["fxappr000003"]);
    // No order is read for the list.
    expect(orders).not.toHaveBeenCalled();

    await act(async () => items()[0].querySelector("button")!.click());
    await until(() => items()[0].textContent!.includes("Regular guest, birthday"));
    expect(items()[0].dataset.approvalSelected).toBe("true");
    expect(items()[2].dataset.approvalSelected).toBe("false");
    expect(items()[0].textContent).toContain("Thai massage 90 · Order #1042");
    expect(buttons("Approve")).toHaveLength(1);

    await act(async () => items()[1].querySelector("button")!.click());
    await until(() => items()[1].textContent!.includes("Robe too small"));
    expect(items()[1].textContent).toContain("Return items · Order #1046");
    expect([...details]).toEqual(["fxappr000003", "fxappr000001", "fxappr000002"]);
    expect(orders).not.toHaveBeenCalled();
  });

  it("loads the next cursor page on Show more requests", async () => {
    const base = previewBackend("spa", "live");
    const loadMore = vi.fn();
    await openPanel({ ...base, usePendingApprovals: () => ({ ...base.usePendingApprovals(), status: "CanLoadMore", loadMore }) });
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("3+ waiting");
    const more = buttons("Show more requests")[0];
    await act(async () => more.click());
    expect(loadMore).toHaveBeenCalledWith(20);
  });

  // Audit r2 blocker 2: a promoted cashier's own newer requests fill the first page.
  it("reads past a first page with nothing to approve and never says Nothing waiting while pages remain", async () => {
    const base = previewBackend("spa", "live");
    const waiting = base.usePendingApprovals().results.filter((row) => row.kind === "discount");
    const loadMore = vi.fn();
    function usePendingApprovals() {
      const [pages, setPages] = useState(1);
      return pages === 1
        ? { results: [], status: "CanLoadMore" as const, loadMore: (n: number) => { loadMore(n); setPages(2); } }
        : { results: waiting, status: "Exhausted" as const, loadMore };
    }
    await render({ ...base, usePendingApprovals }, createElement(CheckoutStaffControls));
    await settle();
    expect(loadMore).toHaveBeenCalledWith(20);
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("1 waiting");
    await act(async () => document.querySelector<HTMLElement>('[data-testid="approvals-button"]')!.click());
    await until(() => items().length === 1);
    expect(items()[0].textContent).toContain("Ploy asks for a ฿180 discount (15%)");
    expect(text()).not.toContain("Nothing waiting");
  });

  it(`stops reading on its own after ${AUTO_PAGES} pages and offers Show more requests instead of Nothing waiting`, async () => {
    const base = previewBackend("spa", "live");
    const loadMore = vi.fn();
    await render({ ...base, usePendingApprovals: () => ({ results: [], status: "CanLoadMore" as const, loadMore }) }, createElement(CheckoutStaffControls));
    await settle();
    expect(loadMore).toHaveBeenCalledTimes(AUTO_PAGES);
    expect(document.querySelector("[data-approval-count]")).toBeNull();
    await act(async () => document.querySelector<HTMLElement>('[data-testid="approvals-button"]')!.click());
    expect(text()).not.toContain("Nothing waiting");
    expect(document.querySelector('[data-testid="approvals-none-loaded"]')?.textContent).toBe("None you can approve in the newest requests.");
    await act(async () => buttons("Show more requests")[0].click());
    expect(loadMore).toHaveBeenCalledTimes(AUTO_PAGES + 1);
    // Exhausted and empty: now it is nothing.
    await render({ ...base, usePendingApprovals: () => ({ results: [], status: "Exhausted" as const, loadMore }) }, createElement(CheckoutStaffControls));
    expect(text()).toContain("Nothing waiting.");
    expect(buttons("Show more requests")).toHaveLength(0);
  });

  // Sol r2: stale requests from before commerce don't count as waiting or open first.
  it("counts only requests that can still be decided and opens the first of those", async () => {
    const base = previewBackend("spa", "live");
    const rows = base.usePendingApprovals().results;
    const soonest = rows.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b));
    const marked = rows.map((row) => (row._id === soonest._id ? { ...row, actionable: false } : row));
    const { backend, details } = counted({ ...base, usePendingApprovals: () => ({ ...base.usePendingApprovals(), results: marked }) });
    await openPanel(backend);
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("2 waiting");
    expect(items()).toHaveLength(3);
    expect(details.has(soonest._id)).toBe(false);
    expect(details.size).toBe(1);
  });

  it("shows only today's requests without the commerce readers", async () => {
    const base = previewBackend("spa", "live");
    await openPanel({ ...base, commerce: undefined });
    expect(document.querySelector("[data-approval-count]")?.textContent).toBe("1 waiting");
    expect(items()).toHaveLength(1);
    expect(COMMERCE_OFF.useAccess()!.switches.vouchers).toBe("off");
  });

  // Audit r1 finding 7: every control is 44 × 44 px with a mouse too, not only on touch screens.
  it("sizes About approvals, Close, Decline and Approve to 44 × 44 at any pointer", async () => {
    await openPanel(previewBackend("spa", "live"));
    await act(async () => items()[0].querySelector("button")!.click());
    await until(() => buttons("Approve").length === 1);
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.className).toContain("[&_button]:min-h-11");
    expect(panel.className).toContain("[&_button]:min-w-11");
    const tip = panel.querySelector<HTMLElement>('button[aria-label="About approvals"]')!;
    expect(tip.className).not.toContain("pointer-coarse:-my-3");
    expect(tip.className).toContain("-my-3");
    expect(buttons("Approve")).toHaveLength(1);
    expect(buttons("Decline")).toHaveLength(1);
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

  // Audit r1 finding 4: a voucher's History is its own money ledger, not a package's sessions.
  it("reads a voucher's money balance, spends and goodwill, and a grant's sessions, each from its own stream", async () => {
    await receipt(dark());
    const open = async (label: string) => {
      const trigger = document.querySelector<HTMLElement>(`button[aria-label="Edit · History: ${label}"]`)!;
      await act(async () => trigger.click());
      await until(() => document.querySelectorAll('[data-testid="history-entry"]').length > 0);
      return document.querySelector('[data-testid="edit-history"]')!;
    };
    const voucher = await open("Gift voucher");
    expect(voucher.textContent).toContain("Issued ฿1,000");
    expect(voucher.textContent).toContain("Paid ฿500");
    expect(voucher.textContent).toContain("฿1,000 → ฿500");
    expect(voucher.textContent).toContain("Goodwill added");
    expect(voucher.textContent).toContain("Name changed to Mia Tanaka");
    expect(voucher.textContent).not.toMatch(/sessions|Massage 5/);
    const guest = [...voucher.querySelectorAll("button")].find((el) => el.textContent === "Show guest")!;
    await act(async () => guest.click());
    await settle();
    const guestSheet = document.querySelector('[data-testid="edit-history"]')!;
    expect(guestSheet.textContent).toContain("Issued ฿1,000");
    expect(guestSheet.textContent).not.toMatch(/sessions|Massage 5|Ploy|Nok/);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await receipt(dark());
    const grant = await open("Gold Wellness · 5 × Thai massage 60 or Hot stone 60");
    expect(grant.textContent).toContain("3 → 4 sessions");
    expect(grant.textContent).toContain("Gold Wellness");
    expect(grant.textContent).not.toContain("Massage 5");
  });

  // Audit r1 finding 2: Show guest covers the whole staff screen, not only the sheet.
  it("puts an opaque scrim over the staff screen while the guest view shows, and lifts it for staff", async () => {
    await receipt(dark());
    const trigger = document.querySelector<HTMLElement>('button[aria-label="Edit · History: Gold Wellness · 5 × Thai massage 60 or Hot stone 60"]')!;
    await act(async () => trigger.click());
    await until(() => document.querySelectorAll('[data-testid="history-entry"]').length > 0);
    const scrim = () => [...document.querySelectorAll<HTMLElement>("[data-state=open]")].find((el) => el.className.includes("fixed inset-0"))!;
    expect(scrim().className).toContain("md:bg-black/15");
    const guest = [...document.querySelectorAll("button")].find((el) => el.textContent === "Show guest")!;
    await act(async () => guest.click());
    await settle();
    expect(document.querySelector('[data-testid="edit-history"]')?.hasAttribute("data-guest-screen")).toBe(true);
    expect(scrim().className).toMatch(/(^| )bg-background( |$)/);
    expect(scrim().className).toContain("md:bg-background");
    expect(scrim().className).not.toContain("md:bg-black/15");
    expect(scrim().className).not.toContain("/80");
    const staff = [...document.querySelectorAll("button")].find((el) => el.textContent === "Show staff view" || el.getAttribute("aria-pressed") === "true")!;
    await act(async () => staff.click());
    await settle();
    expect(scrim().className).toContain("md:bg-black/15");
  });

  // Sol r2: staff rows carry each field an edit changed, before → after, with the reason.
  it("shows staff what an edit changed, before → after, with the reason, and never shows it to the guest", async () => {
    const row = {
      entryId: "adj1", at: Date.UTC(2026, 10, 18), fact: { key: "published" }, balance: null,
      before: { price: 100000, name: "Gold Wellness", validityDays: 180, allowTransfer: true, refundDueDays: { cashOrTransfer: 15, card: 45 }, contents: [{ key: "a" }], note: "GV-7K2M-Q9XD" },
      after: { price: 120000, name: "Gold Wellness", validityDays: 365, allowTransfer: false, refundDueDays: { cashOrTransfer: 15, card: 30 }, contents: [{ key: "a" }, { key: "b" }], note: "gv7k2mh3ln", expiresAt: Date.UTC(2026, 11, 30) },
      staff: { actorName: "Ploy", reason: "healthPause", reasonText: "Owner asked" },
    } as unknown as Parameters<typeof historyEntry>[0];
    const entry = historyEntry(row);
    expect(entry.changes).toEqual([
      { field: "price", before: 100000, after: 120000 },
      { field: "validityDays", before: 180, after: 365 },
      { field: "allowTransfer", before: true, after: false },
      { field: "refundDueDays.card", before: 45, after: 30 },
      { field: "contents", before: { items: 1 }, after: { items: 2 } },
      { field: "note", before: "GV-••••-Q9XD", after: "GV-••••-H3LN" },
      { field: "expiresAt", before: undefined, after: Date.UTC(2026, 11, 30) },
    ]);
    expect(fieldChanges({ name: "Same" }, { name: "Same" })).toEqual([]);
    const guestRow = { ...(row as unknown as Record<string, unknown>), staff: undefined };
    expect(historyEntry(guestRow as unknown as Parameters<typeof historyEntry>[0]).changes).toBeUndefined();

    const base = dark();
    const backend = { ...base, commerce: { ...base.commerce!, useHistory: () => ({ results: [entry], status: "Exhausted" as const, loadMore: () => {} }) } };
    await render(backend, createElement(HistoryList, { target: { targetType: "package", targetId: "fxpkg" as never }, audience: "staff" }));
    const changes = [...document.querySelectorAll('[data-testid="history-changes"] li')].map((li) => li.textContent);
    expect(changes).toEqual([
      "Price: ฿1,000 → ฿1,200", "Validity days: 180 → 365", "Allow transfer: On → Off", "Refund due days · Card: 45 → 30",
      "Contents: 1 item → 2 items", "Note: GV-••••-Q9XD → GV-••••-H3LN", "Ends: — → 30 Dec 2026",
    ]);
    expect(document.querySelector('[data-testid="history-staff"]')?.textContent).toContain("By Ploy · Health pause or extension · Owner asked");
    expect(text()).not.toMatch(FULL_CODE);
    // The same entry, if it ever reached the guest view, shows no changes, staff or reason.
    await render(backend, createElement(HistoryList, { target: { targetType: "package", targetId: "fxpkg" as never }, audience: "guest" }));
    expect(document.querySelector('[data-testid="history-changes"]')).toBeNull();
    expect(text()).not.toContain("฿1,200");
    expect(text()).not.toContain("Ploy");
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

  // Audit r1 finding 3: creating the order drops ?timing=1; the tab stays opted in through settlement.
  it("keeps timing on for this tab after navigation drops ?timing=1, until ?timing=0", () => {
    window.sessionStorage.clear();
    expect(timingOptIn(null)).toBe(false);
    expect(timingOptIn("1")).toBe(true);
    expect(timingOptIn(null)).toBe(true);
    expect(timingOptIn("0")).toBe(false);
    expect(timingOptIn(null)).toBe(false);
  });

  it("times settlement after the order's navigation drops the query", async () => {
    window.sessionStorage.clear();
    resetTiming();
    const base = createFixtureBackend("spa");
    let param: string | null = "1";
    let actions: ReturnType<CheckoutBackend["useActions"]> | null = null;
    function Page() {
      const { backend, readout } = useCheckoutTiming(base);
      actions = backend.useActions();
      return readout;
    }
    searchParams.get = () => param;
    await act(async () => root.render(createElement(Page)));
    await until(() => document.querySelector('[data-testid="checkout-timing"]') !== null);
    // New order: the URL becomes /admin/checkout?order=… without timing.
    param = null;
    await act(async () => root.render(createElement(Page)));
    await until(() => actions !== base.useActions());
    await actions!.addItem({ item: { kind: "extra", name: "Tea", price: 10000 } }).catch(() => undefined);
    await actions!.settleOrder({} as never).catch(() => undefined);
    expect(timingRows().map((row) => row.action).sort()).toEqual(["addItem", "settleOrder"]);
    expect(document.querySelector('[data-testid="checkout-timing"]')).not.toBeNull();
    window.sessionStorage.clear();
  });

  // Audit r2 finding 3: at 390 the fixed panel took taps meant for View order and Cash.
  it("sits in the admin header as a button, closed, and never over the page", async () => {
    resetTiming();
    const header = document.body.appendChild(document.createElement("header"));
    const slot = header.appendChild(document.createElement("div"));
    slot.setAttribute(HEADER_TOOLS, "");
    await act(async () => root.render(createElement(TimingReadout)));
    const trigger = document.querySelector<HTMLElement>('[data-testid="checkout-timing"]')!;
    expect(slot.contains(trigger)).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-testid="checkout-timing-panel"]')).toBeNull();
    expect(document.querySelector(".fixed")).toBeNull();
    await act(async () => trigger.click());
    await until(() => document.querySelector('[data-testid="checkout-timing-panel"]') !== null);
    expect(document.querySelector('[data-testid="checkout-timing-panel"]')!.textContent).toContain("Nothing timed yet");
  });

  it("uses the nearest-rank 95th percentile", () => {
    expect(p95([])).toBe(0);
    expect(p95([5])).toBe(5);
    expect(p95(Array.from({ length: 20 }, (_, index) => index + 1))).toBe(19);
    expect(p95(Array.from({ length: 100 }, (_, index) => 100 - index))).toBe(95);
  });
});
