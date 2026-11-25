import { seedTestBranch } from '../../convex/testing/staff.test-support';
import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import type { FunctionArgs } from "convex/server";
import type { Id } from "convex/_generated/dataModel";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView, type PaymentAttemptView } from "@/components/checkout/backend";
import { PayPanel } from "@/components/checkout/PayPanel";
import { deviceKey, payMode, resetLoadedPayMode, resumeMode } from "@/components/checkout/pay-desk";
import { claimTabKey, resetTabKey } from "@/components/checkout/pay-desk-tab";
import { deskStep, methodsWithinRows, stillToCharge } from "@/components/checkout/pay-desk-rules";
import { resetPinnedAccess } from "@/components/checkout/pay-desk-backend";
import { payRefusal, tillLabelOf } from "@/components/checkout/pay-desk-attempts";
import { resortTodayIso } from "convex/shared/time";
import { createPayDeskBackend } from "../support/paydesk-backend";

/*
 * W2A·L3 · Pay desk on attempts (v27 Paying, D18): Card in two taps, cash received and change,
 * resume on the same till, another till's payment, a lost answer, split with a reload, money taken
 * but the sale not saved, Pay the room first, and the direct panel unchanged before the cutover.
 * Every step crosses the registered Convex functions through the live adapter (payDeskCommerce).
 */

let root: Root;
type Desk = Awaited<ReturnType<typeof createPayDeskBackend>>;
const ARM = "pos/commands/armPaymentLeg:armPaymentLeg";
const RECORD = "pos/commands/recordPaymentLeg:recordPaymentLeg";
const SETTLE = "pos/commands/settleOrder:settlePaymentAttempt";

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text);
const text = () => document.body.textContent ?? "";
const tick = (ms = 50) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
/** Each tap a person makes, in order: the journey's tap list. */
let taps: string[] = [];
const tap = async (label: string) => {
  await settle();
  const target = button(label);
  expect(target, `${label} in: ${text()}`).toBeTruthy();
  expect(target!.disabled, `${label} enabled`).toBe(false);
  taps.push(label);
  await act(async () => target!.click());
  await settle();
};
const input = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  expect(el, selector).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const chip = async (group: string, label: string) => {
  const el = document.querySelector(`[aria-label="${group}"]`)!;
  expect(el, group).toBeTruthy();
  await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
};
const count = (desk: Desk, name: string) => desk.calls.filter((call) => call.name === name).length;

function Probe({ backend, orderId, mode, onBack, onPaid, resume }: { backend: CheckoutBackend; orderId: OrderId; mode: ComponentProps<typeof PayPanel>["mode"]; onBack: () => void; onPaid: () => void; resume?: boolean }) {
  const view: OrderView | null | undefined = backend.useOrder(orderId);
  if (!view) return null;
  // The order panel reopens an attempt in its own mode (resumeMode), as after a reload.
  const opened = resume && view.paymentAttempt ? resumeMode(view.paymentAttempt.legs) : mode;
  return createElement(PayPanel, { view, mode: opened, onBack, onPaid });
}

