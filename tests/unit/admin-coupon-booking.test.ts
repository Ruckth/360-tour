// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { evaluateOffer, type CouponRules, type OfferResult } from "convex/lib/offers";
import messages from "../../messages/en.json";
import { NewBookingDialog } from "@/components/admin/NewBookingDialog";
import { BookingPromotionLine } from "@/components/admin/BookingPromotion";
import { CouponLedger } from "@/components/admin/marketing/CouponLedger";
import { redemptionCounts, usageWithHeld } from "@/components/admin/marketing/marketing-format";
import type { RedemptionRow } from "@/components/admin/marketing/types";

const mutations = vi.hoisted(() => ({ createBooking: vi.fn() }));
const queries = vi.hoisted(() => ({ findGuests: vi.fn(), getCoupon: vi.fn() }));
const preview = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  watchQuery: () => ({ localQueryResult: () => [], onUpdate: () => () => undefined }),
  query: (ref: unknown, args: unknown) => preview(args),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => mutations[getFunctionName(ref).split(":").pop() as keyof typeof mutations],
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined;
    return queries[getFunctionName(ref).split(":").pop() as keyof typeof queries]?.(args);
  },
  useConvex: () => client,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/reui/phone-input", () => ({
  PhoneInput: ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) =>
    createElement("input", { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
}));

const NOW = Date.parse("2026-11-07T03:00:00Z");
// kit/data.md: Mossbell Garden Suite ฿4,500/night, 15% direct offer.
const villa = { _id: "p1", slug: "mossbell", name: "Mossbell Garden Suite", maxGuests: 2, status: "active", pricePerNight: 4500, directDiscountPercent: 15, currency: "THB" };
const F1: CouponRules = {
  code: "DCNT-F1-20", version: 1, status: "active", benefit: { kind: "percent", percent: 20 }, scope: "accommodation",
  stayFrom: "2026-11-01", stayTo: "2026-12-20", minNights: 2, maxSaving: 3000, used: 35, discountGranted: 0,
};
const quote = (nights: number, pricePerNight = 4500): OfferResult =>
  evaluateOffer({
    lines: [{ id: "a", kind: "accommodation", propertySlug: "mossbell", checkIn: "2026-11-12", checkOut: `2026-11-${12 + nights}`, nights, amount: pricePerNight * nights }],
    directDiscountPercent: 15, today: "2026-11-07", coupon: F1,
  });

