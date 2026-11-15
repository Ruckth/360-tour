import { describe, expect, it } from "vitest";
import {
  MAX_ORDER,
  MAX_PRICE,
  MAX_QTY,
  assertOrderSize,
  assertPriceOverride,
  assertTenders,
  orderTotals,
  bookingPayable,
  changeDue,
  formatOrderNumber,
  formatReceiptNumber,
  orderTitle,
  lineDiscount,
  lineNet,
  roundMoney,
} from "convex/shared/orderMath";
import { parseCheckoutSource } from "@/components/checkout/checkout-source";
import { amountInput, orderTime, receiptText } from "@/components/checkout/checkout-ui";

describe("order math", () => {
  it("shows the 7% VAT already included in the total", () => {
    expect(orderTotals([{ unitPrice: 107000, qty: 1 }])).toEqual({ subtotal: 107000, discount: 0, coupon: 0, total: 107000, vat: 7000, deposit: 0, due: 107000 });
    expect(orderTotals([{ unitPrice: 120000, qty: 1 }, { unitPrice: 60000, qty: 1 }]).vat).toBe(11776);
  });

  it("applies amount and percent discounts per line and caps them at the line", () => {
    expect(lineNet({ unitPrice: 100000, qty: 2, discount: { type: "percent", value: 1500 } })).toBe(170000);
    expect(lineNet({ unitPrice: 50000, qty: 1, discount: { type: "amount", value: 80000 } })).toBe(0);
    expect(lineNet({ unitPrice: 120000, qty: 1, priceOverride: { price: 90000 }, discount: { type: "amount", value: 10000 } })).toBe(80000);
  });

  it("deducts deposits from what is due, never below zero", () => {
    expect(orderTotals([{ unitPrice: 3000000, qty: 1, deposit: 1000000 }, { unitPrice: 120000, qty: 1 }])).toMatchObject({ total: 3120000, deposit: 1000000, due: 2120000 });
    expect(orderTotals([{ unitPrice: 500000, qty: 1, deposit: 500000, discount: { type: "amount", value: 100000 } }])).toMatchObject({ total: 400000, deposit: 400000, due: 0 });
  });

  it("validates split tenders against what is due", () => {
    expect(() => assertTenders([{ method: "cash", amount: 100000 }, { method: "promptpay", amount: 80000 }], 180000)).not.toThrow();
    expect(() => assertTenders([{ method: "cash", amount: 100000 }], 180000)).toThrow("Payments add up to 1000, but 1800 is due");
    expect(() => assertTenders([1, 1, 1, 1].map((amount) => ({ method: "card" as const, amount })), 4)).toThrow("at most 3");
    expect(() => assertTenders([{ method: "card", amount: 0 }, { method: "cash", amount: 1000 }], 10)).toThrow("more than zero");
    expect(() => assertTenders([{ method: "card", amount: 1000, received: 2000 }], 10)).toThrow("Only cash");
    expect(() => assertTenders([], 0)).not.toThrow();
    expect(changeDue([{ method: "cash", amount: 180000, received: 200000 }, { method: "card", amount: 20000 }])).toBe(20000);
  });

  it("rounds half-satang amounts up as on paper, not by binary float error", () => {
    expect(lineNet({ unitPrice: 1005, qty: 1, discount: { type: "percent", value: 1000 } })).toBe(904);
    expect(lineNet({ unitPrice: 3050, qty: 1, discount: { type: "percent", value: 700 } })).toBe(2836);
    expect(lineNet({ unitPrice: 15, qty: 1, discount: { type: "percent", value: 5000 } })).toBe(7);
    expect(lineNet({ unitPrice: 10000, qty: 1, discount: { type: "percent", value: 1250 } })).toBe(8750);
    expect(() => lineNet({ unitPrice: 10000, qty: 1, discount: { type: "percent", value: 15000 } })).toThrow("basis points");
    expect(roundMoney(100.5)).toBe(101);
    expect(roundMoney(-100.5)).toBe(-101);
    expect(roundMoney(10 + 20)).toBe(30);
    // VAT 7/107 of the total: 99.50 → 6.509… and 31,080 → 2,033.271…
    expect(orderTotals([{ unitPrice: 9950, qty: 1 }]).vat).toBe(651);
    expect(orderTotals([{ unitPrice: 3108000, qty: 1 }]).vat).toBe(203327);
  });

  it("refuses payments finer than a satang", () => {
    expect(() => assertTenders([{ method: "cash", amount: 60000.4 }, { method: "card", amount: 59999.6 }], 120000)).toThrow("whole satang");
    expect(() => assertTenders([{ method: "cash", amount: 120000, received: 150000.5 }], 1200)).toThrow("whole satang");
    expect(() => assertTenders([{ method: "cash", amount: 10 }, { method: "card", amount: 20 }], 30)).not.toThrow();
  });

  it("refuses cash received that is infinite or beyond any till amount (C5-02)", () => {
    expect(() => assertTenders([{ method: "cash", amount: 9000, received: Infinity }], 90)).toThrow("Cash received");
    expect(() => assertTenders([{ method: "cash", amount: 9000, received: 100000000000000 }], 90)).toThrow("at most");
    expect(() => assertPriceOverride(1e12, "Typo")).toThrow("at most");
  });

  it("keeps percent discounts exact up to the till limits (K5-02)", () => {
    // Exact half-up satang, independently: gross satang × hundredths of a percent / 10,000.
    const exact = (satang: bigint, bp: bigint) => Number((BigInt(2) * satang * bp + BigInt(10000)) / BigInt(20000));
    for (const [unitPrice, qty, percent] of [[10101010, 99, 9711], [10101009, 99, 9711], [MAX_PRICE, 10, 3333], [9999999, 99, 1], [10000001, 99, 9999]] as const) {
      const gross = roundMoney(unitPrice * qty);
      expect(gross).toBeLessThanOrEqual(MAX_ORDER);
      const discount = lineDiscount({ unitPrice, qty, discount: { type: "percent", value: percent } });
      expect(discount).toBe(exact(BigInt(gross), BigInt(percent)));
    }
    // The round 6 case (999,999,999.82 × 99) can't be entered any more.
    expect(() => assertPriceOverride(99_999_999_982, "x")).toThrow("at most 1,000,000");
    expect(() => assertOrderSize(orderTotals([{ unitPrice: MAX_PRICE, qty: MAX_QTY }]))).toThrow("An order is at most 10,000,000");
    expect(() => assertOrderSize(orderTotals([{ unitPrice: MAX_PRICE, qty: 10 }]))).not.toThrow();
    expect(() => assertTenders([{ method: "cash", amount: MAX_ORDER, received: MAX_ORDER + 100 }], MAX_ORDER)).toThrow("at most 10,000,000");
  });

  it("counts what an extended paid stay still owes, like checkout does (C6-01)", () => {
    const stay = { status: "confirmed", paymentStatus: "paid", total: 2000000, amountPaid: 1000000 };
    expect(bookingPayable(stay)).toBe(true);
    expect(bookingPayable({ ...stay, amountPaid: 2000000 })).toBe(false);
    expect(bookingPayable({ ...stay, amountPaid: 2000000 })).toBe(false);
    expect(bookingPayable({ ...stay, paymentStatus: "pending", amountPaid: 0 })).toBe(true);
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
    expect(amountInput("1000000.01", MAX_PRICE / 100)).toBe("1000000");
  });

  it("dates orders changed on other days", () => {
    // Resort (Bangkok) times, whatever the device's zone.
    const now = Date.parse("2026-10-29T09:30:00+07:00");
    expect(orderTime(Date.parse("2026-10-29T08:05:00+07:00"), now)).toBe("08:05");
    expect(orderTime(Date.parse("2026-10-28T23:56:00+07:00"), now)).toBe("28 Oct, 23:56");
  });
});