async function mount(desk: Desk, orderId: OrderId, mode: ComponentProps<typeof PayPanel>["mode"], resume = false) {
  const onBack = vi.fn();
  const onPaid = vi.fn();
  const provider = { backend: desk as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>;
  await act(async () => root.render(createElement(CheckoutBackendProvider, provider, createElement(Probe, { backend: desk, orderId, mode, onBack, onPaid, resume }))));
  await settle();
  return { onBack, onPaid };
}

/** A reload: the page goes, the same till (localStorage) comes back to the same order. */
async function reload(desk: Desk, orderId: OrderId) {
  await act(async () => root.unmount());
  resetLoadedPayMode();
  resetPinnedAccess();
  // A new page keeps nothing it read: every reader starts from loading, as on the live transport.
  desk.forget();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  return mount(desk, orderId, "cash", true);
}

/** Product sales on or off (the owner's switch), as a settings row. */
const productSales = (desk: Desk, flag: "everyone" | "off") => desk.t.run(async (ctx) => {
  const row = (await ctx.db.query("commerceSettings").first())!;
  await ctx.db.patch(row._id, { saleSwitches: { ...row.saleSwitches, products: flag } });
});

/** A product sale: the owner can switch product sales off after the card was charged (the sale can't be saved as it is). */
async function productOrder(desk: Desk, price: number) {
  await productSales(desk, "everyone");
  const orderId = await desk.order([{ name: "Tote", price }]);
  await desk.t.run(async (ctx) => {
    const branchId = await seedTestBranch(ctx);
    const productId = await ctx.db.insert("products", { categoryId: await ctx.db.insert("productCategories", { name: "Shop", sort: 0 }), name: "Tote", status: "active", vatProfile: "standard", options: [], minPrice: price, maxPrice: price, variantCount: 1, sort: 0, revision: 0 });
    const variantId = await ctx.db.insert("productVariants", { productId, optionValueIds: [], label: "Tote", price, status: "active", revision: 0 });
    await ctx.db.insert("stockLevels", { branchId, productId, variantId, onHand: 5, revision: 0 });
    const line = (await ctx.db.query("orderLines").first())!;
    await ctx.db.patch(line._id, { kind: "product", variantId });
  });
  await desk.refresh();
  return { orderId };
}

// The attempt panel is a lazy chunk; load it once so React.lazy resolves within a tick.
beforeAll(async () => {
  await Promise.all([import("@/components/checkout/PayDeskPanel"), import("@/components/checkout/PayRecovery"), import("@/components/checkout/PayDeskNotices")]);
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-19T07:00:00Z"));
  localStorage.setItem("checkout.deviceKey", "front-desk-ipad-0000000000000001");
  sessionStorage.clear();
  resetLoadedPayMode();
  resetPinnedAccess();
  resetTabKey();
  taps = [];
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pay desk rules", () => {
  it("pins the mode this page loaded with, so a till behind the cutover reloads", () => {
    const access = { settingsRevision: 1, switches: { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" } as const, canSell: { products: false, vouchers: false, sessionPackages: false, mixedPackages: false }, paymentsMode: "direct" as const, paused: false, tillReady: true };
    expect(payMode(undefined)).toBe("loading");
    expect(payMode(access)).toBe("direct");
    expect(payMode({ ...access, paused: true })).toBe("paused");
    expect(payMode({ ...access, paymentsMode: "attempts" })).toBe("reload");
    resetLoadedPayMode();
    expect(payMode({ ...access, paymentsMode: "attempts" })).toBe("attempts");
    expect(payMode({ ...access, paymentsMode: "attempts", tillReady: false })).toBe("reload");
  });

  it("shows a fresh instruction only for a part armed by this panel", () => {
    const leg = { key: "k-1", direction: "collect" as const, method: "card" as const, amount: 120000, state: "instructed" as const, received: null, change: null, reference: null, instructedAt: 1 };
    const attempt = { attemptId: "a" as Id<"paymentAttempts">, orderId: "o" as OrderId, status: "collecting" as const, ownerRevision: 0, tillLabel: "", staffName: "", mine: true, due: 120000, legs: [leg], vouchers: [], refusal: null, recovery: null, startedAt: 0 };
    expect(deskStep(attempt, new Set(["k-1"]))).toEqual({ kind: "instruct", leg });
    expect(deskStep(attempt, new Set())).toEqual({ kind: "checkPrevious", leg });
    // Sent before a handover: armed here once, but the server says check, so it never instructs again.
    const handedBack = { ...leg, checkPrevious: true };
    expect(deskStep({ ...attempt, ownerRevision: 4, legs: [handedBack] }, new Set(["k-1"]))).toEqual({ kind: "checkPrevious", leg: handedBack });
    expect(deskStep({ ...attempt, legs: [{ ...leg, state: "taken" }] }, new Set())).toEqual({ kind: "settle" });
    expect(deskStep({ ...attempt, legs: [{ ...leg, state: "declined" }] }, new Set())).toEqual({ kind: "plan" });
    expect(deskStep({ ...attempt, mine: false }, new Set())).toEqual({ kind: "elsewhere" });
    expect(deskStep({ ...attempt, status: "recovering", legs: [] }, new Set())).toEqual({ kind: "settle" });
    expect(stillToCharge({ ...attempt, legs: [{ ...leg, amount: 50000, state: "taken" }] }, 0)).toBe(70000);
    expect(resumeMode([{ method: "card", state: "taken" }, { method: "transfer", state: "planned" }])).toBe("split");
    expect(resumeMode([{ method: "cash", state: "declined" }])).toBe("cash");
  });

  it("keeps the receipt within three payment rows and maps the server's refusals", () => {
    expect(methodsWithinRows([{ method: "cash" }, { method: "card" }], 1, ["cash", "promptpay", "card", "transfer"])).toEqual(["cash", "card"]);
    expect(methodsWithinRows([{ method: "cash" }], 0, ["cash", "promptpay"])).toEqual(["cash", "promptpay"]);
    expect(payRefusal({ code: "payment_handed_over", message: "" })).toEqual({ code: "PAYMENT_HANDED_OVER" });
    expect(payRefusal({ code: "TILL_NEEDS_RELOAD", message: "Reload" })).toEqual({ code: "TILL_NEEDS_RELOAD" });
    expect(payRefusal({ code: "pay_room_first", message: "Pay the room first." })).toEqual({ code: "SERVER", reason: "pay_room_first", message: "Pay the room first." });
  });
});

describe("this browser and this tab", () => {
  /** A LockManager whose locks other pages can hold, for duplicated tabs. */
  function fakeLocks() {
    const held = new Set<string>();
    const locks = {
      held,
      request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: object | null) => unknown) {
        if (held.has(name)) {
          if (options.signal) return new Promise((_, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
          return Promise.resolve(callback(null));
        }
        held.add(name);
        return Promise.resolve(callback({ name }));
      },
    };
    vi.spyOn(navigator, "locks", "get").mockReturnValue(locks as unknown as LockManager);
    return locks;
  }

  it("keeps the device key and this tab's key across a reload, and gives a duplicated tab its own", async () => {
    vi.useRealTimers();
    const locks = fakeLocks();
    const device = deviceKey();
    expect(device).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    expect(deviceKey()).toBe(device);
    const tab = await claimTabKey();
    expect(tab).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    expect(tab).not.toBe(device);
    // A reload: the page it replaces lets go of the key, sessionStorage keeps it.
    resetTabKey();
    locks.held.clear();
    expect(await claimTabKey()).toBe(tab);
    // A duplicated tab copies sessionStorage, but the original page still holds the key.
    resetTabKey();
    const duplicate = await claimTabKey();
    expect(duplicate).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    expect(duplicate).not.toBe(tab);
    expect(sessionStorage.getItem("checkout.tabKey")).toBe(duplicate);
    expect(deviceKey()).toBe(device);
  });

  it("shows another tab's payment as in progress elsewhere, never as this tab's", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿1,200 on the terminal");
    // A second tab of the same browser and person opens the same order.
    await act(async () => root.unmount());
    sessionStorage.clear();
    resetTabKey();
    desk.forget();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await mount(desk, orderId, "card", true);
    expect(text()).toMatch(/Payment in progress on Till [A-Z0-9]{6} · Ploy/);
    expect(text()).not.toContain("on the terminal");
    expect(text()).not.toContain("Check previous payment");
    expect(button("Taken")).toBeUndefined();
    expect(count(desk, ARM)).toBe(1);
  }, 30000);

  it("shows the reload screen when the page has no admitted load for this till", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    localStorage.removeItem("checkout.tillId");
    await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="till-reload"]')?.textContent).toContain("Reload this till to take payments again");
    expect(text()).not.toContain("on the terminal");
    expect(await desk.attempts()).toHaveLength(0);
  }, 30000);
});

