import { describe, expect, it } from "vitest";
import {
  MAX_BILL,
  MAX_PRICE,
  MAX_QTY,
  assertBillSize,
  assertPriceOverride,
  assertTenders,
  billTotals,
  bookingPayable,
  changeDue,
  formatOrderNumber,
  formatReceiptNumber,
  orderTitle,
  lineDiscount,
  lineNet,
  round2,
} from "convex/lib/billMath";
import { parseCheckoutSource } from "@/components/checkout/checkout-source";
import { amountInput, orderTime, receiptText } from "@/components/checkout/checkout-ui";

describe("bill math", () => {
  it("shows the 7% VAT already included in the total", () => {
    expect(billTotals([{ unitPrice: 1070, qty: 1 }])).toEqual({ subtotal: 1070, discount: 0, total: 1070, vat: 70, deposit: 0, due: 1070 });
    expect(billTotals([{ unitPrice: 1200, qty: 1 }, { unitPrice: 600, qty: 1 }]).vat).toBe(117.76);
  });

  it("applies amount and percent discounts per line and caps them at the line", () => {
    expect(lineNet({ unitPrice: 1000, qty: 2, discount: { type: "percent", value: 15 } })).toBe(1700);
    expect(lineNet({ unitPrice: 500, qty: 1, discount: { type: "amount", value: 800 } })).toBe(0);
    expect(lineNet({ unitPrice: 1200, qty: 1, priceOverride: { price: 900 }, discount: { type: "amount", value: 100 } })).toBe(800);
  });

  it("deducts deposits from what is due, never below zero", () => {
    expect(billTotals([{ unitPrice: 30000, qty: 1, deposit: 10000 }, { unitPrice: 1200, qty: 1 }])).toMatchObject({ total: 31200, deposit: 10000, due: 21200 });
    expect(billTotals([{ unitPrice: 5000, qty: 1, deposit: 5000, discount: { type: "amount", value: 1000 } }])).toMatchObject({ total: 4000, deposit: 4000, due: 0 });
  });

  it("validates split tenders against what is due", () => {
    expect(() => assertTenders([{ method: "cash", amount: 1000 }, { method: "promptpay", amount: 800 }], 1800)).not.toThrow();
    expect(() => assertTenders([{ method: "cash", amount: 1000 }], 1800)).toThrow("Payments add up to 1000, but 1800 is due");
    expect(() => assertTenders([1, 1, 1, 1].map((amount) => ({ method: "card" as const, amount })), 4)).toThrow("at most 3");
    expect(() => assertTenders([{ method: "card", amount: 0 }, { method: "cash", amount: 10 }], 10)).toThrow("more than zero");
    expect(() => assertTenders([{ method: "card", amount: 10, received: 20 }], 10)).toThrow("Only cash");
    expect(() => assertTenders([], 0)).not.toThrow();
    expect(changeDue([{ method: "cash", amount: 1800, received: 2000 }, { method: "card", amount: 200 }])).toBe(200);
  });

  it("rounds half-satang amounts up as on paper, not by binary float error", () => {
    expect(lineNet({ unitPrice: 10.05, qty: 1, discount: { type: "percent", value: 10 } })).toBe(9.04);
    expect(lineNet({ unitPrice: 30.5, qty: 1, discount: { type: "percent", value: 7 } })).toBe(28.36);
    expect(lineNet({ unitPrice: 0.15, qty: 1, discount: { type: "percent", value: 50 } })).toBe(0.07);
    expect(lineNet({ unitPrice: 100, qty: 1, discount: { type: "percent", value: 12.5 } })).toBe(87.5);
    expect(lineNet({ unitPrice: 100, qty: 1, discount: { type: "percent", value: 150 } })).toBe(0);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    // VAT 7/107 of the total: 99.50 → 6.509… and 31,080 → 2,033.271…
    expect(billTotals([{ unitPrice: 99.5, qty: 1 }]).vat).toBe(6.51);
    expect(billTotals([{ unitPrice: 31080, qty: 1 }]).vat).toBe(2033.27);
  });

  it("refuses payments finer than a satang", () => {
    expect(() => assertTenders([{ method: "cash", amount: 600.004 }, { method: "card", amount: 599.996 }], 1200)).toThrow("whole satang");
    expect(() => assertTenders([{ method: "cash", amount: 1200, received: 1500.005 }], 1200)).toThrow("whole satang");
    expect(() => assertTenders([{ method: "cash", amount: 0.1 }, { method: "card", amount: 0.2 }], 0.3)).not.toThrow();
  });

  it("refuses cash received that is infinite or beyond any till amount (C5-02)", () => {
    expect(() => assertTenders([{ method: "cash", amount: 90, received: Infinity }], 90)).toThrow("Cash received");
    expect(() => assertTenders([{ method: "cash", amount: 90, received: 1e12 }], 90)).toThrow("at most");
    expect(() => assertPriceOverride(1e12, "Typo")).toThrow("at most");
  });

  it("keeps percent discounts exact up to the till limits (K5-02)", () => {
    // Exact half-up satang, independently: gross satang × hundredths of a percent / 10,000.
    const exact = (satang: bigint, bp: bigint) => Number((BigInt(2) * satang * bp + BigInt(10000)) / BigInt(20000)) / 100;
    for (const [unitPrice, qty, percent] of [[101010.1, 99, 97.11], [101010.09, 99, 97.11], [MAX_PRICE, 10, 33.33], [99999.99, 99, 0.01], [100000.01, 99, 99.99]] as const) {
      const gross = round2(unitPrice * qty);
      expect(gross).toBeLessThanOrEqual(MAX_BILL);
      const discount = lineDiscount({ unitPrice, qty, discount: { type: "percent", value: percent } });
      expect(discount).toBe(exact(BigInt(Math.round(gross * 100)), BigInt(Math.round(percent * 100))));
    }
    // The round 6 case (999,999,999.82 × 99) can't be entered any more.
    expect(() => assertPriceOverride(999_999_999.82, "x")).toThrow("at most 1,000,000");
    expect(() => assertBillSize(billTotals([{ unitPrice: MAX_PRICE, qty: MAX_QTY }]))).toThrow("An order is at most 10,000,000");
    expect(() => assertBillSize(billTotals([{ unitPrice: MAX_PRICE, qty: 10 }]))).not.toThrow();
    expect(() => assertTenders([{ method: "cash", amount: MAX_BILL, received: MAX_BILL + 100 }], MAX_BILL)).toThrow("at most 10,000,000");
  });

  it("counts what an extended paid stay still owes, like checkout does (C6-01)", () => {
    const stay = { status: "confirmed", paymentStatus: "paid", total: 20000, amountPaid: 10000 };
    expect(bookingPayable(stay)).toBe(true);
    expect(bookingPayable({ ...stay, amountPaid: 20000 })).toBe(false);
    expect(bookingPayable({ ...stay, amountPaid: undefined })).toBe(false);
    expect(bookingPayable({ ...stay, paymentStatus: "pending", amountPaid: undefined })).toBe(true);
    expect(bookingPayable({ ...stay, status: "cancelled" })).toBe(false);
    expect(bookingPayable({ ...stay, paymentStatus: "refunded" })).toBe(false);
  });

  it("requires a note for a price override", () => {
    expect(() => assertPriceOverride(900, "   ")).toThrow("Add a note");
    expect(() => assertPriceOverride(-1, "x")).toThrow("zero or more");
    expect(assertPriceOverride(900, " Regular guest ")).toBe("Regular guest");
  });

  it("formats receipt and order numbers separately", () => {
    expect(formatReceiptNumber(142)).toBe("R-000142");
    expect(formatOrderNumber(1042)).toBe("#1042");
    expect(orderTitle(1042)).toBe("Order #1042");
    expect(orderTitle(undefined)).toBe("Order");
  });
});