describe("shared receipt text", () => {
  const view = (payments: { method: "cash" | "card"; amount: number; received?: number }[], extra: Record<string, unknown> = {}) =>
    ({
      order: { status: "paid", receiptNumber: 142, orderNumber: 1042, title: "Order #1042", paidAt: Date.parse("2026-10-29T14:05:00+07:00") },
      receiptCustomer: null,
      legacyGuest: null,
      source: null,
      ...extra,
      lines: [{ name: "Thai massage 60", qty: 1, net: 120000 }],
      payments,
      totals: { subtotal: 120000, discount: 0, total: 120000, vat: 7850, deposit: 0, due: 120000 },
    }) as unknown as Parameters<typeof receiptText>[0];

  it("shows the cash handed over and the change, like the printed receipt", () => {
    const text = receiptText(view([{ method: "cash", amount: 120000, received: 150000 }]), "Resort");
    expect(text).toContain("Receipt R-000142");
    expect(text).toContain("Order #1042");
    expect(text).not.toContain("Customer:");
    expect(text).toContain("VAT 7% included  ฿78.50");
    expect(text).toContain("Cash  ฿1,500");
    expect(text).toContain("Change  ฿300");
  });

  it("names the customer frozen at payment and the booking, never a walk-in label", () => {
    const text = receiptText(view([{ method: "card", amount: 120000 }], { receiptCustomer: { name: "Bob Payer" }, source: { reference: "CONF-ANNA" } }), "Resort");
    expect(text).toContain("Customer: Bob Payer");
    expect(text).toContain("Booking: CONF-ANNA");
    expect(text).not.toMatch(/walk-?in/i);
  });

  it("lists every booking the order is for, its own first", () => {
    const sources = [{ reference: "CONF-ANNA" }, { reference: "SVC-EVE" }];
    const text = receiptText(view([{ method: "card", amount: 120000 }], { source: sources[0], sources }), "Resort");
    expect(text).toContain("Bookings: CONF-ANNA, SVC-EVE");
    expect(receiptText(view([{ method: "card", amount: 120000 }], { sources: [] }), "Resort")).not.toContain("Booking");
  });

  it("leaves change out when nothing is owed back", () => {
    const text = receiptText(view([{ method: "card", amount: 120000 }]), "Resort");
    expect(text).toContain("Card  ฿1,200");
    expect(text).not.toContain("Change");
  });
});