describe("another till's payment (astra r1 m9)", () => {
  it("names the till once the server sends its label, and says another till until then", async () => {
    expect(tillLabelOf({ tillLabel: "Front desk iPad" })).toBe("Front desk iPad");
    expect(tillLabelOf({ tillId: "t1" })).toBe("");
    const { InProgressElsewhere } = await import("@/components/checkout/PayRecovery");
    const attempt = { attemptId: "a1", orderId: "o1", status: "collecting", ownerRevision: 0, staffName: "Nok", mine: false, due: 0, legs: [], vouchers: [], refusal: null, recovery: null, startedAt: 0 } as unknown as PaymentAttemptView;
    const render = (tillLabel: string) => act(async () => root.render(createElement(CheckoutBackendProvider, { backend: { useActions: () => ({}) } as unknown as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>,
      createElement(InProgressElsewhere, { attempt: { ...attempt, tillLabel } }))));
    await render("Front desk iPad");
    expect(text()).toContain("Payment in progress on Front desk iPad · Nok");
    expect(text()).not.toContain("another till");
    await render("");
    expect(text()).toContain("Payment in progress on another till · Nok");
  });
});

/** A dense stay with a room-bill tote: too large to pay in one go (v27 Settlement). */
async function denseStay() {
  const desk = await createPayDeskBackend();
  const orderId = await desk.order([{ name: "Tote", price: 35000 }]);
  // A dense stay with a room-bill item: too large to pay in one go (v27 Settlement).
  await desk.t.run(async (ctx) => {
    const propertyId = await ctx.db.insert("properties", { slug: "villa", name: "Villa 12", tagline: "", description: "", pricePerNight: 30000, currency: "THB", maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: "active" });
    const bookingId = await ctx.db.insert("bookings", { propertyId, guestName: "Guest", guestPhone: "0812345678", guestPhoneDigits: "0812345678", checkIn: "2026-11-18", checkOut: "2026-11-20", guests: 2, nights: 601, subtotal: 60000, discountAmount: 0, total: 60000, amountPaid: 0, amountRefunded: 0, currency: "THB", paymentStatus: "pending", confirmationCode: "STAY", accessToken: "test-only", status: "confirmed", createdAt: Date.now() });
    const productId = await ctx.db.insert("products", { categoryId: await ctx.db.insert("productCategories", { name: "Shop", sort: 0 }), name: "Tote", status: "active", vatProfile: "standard", options: [], minPrice: 35000, maxPrice: 35000, variantCount: 1, sort: 0, revision: 0 });
    const variantId = await ctx.db.insert("productVariants", { productId, optionValueIds: [], label: "Tote", price: 35000, status: "active", revision: 0 });
    const line = (await ctx.db.query("orderLines").first())!;
    await ctx.db.patch(line._id, { kind: "product", variantId });
    return bookingId;
  }).then((bookingId) => desk.otherTill("ploy@example.com").mutation(api.pos.commands.attach.attach, { orderId, bookingId }));
  return { desk, orderId };
}

describe("pay desk on attempts", () => {
  it("takes a card in two taps, with the part armed on the server before the instruction shows", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    taps.push("Card"); // The order panel's Card tap opens this panel.
    const { onPaid } = await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿1,200 on the terminal");
    const [armed] = await desk.attempts();
    expect(armed.legs).toMatchObject([{ method: "card", amount: 120000, state: "instructed" }]);
    expect((await desk.orderDoc(orderId))?.activeAttemptId).toBe(armed._id);
    await tap("Confirm ฿1,200");
    expect(taps).toEqual(["Card", "Confirm ฿1,200"]);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
    expect((await desk.attempts())[0]).toMatchObject({ status: "settled", legs: [{ state: "taken" }] });
    expect(count(desk, "pos/commands/settleOrder:settleOrder")).toBe(0);
  }, 30000);

  it("collects cash with what was handed over and the change on the same panel", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 60000 }]);
    const { onPaid } = await mount(desk, orderId, "cash");
    expect(text()).toContain("Collect ฿600 cash");
    await tap("฿1,000");
    expect(document.querySelector('[data-testid="cash-change"]')?.textContent).toBe("฿400");
    await tap("Confirm · ฿600 cash received");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "cash", amount: 60000, received: 100000 }]);
  }, 30000);

  it("resumes on the same till after a reload with Check previous payment, never a second charge", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 490000 }]);
    await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿4,900 on the terminal");
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Check previous payment");
    expect(text()).toContain("Card ฿4,900 · 14:00");
    expect(text()).not.toContain("on the terminal");
    expect(button("Cash")?.disabled).toBe(true);
    expect(count(desk, ARM)).toBe(1);
    await tap("Taken");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(count(desk, ARM)).toBe(1);
    expect(await desk.payments()).toHaveLength(1);
  }, 30000);

  it("shows another till's payment as in progress elsewhere; a manager takes over with Check previous", async () => {
    const desk = await createPayDeskBackend({ role: "manager" });
    const orderId = await desk.order([{ name: "Tea", price: 260000 }]);
    const other = desk.otherTill("nok@example.com");
    await desk.t.run(async (ctx) => ctx.db.insert("staffGrants", { branchIds: [await seedTestBranch(ctx)], email: "nok@example.com", tokenIdentifier: "https://test.clerk.dev|nok@example.com", role: "cashier", revision: 1, createdAt: 0, updatedAt: 0, updatedByEmail: "system:seed" }));
    const order = (await desk.orderDoc(orderId))!;
    const till2 = await desk.otherAcknowledgedTill();
    const started = await other.mutation(api.pos.commands.startPaymentAttempt.startPaymentAttempt, {
      orderId, ...till2, clientKey: "other-till", expectedRevision: order.revision, expectedDue: 260000, businessDate: resortTodayIso(),
      customers: [], vouchers: [], legs: [{ key: "card-1", method: "card", amount: 260000 }],
    });
    if (started.status !== "ready") throw new Error(JSON.stringify(started));
    await other.mutation(api.pos.commands.armPaymentLeg.armPaymentLeg, { attemptId: started.attempt.attemptId, ownerRevision: 0, ...till2, legKey: "card-1" });
    const { onPaid } = await mount(desk, orderId, "card", true);
    expect(text()).toMatch(/Payment in progress on Till [A-Z0-9]{6} · Nok/);
    expect(button("Take over")?.disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await tap("Take over");
    expect(text()).toContain("Check previous payment");
    expect(text()).not.toContain("on the terminal");
    await tap("Not taken");
    await tap("Card");
    expect(text()).toContain("Charge ฿2,600 on the terminal");
    await tap("Confirm ฿2,600");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 260000 }]);
  }, 30000);

  it("keeps a lost answer retryable: Retry sends the same step and the sale is recorded once", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    const { onPaid } = await mount(desk, orderId, "promptpay");
    expect(text()).toContain("Request ฿1,200 by PromptPay");
    desk.loseNext(RECORD);
    await tap("Confirm ฿1,200");
    expect(document.querySelector('[data-testid="pay-offline"]')?.textContent).toContain("No answer from the server");
    expect(onPaid).not.toHaveBeenCalled();
    await tap("Retry");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(count(desk, RECORD)).toBe(2);
    expect(count(desk, SETTLE)).toBe(1);
    expect(await desk.payments()).toHaveLength(1);
  }, 30000);

  it("says when the till is offline", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(document.querySelector('[data-testid="pay-offline"]')?.textContent).toContain("Offline");
  }, 30000);

  it("splits across parts, survives a reload with the taken part locked, and changes the untouched rest", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 300000 }, { name: "Oil", price: 200000 }]);
    await mount(desk, orderId, "split");
    await chip("Payment 1 method", "Card");
    await chip("Payment 2 method", "Transfer");
    await input('[aria-label="Payment 1 amount"]', "3000");
    expect(document.querySelector('[data-testid="split-remaining"]')?.textContent).toBe("Covered · ฿5,000 in 2 payments");
    await tap("Charge ฿3,000");
    expect(text()).toContain("Charge ฿3,000 on the terminal");
    await tap("Confirm ฿3,000");
    expect(text()).toContain("Card ฿3,000 · taken");
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Card ฿3,000 · taken");
    expect(document.querySelector('[aria-label="Payment 2 method"] [aria-pressed="true"], [aria-label="Payment 2 method"] [data-state="on"]')?.textContent).toBe("Transfer");
    await chip("Payment 2 method", "PromptPay");
    await tap("Charge ฿2,000");
    expect(text()).toContain("Request ฿2,000 by PromptPay");
    await tap("Confirm ฿2,000");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 300000 }, { method: "promptpay", amount: 200000 }]);
  }, 30000);

  it("shows a fresh instruction only when its own arm call armed the part: a second tab's Charge reconciles (sol r1 B1)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 300000 }, { name: "Oil", price: 200000 }]);
    await mount(desk, orderId, "split");
    await chip("Payment 1 method", "Card");
    await input('[aria-label="Payment 1 amount"]', "3000");
    // Another tab on this till taps the same Charge a moment earlier: its arm wins.
    desk.sendFirst(ARM, (args) => desk.rawMutation(api.pos.commands.armPaymentLeg.armPaymentLeg, args as FunctionArgs<typeof api.pos.commands.armPaymentLeg.armPaymentLeg>));
    await tap("Charge ฿3,000");
    expect(text()).not.toContain("Charge ฿3,000 on the terminal");
    expect(text()).toContain("Check previous payment");
    expect(text()).toContain("Card ฿3,000 · 14:00");
    expect((await desk.attempts())[0].legs.filter((leg) => leg.state === "instructed")).toHaveLength(1);
  }, 30000);

  it("a reload during a give-back asks what the terminal shows, never to refund again; done, it says what was given back (astra r1 B2, m7)", async () => {
    const desk = await createPayDeskBackend();
    const { orderId } = await productOrder(desk, 190000);
    await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿1,900 on the terminal");
    // The owner switches product sales off after the card was charged.
    await productSales(desk, "off");
    await act(() => desk.refresh());
    await tap("Confirm ฿1,900");
    expect(text()).toContain("Money taken · sale not saved");
    await tap("Give all the money back");
    expect(text()).toContain("Refund ฿1,900 on the terminal");
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Check previous refund");
    expect(text()).toContain("Card ฿1,900 · 14:00");
    expect(text()).toContain("What does the terminal show?");
    expect(text()).not.toContain("on the terminal");
    await tap("Given back");
    expect(text()).not.toContain("Nothing was taken");
    const given = document.querySelector('[data-testid="money-given-back"]')?.textContent ?? "";
    expect(given).toContain("Card ฿1,900 taken");
    expect(given).toContain("Card ฿1,900 given back");
    expect(given).toContain("Kept · ฿0");
    expect(onPaid).not.toHaveBeenCalled();
    expect(await desk.payments()).toHaveLength(0);
  }, 30000);

  it("reloads a split exactly as planned: the untouched rest keeps its method and amount (astra r1 M4)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 300000 }, { name: "Oil", price: 200000 }]);
    await mount(desk, orderId, "split");
    await chip("Payment 1 method", "Card");
    await chip("Payment 2 method", "Transfer");
    await input('[aria-label="Payment 1 amount"]', "3000");
    await tap("Charge ฿3,000");
    await tap("Confirm ฿3,000");
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Card ฿3,000 · taken");
    const parts = [...document.querySelectorAll('[data-testid="split-part"][data-state="planned"]')];
    expect(parts.map((part) => part.querySelector("h3")?.textContent)).toEqual(["Payment 2 · rest"]);
    expect(text()).not.toContain("Payment 3");
    expect(document.querySelector('[aria-label="Payment 2 amount"]')?.textContent).toBe("2,000");
    expect(document.querySelector('[aria-label="Payment 2 method"] [data-state="on"]')?.textContent).toBe("Transfer");
    await chip("Payment 2 method", "PromptPay");
    expect(text()).not.toContain("Enter an amount");
    await tap("Charge ฿2,000");
    await tap("Confirm ฿2,000");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 300000 }, { method: "promptpay", amount: 200000 }]);
  }, 30000);

  it("after a reload, Check previous cash shows the change for what was handed over (astra r1 M6)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 500000 }]);
    await mount(desk, orderId, "cash");
    await input('input[inputmode="decimal"]', "5500");
    expect(document.querySelector('[data-testid="cash-change"]')?.textContent).toBe("฿500");
    expect((await desk.attempts())[0].legs[0]).toMatchObject({ tendered: 550000 });
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("checkout.cash.")) sessionStorage.removeItem(key);
    }
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Check previous cash");
    expect(document.querySelector<HTMLInputElement>('[data-testid="check-previous"] input')?.value).toBe("5500");
    expect(document.querySelector('[data-testid="check-previous"] [data-testid="cash-change"]')?.textContent).toBe("฿500");
    await input('[data-testid="check-previous"] input', "4000");
    expect(button("Short ฿1,000")?.disabled).toBe(true);
    await input('[data-testid="check-previous"] input', "5500");
    await tap("Taken");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "cash", amount: 500000, received: 550000 }]);
  }, 30000);

  it("keeps a corrected drawer amount across a second reload and records it on Taken (r3 major)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 500000 }]);
    await mount(desk, orderId, "cash");
    await input('input[inputmode="decimal"]', "5500");
    await reload(desk, orderId);
    await input('[data-testid="check-previous"] input', "5600");
    expect(document.querySelector('[data-testid="check-previous"] [data-testid="cash-change"]')?.textContent).toBe("฿600");
    // Saved on the server too, for a reload that loses this tab's draft.
    expect((await desk.attempts())[0].legs[0]).toMatchObject({ tendered: 560000 });
    await reload(desk, orderId);
    expect(document.querySelector<HTMLInputElement>('[data-testid="check-previous"] input')?.value).toBe("5600");
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("checkout.cash.")) sessionStorage.removeItem(key);
    }
    const { onPaid } = await reload(desk, orderId);
    expect(document.querySelector<HTMLInputElement>('[data-testid="check-previous"] input')?.value).toBe("5600");
    expect(document.querySelector('[data-testid="check-previous"] [data-testid="cash-change"]')?.textContent).toBe("฿600");
    await tap("Taken");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "cash", amount: 500000, received: 560000 }]);
  }, 30000);

  it("leaves the drawer amount blank after a reload once the correction was short (r3 major)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Robe", price: 500000 }]);
    await mount(desk, orderId, "cash");
    await input('input[inputmode="decimal"]', "5500");
    await reload(desk, orderId);
    await input('[data-testid="check-previous"] input', "4000");
    expect((await desk.attempts())[0].legs[0].tendered).toBeUndefined();
    await reload(desk, orderId);
    expect(document.querySelector<HTMLInputElement>('[data-testid="check-previous"] input')?.value).toBe("");
    expect(button("Short ฿5,000")?.disabled).toBe(true);
  }, 30000);

  it("requires a drawer amount when the previous cash instruction has no saved tender", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "cash");
    await reload(desk, orderId);
    const check = document.querySelector('[data-testid="check-previous"]');
    expect(check?.querySelector("input")?.value).toBe("");
    expect(check?.querySelector<HTMLButtonElement>('[data-testid="previous-taken"]')?.disabled).toBe(true);
    expect(await desk.payments()).toEqual([]);
  }, 30000);

  it("starts nothing while disconnected: the methods are off and the banner says why (astra r1 M5)", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await mount(desk, orderId, "split");
    expect(document.querySelector('[data-testid="pay-offline"]')?.textContent).toContain("New payments can't start until the connection is back");
    for (const label of ["Cash", "PromptPay", "Card", "Transfer", "Split payment"]) expect(button(label)?.disabled, label).toBe(true);
    expect(count(desk, "pos/commands/startPaymentAttempt:startPaymentAttempt")).toBe(0);
  }, 30000);

  it("shows Money taken · sale not saved with what was kept, and finishes the sale once", async () => {
    const desk = await createPayDeskBackend();
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    const me = desk.otherTill("ploy@example.com");
    const customerId = await me.mutation(api.pos.customers.createCustomer, { name: "Maya Lin" });
    await me.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
    const { onPaid } = await mount(desk, orderId, "card");
    // Another screen corrects Maya's profile between the terminal charge and settlement.
    await desk.t.run((ctx) => ctx.db.patch(customerId, { revision: 1 }));
    await act(() => desk.refresh());
    await tap("Confirm ฿1,200");
    expect(onPaid).not.toHaveBeenCalled();
    expect(text()).toContain("Money taken · sale not saved");
    expect(text()).toContain("Card · ฿1,200 kept");
    expect(text()).toContain("What changed: The customer changed.");
    await tap("Finish sale");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
  }, 30000);

  it("offers Pay the room first before any instruction, then charges the room alone", async () => {
    const { desk, orderId } = await denseStay();
    taps.push("Card");
    const { onPaid } = await mount(desk, orderId, "card");
    expect(text()).toContain("This bill is too large to pay in one go");
    expect(text()).not.toContain("on the terminal");
    expect(await desk.attempts()).toHaveLength(0);
    await tap("Pay the room first");
    expect(text()).toContain("Charge ฿600 on the terminal");
    expect(document.querySelector('[data-testid="linked-shop"]')?.textContent).toContain("Shop & spa · ฿350");
    await tap("Confirm ฿600");
    expect(taps).toEqual(["Card", "Pay the room first", "Confirm ฿600"]);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 60000 }]);
  }, 30000);

  it("retries a lost Pay the room first with its original key and revision (sol r1 minor)", async () => {
    const { desk, orderId } = await denseStay();
    const SPLIT = "pos/commands/splitStayPayment:splitStayPayment";
    const { onPaid } = await mount(desk, orderId, "card");
    desk.loseNext(SPLIT);
    await tap("Pay the room first");
    expect(document.querySelector('[data-testid="pay-offline"]')?.textContent).toContain("No answer from the server");
    await tap("Retry");
    const sent = desk.calls.filter((call) => call.name === SPLIT).map((call) => call.args as { clientKey: string; expectedRevision: number });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(text()).toContain("Charge ฿600 on the terminal");
    await tap("Confirm ฿600");
    expect(onPaid).toHaveBeenCalledOnce();
  }, 30000);

  it("asks a till that loaded the direct panel to reload once payments switch to attempts", async () => {
    const desk = await createPayDeskBackend({ mode: "direct" });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    expect(text()).toContain("Confirm ฿1,200 card");
    await desk.setAccess({ paymentsMode: "attempts" });
    await settle();
    expect(text()).toContain("Reload this till to take payments again");
    expect(text()).not.toContain("Confirm ฿1,200 card");
  }, 30000);
});

