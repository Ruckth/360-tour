import { expect, it } from "vitest";
import { TENDER_LABELS } from "@/components/checkout/checkout-ui";
import { REFUND_METHODS, refundMethodName } from "@/components/checkout/refunds";
import { MONEY_METHOD_LABELS } from "@/components/admin/admin-bookings-shared";

/*
 * Checkout, receipts, refunds and the booking desk name methods one way: PromptPay, Transfer, Cash, Card.
 */
it("names each method one way in checkout, receipts, refunds and the desk", () => {
  for (const [method, name] of [["promptpay", "PromptPay"], ["transfer", "Transfer"], ["cash", "Cash"], ["card", "Card"]] as const) {
    expect(TENDER_LABELS[method].short).toBe(name);
    expect(TENDER_LABELS[method].long).toBe(name);
    expect(REFUND_METHODS.find((option) => option.value === method)?.label).toBe(name);
    expect(refundMethodName(method)).toBe(name);
    expect(MONEY_METHOD_LABELS[method]).toBe(name);
  }
});