describe("shared receipt text with POS refunds", () => {
  const view = (extra: Record<string, unknown>) =>
    ({
      order: { status: "paid", receiptNumber: 142, orderNumber: 1042, title: "Order #1042", paidAt: Date.parse("2026-10-29T14:05:00+07:00") },
      receiptCustomer: null,
      legacyGuest: null,
      source: null,
      lines: [{ name: "Thai massage 60", qty: 1, net: 120000, refundedAmountSatang: 30000 }, { name: "Foot spa 45", qty: 1, net: 60000, refundedAmountSatang: 0 }],
      payments: [{ method: "card", amount: 180000 }],
      totals: { subtotal: 180000, discount: 0, total: 180000, vat: 11776, deposit: 0, due: 180000 },
      ...extra,
    }) as unknown as Parameters<typeof receiptText>[0];

  it("matches the printed receipt: refunded rows and the net", () => {
    const text = receiptText(view({ refundedAmountSatang: 30000 }), "Resort");
    expect(text).toContain("  Refunded  -฿300");
    expect(text).toContain("Refunded  -฿300\nNet  ฿1,500");
  });

  it("shows no refund rows without refunds or past the history limit", () => {
    expect(receiptText(view({ lines: [{ name: "Foot spa 45", qty: 1, net: 60000 }], refundedAmountSatang: 0 }), "Resort")).not.toContain("Refunded");
    const truncated = receiptText(view({ refundedAmountSatang: 30000, refundHistoryTruncated: true }), "Resort");
    expect(truncated).not.toContain("Refunded");
    expect(truncated).not.toContain("Net");
  });
});

describe("refund amount input", () => {
  it("turns typed baht into whole satang", async () => {
    const { refundAmountSatang, answeredRefusal } = await import("@/components/checkout/refunds");
    expect(refundAmountSatang("250")).toBe(25000);
    expect(refundAmountSatang("0.29")).toBe(29);
    expect(refundAmountSatang(".5")).toBe(50);
    expect(refundAmountSatang("12.")).toBe(1200);
    expect(refundAmountSatang("0")).toBeNull();
    expect(refundAmountSatang("1.234")).toBeNull();
    expect(refundAmountSatang(".")).toBeNull();
    // A refusal the server answered, typed or plain, wrote nothing; a lost answer is unknown.
    expect(answeredRefusal({ data: { code: "PENDING_APPROVAL" } })).toBe(true);
    expect(answeredRefusal({ data: "Not allowed" })).toBe(true);
    expect(answeredRefusal(new Error("Network"))).toBe(false);
  });
});