const OPEN_PANEL = "commerce/paymentCutover:openDirectPanel";
const CLOSE_PANEL = "commerce/paymentCutover:closeDirectPanel";
const openPanels = (desk: Desk) => desk.t.run((ctx) => ctx.db.query("directPaymentPanels").take(20));

describe("before the cutover", () => {
  it("keeps the direct panel as today, registered under its own key before its instruction, released by the sale", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector("[data-pay-desk]")).toBeNull();
    expect(text()).toContain("Charge the amount on the card terminal");
    expect(desk.calls.findIndex((call) => call.name === OPEN_PANEL)).toBeGreaterThanOrEqual(0);
    const [registered] = await openPanels(desk);
    expect(registered).toMatchObject({ orderId, panelKey: expect.stringMatching(/^[A-Za-z0-9_-]{20,128}$/) });
    expect(registered.panelKey).not.toContain(localStorage.getItem("checkout.deviceKey")!);
    await tap("Confirm ฿1,200 card");
    expect(onPaid, text()).toHaveBeenCalledOnce();
    expect(count(desk, "pos/commands/settleOrder:settleOrder")).toBe(1);
    expect(await desk.attempts()).toHaveLength(0);
    // The recorded sale released the registration on the server; the panel has nothing to close.
    expect(await openPanels(desk)).toEqual([]);
    await act(async () => root.unmount());
    await settle();
    expect(count(desk, CLOSE_PANEL)).toBe(0);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  }, 30000);

  it("releases a recorded direct payment even if its response is lost", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const second = await desk.order([{ name: "Oil", price: 50000 }]);
    await mount(desk, second, "card");
    desk.loseNext("pos/commands/settleOrder:settleOrder");
    await tap("Confirm ฿500 card");
    expect(text()).toContain("Connection lost");
    await act(async () => root.unmount());
    await settle();
    expect(await desk.orderDoc(second)).toMatchObject({ status: "paid" });
    expect(await openPanels(desk)).toEqual([]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  }, 30000);

  it("shows the pause screen when a new direct panel opens during the checkout pause", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", paused: true, liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="checkout-paused"]')?.textContent).toContain("Checkout paused for update");
    expect(text()).not.toContain("Charge the amount on the card terminal");
    expect(await openPanels(desk)).toEqual([]);
  }, 30000);

  it("before any pause, reopens a left direct panel as today's panel under the same registration", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    const [first] = await openPanels(desk);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const { onPaid } = await mount(desk, orderId, "card");
    expect(text()).toContain("Charge the amount on the card terminal");
    expect(document.querySelector('[data-testid="check-previous"]')).toBeNull();
    expect(await openPanels(desk)).toHaveLength(1);
    await tap("Confirm ฿1,200 card");
    expect(onPaid).toHaveBeenCalledOnce();
    const sent = desk.calls.filter((call) => call.name === "pos/commands/settleOrder:settleOrder").map((call) => call.args as { panelKey?: string });
    expect(sent.map((args) => args.panelKey)).toEqual([first.panelKey]);
    expect(await openPanels(desk)).toEqual([]);
  }, 30000);

  it("continues the cashier's unrecorded direct panel: Check previous payment, recorded during the pause (r3 blocker)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    expect(text()).toContain("Charge the amount on the card terminal");
    const [first] = await openPanels(desk);
    // The terminal approved; the cashier left before Confirm. Then checkout pauses.
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await desk.t.run(async (ctx) => {
      const row = (await ctx.db.query("commerceSettings").first())!;
      await ctx.db.patch(row._id, { cutover: { pausedAt: Date.now(), actor: "owner" } });
    });
    await act(() => desk.refresh());
    await settle();
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/Check previous payment.*Card ฿1,200 · \d\d:\d\d/);
    expect(text()).not.toContain("Charge the amount on the card terminal");
    await tap("Taken");
    expect(text()).toContain("Record the payment that was taken");
    expect(text()).not.toContain("Charge the amount on the card terminal");
    await tap("Confirm ฿1,200 card");
    expect(onPaid).toHaveBeenCalledOnce();
    const sent = desk.calls.filter((call) => call.name === "pos/commands/settleOrder:settleOrder").map((call) => call.args as { panelKey?: string });
    expect(sent.map((args) => args.panelKey)).toEqual([first.panelKey]);
    expect(await openPanels(desk)).toEqual([]);
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
  }, 30000);

  it("acknowledges the new panel with the revision this page loaded, then takes payment by attempt", async () => {
    const desk = await createPayDeskBackend({ mode: "attempts", liveAccess: true, cutover: { revision: 4 } });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    // The first till on the new payments: acknowledge creates its till record.
    await desk.t.run((ctx) => ctx.db.insert("tills", { key: "default" }));
    const { onPaid } = await mount(desk, orderId, "card");
    // This browser's own till (found by its device key), not the shared default one.
    const mine = (await desk.tills()).find((till) => till.key === "payment")!;
    expect(mine.paymentRollout?.acknowledged).toMatchObject({ mode: "attempts", revision: 4 });
    expect(text()).toContain("Charge ฿1,200 on the terminal");
    expect(localStorage.getItem("checkout.tillId")).toBe(mine._id);
    await tap("Confirm ฿1,200");
    expect(onPaid).toHaveBeenCalledOnce();
  }, 30000);

  it("asks for a reload when the cutover revision moves after this page loaded", async () => {
    const desk = await createPayDeskBackend({ mode: "attempts", liveAccess: true, cutover: { revision: 4 } });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await desk.t.run((ctx) => ctx.db.insert("tills", { key: "default" }));
    await mount(desk, orderId, "none");
    await desk.t.run(async (ctx) => {
      const row = (await ctx.db.query("commerceSettings").first())!;
      await ctx.db.patch(row._id, { cutover: { ...row.cutover!, revision: 5 } });
    });
    await act(() => desk.refresh());
    await settle();
    expect(document.querySelector('[data-testid="till-reload"]')?.textContent).toContain("Reload this till to take payments again");
  }, 30000);
});

