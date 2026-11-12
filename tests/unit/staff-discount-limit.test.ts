// The cashier's "over your limit" hint must agree with the server's refusal, satang for satang.
import { describe, expect, it } from "vitest";
import type { LineDiscount } from "convex/lib/billMath";
import { assertCashierDiscount, type StaffActor } from "convex/lib/staffAccess";
import { DEFAULT_CASHIER_RULES } from "convex/lib/staffTypes";
import { discountOverLimit } from "@/components/checkout/staff-approvals";

const cashier = { role: "cashier", email: "mint@example.com", tokenIdentifier: "mint" } as StaffActor;
/** A query context whose only read is the cashier rules row. */
const ctxWithLimit = (discountLimitPercent: number) =>
  ({ db: { query: () => ({ withIndex: () => ({ unique: async () => ({ ...DEFAULT_CASHIER_RULES, discountLimitPercent }) }) }) } }) as never;

type Line = { unitPrice: number; qty: number; catalogUnitPrice?: number; priceOverride?: { price: number }; couponDiscount?: number };

/** What the server does with this discount: null when allowed, else the amount it reports. */
async function server(line: Line, discount: LineDiscount, limit: number) {
  try {
    await assertCashierDiscount(ctxWithLimit(limit), cashier, { ...line, discount });
    return null;
  } catch (err) {
    const data = (err as { data?: { code?: string; amount?: number } }).data;
    expect(data?.code).toBe("NEEDS_APPROVAL");
    return data!.amount!;
  }
}
async function agree(line: Line, discount: LineDiscount, limit = 10) {
  const hint = discountOverLimit(line, discount, { discountLimitPercent: limit });
  const refused = await server(line, discount, limit);
  expect(hint?.amount ?? null).toBe(refused);
  return hint;
}

describe("cashier discount limit hint", () => {
  const massage = { unitPrice: 1000, qty: 1 };

  it("allows exactly 10% and asks a manager for 0.01 over, in baht", async () => {
    expect(await agree(massage, { type: "amount", value: 100 })).toBeNull();
    expect(await agree(massage, { type: "amount", value: 100.01 })).toEqual({ amount: 100.01, limitPercent: 10 });
  });

  it("allows exactly 10% and asks a manager for 0.01 over, in percent", async () => {
    expect(await agree(massage, { type: "percent", value: 10 })).toBeNull();
    // 10.01% of ฿1,000 is ฿100.10.
    expect(await agree(massage, { type: "percent", value: 10.01 })).toEqual({ amount: 100.1, limitPercent: 10 });
  });

  it("rounds the limit to the satang the way the server does", async () => {
    // 10% of ฿10.05 is ฿1.005, so ฿1.01 is allowed and ฿1.02 is not.
    const tea = { unitPrice: 10.05, qty: 1 };
    expect(await agree(tea, { type: "amount", value: 1.01 })).toBeNull();
    expect(await agree(tea, { type: "amount", value: 1.02 })).not.toBeNull();
    expect(await agree(tea, { type: "percent", value: 10 })).toBeNull();
  });

  it("counts the quantity, a price change and a higher catalog baseline, but not the coupon", async () => {
    const nights = { unitPrice: 450, qty: 3 };
    expect(await agree(nights, { type: "amount", value: 135 })).toBeNull();
    expect(await agree(nights, { type: "amount", value: 135.01 })).not.toBeNull();
    // A ฿950 override on a ฿1,000 row already uses ฿50 of the ฿100 allowance.
    const repriced = { unitPrice: 1000, qty: 1, priceOverride: { price: 950 } };
    expect(await agree(repriced, { type: "amount", value: 50 })).toBeNull();
    expect(await agree(repriced, { type: "amount", value: 50.01 })).toEqual({ amount: 100.01, limitPercent: 10 });
    // A lower stored price can't hide a reduction from the catalog price.
    const lowered = { unitPrice: 900, catalogUnitPrice: 1000, qty: 1 };
    expect(await agree(lowered, { type: "amount", value: 0.01 })).not.toBeNull();
    const withCoupon = { unitPrice: 1000, qty: 1, couponDiscount: 300 };
    expect(await agree(withCoupon, { type: "amount", value: 100 })).toBeNull();
  });

  it("follows other limits, including two decimals and zero", async () => {
    expect(await agree(massage, { type: "amount", value: 125 }, 12.5)).toBeNull();
    expect(await agree(massage, { type: "amount", value: 125.01 }, 12.5)).not.toBeNull();
    expect(await agree(massage, { type: "percent", value: 12.34 }, 12.34)).toBeNull();
    expect(await agree(massage, { type: "amount", value: 0.01 }, 0)).not.toBeNull();
    expect(await agree(massage, { type: "amount", value: 0 }, 0)).toBeNull();
  });

  it("ignores a value that isn't a discount yet", () => {
    expect(discountOverLimit(massage, { type: "amount", value: Number.NaN }, { discountLimitPercent: 10 })).toBeNull();
  });
});