describe("checkout source", () => {
  const parse = (query: string) => parseCheckoutSource(new URLSearchParams(query));

  it("opens a new order, one order, booking or appointment", () => {
    expect(parse("")).toEqual({ kind: "new" });
    expect(parse("order=k17abc123def")).toEqual({ kind: "order", id: "k17abc123def" });
    // Links from before orders.
    expect(parse("bill=k17abc123def")).toEqual({ kind: "order", id: "k17abc123def", legacy: true });
    expect(parse("booking=k17abc123def")).toEqual({ kind: "booking", id: "k17abc123def" });
    expect(parse("appointment=k17abc123def&utm=x")).toEqual({ kind: "appointment", id: "k17abc123def" });
  });

  it.each(["order=k17abc123def&booking=k17abc123def", "order=k17abc123def&bill=k17abc123def", "booking=k17abc123def&booking=k17abc999def", "booking=", "order=../x"])("refuses %s", (query) => {
    expect(parse(query).kind).toBe("invalid");
  });
});

describe("checkout inputs and labels", () => {
  it("keeps typed money to digits, one decimal point and two decimals", () => {
    expect(amountInput("1,200")).toBe("1200");
    expect(amountInput("฿ 99.5")).toBe("99.5");
    expect(amountInput("1.2.3")).toBe("1.23");
    expect(amountInput("10.999")).toBe("10.99");
    expect(amountInput(".5")).toBe(".5");
    expect(amountInput("abc")).toBe("");
    // Never above the till limits, so a held-down key or a shortcut can't make an amount the server refuses.
    expect(amountInput("9".repeat(400))).toBe("10000000");
    expect(amountInput("10000099.99")).toBe("10000000");
    expect(amountInput("9999999.99")).toBe("9999999.99");
    expect(amountInput("1000000.01", MAX_PRICE)).toBe("1000000");
  });

  it("dates orders changed on other days", () => {
    const now = new Date(2026, 9, 29, 9, 30).getTime();
    expect(orderTime(new Date(2026, 9, 29, 8, 5).getTime(), now)).toBe("08:05");
    expect(orderTime(new Date(2026, 9, 28, 23, 56).getTime(), now)).toBe("28 Oct, 23:56");
  });
});