// W2B before payments go live (docs/commerce/deferred.md): the owner's Hand over, accepted at the
// chosen till, with two cashiers. The terminal instruction already shown stays locked over there.
describe("Hand over to another till", () => {
  it("cashier A hands a card payment to Till B mid-charge; cashier B accepts it, checks the terminal and finishes", async () => {
    const desk = await createPayDeskBackend({ role: "manager", email: "mali@example.com" });
    const tillB = await desk.otherAcknowledgedTill();
    const labelB = `Till ${tillB.tillId.slice(-6).toUpperCase()}`;
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await desk.setStaff({ role: "cashier", email: "ploy@example.com" });
    taps.push("Card");
    await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿1,200 on the terminal");
    const [armed] = await desk.attempts();
    await tap("Hand over");
    expect(text()).toMatch(/This till is Till [A-Z0-9]{6}\./);
    await tap(`Hand over to ${labelB}`);
    expect(text()).toContain(`Handed over to ${labelB}`);
    expect(button("Accept the payment")).toBeUndefined();
    expect(buttons().some((b) => b.textContent?.startsWith("Confirm"))).toBe(false);
    expect(taps).toEqual(["Card", "Hand over", `Hand over to ${labelB}`]);
    // Till A's next action is refused: the payment belongs to Till B now.
    const stale = await desk.rawMutation(api.pos.commands.recordPaymentLeg.recordPaymentLeg, {
      attemptId: armed._id, ownerRevision: 0, tillId: localStorage.getItem("checkout.tillId")!, tabKey: await claimTabKey(), legKey: "card-1", kind: "collection", outcome: "taken",
    });
    expect(stale).toMatchObject({ status: "refused", code: "payment_handed_over" });

    // Cashier B on Till B (another browser): the payment waits for them.
    await act(async () => root.unmount());
    localStorage.setItem("checkout.deviceKey", tillB.load.deviceKey);
    localStorage.setItem("checkout.tillId", tillB.tillId);
    sessionStorage.clear();
    resetLoadedPayMode();
    resetPinnedAccess();
    resetTabKey();
    await desk.setStaff({ role: "cashier", email: "nok@example.com" });
    desk.forget();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    taps = [];
    const { onPaid } = await mount(desk, orderId, "card", true);
    expect(text()).toContain("Handed over to this till");
    await tap("Accept the payment");
    expect(text()).toContain("Check previous payment");
    expect(text()).not.toContain("on the terminal");
    await tap("Taken");
    expect(taps).toEqual(["Accept the payment", "Taken"]);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(count(desk, ARM)).toBe(1);
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
    expect((await desk.attempts())[0]).toMatchObject({ status: "settled", ownerRevision: 2, tillId: tillB.tillId });
  }, 30000);
});

