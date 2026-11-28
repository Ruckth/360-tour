// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cashAmountSize } from "@/components/checkout/CheckoutView";
import { cashReceived } from "@/components/checkout/ReceiptView";

vi.mock("@/platform/localized-navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

/** Mobile reference: the bar keeps "View order" whole, and the receipt header shows the change. */
describe("checkout bar amount size", () => {
  it("steps the amount down as the total grows", () => {
    expect(cashAmountSize("฿3,200")).toBe("text-xl");
    expect(cashAmountSize("฿155,385.60")).toBe("text-lg");
    expect(cashAmountSize("฿1,010,077.90")).toBe("text-base");
    expect(cashAmountSize("฿3,200", "text-2xl")).toBe("text-2xl");
  });
});

describe("receipt cash received", () => {
  it("adds only tenders that record what was handed over", () => {
    expect(cashReceived([{ amount: 2650, received: 3000 }])).toBe(3000);
    expect(cashReceived([{ amount: 1000, received: 1500 }, { amount: 1650 }])).toBe(1500);
    expect(cashReceived([{ amount: 2650 }])).toBe(0);
  });
});
