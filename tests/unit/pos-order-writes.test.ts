// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type CustomerId, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { useOrderWrites } from "@/components/checkout/useOrderWrites";

const A = "order-a" as OrderId;
let root: Root;
let writes: ReturnType<typeof useOrderWrites>;
const changes: Array<OrderId | null> = [];

function Harness({ orderId }: { orderId: OrderId | null }) {
  const current = useOrderWrites(orderId, (next) => changes.push(next), () => {});
  useEffect(() => {
    writes = current;
  });
  return null;
}
const render = (orderId: OrderId | null) => act(async () => root.render(createElement(Harness, { orderId })));
const provide = (backend: CheckoutBackend, child: ReturnType<typeof createElement>) =>
  createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child);
const showOrder = (backend: CheckoutBackend, orderId: OrderId) =>
  act(async () => root.render(provide(backend, createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} }))));

/** The checkout page's URL state: the order on screen follows onOrderChange, like the router. */
const shown: { orderId: OrderId | null } = { orderId: null };
function Page() {
  const [orderId, setOrderId] = useState<OrderId | null>(null);
  shown.orderId = orderId;
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const showPage = (backend: CheckoutBackend) => act(async () => root.render(provide(backend, createElement(Page))));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const buttons = () => [...document.querySelectorAll("button")];
const button = (text: string) => buttons().find((el) => el.textContent?.trim() === text)!;
const buttonStarting = (text: string) => buttons().find((el) => el.textContent?.trim().startsWith(text))!;
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function create(backend: CheckoutBackend, name = "Gift", price = 1000) {
  const added = backend.useActions().addItem({ item: { kind: "extra", name, price } });
  await vi.advanceTimersByTimeAsync(200);
  return await added;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  changes.length = 0;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkout order screen", () => {
  it("names a new order, then its permanent number once it exists, with no walk-in label", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    await showPage(backend);
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("New order");
    expect(document.body.textContent).toContain("No booking");
    expect(byLabel("Add customer")).toBeTruthy();
    await act(async () => buttonStarting("Thai massage 60").click());
    await settle();
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("Order #1043");
    expect(document.body.textContent).not.toMatch(/walk-?in/i);
  });

  it("saves and closes an order, then reopens it from Orders with its items", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    await showPage(backend);
    await act(async () => buttonStarting("Foot spa 45").click());
    await settle();
    const saved = shown.orderId!;
    await act(async () => button("Save & close").click());
    await settle();
    expect(shown.orderId).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Order #1043 saved");
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("New order");

    await act(async () => button("Orders").click());
    const list = byLabel("Unpaid orders");
    expect(list.textContent).toContain("Order #1043");
    expect(list.textContent).toContain("Order #1042");
    expect(list.textContent).toContain("Somchai Prasert");
    // Order #1042: two coconut waters and a foot spa, nothing paid yet.
    expect(list.textContent).toContain("฿780");
    await act(async () => [...list.querySelectorAll("button")].find((el) => el.textContent?.includes("Order #1043"))!.click());
    expect(shown.orderId).toBe(saved);
    expect(document.querySelector('aside[aria-label="Order"]')?.textContent).toContain("Foot spa 45");

    await act(async () => button("Orders").click());
    await act(async () => button("Paid").click());
    expect(document.body.textContent).toContain("No paid orders yet.");
  });

  it("links a reusable customer separately from the booking's guest, and unlinks them", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    // Anna's stay already has Order #1041; opening it charges the stay.
    const opened = backend.useActions().openOrderFor({ bookingId: "fxbkg000001" as never });
    await vi.advanceTimersByTimeAsync(200);
    const { orderId } = await opened;
    await showOrder(backend, orderId);
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("Order #1041");
    expect(document.body.textContent).toContain("Guest: Anna Schmidt");

    await act(async () => byLabel("Add customer").click());
    await act(async () => type(byLabel("Search customers") as HTMLInputElement, "Somchai"));
    await act(async () => buttonStarting("Somchai Prasert").click());
    await settle();
    expect(byLabel("Customer: Somchai Prasert. Change customer")).toBeTruthy();
    expect(document.body.textContent).toContain("Guest: Anna Schmidt");

    await act(async () => byLabel("Customer: Somchai Prasert. Change customer").click());
    await act(async () => button("Remove").click());
    await settle();
    expect(byLabel("Add customer")).toBeTruthy();
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe("Order #1041");
  });

  it("lists namesakes separately and offers an existing customer before adding a duplicate", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const { orderId } = await create(backend);
    await showOrder(backend, orderId);
    await act(async () => byLabel("Add customer").click());
    await act(async () => type(byLabel("Search customers") as HTMLInputElement, "Anna Schmidt"));
    const results = byLabel("Customers");
    expect([...results.querySelectorAll("button")].filter((el) => el.textContent?.includes("Anna Schmidt"))).toHaveLength(2);

    await act(async () => button("New customer").click());
    await act(async () => type(document.querySelector<HTMLInputElement>("#customer-phone")!, "+66 81 555 0101"));
    expect(document.body.textContent).toContain("Already a customer with this contact?");
    await act(async () => type(document.querySelector<HTMLInputElement>("#customer-phone")!, "0899999999"));
    expect(document.body.textContent).not.toContain("Already a customer with this contact?");
    await act(async () => button("Add and link").click());
    // Two writes: create the profile, then link it.
    await settle();
    await settle();
    expect(byLabel("Customer: Anna Schmidt. Change customer")).toBeTruthy();
  });

  it("shows a stay added to a standalone order even though the stay has its own order, through payment and later extras", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const header = () => document.querySelector('[data-testid="order-title"]')!.parentElement!.textContent!;
    await showPage(backend);
    const tile = () => [...byLabel("Catalog").querySelectorAll("button")].find((el) => el.textContent?.includes("Thai massage 60"))!;
    for (let i = 0; i < 12; i++) {
      await act(async () => tile().click());
      await settle();
    }
    const sale = shown.orderId!;
    expect(tile().textContent).toContain("12 on the order");
    expect(header()).toContain("Order #1043");
    expect(header()).toContain("No booking");

    // A separate payer, then Add booking → Anna → her stay (it already has Order #1041, empty).
    await act(async () => byLabel("Add customer").click());
    await act(async () => button("New customer").click());
    await act(async () => type(document.querySelector<HTMLInputElement>("#customer-name")!, "Payer Pat"));
    await act(async () => button("Add and link").click());
    await settle();
    await settle();
    await act(async () => button("Add booking").click());
    await act(async () => type(byLabel("Search bookings") as HTMLInputElement, "Anna"));
    const stayRow = [...document.querySelectorAll("li")].find((li) => li.textContent?.includes("Stay · Lagoon Pool Villa"))!;
    await act(async () => [...stayRow.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Add")!.click());
    await settle();
    expect(stayRow.textContent).toContain("On this order");
    await act(async () => button("Done").click());

    expect(shown.orderId).toBe(sale);
    expect(header()).toContain("Order #1043");
    expect(header()).toContain("Stay · Lagoon Pool Villa · CONF-2026-A1B2C3 · Guest: Anna Schmidt");
    expect(header()).not.toContain("No booking");
    expect(byLabel("Customer: Payer Pat. Change customer")).toBeTruthy();

    await act(async () => button("Orders").click());
    const row = () => [...byLabel("Unpaid orders").querySelectorAll("button")].find((el) => el.textContent?.includes("Order #1043"))!;
    expect(row().textContent).toContain("Payer Pat · CONF-2026-A1B2C3");
    // Anna's own order is still empty, so it isn't listed.
    expect(byLabel("Unpaid orders").textContent).not.toContain("Order #1041");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    // Save & close, reopen from Orders: same order, same booking.
    await act(async () => button("Save & close").click());
    await settle();
    expect(shown.orderId).toBeNull();
    await act(async () => button("Orders").click());
    await act(async () => row().click());
    expect(shown.orderId).toBe(sale);
    expect(header()).toContain("Stay · Lagoon Pool Villa · CONF-2026-A1B2C3");
    // Opening Anna's stay finds the order charging it.
    const reopened = actions.openOrderFor({ bookingId: "fxbkg000001" as never });
    await settle();
    expect(await reopened).toEqual({ orderId: sale });

    // 12 × 1,200 plus the stay's 26,000 still owed.
    await act(async () => button("Card").click());
    await act(async () => button("Confirm ฿40,400 received").click());
    await settle();

    // Extras after payment go on the stay's own Order #1041, which shows the stay.
    const later = actions.openOrderFor({ bookingId: "fxbkg000001" as never });
    await settle();
    const { orderId: own } = await later;
    expect(own).not.toBe(sale);
    const extra = actions.addItem({ orderId: own, item: { kind: "extra", name: "Late checkout", price: 1500 } });
    await settle();
    await extra;
    await showOrder(backend, own);
    expect(header()).toContain("Order #1041");
    expect(header()).toContain("Stay · Lagoon Pool Villa · CONF-2026-A1B2C3");
    await act(async () => button("Orders").click());
    await act(async () => button("Paid").click());
    const paid = [...byLabel("Paid orders").querySelectorAll("button")].find((el) => el.textContent?.includes("Order #1043"))!;
    expect(paid.textContent).toContain("Payer Pat · CONF-2026-A1B2C3");
    // Paid orders list their total (the deposit included) and receipt number.
    expect(paid.textContent).toContain("R-000142");
    expect(paid.textContent).toContain("฿50,400");
  });

  it("explains and disables adding a stay while the guest is paying online", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const { orderId } = await create(backend);
    await showOrder(backend, orderId);
    await act(async () => button("Add booking").click());
    await act(async () => type(byLabel("Search bookings") as HTMLInputElement, "Mia"));
    expect(document.body.textContent).toContain("Online checkout is in progress");
    expect(button("Add").disabled).toBe(true);
  });

  it.each([
    ["card", "total"],
    ["card", "customer"],
    ["cash", "total"],
    ["split", "total"],
  ] as const)("requires a fresh review when an open %s payment changes (%s)", async (mode, change) => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const { orderId } = await create(backend);
    const settleOrder = vi.spyOn(actions, "settleOrder");
    await showOrder(backend, orderId);
    await act(async () => button(mode === "card" ? "Card" : mode === "cash" ? "Cash" : "Split payment").click());
    if (mode === "cash") await act(async () => button("Exact").click());

    // Another cashier changes the order while this cashier is taking payment.
    const edit = change === "total"
      ? actions.addItem({ orderId, item: { kind: "extra", name: "Water", price: 50 } })
      : actions.linkCustomer({ orderId, customerId: "fxcust000002" as CustomerId });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); await edit; });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The order changed while payment was open");
    expect(buttons().some((el) => el.textContent?.startsWith("Confirm"))).toBe(false);
    expect(document.querySelector("#cash-received")).toBeNull();
    expect(settleOrder).not.toHaveBeenCalled();

    // Explicitly reviewing the updated order starts a new, valid payment attempt.
    await act(async () => button("Review updated order").click());
    await act(async () => button("Card").click());
    await act(async () => button(`Confirm ฿${change === "total" ? "1,050" : "1,000"} received`).click());
    await settle();
    expect(settleOrder).toHaveBeenCalledOnce();
    expect(settleOrder).toHaveBeenCalledWith(expect.objectContaining({ expectedDue: change === "total" ? 1050 : 1000, expectedRevision: 2 }));
  });

  it("doesn't re-arm an open payment when the order is only saved elsewhere", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const { orderId } = await create(backend);
    const settleOrder = vi.spyOn(actions, "settleOrder");
    await showOrder(backend, orderId);
    await act(async () => button("Card").click());
    const save = actions.saveOrder({ orderId });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); await save; });
    // Saving changed nothing on the order, so the payment the cashier reviewed is still valid.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("Confirm ฿1,000 received").click());
    await settle();
    expect(settleOrder).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, expectedDue: 1000 }));
    await expect(settleOrder.mock.results[0].value).resolves.toMatchObject({ replayed: false });
  });

  it("starts a fresh payment when another order with the same total is opened (C5-01)", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const a = (await create(backend, "Water", 100)).orderId;
    const b = (await create(backend, "Tea", 100)).orderId;
    await showOrder(backend, a);
    await act(async () => button("Cash").click());
    await act(async () => button("Exact").click());
    expect(document.querySelector<HTMLInputElement>("#cash-received")?.value).toBe("100");
    await showOrder(backend, b);
    expect(document.querySelector("#cash-received")).toBeNull();
    expect(document.body.textContent).toContain("Tea");
  });

  it("keeps the cash shortcuts within what the till takes (R6-01)", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const { orderId, lineId } = await create(backend, "Wedding", 1_000_000);
    const step = actions.updateLine({ lineId, qtyChange: 9 });
    await vi.advanceTimersByTimeAsync(200);
    await step;
    await showOrder(backend, orderId);
    await act(async () => button("Cash").click());
    await act(async () => button("Exact").click());
    await act(async () => button("+฿100").click());
    expect(document.querySelector<HTMLInputElement>("#cash-received")?.value).toBe("10000000");
    expect(button("Confirm cash").disabled).toBe(false);
  });

  it("shows no struck-out list price on an undiscounted row with satang (K6-02)", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const { orderId, lineId } = await create(backend, "Tea", 10.1);
    const step = actions.updateLine({ lineId, qtyChange: 2 });
    await vi.advanceTimersByTimeAsync(200);
    await step;
    await showOrder(backend, orderId);
    expect(document.body.textContent).toContain("฿30.30");
    expect(document.querySelector(".line-through")).toBeNull();
  });

  it("adds up quick quantity taps (C4-07)", async () => {
    vi.useFakeTimers();
    const actions = createFixtureBackend().useActions();
    const added = actions.addItem({ item: { kind: "extra", name: "Coconut water", price: 90 } });
    await vi.runAllTimersAsync();
    const { orderId, lineId } = await added;
    const taps = Promise.all([actions.updateLine({ lineId, qtyChange: 1 }), actions.updateLine({ lineId, qtyChange: 1 })]);
    await vi.runAllTimersAsync();
    await taps;
    // 3 × ฿90 is due, and the order is on its third revision (add, then two steps).
    const paid = actions.settleOrder({ orderId, idempotencyKey: "attempt-0001", expectedDue: 270, expectedRevision: 3, tenders: [{ method: "card", amount: 270 }] });
    await vi.runAllTimersAsync();
    await expect(paid).resolves.toMatchObject({ replayed: false });
  });
});

