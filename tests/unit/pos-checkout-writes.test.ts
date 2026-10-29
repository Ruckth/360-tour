// @vitest-environment happy-dom
import { act, createElement, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type BillId, type CheckoutBackend } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { useBillWrites } from "@/components/checkout/useBillWrites";

const A = "bill-a" as BillId;
let root: Root;
let writes: ReturnType<typeof useBillWrites>;
const changes: Array<BillId | null> = [];

function Harness({ billId }: { billId: BillId | null }) {
  const current = useBillWrites(billId, (next) => changes.push(next), () => {});
  useEffect(() => {
    writes = current;
  });
  return null;
}
const render = (billId: BillId | null) => act(async () => root.render(createElement(Harness, { billId })));
const showBill = (backend: CheckoutBackend, billId: BillId) =>
  act(async () =>
    root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { billId, onBillChange: () => {}, onPaid: () => {} }))),
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

describe("checkout bill writes", () => {
  it("explains and disables attachment while the guest is paying online", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const added = backend.useActions().setCustomer({ guest: { name: "Mia Tanaka", phone: "+81 90 1234 5678" } });
    await vi.advanceTimersByTimeAsync(200);
    const { billId } = await added;
    await showBill(backend, billId);
    const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text)!;
    await act(async () => button("Attach booking").click());
    expect(document.body.textContent).toContain("Online checkout is in progress");
    expect(button("Attach").disabled).toBe(true);
  });

  it.each([
    ["card", true],
    ["card", false],
    ["cash", true],
    ["split", true],
  ] as const)("requires a fresh review when an open %s payment changes (total changes: %s)", async (mode, totalChanges) => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const added = actions.addItem({ item: { kind: "extra", name: "Gift", price: 1000 } });
    await vi.advanceTimersByTimeAsync(200);
    const { billId } = await added;
    const settle = vi.spyOn(actions, "settleBill");
    const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text)!;
    await showBill(backend, billId);
    await act(async () => button(mode === "card" ? "Card" : mode === "cash" ? "Cash" : "Split payment").click());
    if (mode === "cash") await act(async () => button("Exact").click());

    // Another cashier changes the bill while this cashier is taking payment.
    const change = totalChanges
      ? actions.addItem({ billId, item: { kind: "extra", name: "Water", price: 50 } })
      : actions.setCustomer({ billId, guest: { name: "Updated guest" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); await change; });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The bill changed while payment was open");
    expect([...document.querySelectorAll("button")].some((el) => el.textContent?.startsWith("Confirm"))).toBe(false);
    expect(document.querySelector("#cash-received")).toBeNull();
    expect(settle).not.toHaveBeenCalled();

    // Explicitly reviewing the updated bill starts a new, valid payment attempt.
    await act(async () => button("Review updated bill").click());
    await act(async () => button("Card").click());
    await act(async () => button(`Confirm ฿${totalChanges ? "1,050" : "1,000"} received`).click());
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ expectedDue: totalChanges ? 1050 : 1000, expectedRevision: 2 }));
  });

  it("joins taps made before the bill exists into the bill the first one creates", async () => {
    await render(null);
    const first = deferred<{ billId: BillId }>();
    const seen: Array<BillId | undefined> = [];
    const one = writes.run((id) => (seen.push(id), first.promise));
    const two = writes.run(async (id) => (seen.push(id), { billId: id! }));
    first.resolve({ billId: A });
    await act(async () => { await Promise.all([one, two]); });
    expect(seen).toEqual([undefined, A]);
    expect(changes).toEqual([A]);
  });

  it("doesn't jump back to the old bill when its write finishes after New bill (C4-08)", async () => {
    await render(A);
    const pending = deferred<{ billId: BillId }>();
    const add = writes.run(() => pending.promise);
    await act(async () => writes.switchTo(null));
    await render(null);
    const seen: Array<BillId | undefined> = [];
    const next = writes.run(async (id) => { seen.push(id); return null; });
    pending.resolve({ billId: A });
    await act(async () => { await Promise.all([add, next]); });
    expect(changes).toEqual([null]);
    expect(seen).toEqual([undefined]);
  });

  it("stays on a held bill opened while the first item was still creating a new one", async () => {
    const B = "bill-b" as BillId;
    await render(null);
    const creating = deferred<{ billId: BillId }>();
    const add = writes.run(() => creating.promise);
    await act(async () => writes.switchTo(B));
    await render(B);
    const seen: Array<BillId | undefined> = [];
    const next = writes.run(async (id) => { seen.push(id); return null; });
    creating.resolve({ billId: A });
    await act(async () => { await Promise.all([add, next]); });
    expect(changes).toEqual([B]);
    expect(seen).toEqual([B]);
  });

  it("doesn't leave the bill opened while Hold was still saving (C4-08)", async () => {
    const B = "bill-b" as BillId;
    await render(A);
    const holding = deferred<null>();
    const left: string[] = [];
    const hold = writes.run(() => holding.promise, () => left.push("A"));
    await act(async () => writes.switchTo(B));
    await render(B);
    holding.resolve(null);
    await act(async () => { await hold; });
    expect(left).toEqual([]);
    expect(changes).toEqual([B]);
    // Holding the bill that is still on screen does leave it.
    await act(async () => { await writes.run(async () => null, () => left.push("B")); });
    expect(left).toEqual(["B"]);
  });

  it("starts a fresh payment when another bill with the same total is opened (C5-01)", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const create = async (name: string) => {
      const added = actions.addItem({ item: { kind: "extra", name, price: 100 } });
      await vi.advanceTimersByTimeAsync(200);
      return (await added).billId;
    };
    const [a, b] = [await create("Water"), await create("Tea")];
    const show = (billId: BillId) => showBill(backend, billId);
    const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text)!;
    await show(a);
    await act(async () => button("Cash").click());
    await act(async () => button("Exact").click());
    expect(document.querySelector<HTMLInputElement>("#cash-received")?.value).toBe("100");
    await show(b);
    expect(document.querySelector("#cash-received")).toBeNull();
    expect(document.body.textContent).toContain("Tea");
  });

  it("keeps the cash shortcuts within what the till takes (R6-01)", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend();
    const actions = backend.useActions();
    const added = actions.addItem({ item: { kind: "extra", name: "Wedding", price: 1_000_000 } });
    await vi.advanceTimersByTimeAsync(200);
    const { billId, lineId } = await added;
    const step = actions.updateLine({ lineId, qtyChange: 9 });
    await vi.advanceTimersByTimeAsync(200);
    await step;
    await showBill(backend, billId);
    const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text)!;
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
    const added = actions.addItem({ item: { kind: "extra", name: "Tea", price: 10.1 } });
    await vi.advanceTimersByTimeAsync(200);
    const { billId, lineId } = await added;
    const step = actions.updateLine({ lineId, qtyChange: 2 });
    await vi.advanceTimersByTimeAsync(200);
    await step;
    await showBill(backend, billId);
    expect(document.body.textContent).toContain("฿30.30");
    expect(document.querySelector(".line-through")).toBeNull();
  });

  it("adds up quick quantity taps (C4-07)", async () => {
    vi.useFakeTimers();
    const actions = createFixtureBackend().useActions();
    const added = actions.addItem({ item: { kind: "extra", name: "Coconut water", price: 90 } });
    await vi.runAllTimersAsync();
    const { billId, lineId } = await added;
    const taps = Promise.all([actions.updateLine({ lineId, qtyChange: 1 }), actions.updateLine({ lineId, qtyChange: 1 })]);
    await vi.runAllTimersAsync();
    await taps;
    // 3 × ฿90 is due, and the bill is on its third revision (add, then two steps).
    const settle = actions.settleBill({ billId, idempotencyKey: "attempt-0001", expectedDue: 270, expectedRevision: 3, tenders: [{ method: "card", amount: 270 }] });
    await vi.runAllTimersAsync();
    await expect(settle).resolves.toMatchObject({ replayed: false });
  });
});
