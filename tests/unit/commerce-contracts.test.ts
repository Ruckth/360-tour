// @vitest-environment happy-dom
import { act } from "../support/checkout-act";
import { ConvexError } from "convex/values";
import type { Doc } from "convex/_generated/dataModel";
import { createElement, useEffect, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  COMMERCE_OFF,
  CheckoutBackendProvider,
  commerceRefusal,
  useCommerce,
  type AdjustKind,
  type AdjustInput,
  type AdjustTarget,
  type AttemptStatus,
  type CheckoutBackend,
  type CheckoutTerms,
  type CommerceBackend,
  type ExternalMethod,
  type LegState,
  type PayoutState,
  type ReturnPart,
  type ReturnStatus,
  type SaleKind,
  type SaleSwitch,
} from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { checkoutDesignStates, commerceDesignStates, createCommerceFixture, createFixtureBackend, type CommerceDesignState } from "@/components/checkout/fixture-backend";

describe("commerce view types follow storage", () => {
  it("derives every stored enum from the schema", () => {
    expectTypeOf<SaleKind>().toEqualTypeOf<"products" | "vouchers" | "sessionPackages" | "mixedPackages">();
    expectTypeOf<SaleSwitch>().toEqualTypeOf<"off" | "managers" | "everyone">();
    expectTypeOf<CheckoutTerms["packageSplit"]>().toEqualTypeOf<Doc<"commerceSettings">["packageSplit"]>();
    expectTypeOf<ExternalMethod>().toEqualTypeOf<"cash" | "promptpay" | "card" | "transfer">();
    expectTypeOf<LegState>().toEqualTypeOf<"planned" | "instructed" | "taken" | "declined" | "unknown">();
    expectTypeOf<AttemptStatus>().toEqualTypeOf<Doc<"paymentAttempts">["status"]>();
    expectTypeOf<ReturnStatus>().toEqualTypeOf<"authorized" | "completed" | "cancelled">();
    expectTypeOf<PayoutState>().toEqualTypeOf<"owed" | "instructed" | "given" | "failed" | "unknown" | "cancelled">();
    expectTypeOf<ReturnPart>().toEqualTypeOf<Doc<"orderReturns">["parts"][number]>();
    expectTypeOf<AdjustTarget["targetType"]>().toEqualTypeOf<Doc<"commerceAdjustments">["targetType"]>();
    expectTypeOf<AdjustTarget["targetId"]>().toEqualTypeOf<Doc<"commerceAdjustments">["targetId"]>();
    // Take back, payment corrections and session waivers use dedicated flows.
    expectTypeOf<Exclude<AdjustKind, AdjustInput["kind"]>>().toEqualTypeOf<"takeBack" | "amendPayment" | "waive">();
    expectTypeOf<Exclude<AdjustInput["kind"], AdjustKind>>().toEqualTypeOf<never>();
  });

  it("reads a typed refusal and nothing else", () => {
    const refusal = commerceRefusal(new ConvexError({ code: "VOUCHER_PAUSED", maskedCode: "GV-••••-Q9XD" }));
    expect(refusal).toEqual({ code: "VOUCHER_PAUSED", maskedCode: "GV-••••-Q9XD" });
    expect(commerceRefusal(new ConvexError({ code: "NEEDS_APPROVAL", kind: "refund" }))).toBeNull();
    expect(commerceRefusal(new ConvexError("Plain message"))).toBeNull();
    expect(commerceRefusal(new Error("Network"))).toBeNull();
    expect(commerceRefusal(null)).toBeNull();
  });
});

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const mount = (backend: CheckoutBackend, child: ReactElement) =>
  act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child)));

