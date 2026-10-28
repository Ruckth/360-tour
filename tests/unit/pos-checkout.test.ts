import { describe, expect, it } from "vitest";
import { assertPriceOverride, assertTenders, billTotals, changeDue, formatReceiptNumber, lineNet } from "convex/lib/billMath";
import { parseCheckoutSource } from "@/components/checkout/checkout-source";

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

  it("requires a note for a price override", () => {
    expect(() => assertPriceOverride(900, "   ")).toThrow("Add a note");
    expect(() => assertPriceOverride(-1, "x")).toThrow("zero or more");
    expect(assertPriceOverride(900, " Regular guest ")).toBe("Regular guest");
  });

  it("formats receipt numbers", () => expect(formatReceiptNumber(142)).toBe("R-000142"));
});

describe("checkout source", () => {
  const parse = (query: string) => parseCheckoutSource(new URLSearchParams(query));

  it("opens a new bill, one bill, booking or appointment", () => {
    expect(parse("")).toEqual({ kind: "new" });
    expect(parse("bill=k17abc123def")).toEqual({ kind: "bill", id: "k17abc123def" });
    expect(parse("booking=k17abc123def")).toEqual({ kind: "booking", id: "k17abc123def" });
    expect(parse("appointment=k17abc123def&utm=x")).toEqual({ kind: "appointment", id: "k17abc123def" });
  });

  it.each(["bill=k17abc123def&booking=k17abc123def", "booking=k17abc123def&booking=k17abc999def", "booking=", "bill=../x"])("refuses %s", (query) => {
    expect(parse(query).kind).toBe("invalid");
  });
});