let root: Root;
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
const render = (node: ReactNode) => act(async () => root.render(createElement(NextIntlClientProvider, intl, node)));
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement | undefined;
const text = () => document.body.textContent ?? "";
const type = (id: string, value: string) => act(async () => {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
/** Lets the 300 ms debounce and the quote promise settle. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
const submit = () => act(async () => (document.querySelector("form") as HTMLFormElement).requestSubmit());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mutations.createBooking.mockReset().mockResolvedValue("b1");
  queries.findGuests.mockReset().mockReturnValue([]);
  queries.getCoupon.mockReset();
  preview.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openDialog(checkOut = "2026-11-14") {
  await render(
    createElement(NewBookingDialog, {
      properties: [villa] as never, prefill: { propertyId: "p1", checkIn: "2026-11-12", checkOut }, onClose: vi.fn(), onCreated: vi.fn(), onBlockInstead: vi.fn(),
    }),
  );
  await type("nb-phone", "+66812345678");
  await type("nb-name", "Maya Chen");
}

describe("new booking with a coupon code", () => {
  it("previews the code, shows that it wins, and sends it", async () => {
    preview.mockResolvedValue(quote(2));
    await openDialog();
    await type("nb-coupon", "dcnt-f1-20 ");
    await settle();
    expect(preview).toHaveBeenLastCalledWith({ code: "DCNT-F1-20", propertySlug: "mossbell", checkIn: "2026-11-12", checkOut: "2026-11-14" });
    expect(text()).toContain("Coupon wins");
    expect(text()).toContain("Total ฿7,200 with DCNT-F1-20");
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ couponCode: "DCNT-F1-20" }));
  });

  it("doesn't send a code the direct offer beats", async () => {
    preview.mockResolvedValue(quote(3, 12000));
    await openDialog("2026-11-15");
    await type("nb-coupon", "DCNT-F1-20");
    await settle();
    expect(text()).toContain("Direct offer wins");
    await submit();
    expect(mutations.createBooking.mock.calls[0][0]).not.toHaveProperty("couponCode");
  });

  it("blocks a code that doesn't apply until it's cleared", async () => {
    preview.mockResolvedValue(quote(1));
    await openDialog("2026-11-13");
    await type("nb-coupon", "DCNT-F1-20");
    await settle();
    expect(text()).toContain("Minimum nights");
    expect(text()).toContain("Clear the coupon code or use one that applies to this stay.");
    expect(button("Create booking")?.disabled).toBe(true);
    await type("nb-coupon", "");
    expect(button("Create booking")?.disabled).toBe(false);
  });

  it("shows coupon_unavailable next to the code and keeps the form", async () => {
    preview.mockResolvedValue(quote(2));
    mutations.createBooking.mockRejectedValueOnce(new ConvexError({ code: "coupon_unavailable", message: "This offer has been fully used.", problem: { code: "sold_out" } }));
    await openDialog();
    await type("nb-coupon", "DCNT-F1-20");
    await settle();
    await submit();
    const alert = document.querySelector("#nb-coupon-status [role='alert']");
    expect(alert?.textContent).toBe("This offer has been fully used.");
    expect((document.getElementById("nb-name") as HTMLInputElement).value).toBe("Maya Chen");
    expect(document.getElementById("nb-coupon")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("leaves the code out with a custom price", async () => {
    await openDialog();
    await type("nb-coupon", "DCNT-F1-20");
    await act(async () => (document.getElementById("nb-custom") as HTMLInputElement).click());
    expect(text()).toContain("A custom price replaces the villa rate, so the code isn’t used.");
    expect((document.getElementById("nb-coupon") as HTMLInputElement).disabled).toBe(true);
  });
});

const row = (patch: Partial<RedemptionRow>): RedemptionRow =>
  ({
    _id: "r1", _creationTime: 0, couponId: "c1", couponVersion: 1, code: "DCNT-F1-20", bookingId: "b1", state: "held", discount: 1800,
    createdAt: Date.parse("2026-11-07T03:42:00Z"), updatedAt: Date.parse("2026-11-07T03:42:00Z"),
    booking: { guestName: "Maya Chen", checkIn: "2026-11-12", checkOut: "2026-11-14", confirmationCode: "CONF-2026-H7Q2KD" },
    ...patch,
  }) as RedemptionRow;

describe("booking sheet promotion", () => {
  it("links the coupon with its version, discount and ledger state", async () => {
    await render(createElement(BookingPromotionLine, { promotion: { couponId: "c1", couponVersion: 1, code: "DCNT-F1-20", discount: 1800, redemptionId: "r1" }, currency: "THB", redemption: { state: "consumed", overLimit: false } }));
    const link = document.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/admin/marketing/coupons/c1");
    expect(document.querySelector("[data-testid='booking-promotion']")?.textContent).toBe("DCNT-F1-20· v1· −฿1,800Consumed");
  });

  it("flags a use that went over the limit", async () => {
    await render(createElement(BookingPromotionLine, { promotion: { couponId: "c1", couponVersion: 1, code: "DCNT-F1-20", discount: 1800, redemptionId: "r1" }, currency: "THB", redemption: { state: "consumed", overLimit: true } }));
    expect(text()).toContain("Over the limit");
  });
});

describe("coupon usage", () => {
  it("counts held slots with the uses", () => {
    expect(usageWithHeld(35, 3, 500)).toBe("38 / 500 · 3 held");
    expect(usageWithHeld(35, 3)).toBe("38 used · 3 held");
    expect(usageWithHeld(35, 0, 500)).toBe("35 / 500");
    expect(usageWithHeld(22, 0)).toBe("22 · no limit");
  });

  it("counts ledger rows by state", () => {
    expect(redemptionCounts([row({}), row({ state: "consumed" }), row({ state: "consumed" }), row({ state: "reversed" })])).toEqual({
      held: 1, consumed: 2, released: 0, reversed: 1,
    });
  });

  it("lists uses newest first, filters by state and flags over-limit uses", async () => {
    const rows = [
      row({ _id: "r1" as never, state: "consumed", createdAt: 1, booking: { guestName: "Older Guest", checkIn: "2026-11-05", checkOut: "2026-11-07" } }),
      row({ _id: "r2" as never, state: "held", createdAt: 2 }),
      row({ _id: "r3" as never, state: "consumed", overLimit: true, createdAt: 3, booking: undefined }),
    ];
    await render(createElement(CouponLedger, { code: "DCNT-F1-20", redemptions: rows }));
    const items = [...document.querySelectorAll("[data-testid='ledger-row']")].map((el) => el.textContent ?? "");
    expect(items[0]).toContain("Booking removed");
    expect(items[0]).toContain("Over the limit");
    expect(items[1]).toContain("Maya Chen");
    expect(items[1]).toContain("CONF-2026-H7Q2KD");
    expect(items[1]).toContain("12–14 Nov 2026 · 2 nights · v1");
    expect(text()).toContain("1 paid use went past the limit or budget.");
    await act(async () => [...document.querySelectorAll("button")].find((el) => el.textContent?.startsWith("Held"))!.click());
    expect(document.querySelectorAll("[data-testid='ledger-row']")).toHaveLength(1);
  });

  it("lists checkout sales beside bookings, linked to their receipts", async () => {
    const order = { orderId: "fxbill000042" as never, title: "Order #42", receiptNumber: "R-000318", customerName: "Mia Tanaka" };
    await render(createElement(CouponLedger, { code: "DCNT-SPA-500", redemptions: [row({ _id: "r4" as never, state: "consumed", discount: 500, createdAt: 4, booking: undefined, order })] }));
    const entry = document.querySelector("[data-testid='ledger-row']")!;
    expect(entry.textContent).toContain("Order #42R-000318");
    expect(entry.textContent).toContain("Checkout · Mia Tanaka · v1");
    expect(entry.querySelector("a")?.getAttribute("href")).toBe("/admin/receipt/fxbill000042");
  });

  it("explains an empty ledger", async () => {
    await render(createElement(CouponLedger, { code: "DCNT-F1-20", redemptions: [] }));
    expect(text()).toContain("No uses yet. Bookings made with DCNT-F1-20 show here");
  });
});
