// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateOffer, type CouponRules } from "convex/lib/offers";
import messages from "../../messages/en.json";
import { CouponField } from "@/components/booking/CouponField";
import { couponPhase, type CouponPhase } from "@/lib/booking/coupon";

const F1: CouponRules = {
  code: "DCNT-F1-20", version: 1, status: "active", benefit: { kind: "percent", percent: 20 }, scope: "accommodation",
  stayFrom: "2026-11-01", stayTo: "2026-12-20", minNights: 2, maxSaving: 3000, used: 35, discountGranted: 0,
};
const offer = (pricePerNight: number, checkIn: string, checkOut: string) => {
  const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000;
  return evaluateOffer({
    lines: [{ id: "a", kind: "accommodation", propertySlug: "v", checkIn, checkOut, nights, amount: pricePerNight * nights }],
    directDiscountPercent: 15, today: "2026-11-07", coupon: F1,
  });
};
const ready = (result: ReturnType<typeof offer>) => couponPhase("DCNT-F1-20", { status: "ready", result });

const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
const handlers = () => ({
  onDraftChange: vi.fn(), onOpenChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(), onUndo: vi.fn(), onRetry: vi.fn(), onAddNights: vi.fn(), onChangeStay: vi.fn(),
});
type Props = ComponentProps<typeof CouponField>;
async function show(patch: Partial<Props>) {
  const props: Props = {
    code: "DCNT-F1-20", source: "link", phase: { kind: "none" }, draft: "", open: false, entryError: null, notice: null, currency: "THB",
    ...handlers(), ...patch,
  };
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(CouponField, props))));
  return props;
}
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Have a code?", () => {
  it("starts collapsed and opens the entry", async () => {
    const props = await show({ code: null });
    await act(async () => button("Have a code?")!.click());
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("applies on Enter", async () => {
    const props = await show({ code: null, open: true, draft: "dcnt-f1-20" });
    const input = document.querySelector("input")!;
    expect(document.querySelector("label")?.textContent).toBe("Coupon code");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(props.onApply).toHaveBeenCalled();
  });

  it("shows the saving and Remove when the code applies", async () => {
    const props = await show({ phase: ready(offer(4500, "2026-11-12", "2026-11-14")) });
    expect(text()).toContain("DCNT-F1-20 applied. You save ฿1,800.");
    expect(text()).toContain("It replaces your direct-booking discount.");
    expect(text()).toContain("From your link");
    await act(async () => (document.querySelector('[aria-label="Remove code DCNT-F1-20"]') as HTMLButtonElement).click());
    expect(props.onRemove).toHaveBeenCalled();
  });

  it("keeps the direct price when it's better", async () => {
    await show({ phase: ready(offer(12000, "2026-11-12", "2026-11-15")) });
    expect(text()).toContain("Your direct rate is already better");
    expect(text()).toContain("We kept your direct price. DCNT-F1-20 would save ฿3,000; your direct rate saves ฿5,400.");
    expect(text()).toContain("Not used");
  });

  it("offers to add the missing night", async () => {
    const props = await show({ phase: ready(offer(8500, "2026-11-12", "2026-11-13")) });
    expect(text()).toContain("Add 1 more night to use this code");
    expect(text()).toContain("Your direct-booking discount still applies.");
    await act(async () => button("Add a night")!.click());
    expect(props.onAddNights).toHaveBeenCalledWith(1);
  });

  it("hides Add a night when the extra night isn't free", async () => {
    await show({ phase: ready(offer(8500, "2026-11-12", "2026-11-13")), onAddNights: undefined });
    expect(button("Add a night")).toBeUndefined();
  });

  it("sends the guest back to the dates when they're outside the offer", async () => {
    const props = await show({ phase: ready(offer(4500, "2026-12-22", "2026-12-24")) });
    expect(text()).toMatch(/This code is for stays .*2026/);
    await act(async () => button("Change dates")!.click());
    expect(props.onChangeStay).toHaveBeenCalled();
  });

  it("shows a refused code under the input, not as attached", async () => {
    const phase: CouponPhase = { kind: "rejected", problem: { code: "not_found" } };
    await show({ code: "DNCT-F1-20", draft: "DNCT-F1-20", phase });
    const input = document.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("DNCT-F1-20");
    expect(text()).toContain("We couldn't find that code. Check the letters and try again");
    expect(document.querySelector('[data-testid="coupon-attached"]')).toBeNull();
  });

  it("explains a code that ran out while booking", async () => {
    await show({ code: null, notice: { kind: "ran_out", code: "DCNT-F1-20", detail: "This code has been fully used" } });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("DCNT-F1-20 can't be used any more");
    expect(text()).toContain("This code has been fully used. Nothing was booked or charged.");
  });

  it("lets the guest undo a removal", async () => {
    const props = await show({ code: null, notice: { kind: "removed", code: "DCNT-F1-20", source: "typed" } });
    expect(text()).toContain("Code removed. The price is updated.");
    expect(document.activeElement?.textContent).toContain("Undo");
    await act(async () => button("Undo")!.click());
    expect(props.onUndo).toHaveBeenCalled();
  });

  it("can retry a failed check", async () => {
    const props = await show({ phase: { kind: "error" } });
    expect(text()).toContain("We couldn't check this code.");
    await act(async () => button("Try again")!.click());
    expect(props.onRetry).toHaveBeenCalled();
  });
});
