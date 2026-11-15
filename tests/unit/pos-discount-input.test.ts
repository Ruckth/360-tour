import { describe, expect, it } from "vitest";
import { discountText, parseDiscount } from "@/components/checkout/discount-input";

const line = { unitPrice: 120000, qty: 1 };

describe("parseDiscount", () => {
  it("reads a trailing % as percent, with or without a space", () => {
    for (const text of ["15%", "15 %", " 15% "]) {
      expect(parseDiscount(text, line)).toEqual({
        ok: true, discount: { type: "percent", value: 1500 }, amount: 18000, percent: 1500, echo: "15% = ฿180", what: "15% (฿180)",
      });
    }
    expect(parseDiscount("12.5%", line)).toMatchObject({ ok: true, discount: { type: "percent", value: 1250 }, amount: 15000, echo: "12.5% = ฿150" });
    expect(parseDiscount("100%", line)).toMatchObject({ ok: true, amount: 120000 });
  });

  it("reads anything else as baht", () => {
    expect(parseDiscount("150", line)).toEqual({
      ok: true, discount: { type: "amount", value: 15000 }, amount: 15000, percent: 1250, echo: "฿150 = 12.5%", what: "฿150 (12.5%)",
    });
    expect(parseDiscount("150.50", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 15050 }, amount: 15050, echo: "฿150.50 = 12.54%" });
    expect(parseDiscount("฿150", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 15000 } });
    expect(parseDiscount("1,200", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 120000 }, echo: "฿1,200 = 100%" });
  });

  it("works the amount out per line, as the bill does: quantity and price changes count", () => {
    expect(parseDiscount("10%", { unitPrice: 60000, qty: 3 })).toMatchObject({ amount: 18000, echo: "10% = ฿180" });
    expect(parseDiscount("10%", { unitPrice: 120000, qty: 1, priceOverride: { price: 100000 } })).toMatchObject({ amount: 10000 });
    // Whole satang: 10% of ฿10.05 rounds half up.
    expect(parseDiscount("10%", { unitPrice: 1005.0000000000001, qty: 1 })).toMatchObject({ amount: 101 });
  });

  it("is empty for an empty field", () => {
    expect(parseDiscount("", line)).toBeNull();
    expect(parseDiscount("   ", line)).toBeNull();
  });

  it("refuses anything ambiguous or out of range instead of guessing", () => {
    const refused = (text: string) => parseDiscount(text, line);
    for (const text of ["15%%", "%15", "-15", "-15%", "15-", "abc", "1,5", "12,34", "1.234", "15.%", ".5", "15 % %", "1 5", "0x10", "1e3"]) {
      expect(refused(text), text).toEqual({ ok: false, error: "Type 10% or ฿120" });
    }
    expect(refused("0")).toEqual({ ok: false, error: "Type more than 0" });
    expect(refused("0%")).toEqual({ ok: false, error: "Type more than 0" });
    expect(refused("101%")).toEqual({ ok: false, error: "At most 100%" });
    // Over the line total.
    expect(refused("1200.01")).toEqual({ ok: false, error: "At most ฿1,200" });
    expect(refused("1500")).toEqual({ ok: false, error: "At most ฿1,200" });
  });
});

describe("discountText", () => {
  it("shows the line's discount as the field reads it", () => {
    expect(discountText(undefined)).toBe("");
    expect(discountText({ type: "percent", value: 1500 })).toBe("15%");
    expect(discountText({ type: "amount", value: 15050 })).toBe("150.5");
    // What it shows parses back to the same discount.
    expect(parseDiscount(discountText({ type: "amount", value: 15050 }), line)).toMatchObject({ discount: { type: "amount", value: 15050 } });
  });
});
