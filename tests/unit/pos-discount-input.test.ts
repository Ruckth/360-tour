import { describe, expect, it } from "vitest";
import { discountText, parseDiscount } from "@/components/checkout/discount-input";

const line = { unitPrice: 1200, qty: 1 };

describe("parseDiscount", () => {
  it("reads a trailing % as percent, with or without a space", () => {
    for (const text of ["15%", "15 %", " 15% "]) {
      expect(parseDiscount(text, line)).toEqual({
        ok: true, discount: { type: "percent", value: 15 }, amount: 180, percent: 15, echo: "15% = ฿180", what: "15% (฿180)",
      });
    }
    expect(parseDiscount("12.5%", line)).toMatchObject({ ok: true, discount: { type: "percent", value: 12.5 }, amount: 150, echo: "12.5% = ฿150" });
    expect(parseDiscount("100%", line)).toMatchObject({ ok: true, amount: 1200 });
  });

  it("reads anything else as baht", () => {
    expect(parseDiscount("150", line)).toEqual({
      ok: true, discount: { type: "amount", value: 150 }, amount: 150, percent: 12.5, echo: "฿150 = 12.5%", what: "฿150 (12.5%)",
    });
    expect(parseDiscount("150.50", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 150.5 }, amount: 150.5, echo: "฿150.50 = 12.54%" });
    expect(parseDiscount("฿150", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 150 } });
    expect(parseDiscount("1,200", line)).toMatchObject({ ok: true, discount: { type: "amount", value: 1200 }, echo: "฿1,200 = 100%" });
  });

  it("works the amount out per line, as the bill does: quantity and price changes count", () => {
    expect(parseDiscount("10%", { unitPrice: 600, qty: 3 })).toMatchObject({ amount: 180, echo: "10% = ฿180" });
    expect(parseDiscount("10%", { unitPrice: 1200, qty: 1, priceOverride: { price: 1000 } })).toMatchObject({ amount: 100 });
    // Whole satang: 10% of ฿10.05 rounds half up.
    expect(parseDiscount("10%", { unitPrice: 10.05, qty: 1 })).toMatchObject({ amount: 1.01 });
  });

  it("is empty for an empty field", () => {
    expect(parseDiscount("", line)).toBeNull();
    expect(parseDiscount("   ", line)).toBeNull();
  });

  it("refuses anything ambiguous or out of range instead of guessing", () => {
    const refused = (text: string) => parseDiscount(text, line);
    for (const text of ["15%%", "%15", "-15", "-15%", "15-", "abc", "1,5", "12,34", "1.234", "15.%", ".5", "15 % %", "1 5", "0x10", "1e3"]) {
      expect(refused(text), text).toEqual({ ok: false, error: "Type 15% or 150" });
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
    expect(discountText({ type: "percent", value: 15 })).toBe("15%");
    expect(discountText({ type: "amount", value: 150.5 })).toBe("150.5");
    // What it shows parses back to the same discount.
    expect(parseDiscount(discountText({ type: "amount", value: 150.5 }), line)).toMatchObject({ discount: { type: "amount", value: 150.5 } });
  });
});