/** Every commerce reader, called the way a screen would, so the fixture's hooks really run. */
const seen: { current: Record<string, unknown> } = { current: {} };
function ReadEverything() {
  const commerce = useCommerce();
  const order = "fxbill000011" as never, customer = "fxcust00maya" as never;
  const views = {
    access: commerce.useAccess(),
    rules: commerce.useCheckoutRules(),
    categories: commerce.useCategories(),
    shop: commerce.useShop({ categoryId: null, query: "" }).results,
    product: commerce.useProduct(commerce.useShop({ categoryId: null, query: "robe" }).results[0]?.productId ?? null),
    packages: commerce.usePackagesAndGifts(),
    pins: commerce.useFrequentPins(),
    roomPost: commerce.useRoomPostTarget(order),
    handovers: commerce.useHandovers(order),
    benefits: commerce.useCustomerBenefits(customer),
    coverage: commerce.useCoverage("fxappt0maya" as never),
    voucherCheck: commerce.useVoucherCheck({ orderId: order, code: "gv-7k2m-q9xd" }),
    unknownVoucher: commerce.useVoucherCheck({ orderId: order, code: "GV-NOPE-0000" }),
    giftSlip: commerce.useGiftSlip("fxvchmaya" as never),
    attempt: commerce.usePaymentAttempt(order),
    returnable: commerce.useReturnable(order),
    quote: commerce.useReturnQuote({ orderId: order, parts: [] }),
    card: commerce.useBenefitCard({ targetType: "grant", targetId: "fxgrantmaya" as never }),
    staffHistory: commerce.useHistory({ targetType: "grant", targetId: "fxgrantmaya" as never }, "staff").results,
    guestHistory: commerce.useHistory({ targetType: "grant", targetId: "fxgrantmaya" as never }, "guest").results,
    preview: commerce.useEditPreview({ target: { targetType: "grant", targetId: "fxgrantmaya" as never }, input: { kind: "extend", until: 0 }, expectedRevision: 6, reason: "healthPause", reasonText: null }),
  };
  useEffect(() => { seen.current = views; });
  return null;
}
/** The readers' own return types, loaded. */
type C = CommerceBackend;
type Views = {
  access: NonNullable<ReturnType<C["useAccess"]>>; rules: NonNullable<ReturnType<C["useCheckoutRules"]>>; categories: NonNullable<ReturnType<C["useCategories"]>>;
  shop: ReturnType<C["useShop"]>["results"]; product: ReturnType<C["useProduct"]>; packages: NonNullable<ReturnType<C["usePackagesAndGifts"]>>;
  pins: NonNullable<ReturnType<C["useFrequentPins"]>>; roomPost: ReturnType<C["useRoomPostTarget"]>; handovers: NonNullable<ReturnType<C["useHandovers"]>>;
  benefits: ReturnType<C["useCustomerBenefits"]>; coverage: ReturnType<C["useCoverage"]>; voucherCheck: ReturnType<C["useVoucherCheck"]>; unknownVoucher: ReturnType<C["useVoucherCheck"]>;
  giftSlip: ReturnType<C["useGiftSlip"]>; attempt: ReturnType<C["usePaymentAttempt"]>; returnable: ReturnType<C["useReturnable"]>; quote: ReturnType<C["useReturnQuote"]>;
  card: ReturnType<C["useBenefitCard"]>; staffHistory: ReturnType<C["useHistory"]>["results"]; guestHistory: ReturnType<C["useHistory"]>["results"]; preview: ReturnType<C["useEditPreview"]>;
};
const read = async (backend: CheckoutBackend) => {
  await mount(backend, createElement(ReadEverything));
  return seen.current as Views;
};

