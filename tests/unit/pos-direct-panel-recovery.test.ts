import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement, Fragment, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { PayPanel } from "@/components/checkout/PayPanel";
import { resetLoadedPayMode } from "@/components/checkout/pay-desk";
import { resetTabKey } from "@/components/checkout/pay-desk-tab";
import { resetPinnedAccess } from "@/components/checkout/pay-desk-backend";
import { createPayDeskBackend } from "../support/paydesk-backend";

/*
 * PR 92 round 4 · the direct panel through the payments cutover, on the registered functions.
 * Before any pause it is today's panel whatever its registration does. From the first pause on, a
 * reopened panel records exactly what it instructed, on its own till and tab, or goes to a manager.
 */

let root: Root;
type Desk = Awaited<ReturnType<typeof createPayDeskBackend>>;
const OPEN_PANEL = "commerce/paymentCutover:openDirectPanel";
const SETTLE = "pos/commands/settleOrder:settleOrder";
const CARD_HINT = "Charge the amount on the card terminal";

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string | RegExp) => buttons().find((b) => {
  const name = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "";
  return typeof label === "string" ? name === label : label.test(name);
});
const text = () => document.body.textContent ?? "";
const tick = (ms = 50) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
const tap = async (label: string | RegExp) => {
  await settle();
  const target = button(label);
  expect(target, `${label} in: ${text()}`).toBeTruthy();
  expect(target!.disabled, `${label} enabled`).toBe(false);
  await act(async () => target!.click());
  await settle();
};
const panels = (desk: Desk) => desk.t.run((ctx) => ctx.db.query("directPaymentPanels").take(10));

function Probe({ backend, orderId, mode, onBack, onPaid }: { backend: CheckoutBackend; orderId: OrderId; mode: ComponentProps<typeof PayPanel>["mode"]; onBack: () => void; onPaid: () => void }) {
  const view: OrderView | null | undefined = backend.useOrder(orderId);
  if (!view) return null;
  // The order panel's entry during the pause, which focus returns to.
  return createElement(Fragment, null,
    createElement("button", { type: "button", "data-pay-return": "" }, "Check previous payment"),
    createElement(PayPanel, { view, mode, onBack, onPaid }));
}

async function mount(desk: Desk, orderId: OrderId, mode: ComponentProps<typeof PayPanel>["mode"]) {
  const onBack = vi.fn();
  const onPaid = vi.fn();
  const provider = { backend: desk as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>;
  await act(async () => root.render(createElement(CheckoutBackendProvider, provider, createElement(Probe, { backend: desk, orderId, mode, onBack, onPaid }))));
  await settle();
  return { onBack, onPaid };
}

/** The cashier leaves the panel (Order) and comes back to the same page later. */
async function leave() {
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
}

/** "Checkout paused for update", as the manager's setPaused leaves the settings. */
async function pause(desk: Desk) {
  await desk.t.run(async (ctx) => {
    const row = (await ctx.db.query("commerceSettings").first())!;
    await ctx.db.patch(row._id, { cutover: { pausedAt: Date.now(), actor: "owner" }, cutoverStartedAt: Date.now() });
  });
  await act(() => desk.refresh());
  await settle();
}

/** An order with a confirmed stay on it: the panel offers the booking payment confirmation email. */
async function stayOrder(desk: Desk) {
  const orderId = await desk.order([{ name: "Tea", price: 20000 }]);
  const bookingId = await desk.t.run(async (ctx) => {
    const propertyId = await ctx.db.insert("properties", { slug: "villa", name: "Villa 12", tagline: "", description: "", pricePerNight: 30000, currency: "THB", maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: "active" });
    return ctx.db.insert("bookings", { propertyId, guestName: "Guest", guestPhone: "0812345678", guestPhoneDigits: "0812345678", checkIn: "2026-11-19", checkOut: "2026-11-21", guests: 2, nights: 2, subtotal: 60000, discountAmount: 0, total: 60000, amountPaid: 0, amountRefunded: 0, currency: "THB", paymentStatus: "pending", confirmationCode: "STAY", accessToken: "test-only", status: "confirmed", createdAt: Date.now() });
  });
  await desk.rawMutation(api.pos.commands.attach.attach, { orderId, bookingId });
  await act(() => desk.refresh());
  return orderId;
}
const emailBox = () => [...document.querySelectorAll<HTMLLabelElement>("label")].find((el) => el.textContent?.includes("Send booking payment confirmation email"))?.querySelector("input");
const toggleEmail = () => act(async () => emailBox()!.click());

beforeAll(async () => {
  await Promise.all([import("@/components/checkout/PayRecovery"), import("@/components/checkout/pay-desk-tab")]);
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

describe("before any pause", () => {
  it("keeps today's Card panel and records it when the registration fails (r4 dormant regression)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    desk.sendFirst(OPEN_PANEL, async () => { throw new Error("Connection lost"); });
    const { onPaid } = await mount(desk, orderId, "card");
    expect(text()).toContain(CARD_HINT);
    expect(text()).not.toContain("didn't open");
    expect(await panels(desk)).toEqual([]);
    await tap("Confirm ฿1,200 card");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
  }, 30000);

  it("keeps today's panel, Cash and Split included, when the server refuses the registration", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    desk.sendFirst(OPEN_PANEL, async () => { throw Object.assign(new Error("refused"), { data: { code: "KEY_CONFLICT", message: "This pay panel key is already in use." } }); });
    const { onPaid } = await mount(desk, orderId, "split");
    expect(text()).not.toContain("already in use");
    await tap("Cash");
    await tap(/^Confirm cash · ฿1,200 received/);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(desk.calls.filter((call) => call.name === SETTLE)).toHaveLength(1);
  }, 30000);

  it("reports each tender the panel shows, so a later check names the right one", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    expect((await panels(desk))[0].instruction).toMatchObject({ tenders: [{ method: "card", amount: 120000 }] });
    await tap("PromptPay");
    expect((await panels(desk))[0].instruction).toMatchObject({ tenders: [{ method: "promptpay", amount: 120000 }] });
  }, 30000);
});