describe("shared receipt text", () => {
  const view = (payments: { method: "cash" | "card"; amount: number; received?: number }[], extra: Record<string, unknown> = {}) =>
    ({
      order: { status: "paid", receiptNumber: 142, orderNumber: 1042, title: "Order #1042", paidAt: new Date(2026, 9, 29, 14, 5).getTime() },
      receiptCustomer: null,
      legacyGuest: null,
      source: null,
      ...extra,
      lines: [{ name: "Thai massage 60", qty: 1, net: 1200 }],
      payments,
      totals: { subtotal: 1200, discount: 0, total: 1200, vat: 78.5, deposit: 0, due: 1200 },
    }) as unknown as Parameters<typeof receiptText>[0];

  it("shows the cash handed over and the change, like the printed receipt", () => {
    const text = receiptText(view([{ method: "cash", amount: 1200, received: 1500 }]), "Resort");
    expect(text).toContain("Receipt R-000142");
    expect(text).toContain("Order #1042");
    expect(text).not.toContain("Customer:");
    expect(text).toContain("VAT 7% included  ฿78.50");
    expect(text).toContain("Cash  ฿1,500");
    expect(text).toContain("Change  ฿300");
  });

  it("names the customer frozen at payment and the booking, never a walk-in label", () => {
    const text = receiptText(view([{ method: "card", amount: 1200 }], { receiptCustomer: { name: "Bob Payer" }, source: { reference: "CONF-ANNA" } }), "Resort");
    expect(text).toContain("Customer: Bob Payer");
    expect(text).toContain("Booking: CONF-ANNA");
    expect(text).not.toMatch(/walk-?in/i);
  });

  it("lists every booking the order is for, its own first", () => {
    const sources = [{ reference: "CONF-ANNA" }, { reference: "SVC-EVE" }];
    const text = receiptText(view([{ method: "card", amount: 1200 }], { source: sources[0], sources }), "Resort");
    expect(text).toContain("Bookings: CONF-ANNA, SVC-EVE");
    expect(receiptText(view([{ method: "card", amount: 1200 }], { sources: [] }), "Resort")).not.toContain("Booking");
  });

  it("leaves change out when nothing is owed back", () => {
    const text = receiptText(view([{ method: "card", amount: 1200 }]), "Resort");
    expect(text).toContain("Card  ฿1,200");
    expect(text).not.toContain("Change");
  });
});
