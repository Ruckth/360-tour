// @vitest-environment happy-dom
import { act, gateResponse } from '../support/checkout-act';
import { createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "../support/checkout-backend";

let root: Root;
function Page({ start }: { start: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const show = (backend: CheckoutBackend, start: OrderId | null) =>
  act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { start }))));
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const inPanel = (text: string) => [...panel().querySelectorAll("button")].find((el) => ((el.getAttribute("aria-label") ?? el.textContent?.trim()) === text || (text === "Cash" && el.textContent?.trim().startsWith("Cash ฿")))) as HTMLButtonElement | undefined;
const row = (name: string) => [...panel().querySelectorAll("li")].find((li) => li.querySelector("button")?.textContent?.startsWith(name))!;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const priceInput = () => panel().querySelector<HTMLInputElement>('input[id^="price-"]')!;
const reasonInput = () => panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Reason for the price change"]')!;

async function orderWithGift(backend: CheckoutBackend) {
  const adding = backend.useActions().addItem({ item: { kind: "extra", name: "Gift basket", price: 100000 } });
  await vi.advanceTimersByTimeAsync(200);
  return (await adding).orderId;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("editing a changed price", () => {
  it("corrects an existing price change and its reason in place, without restoring it first", async () => {
    const backend = await createFixtureBackend();
    const orderId = await orderWithGift(backend);
    await show(backend, orderId);
    await click(row("Gift basket").querySelector("button"));
    await click(inPanel("Price ฿1,000"));
    type(priceInput(), "800");
    type(reasonInput(), "Loyal guets");
    await click(inPanel("Apply price"));
    await settle();
    expect(row("Gift basket").textContent).toContain("Price changed: Loyal guets");

    // Edit opens the form with the current price and reason; unchanged, it can't be re-applied.
    await click(inPanel("Edit"));
    expect(priceInput().value).toBe("800");
    expect(reasonInput().value).toBe("Loyal guets");
    expect(inPanel("Apply price")?.disabled).toBe(true);

    type(priceInput(), "750");
    type(reasonInput(), "Loyal guest");
    await click(inPanel("Apply price"));
    await settle();
    expect(row("Gift basket").textContent).toContain("Price changed: Loyal guest");
    expect(panel().querySelector('[data-testid="order-due"]')?.textContent).toBe("฿750");

    // One audit entry per change, the correction going from the earlier changed price; nothing restored in between.
    const read: { view?: ReturnType<CheckoutBackend["useOrder"]> } = {};
    function Read() {
      read.view = backend.useOrder(orderId);
      return null;
    }
    await act(async () => root.render(createElement(Read)));
    const changes = read.view?.audit.filter((entry) => entry.kind === "price_override").reverse();
    expect(changes?.map(({ fromPrice, toPrice, note }) => ({ fromPrice, toPrice, note }))).toEqual([
      { fromPrice: 100000, toPrice: 80000, note: "Loyal guets" },
      { fromPrice: 80000, toPrice: 75000, note: "Loyal guest" },
    ]);
  });

  it("saves a discount on blur without sending a duplicate while that save is in flight", async () => {
    const backend = await createFixtureBackend();
    await show(backend, await orderWithGift(backend));
    const gate = gateResponse(backend.useActions().updateLine);
    const update = vi.spyOn(backend.useActions(), "updateLine").mockImplementation(gate.write);
    await click(row("Gift basket").querySelector("button"));
    const discount = panel().querySelector<HTMLInputElement>('input[aria-label="Discount"]')!;
    await act(async () => {
      discount.focus();
      type(discount, "10%");
    });
    await act(async () => {
      discount.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      discount.blur();
    });
    expect(panel().textContent).toContain("Saving…");
    gate.release();
    await settle();
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toMatchObject({ discount: { type: "percent", value: 1000 } });
    expect(panel().querySelector('[data-testid="order-due"]')?.textContent).toBe("฿900");
  });

  it("doesn't offer to apply a price or discount that is only a decimal point", async () => {
    const backend = await createFixtureBackend();
    await show(backend, await orderWithGift(backend));
    await click(row("Gift basket").querySelector("button"));

    const discount = panel().querySelector<HTMLInputElement>('input[aria-label="Discount"]')!;
    type(discount, ".");
    expect(discount.value).toBe(".");
    // Not a discount yet: no Apply, and the field says what it takes.
    expect([...panel().querySelectorAll("button")].some((el) => el.textContent?.startsWith("Apply"))).toBe(false);
    expect(panel().querySelector('[data-testid="discount-echo"]')?.textContent).toBe("Type 10% or ฿120");
    type(discount, "10");
    expect([...panel().querySelectorAll("button")].find((el) => el.textContent?.startsWith("Apply ฿10"))?.disabled).toBe(false);

    await click(inPanel("Price ฿1,000"));
    type(priceInput(), ".");
    type(reasonInput(), "Typo check");
    expect(inPanel("Apply price")?.disabled).toBe(true);
    type(priceInput(), "0");
    expect(inPanel("Apply price")?.disabled).toBe(false);
  });
});

describe("write errors and order switches", () => {
  it("drops a failed write's banner when the cashier moves on to a new order", async () => {
    const base = await createFixtureBackend();
    const actions = { ...base.useActions(), addItem: () => Promise.reject(new Error("Network down")) };
    const backend: CheckoutBackend = { ...base, useActions: () => actions };
    await show(backend, await orderWithGift(base));

    await click([...document.querySelectorAll("button")].find((el) => el.textContent?.trim().startsWith("Foot spa 45")));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Network down");

    await click(document.querySelector('button[aria-label="New order"]'));
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(panel().querySelector('[data-testid="order-panel-title"]')?.textContent).toBe("New order");
  });
});