describe("from the first pause on", () => {
  it("records a verified PromptPay as PromptPay, never as the Card the order panel reopened on (r4 astra blocker b)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Massage", price: 500000 }]);
    await mount(desk, orderId, "promptpay");
    await leave();
    await pause(desk);
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/PromptPay ฿5,000 · \d\d:\d\d/);
    await tap("Taken");
    expect(text()).toContain("Record the payment that was taken");
    // No tender picker: only the instruction that was approved can be recorded.
    expect(document.querySelector('[aria-label="Take payment by"]')).toBeNull();
    await tap(/^Confirm ฿5,000/);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "promptpay", amount: 500000 }]);
    expect(await panels(desk)).toEqual([]);
  }, 30000);

  it("sends a Card approval to a manager when the order changed across the pause (r4 astra blocker a)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Massage", price: 500000 }]);
    await mount(desk, orderId, "card");
    await leave();
    await desk.rawMutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: "extra", name: "Oil", price: 50000 } });
    await pause(desk);
    await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/Card ฿5,000/);
    expect(document.querySelector('[data-testid="previous-unmatched"]')?.textContent).toContain("The order changed since this payment was shown.");
    expect(document.querySelector('[data-testid="previous-taken"]')).toBeNull();
    const askButton = document.querySelector<HTMLButtonElement>('[data-testid="previous-other"]')!;
    expect(askButton.textContent?.trim()).toBe("Ask a manager");
    await act(async () => askButton.click());
    await settle();
    expect(text()).toContain("Ask a manager to reconcile this pay panel.");
    expect(text()).not.toMatch(/Confirm ฿5,[05]00/);
    expect(await desk.payments()).toEqual([]);
    expect(await panels(desk)).toHaveLength(1);
  }, 30000);

  it("shows another tab's open panel as in progress elsewhere; a manager takes it over and records its own instruction (r4 sol blocker 2)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    await leave();
    await pause(desk);
    // Another tab of this browser: a new tab key.
    sessionStorage.clear();
    resetTabKey();
    const { onPaid } = await mount(desk, orderId, "transfer");
    expect(document.querySelector('[data-testid="payment-elsewhere"]')?.textContent).toMatch(/Payment in progress on Till [A-Z0-9]{6} · \d\d:\d\d/);
    expect(text()).not.toContain("Charge");
    expect(button("Take over")?.disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('[data-testid="payment-elsewhere"] input[type="checkbox"]')!.click());
    await tap("Take over");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/Card ฿1,200/);
    await tap("Taken");
    await tap("Confirm ฿1,200 card");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 120000 }]);
    expect(await panels(desk)).toEqual([]);
  }, 30000);

  it("returns focus to Check previous payment after Escape or Back during the pause (r4 astra major)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await mount(desk, orderId, "card");
    await leave();
    await pause(desk);
    const { onBack } = await mount(desk, orderId, "card");
    expect(document.activeElement?.textContent).toBe("Taken");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
    expect(document.activeElement?.getAttribute("data-pay-return")).toBe("");
  }, 30000);

  it("keeps the booking confirmation email choice for a panel reopened during the pause, and sends it at settlement (PR 93 lane)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await stayOrder(desk);
    await mount(desk, orderId, "card");
    expect(emailBox()?.checked).toBe(false);
    await toggleEmail();
    await settle();
    expect((await panels(desk))[0]).toMatchObject({ notifyGuest: true });
    await leave();
    await pause(desk);
    // A reload of this tab during the pause: the page reads everything again.
    desk.forget();
    resetPinnedAccess();
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="previous-other"]')?.textContent?.trim()).toBe("Different or not sure");
    await tap("Taken");
    expect(emailBox()?.checked).toBe(true);
    expect(emailBox()?.disabled).toBe(true);
    expect(text()).toContain("Received now");
    expect(button("Edit time")).toBeUndefined();
    await tap(/^Confirm ฿/);
    expect(onPaid).toHaveBeenCalledOnce();
    const sent = desk.calls.filter((call) => call.name === SETTLE).map((call) => call.args as { notifyGuest?: boolean });
    expect(sent).toMatchObject([{ notifyGuest: true }]);
    expect(await panels(desk)).toEqual([]);
  }, 30000);

  it("before any pause, a reopened panel starts with the email choice off, as today", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await stayOrder(desk);
    await mount(desk, orderId, "card");
    await toggleEmail();
    await settle();
    await leave();
    await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')).toBeNull();
    expect(emailBox()?.checked).toBe(false);
  }, 30000);
});

