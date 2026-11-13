// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { OrdersBrowser } from "@/components/checkout/OrderStrip";

/*
 * K6: items come before their history, the customer is named once beside the catalog, and every
 * existing line edit stays. K8: Discard (confirmed) and Restore… (reviewed) sit beside each row.
 */

let root: Root;
/** The order the checkout is showing, read the way the screen reads it. */
const read: { view?: OrderView | null } = {};
const saved = "fxbill000002" as OrderId;
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
const press = (el: Element | null | undefined) => act(async () => { expect(el).toBeTruthy(); (el as HTMLElement).click(); });
const within = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
const type = (el: HTMLInputElement | HTMLTextAreaElement | null, value: string) => act(async () => {
  expect(el).toBeTruthy();
  Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el!.dispatchEvent(new Event("input", { bubbles: true }));
});
const provide = (backend: CheckoutBackend, ...children: ReturnType<typeof createElement>[]) =>
  createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, ...children);

function Checkout({ backend, start }: { backend: CheckoutBackend; start: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  read.view = backend.useOrder(orderId);
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const showCheckout = (backend: CheckoutBackend, start: OrderId | null) => act(async () => root.render(provide(backend, createElement(Checkout, { backend, start }))));
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const row = (name: string) => [...panel().querySelectorAll("li")].find(li => li.querySelector("button")?.textContent?.startsWith(name));
const line = (name: string) => read.view!.lines.find(l => l.name === name);
/** Opens the order panel's ⋯ and picks an item. */
async function openMenuItem(label: string) {
  const more = panel().querySelector<HTMLButtonElement>('button[aria-label="More order actions"]')!;
  await act(async () => { more.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); more.click(); });
  await tick();
  await press([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === label));
}
const historyDetails = (scope: ParentNode) => [...scope.querySelectorAll("details")].find(d => d.querySelector("summary")?.textContent === "Order history");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("lists items before their history and names the customer once beside the catalog, but keeps it in the phone sheet", async () => {
  const backend = createFixtureBackend();
  await showCheckout(backend, saved);
  const customer = read.view!.customer!.name;
  const items = panel().querySelector("ul")!;
  expect(items.textContent).toContain("Foot spa 45");
  expect(items.compareDocumentPosition(historyDetails(panel())!) & Node.DOCUMENT_POSITION_FOLLOWING, "history follows the items").toBeTruthy();

  // Beside the catalog the strip's customer button names them; the panel heading does not repeat it.
  expect(document.querySelector(`button[aria-label="Customer: ${customer}. Change customer"]`)).toBeTruthy();
  const subtitle = () => panel().querySelector('[data-testid="order-panel-title"]')!.nextElementSibling!.textContent;
  expect(subtitle()).not.toContain(customer);

  // The phone sheet covers the strip, so its heading keeps the customer.
  await press(document.querySelector('[aria-label$="open the order"]'));
  const sheet = [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
  expect(sheet.querySelector('[data-testid="order-panel-title"]')!.nextElementSibling!.textContent).toContain(customer);
  const sheetItems = sheet.querySelector("ul")!;
  expect(sheetItems.compareDocumentPosition(historyDetails(sheet)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps every existing line edit, No booking, and Clear order behind its confirmation", async () => {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "service", serviceId: "fxsvc000001" as Id<"services"> } }));
  await run(actions.addItem({ orderId, item: { kind: "extra", name: "Tea", price: 100 } }));
  await showCheckout(backend, orderId);
  expect(document.body.textContent).toContain("No booking");
  const massage = read.view!.lines[0];
  const listPrice = massage.unitPrice;

  // Therapist: Any or a named person.
  await press(row(massage.name)!.querySelector("button"));
  const chips = () => [...row(massage.name)!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  const person = chips().find(c => !["Any", "Now"].includes(c.textContent!))!;
  const personName = person.textContent!;
  await press(person); await tick();
  expect(line(massage.name)!.staffId).toBeDefined();
  expect(row(massage.name)!.textContent).toContain(personName);
  await press(within(row(massage.name)!, "Any")); await tick();
  expect(line(massage.name)!.staffId).toBeUndefined();

  // Service date and time remain optional; clearing the time keeps the row unscheduled.
  expect(row(massage.name)!.querySelector('button[aria-label="Service date"]')).toBeTruthy();
  await type(row(massage.name)!.querySelector<HTMLInputElement>('input[aria-label="Service time"]'), "15:30"); await tick();
  expect(line(massage.name)!.schedule).toEqual({ time: "15:30" });
  await press(row(massage.name)!.querySelector('button[aria-label="Clear service time"]')); await tick();
  expect(line(massage.name)!.schedule).toEqual({});

  // Percent discount, typed as one value, then removal.
  await type(row(massage.name)!.querySelector<HTMLInputElement>('input[aria-label="Discount"]'), "10%");
  await press([...row(massage.name)!.querySelectorAll("button")].find(b => b.textContent?.startsWith("Apply 10% ("))); await tick();
  expect(line(massage.name)!.discount).toEqual({ type: "percent", value: 10 });
  expect(line(massage.name)!.net).toBe(Math.round(listPrice * 0.9 * 100) / 100);
  await press(within(row(massage.name)!, "Remove")); await tick();
  expect(line(massage.name)!.discount).toBeUndefined();

  // A zero custom price is still a custom price: editable and restorable.
  await press(within(row(massage.name)!, "Change price"));
  await type(row(massage.name)!.querySelector<HTMLInputElement>('input[id^="price-"]'), "0");
  await type(row(massage.name)!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reason for the price change"]'), "Complimentary");
  await press(within(row(massage.name)!, "Apply price")); await tick();
  expect(line(massage.name)!.priceOverride).toMatchObject({ price: 0, note: "Complimentary" });
  expect(line(massage.name)!.net).toBe(0);
  await press(within(row(massage.name)!, "Edit"));
  expect(row(massage.name)!.querySelector<HTMLInputElement>('input[id^="price-"]')!.value).toBe("0");
  await press(within(row(massage.name)!, "Cancel"));
  await press(within(row(massage.name)!, "Restore")); await tick();
  expect(line(massage.name)!.priceOverride).toBeUndefined();
  expect(line(massage.name)!.net).toBe(listPrice);

  // Quantity steps and item removal.
  await press(row("Tea")!.querySelector('button[aria-label="One more"]')); await tick();
  expect(line("Tea")!.qty).toBe(2);
  await press(row("Tea")!.querySelector('button[aria-label="One less"]')); await tick();
  expect(line("Tea")!.qty).toBe(1);
  await press(row("Tea")!.querySelector("button"));
  await press(within(row("Tea")!, "Remove item")); await tick();
  expect(line("Tea")).toBeUndefined();

  // Clear order, in the order's ⋯, asks first; Cancel keeps the items.
  await openMenuItem("Clear order");
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  expect(dialog()!.textContent).toContain("Clear this order?");
  await press(within(dialog()!, "Cancel"));
  expect(read.view!.lines).toHaveLength(1);
  await openMenuItem("Clear order");
  await press(within(dialog()!, "Clear order")); await tick();
  expect(read.view!.lines).toHaveLength(0);
  expect(panel().textContent).toContain("Tap an item to add it to the order.");

  // Removed items stay in the history, which still follows the (now empty) list.
  const history = historyDetails(panel())!;
  await act(async () => { history.open = true; history.dispatchEvent(new Event("toggle")); });
  expect(history.textContent).toContain("Item removed");
  expect(history.textContent).toContain("Order cleared");
  expect(history.textContent).toContain("Tea");
});

it("lists unpaid orders without a Discard button and offers Restore… beside each discarded row, reviewed first", async () => {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const restore = vi.spyOn(actions, "restoreOrder");
  await act(async () => root.render(provide(backend, createElement(OrdersBrowser, { currentId: saved, onOpen: vi.fn() }))));
  const selected = () => document.querySelector<HTMLButtonElement>('[aria-current="true"]')!;
  const title = selected().textContent!.split(" · ")[0];
  const action = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label} ${title}"]`);
  // Discard lives in the open order's ⋯ now.
  expect(action("Discard")).toBeNull();
  expect(selected().closest("li")!.querySelectorAll("button")).toHaveLength(1);

  await run(actions.discardOrder({ orderId: saved, expectedRevision: 2, idempotencyKey: "hierarchy-discard" }));
  await press([...document.querySelectorAll("button")].find(b => b.textContent === "Discarded"));
  expect(action("Restore")!.parentElement).toBe(selected().closest("li"));
  expect(selected().contains(action("Restore"))).toBe(false);
  expect(action("Restore")!.textContent).toBe("Restore…");
  expect(action("Restore")!.className).toContain("min-h-11");

  // Restore… opens the review; leaving it restores nothing.
  await press(action("Restore"));
  expect(document.body.textContent).toContain("Its charges were released while discarded");
  await press(within(document, "Back to orders"));
  expect(restore).not.toHaveBeenCalled();

  await press(action("Restore"));
  await press(within(document, "Restore order")); await tick();
  expect(restore).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("restored. Review retained rows");
});