describe("commerce fixtures", () => {
  it("reads as every switch Off on a backend without commerce", async () => {
    const backend = createFixtureBackend("spa");
    expect("commerce" in backend).toBe(false);
    const view = await read(backend);
    expect(view.access.switches).toEqual({ products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" });
    expect(Object.values(view.access.canSell)).toEqual([false, false, false, false]);
    expect(view.shop).toEqual([]);
    expect(view.attempt).toBeNull();
    await expect(COMMERCE_OFF.useActions().addVoucher({ clientKey: "k", orderId: "o" as never, faceValue: 100000, templateId: null, name: null })).rejects.toThrow();
  });

  it("ships dark: every kind readable, nothing sellable", async () => {
    const view = await read(createFixtureBackend("empty", "dark"));
    expect(view.access.switches).toEqual({ products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" });
    expect(Object.values(view.access.canSell)).toEqual([false, false, false, false]);
    expect(view.access.paymentsMode).toBe("direct");
    // Products, both package kinds and vouchers all have something to read.
    expect(view.shop.map((tile) => tile.name)).toEqual(["Spa robe", "Lemongrass oil", "Beach tote"]);
    expect(view.product?.variants.find((variant) => variant.label === "Blue / M")).toMatchObject({ onHand: 0, elsewhere: [{ branchName: "Beach spa", onHand: 3 }] });
    expect(view.product?.variants.some((variant) => variant.label === "White / S")).toBe(false);
    expect(new Set(view.packages.packages.map((tile) => tile.saleKind))).toEqual(new Set(["sessionPackages", "mixedPackages"]));
    expect(view.benefits?.grants[0]).toMatchObject({ packageName: "Massage 5", paidLeft: 3, goodwillLeft: 1, unusedPaidValue: 324000 });
    expect(view.benefits?.vouchers[0]).toMatchObject({ maskedCode: "GV-••••-Q9XD", status: "active" });
    expect(view.voucherCheck).toMatchObject({ status: "valid", applies: 200000, stillDue: 60000 });
    expect(view.unknownVoucher).toEqual({ status: "refused", refusal: { code: "VOUCHER_NOT_FOUND" } });
    expect(view.giftSlip?.code).toBe("GV-7K2M-Q9XD");
    expect(view.attempt).toMatchObject({ status: "settled", vouchers: [{ maskedCode: "GV-••••-Q9XD" }] });
    expect(view.returnable?.parts.map((part) => part.part.kind)).toEqual(["cancelPackage", "content"]);
    expect(view.quote?.total).toBe(479300);
    expect(view.handovers[0]).toMatchObject({ kind: "room_bill", withGuest: 1 });
    expect(view.coverage?.offers[0]).toMatchObject({ packageName: "Massage 5", left: 4 });
  });

  it("never shows staff names or reasons in the guest history", async () => {
    const view = await read(createFixtureBackend("empty", "live"));
    expect(view.staffHistory.every((entry) => entry.staff)).toBe(true);
    expect(view.guestHistory).toHaveLength(view.staffHistory.length);
    expect(view.guestHistory.some((entry) => "staff" in entry)).toBe(false);
    expect(JSON.stringify(view.guestHistory)).not.toMatch(/Ploy|Nok|healthPause/);
  });

  it("applies each switch to the staff member's role", async () => {
    const rehearsal = await read(createFixtureBackend("empty", "rehearsal"));
    expect(rehearsal.access.switches).toMatchObject({ products: "managers", vouchers: "managers", sessionPackages: "off" });
    expect(rehearsal.access.canSell).toEqual({ products: true, vouchers: true, sessionPackages: false, mixedPackages: false });
    const live = await read(createFixtureBackend("empty", "live"));
    expect(Object.values(live.access.canSell)).toEqual([true, true, true, true]);
    expect(live.preview?.permission).toBe("askManager");
  });

  it.each<[CommerceDesignState, (view: Views) => void]>([
    ["payment-in-progress", (view) => expect(view.attempt).toMatchObject({ status: "collecting", mine: false, tillLabel: "Till 2", staffName: "Nok" })],
    ["sale-not-saved", (view) => expect(view.attempt).toMatchObject({ status: "refused", refusal: { code: "VOUCHER_USED_UP" }, recovery: { kept: 60000, stillDue: 200000, action: { kind: "collectRest", amount: 200000 } } })],
    ["return-open", (view) => expect(view.returnable?.open).toMatchObject({ status: "authorized", total: 479300, claims: [{ method: "card", state: "instructed" }] })],
    ["expired-and-paused", (view) => {
      expect(view.benefits?.grants[0]).toMatchObject({ status: "expired", unusedPaidValue: 324000 });
      expect(view.benefits?.vouchers[0]).toMatchObject({ status: "paused" });
      expect(view.coverage?.offers).toEqual([]);
    }],
  ])("shows the %s scenario", async (state, check) => {
    check(await read(createFixtureBackend("empty", state)));
  });

  it("lists every state and refuses every write", async () => {
    expect(commerceDesignStates).toEqual(["dark", "rehearsal", "live", "payment-in-progress", "sale-not-saved", "return-open", "expired-and-paused"]);
    const actions = createCommerceFixture("live").useActions();
    await expect(actions.adjust({ clientKey: "k", target: { targetType: "voucher", targetId: "v" as never }, input: { kind: "rename", name: "Mia" }, expectedRevision: 1, reason: "spellingCorrection", reasonText: null })).rejects.toThrow();
  });
});

describe("today's checkout on the old fixtures", () => {
  function Page({ orderId }: { orderId: string | null }) {
    return createElement(CheckoutView, { orderId: orderId as never, onOrderChange: () => {}, onPaid: () => {} });
  }
  /** React's useId counters differ between two roots; nothing else may. */
  const markup = () => document.body.innerHTML.replace(/_r_\w+_/g, "_r_");
  it.each(checkoutDesignStates.map(({ key, orderId }) => [key, orderId] as const))("renders %s the same with or without commerce attached", async (state, orderId) => {
    await mount(createFixtureBackend(state), createElement(Page, { orderId }));
    const today = markup();
    expect(today).toContain("checkout-catalog");
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await mount(createFixtureBackend(state, "live"), createElement(Page, { orderId }));
    expect(markup()).toBe(today);
  });
});
