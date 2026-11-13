import { expect, it } from "vitest";
import { TENDER_LABELS } from "@/components/checkout/checkout-ui";
import { REFUND_METHODS, refundMethodName } from "@/components/checkout/refunds";

it("names PromptPay one way everywhere: PromptPay QR", () => {
  expect(TENDER_LABELS.promptpay.short).toBe("PromptPay QR");
  expect(TENDER_LABELS.promptpay.long).toBe("PromptPay QR");
  expect(REFUND_METHODS.find((method) => method.value === "promptpay")?.label).toBe("PromptPay QR");
  expect(refundMethodName("promptpay")).toBe("PromptPay QR");
});