// ─── Round 5 (PR #92): the registration holds exactly what the panel shows ──
const INSTRUCT = "commerce/paymentCutover:instructDirectPanel";
const PROMPTPAY_CONFIRM = /^Confirm ฿5,000/;
/** A pause started and lifted: the cutover window. */
async function cutoverWindow(desk: Desk) {
  await pause(desk);
  await desk.t.run(async (ctx) => {
    const row = (await ctx.db.query("commerceSettings").first())!;
    await ctx.db.patch(row._id, { cutover: undefined });
  });
  await act(() => desk.refresh());
  await settle();
}

describe("round 5", () => {
  it("records the PromptPay a reopened panel showed, never the Card it first showed (r5 sol blocker 1, astra blocker 1)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Massage", price: 500000 }]);
    await mount(desk, orderId, "card");
    await leave();
    // Before the first pause the same order and tab reopen on PromptPay: today's panel, at once.
    await mount(desk, orderId, "promptpay");
    expect(text()).toMatch(/Confirm ฿5,000/);
    expect(await panels(desk)).toMatchObject([{ instruction: { tenders: [{ method: "promptpay", amount: 500000 }] } }]);
    await leave();
    await pause(desk);
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/PromptPay ฿5,000/);
    await tap("Taken");
    await tap(PROMPTPAY_CONFIRM);
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "promptpay", amount: 500000 }]);
  }, 30000);

  it("shows a new tender's instruction only once saved; a failed save shows Try again, not Confirm (r5 sol second probe)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await cutoverWindow(desk);
    await mount(desk, orderId, "card");
    expect(text()).toContain(CARD_HINT);
    desk.sendFirst(INSTRUCT, async () => { throw new Error("Connection lost"); });
    await tap("PromptPay");
    expect(document.querySelector('[data-testid="instruction-unsaved"]')).toBeTruthy();
    expect(button(/^Confirm ฿1,200/)).toBeUndefined();
    expect(await panels(desk)).toMatchObject([{ instruction: { tenders: [{ method: "card" }] } }]);
    await tap("Try again");
    expect(button(/^Confirm ฿1,200/)).toBeTruthy();
    expect(await panels(desk)).toMatchObject([{ instruction: { tenders: [{ method: "promptpay", amount: 120000 }] } }]);
  }, 30000);

  it("saves the fresh Card after Not taken, so the next check names it and Taken records it (r5 astra major)", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Massage", price: 500000 }]);
    await cutoverWindow(desk);
    await mount(desk, orderId, "card");
    await leave();
    await mount(desk, orderId, "card");
    await tap("Not taken");
    expect(text()).toContain(CARD_HINT);
    expect(await panels(desk)).toMatchObject([{ checking: false, instruction: { tenders: [{ method: "card", amount: 500000 }] } }]);
    // The terminal approves; the cashier leaves before Confirm and checkout pauses.
    await leave();
    await pause(desk);
    const { onPaid } = await mount(desk, orderId, "card");
    expect(document.querySelector('[data-testid="check-previous"]')?.textContent).toMatch(/Card ฿5,000/);
    expect(document.querySelector('[data-testid="previous-taken"]')).toBeTruthy();
    await tap("Taken");
    await tap("Confirm ฿5,000 card");
    expect(onPaid).toHaveBeenCalledOnce();
    expect(await desk.payments()).toMatchObject([{ method: "card", amount: 500000 }]);
  }, 30000);

  it("saves a split's covering parts before Confirm, and clears them when they no longer cover the bill", async () => {
    const desk = await createPayDeskBackend({ mode: "direct", liveAccess: true });
    const orderId = await desk.order([{ name: "Tea", price: 120000 }]);
    await cutoverWindow(desk);
    await mount(desk, orderId, "split");
    const amount = () => document.querySelector<HTMLInputElement>('input[aria-label="Payment 1 amount"]')!;
    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(amount(), value);
        amount().dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    };
    await type("200");
    expect(await panels(desk)).toMatchObject([{ instruction: { tenders: [{ method: "cash", amount: 20000 }, { method: "promptpay", amount: 100000 }] } }]);
    expect(button(/^Confirm .*฿200/)?.disabled).toBe(false);
    await type("");
    expect((await panels(desk))[0].instruction).toBeUndefined();
  }, 30000);
});
