import { expect, it } from "vitest";
import { TENDER_LABELS } from "@/components/checkout/checkout-ui";
import { REFUND_METHODS, refundMethodName } from "@/components/checkout/refunds";

/*
 * Checkout, receipts and refunds name methods one way: PromptPay, Transfer, Cash, Card.
 * The desk's MONEY_METHOD_LABELS (src/components/admin) follow in the desk package.
 */
it("names each method one way in checkout, receipts and refunds", () => {
  for (const [method, name] of [["promptpay", "PromptPay"], ["transfer", "Transfer"], ["cash", "Cash"], ["card", "Card"]] as const) {
    expect(TENDER_LABELS[method].short).toBe(name);
    expect(TENDER_LABELS[method].long).toBe(name);
    expect(REFUND_METHODS.find((option) => option.value === method)?.label).toBe(name);
    expect(refundMethodName(method)).toBe(name);
  }
});
