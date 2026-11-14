// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { PayPanel } from "@/components/checkout/PayPanel";
import { cashConfirmLabel, cashNotes } from "@/components/checkout/checkout-ui";

/*
 * P3 · Pay panel: cash opens at the amount due, note chips set what was handed over, split rows end
 * in "the rest", and the tender row replaces Back. Every money action keeps one attempt key per
 * attempt: a retry after a lost response sends the very same settle call.
 */

let root: Root;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text);
const click = (text: string) => act(async () => { expect(button(text), text).toBeTruthy(); button(text)!.click(); });
const tick = (ms = 200) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const input = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  expect(el, selector).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const confirmText = () => {
  const control = buttons().find((b) => b.textContent?.startsWith("Confirm") || b.textContent?.startsWith("Short"));
  return control?.getAttribute("aria-label") ?? control?.textContent?.trim();
};

function Probe({ backend, orderId, mode, onBack, onPaid }: { backend: CheckoutBackend; orderId: OrderId; mode: ComponentProps<typeof PayPanel>["mode"]; onBack: () => void; onPaid: () => void }) {
  const view: OrderView | null | undefined = backend.useOrder(orderId);
  return view ? createElement(PayPanel, { view, mode, onBack, onPaid }) : null;
}

async function openPanel(mode: ComponentProps<typeof PayPanel>["mode"], price = 1200) {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const added = actions.addItem({ item: { kind: "extra", name: "Tea", price } });
  await tick();
  const { orderId } = await added;
  const onBack = vi.fn();
  const onPaid = vi.fn();
  const provider = { backend: backend as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>;
  await act(async () => root.render(createElement(CheckoutBackendProvider, provider, createElement(Probe, { backend, orderId, mode, onBack, onPaid }))));
  await tick();
  return { actions, onBack, onPaid };
}

/** The first settle records the payment but its answer is lost, as on a dropped connection. */
function loseFirstAnswer(actions: ReturnType<CheckoutBackend["useActions"]>) {
  const original = actions.settleOrder;
  return vi.spyOn(actions, "settleOrder").mockImplementationOnce(async (args) => { await original(args); throw new Error("Response lost"); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T09:12:34Z"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("cash wording", () => {
  it("offers the next notes up", () => {
    expect(cashNotes(1200)).toEqual([1500, 2000]);
    expect(cashNotes(1000)).toEqual([1500, 2000]);
    expect(cashNotes(1450)).toEqual([1500, 2000]);
    expect(cashNotes(180)).toEqual([200, 500]);
    expect(cashNotes(60)).toEqual([100, 500]);
    expect(cashNotes(450)).toEqual([500, 1000]);
    expect(cashNotes(950)).toEqual([1000, 2000]);
    expect(cashNotes(30.3)).toEqual([100, 500]);
    expect(cashNotes(9_999_000)).toEqual([9_999_500, 10_000_000]);
    expect(cashNotes(10_000_000)).toEqual([]);
  });

  it("says the money on the button", () => {
    expect(cashConfirmLabel(1200, 1200)).toEqual({ ready: true, text: "Confirm ฿1,200 cash · no change" });
    expect(cashConfirmLabel(1200, 1500)).toEqual({ ready: true, text: "Confirm ฿1,500 cash · change ฿300" });
    expect(cashConfirmLabel(1200, 1000)).toEqual({ ready: false, text: "Short ฿200" });
  });
});

describe("pay panel", () => {
  it("opens cash at the amount due, a note chip sets what was handed over, and typing replaces it", async () => {
    const { actions, onPaid } = await openPanel("cash");
    const settle = vi.spyOn(actions, "settleOrder");
    expect(document.querySelector<HTMLInputElement>("#cash-received")?.value).toBe("1200");
    expect(confirmText()).toBe("Confirm ฿1,200 cash · no change");
    await click("฿1,500");
    expect(confirmText()).toBe("Confirm ฿1,500 cash · change ฿300");
    expect(button("฿1,500")?.getAttribute("aria-pressed")).toBe("true");
    await click("฿2,000");
    expect(confirmText()).toBe("Confirm ฿2,000 cash · change ฿800");
    await input("#cash-received", "1100");
    expect(confirmText()).toBe("Short ฿100");
    expect(button("Short ฿100")?.disabled).toBe(true);
    await click("฿1,500");
    await click("Confirm ฿1,500 cash · change ฿300"); await tick();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0]).toMatchObject({ expectedDue: 1200, tenders: [{ method: "cash", amount: 1200, received: 1500 }] });
    expect(onPaid).toHaveBeenCalledOnce();
  });

  it("retries a cash payment with the same attempt key", async () => {
    const { actions, onPaid } = await openPanel("cash");
    const settle = loseFirstAnswer(actions);
    await click("Confirm ฿1,200 cash · no change"); await tick();
    expect(document.body.textContent).toContain("Response lost");
    // The attempt is frozen: no other amount, and switching or retrying can't change it silently.
    expect(document.querySelector<HTMLInputElement>("#cash-received")?.closest("fieldset")?.disabled).toBe(true);
    await click("Retry payment"); await tick();
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle.mock.calls[1][0]).toEqual(settle.mock.calls[0][0]);
    expect(settle.mock.calls[1][0].idempotencyKey).toBe(settle.mock.calls[0][0].idempotencyKey);
    await expect(settle.mock.results[1].value).resolves.toMatchObject({ replayed: true });
    expect(onPaid).toHaveBeenCalledOnce();
  });

  it("retries a card payment with the same attempt key", async () => {
    const { actions } = await openPanel("card");
    const settle = loseFirstAnswer(actions);
    await click("Confirm ฿1,200 card"); await tick();
    await click("Retry payment"); await tick();
    expect(settle.mock.calls[1][0]).toEqual(settle.mock.calls[0][0]);
    await expect(settle.mock.results[1].value).resolves.toMatchObject({ replayed: true });
  });

  it("fills the last split row with the rest, and retries the split with the same attempt key", async () => {
    const { actions, onPaid } = await openPanel("split");
    const settle = loseFirstAnswer(actions);
    const rowTwo = document.querySelector('[aria-label="Payment 2 method"]')!;
    await act(async () => [...rowTwo.querySelectorAll("button")].find((b) => b.textContent === "Card")!.click());
    expect(document.querySelector('[data-testid="split-remaining"]')?.textContent).toBe("฿1,200");
    expect(button("Confirm split")?.disabled).toBe(true);
    await input('[aria-label="Payment 1 amount"]', "500");
    expect(document.querySelector('[data-testid="split-remaining"]')?.textContent).toBe("฿700");
    await click("Confirm ฿500 cash + ฿700 card"); await tick();
    expect(settle.mock.calls[0][0]).toMatchObject({ tenders: [{ method: "cash", amount: 500 }, { method: "card", amount: 700 }] });
    await click("Retry payment"); await tick();
    expect(settle.mock.calls[1][0]).toEqual(settle.mock.calls[0][0]);
    expect(onPaid).toHaveBeenCalledOnce();
  });

  it("refuses a split whose typed rows already cover the bill", async () => {
    await openPanel("split");
    await input('[aria-label="Payment 1 amount"]', "1500");
    expect(document.body.textContent).toContain("Over by");
    expect(document.querySelector('[data-testid="split-remaining"]')?.textContent).toBe("฿300");
    expect(button("Confirm split")?.disabled).toBe(true);
  });

  it("switches tender from the tender row, with focus starting on the active tender", async () => {
    const { actions, onBack } = await openPanel("cash");
    const settle = vi.spyOn(actions, "settleOrder");
    expect(button("Cash")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(button("Cash"));
    expect(button("Back to order")).toBeUndefined();

    await click("Card");
    expect(button("Card")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#cash-received")).toBeNull();
    await click("Confirm ฿1,200 card"); await tick();
    expect(settle.mock.calls[0][0]).toMatchObject({ tenders: [{ method: "card", amount: 1200 }] });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("leaves on the active tender and on Escape from inside the panel", async () => {
    const { onBack } = await openPanel("promptpay");
    await click("PromptPay");
    expect(onBack).toHaveBeenCalledOnce();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { document.activeElement!.dispatchEvent(escape); });
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("keeps the tender row locked while a payment is in flight", async () => {
    const { actions, onBack } = await openPanel("cash");
    let release = () => {};
    vi.spyOn(actions, "settleOrder").mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(new Error("Response lost")); }));
    await click("Confirm ฿1,200 cash · no change");
    expect(button("Card")?.disabled).toBe(true);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(escape); });
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => release());
    expect(button("Card")?.disabled).toBe(false);
  });

  it("shows the payment time as Received now until Change opens it", async () => {
    await openPanel("cash");
    expect(document.body.textContent).toContain("Received now");
    expect(document.querySelector("#payment-effective")).toBeNull();
    await click("Change payment time");
    await input("#payment-effective-time", "14:15");
    expect(document.body.textContent).toContain("Received 2026-11-01 · 14:15 Bangkok");
  });
});
