// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillId } from "@/components/checkout/backend";
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
