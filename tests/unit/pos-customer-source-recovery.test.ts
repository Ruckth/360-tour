// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { parseCheckoutSource } from "@/components/checkout/checkout-source";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";

let root: Root;
const button = (name: string) => [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === name)!;
const click = (name: string) => act(async () => button(name).click());
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
const type = (selector: string, value: string) => act(async () => {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

function Page({ query }: { query: string }) {
  const [params, setParams] = useState(new URLSearchParams(query));
  const source = parseCheckoutSource(params);
  return createElement(CheckoutView, {
    orderId: source.kind === "order" ? source.id as OrderId : null,
    notice: source.kind === "invalid" ? source.reason : undefined,
    onOrderChange: (id) => setParams(new URLSearchParams(id ? { order: id } : {})),
    onPaid: () => {},
  });
}
async function show(backend: CheckoutBackend, query = "") {
  await act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { query }))));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps an invalid phone draft recoverable, then saves the corrected phone", async () => {
  const backend = createFixtureBackend();
  const create = vi.spyOn(backend.useActions(), "createCustomer");
  await show(backend);
  await click("Add customer");
  await click("New customer");
  await type("#customer-name", "Payer");
  await type("#customer-phone", "not-a-phone");
  await submit();
  await settle();
  expect(create).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/valid phone/i);
  expect(document.querySelector<HTMLInputElement>("#customer-phone")?.value).toBe("not-a-phone");
  expect(document.querySelector<HTMLInputElement>("#customer-name")?.value).toBe("Payer");
  await type("#customer-phone", "+44 7700 900123");
  await submit();
  await settle();
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ phone: "+44 7700 900123" }));
  expect(document.querySelector('[aria-label="Customer: Payer. Change customer"]')).not.toBeNull();
});

it("allows creating a customer with no phone", async () => {
  const backend = createFixtureBackend();
  const create = vi.spyOn(backend.useActions(), "createCustomer");
  await show(backend);
  await click("Add customer");
  await click("New customer");
  await type("#customer-name", "Payer without phone");
  await submit();
  await settle();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ phone: undefined }));
  expect(document.querySelector('[aria-label="Customer: Payer without phone. Change customer"]')).not.toBeNull();
});

it.each(["order=aaaaaaaa", "order=bbbbbbbb", "order=fxmissing000001", "booking=bad!"])("offers New order recovery for %s", async (query) => {
  await show(createFixtureBackend(), query);
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/(order|id)/i);
  expect(button("New order").disabled).toBe(false);
  await click("New order");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("New order");
  expect(button("New order").disabled).toBe(true);
});

it("opens an existing order through Orders after a missing link", async () => {
  await show(createFixtureBackend(), "order=aaaaaaaa");
  await click("Orders");
  const row = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Unpaid orders"] button')].find(el => el.textContent?.includes("Order #1042"))!;
  await act(async () => row.click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("Order #1042");
  expect(document.querySelector('aside[aria-label="Order"]')?.textContent).toContain("Foot spa");
});

it("keeps a valid existing link usable", async () => {
  const backend = createFixtureBackend();
  const pending = backend.useActions().addItem({ item: { kind: "extra", name: "Valid linked item", price: 100 } });
  await settle();
  const { orderId } = await pending;
  await show(backend, `order=${orderId}`);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('aside[aria-label="Order"]')?.textContent).toContain("Valid linked item");
});