describe("checkout order writes", () => {
  it("joins taps made before the order exists into the order the first one creates", async () => {
    await render(null);
    const first = deferred<{ orderId: OrderId }>();
    const seen: Array<OrderId | undefined> = [];
    const one = writes.run((id) => (seen.push(id), first.promise));
    const two = writes.run(async (id) => (seen.push(id), { orderId: id! }));
    first.resolve({ orderId: A });
    await act(async () => { await Promise.all([one, two]); });
    expect(seen).toEqual([undefined, A]);
    expect(changes).toEqual([A]);
  });

  it("doesn't jump back to the old order when its write finishes after New order (C4-08)", async () => {
    await render(A);
    const pending = deferred<{ orderId: OrderId }>();
    const add = writes.run(() => pending.promise);
    await act(async () => writes.switchTo(null));
    await render(null);
    const seen: Array<OrderId | undefined> = [];
    const next = writes.run(async (id) => { seen.push(id); return null; });
    pending.resolve({ orderId: A });
    await act(async () => { await Promise.all([add, next]); });
    expect(changes).toEqual([null]);
    expect(seen).toEqual([undefined]);
  });

  it("stays on a saved order opened while the first item was still creating a new one", async () => {
    const B = "order-b" as OrderId;
    await render(null);
    const creating = deferred<{ orderId: OrderId }>();
    const add = writes.run(() => creating.promise);
    await act(async () => writes.switchTo(B));
    await render(B);
    const seen: Array<OrderId | undefined> = [];
    const next = writes.run(async (id) => { seen.push(id); return null; });
    creating.resolve({ orderId: A });
    await act(async () => { await Promise.all([add, next]); });
    expect(changes).toEqual([B]);
    expect(seen).toEqual([B]);
  });

  it("doesn't leave the order opened while Save & close was still saving (C4-08)", async () => {
    const B = "order-b" as OrderId;
    await render(A);
    const saving = deferred<null>();
    const left: string[] = [];
    const save = writes.run(() => saving.promise, () => left.push("A"));
    await act(async () => writes.switchTo(B));
    await render(B);
    saving.resolve(null);
    await act(async () => { await save; });
    expect(left).toEqual([]);
    expect(changes).toEqual([B]);
    // Saving the order that is still on screen does leave it.
    await act(async () => { await writes.run(async () => null, () => left.push("B")); });
    expect(left).toEqual(["B"]);
  });
});
