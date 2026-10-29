// @vitest-environment happy-dom
// Failed customer and booking lookups and writes stay recoverable inside their dialog.
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";

let root: Root;
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const input = (selector: string) => document.querySelector<HTMLInputElement>(selector)!;
const title = () => document.querySelector('[data-testid="order-title"]')?.textContent;
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(" | ");
const customerButton = () => document.querySelector<HTMLButtonElement>('[aria-label^="Customer:"]');
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const click = (text: string) => act(async () => button(text)!.click());
const submit = () => act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const typeInto = (selector: string, value: string) => act(async () => type(input(selector), value));

async function render(backend: CheckoutBackend, orderId: OrderId) {
  await act(async () =>
    root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} }))),
  );
}
async function setup() {
  const backend = createFixtureBackend();
  const adding = backend.useActions().addItem({ item: { kind: "extra", name: "Recovery item", price: 100 } });
  await vi.advanceTimersByTimeAsync(200);
  return { backend, actions: backend.useActions(), orderId: (await adding).orderId };
}
async function openNewCustomerForm(name: string, phone = "") {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Add customer"]')!.click());
  await click("New customer");
  await typeInto("#customer-name", name);
  if (phone) await typeInto("#customer-phone", phone);
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
  vi.restoreAllMocks();
});

describe("new customer writes", () => {
  it("keeps the form when the profile saves but linking fails, and a retry links it without saving it twice", async () => {
    const { backend, actions, orderId } = await setup();
    const create = vi.spyOn(actions, "createCustomer");
    const link = vi.spyOn(actions, "linkCustomer").mockRejectedValueOnce(new Error("Link failed"));
    await render(backend, orderId);
    await openNewCustomerForm("Retry payer", "0812345678");
    await submit();
    await settle();

    expect(alertText()).toContain("Retry payer is saved as a customer but isn't linked to this order yet: Link failed");
    expect(input("#customer-name").value).toBe("Retry payer");
    expect(input("#customer-phone").value).toBe("0812345678");
    // Locked to what was saved, so the retry links that same profile.
    expect(input("#customer-name").readOnly).toBe(true);
    expect(customerButton()).toBeNull();
    // The new profile isn't offered back as a possible duplicate.
    expect(document.body.textContent).not.toContain("Already a customer with this contact?");

    await click("Link customer");
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledTimes(2);
    expect(link.mock.calls[1][0]).toEqual({ orderId, customerId: await create.mock.results[0].value });
    expect(customerButton()?.textContent).toBe("Retry payer");
    expect(document.querySelector("#customer-name")).toBeNull();
    expect(title()).toBe("Order #1043");
  });

  it("offers the saved profile after Back instead of saving it again", async () => {
    const { backend, actions, orderId } = await setup();
    const create = vi.spyOn(actions, "createCustomer");
    vi.spyOn(actions, "linkCustomer").mockRejectedValueOnce(new Error("Link failed"));
    await render(backend, orderId);
    await openNewCustomerForm("Back payer");
    await submit();
    await settle();
    await click("Back");
    expect(document.body.textContent).toContain("Back payer is saved as a customer but isn't linked to this order yet.");
    await click("Link");
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(customerButton()?.textContent).toBe("Back payer");
  });

  it("sends one create for a double submit", async () => {
    const { backend, actions, orderId } = await setup();
    const create = vi.spyOn(actions, "createCustomer");
    await render(backend, orderId);
    await openNewCustomerForm("Double tap");
    await submit();
    await submit();
    await settle();
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(customerButton()?.textContent).toBe("Double tap");
  });

  it("keeps the picker open with the error when linking an existing customer fails", async () => {
    const { backend, actions, orderId } = await setup();
    vi.spyOn(actions, "linkCustomer").mockRejectedValueOnce(new Error("Link failed"));
    await render(backend, orderId);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Add customer"]')!.click());
    await typeInto('[aria-label="Search customers"]', "Somchai");
    const pick = () => act(async () => [...document.querySelectorAll('[aria-label="Customers"] button')][0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await pick();
    await settle();
    expect(alertText()).toContain("Link failed");
    expect(input('[aria-label="Search customers"]').value).toBe("Somchai");
    await pick();
    await settle();
    expect(customerButton()?.textContent).toBe("Somchai Prasert");
  });
});

describe("lookup failures stay in their dialog", () => {
  it("retries a failed customer search in place", async () => {
    const { backend, orderId } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const flaky: CheckoutBackend = { ...backend, useCustomerSearch: (query) => { if (down && query.trim().length >= 2) throw new Error("Search unavailable"); return backend.useCustomerSearch(query); } };
    await render(flaky, orderId);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Add customer"]')!.click());
    await typeInto('[aria-label="Search customers"]', "Somchai");
    expect(alertText()).toContain("Couldn't search customers");
    expect(input('[aria-label="Search customers"]').value).toBe("Somchai");
    down = false;
    await click("Try again");
    expect(button("Try again")).toBeUndefined();
    expect(document.querySelector('[aria-label="Customers"]')?.textContent).toContain("Somchai Prasert");
    expect(title()).toBe("Order #1043");
  });

  it("still adds a new customer when the existing-contact check fails", async () => {
    const { backend, actions, orderId } = await setup();
    const create = vi.spyOn(actions, "createCustomer");
    const link = vi.spyOn(actions, "linkCustomer");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flaky: CheckoutBackend = { ...backend, useCustomerSearch: (query) => { if (/\d{4}/.test(query)) throw new Error("Search unavailable"); return backend.useCustomerSearch(query); } };
    await render(flaky, orderId);
    await openNewCustomerForm("Check down", "0899998888");
    expect(alertText()).toContain("Couldn't check for an existing customer");
    expect(button("Try again")).toBeTruthy();
    expect(input("#customer-phone").value).toBe("0899998888");
    await submit();
    await settle();
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledTimes(1);
    expect(customerButton()?.textContent).toBe("Check down");
  });

  it("retries failed booking suggestions in place when the dialog opens", async () => {
    const { backend, orderId } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const flaky: CheckoutBackend = { ...backend, useAttachable: (args) => { if (down) throw new Error("Suggestions unavailable"); return backend.useAttachable(args); } };
    await render(flaky, orderId);
    await click("Add booking");
    expect(alertText()).toContain("Couldn't load bookings");
    expect(input('[aria-label="Search bookings"]')).toBeTruthy();
    expect(title()).toBe("Order #1043");
    down = false;
    await typeInto('[aria-label="Search bookings"]', "Somchai");
    // A new search tries again by itself.
    expect(button("Try again")).toBeUndefined();
    expect(document.body.textContent).toContain("Thai massage 90");
  });

  it("says when phone and email search doesn't reach older appointments yet", async () => {
    const { backend, orderId } = await setup();
    await render({ ...backend, useAttachLookupStatus: () => ({ complete: false }) }, orderId);
    await click("Add booking");
    expect(document.body.textContent).toContain("Some older appointments can't be found by phone or email yet.");
  });

  it("finds an appointment by its guest's email in the fixture too", async () => {
    const { backend, orderId } = await setup();
    await render(backend, orderId);
    await click("Add booking");
    await typeInto('[aria-label="Search bookings"]', "ANNA@example.com");
    expect(document.body.textContent).toContain("Hot stone 60");
  });
});