// PR 93 round 3 (astra B1, B2): a payment handed back to its original till, and the booking email choice.
describe("Hand back and the booking email choice", () => {
  const takeOver = api.pos.commands.handoverPaymentAttempt.takeOverPaymentAttempt;
  const release = api.pos.commands.handoverPaymentAttempt.releasePaymentAttempt;
  const emailBox = () => [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("Send booking payment confirmation email"))?.querySelector("input") ?? null;

  /** Till B's cashier accepts the payment and sends it straight back to Till A without recording anything. */
  async function handBack(desk: Desk, orderId: OrderId, tillB: Awaited<ReturnType<Desk["otherAcknowledgedTill"]>>, tillA: string) {
    const [attempt] = await desk.attempts();
    await desk.setStaff({ role: "cashier", email: "nok@example.com" });
    const onB = { tillId: tillB.tillId, tabKey: tillB.tabKey };
    expect(await desk.rawMutation(takeOver, { ...onB, load: tillB.load, orderId, expectedOwnerRevision: attempt.ownerRevision })).toMatchObject({ status: "taken_over" });
    expect(await desk.rawMutation(release, { attemptId: attempt._id, ownerRevision: attempt.ownerRevision + 1, ...onB, nextTillId: tillA })).toMatchObject({ status: "released" });
    await desk.setStaff({ role: "cashier", email: "ploy@example.com" });
    await settle();
  }

  async function stayOrder(desk: Desk) {
    const orderId = await desk.order([{ name: "Tea", price: 65000 }]);
    const bookingId = await desk.t.run(async (ctx) => {
      const propertyId = await ctx.db.insert("properties", { slug: "villa", name: "Villa 12", tagline: "", description: "", pricePerNight: 30000, currency: "THB", maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: "active" });
      return ctx.db.insert("bookings", { propertyId, guestName: "Guest", guestPhone: "0812345678", guestPhoneDigits: "0812345678", guestEmail: "guest@example.com", checkIn: "2026-11-01", checkOut: "2026-11-03", guests: 2, nights: 2, subtotal: 60000, discountAmount: 0, total: 60000, amountPaid: 0, amountRefunded: 0, currency: "THB", paymentStatus: "pending", confirmationCode: "STAY", accessToken: "test-only", status: "confirmed", createdAt: Date.now() });
    });
    await desk.otherTill("ploy@example.com").mutation(api.pos.commands.attach.attach, { orderId, bookingId });
    await desk.refresh();
    return { orderId, bookingId };
  }

  it("A → B → A on the still-open original panel: Check previous payment, never a second Charge (astra r3 B1)", async () => {
    const desk = await createPayDeskBackend({ role: "manager", email: "mali@example.com" });
    const tillB = await desk.otherAcknowledgedTill();
    const orderId = await desk.order([{ name: "Tea", price: 65000 }]);
    await desk.setStaff({ role: "cashier", email: "ploy@example.com" });
    taps.push("Card");
    const { onPaid } = await mount(desk, orderId, "card");
    expect(text()).toContain("Charge ฿650 on the terminal");
    await tap("Hand over");
    await tap(`Hand over to Till ${tillB.tillId.slice(-6).toUpperCase()}`);
    await handBack(desk, orderId, tillB, localStorage.getItem("checkout.tillId")!);
    expect(text()).toContain("Handed over to this till");
    await tap("Accept the payment");
    expect(text()).toContain("Check previous payment");
    expect(text()).toContain("Card ฿650");
    expect(text()).not.toContain("on the terminal");
    expect(buttons().some((b) => b.textContent?.startsWith("Confirm"))).toBe(false);
    await tap("Taken");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(count(desk, ARM)).toBe(1);
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 65000 }]);
  }, 30000);

  it("keeps a checked booking email across a reload and settles with it (astra r3 B2)", async () => {
    const desk = await createPayDeskBackend();
    const { orderId, bookingId } = await stayOrder(desk);
    await mount(desk, orderId, "card");
    expect(text()).toContain("on the terminal");
    expect(emailBox()?.checked).toBe(false);
    await act(async () => emailBox()!.click());
    await settle();
    expect(emailBox()?.checked).toBe(true);
    const { onPaid } = await reload(desk, orderId);
    expect(text()).toContain("Check previous payment");
    expect(emailBox()?.checked).toBe(true);
    await tap("Taken");
    expect(onPaid).toHaveBeenCalledOnce();
    expect((await desk.t.run((ctx) => ctx.db.get(bookingId)))?.confirmationEmailsQueuedAt).toBeDefined();
  }, 30000);

  it("hands a checked booking email to the accepting till, which settles with it (astra r3 B2)", async () => {
    const desk = await createPayDeskBackend();
    const tillB = await desk.otherAcknowledgedTill();
    const { orderId, bookingId } = await stayOrder(desk);
    await desk.setStaff({ role: "cashier", email: "ploy@example.com" });
    await mount(desk, orderId, "card");
    await act(async () => emailBox()!.click());
    await settle();
    await tap("Hand over");
    await tap(`Hand over to Till ${tillB.tillId.slice(-6).toUpperCase()}`);
    // Till B accepts it: the choice is on the attempt, so B sees it checked and settles with it.
    const [attempt] = await desk.attempts();
    expect(attempt).toMatchObject({ notifyGuest: true });
    await desk.setStaff({ role: "cashier", email: "nok@example.com" });
    const onB = { attemptId: attempt._id, tillId: tillB.tillId, tabKey: tillB.tabKey };
    const accepted = await desk.rawMutation(takeOver, { tillId: tillB.tillId, tabKey: tillB.tabKey, load: tillB.load, orderId, expectedOwnerRevision: 1 });
    expect(accepted).toMatchObject({ status: "taken_over", attempt: { notifyGuest: true } });
    await desk.rawMutation(api.pos.commands.recordPaymentLeg.recordPaymentLeg, { ...onB, ownerRevision: 2, legKey: attempt.legs[0].key, kind: "collection", outcome: "taken" });
    expect(await desk.rawMutation(api.pos.commands.settleOrder.settlePaymentAttempt, { ...onB, ownerRevision: 2 })).toMatchObject({ status: "settled" });
    expect((await desk.t.run((ctx) => ctx.db.get(bookingId)))?.confirmationEmailsQueuedAt).toBeDefined();
  }, 30000);
});
