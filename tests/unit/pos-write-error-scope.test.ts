// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrderId } from "@/components/checkout/backend";
import { useOrderWrites } from "@/components/checkout/useOrderWrites";

const A = "order-a" as OrderId;
const B = "order-b" as OrderId;
let root: Root;
let writes: ReturnType<typeof useOrderWrites>;
let visible: OrderId | null;
let banner: string;
let setBanner: (message: string) => void;

function Harness({ initial }: { initial: OrderId | null }) {
  const [id, setId] = useState(initial);
  const [error, setError] = useState("");
  const current = useOrderWrites(id, setId, setError);
  useEffect(() => {
    writes = current;
    visible = id;
    banner = error;
    setBanner = setError;
  }, [current, id, error]);
  return createElement("p", { role: "alert" }, error);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const show = (initial: OrderId | null) => act(async () => root.render(createElement(Harness, { initial })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each([A, null])("keeps a late failed write from sale %s off the current order", async (initial) => {
  await show(initial);
  const pending = deferred<{ orderId: OrderId }>();
  let running!: Promise<boolean>;
  await act(async () => { running = writes.run(() => pending.promise); });
  await act(async () => writes.switchTo(B));
  await act(async () => { pending.reject(new Error("Earlier sale failed")); await running; });
  expect(visible).toBe(B);
  expect(banner).toBe("");
  await expect(running).resolves.toBe(false);
});

it("does not let an old queued write clear the current order's error, but still writes its original sale", async () => {
  await show(null);
  const first = deferred<{ orderId: OrderId }>();
  const queued = vi.fn(async (id: OrderId | undefined) => ({ orderId: id! }));
  let one!: Promise<boolean>;
  let two!: Promise<boolean>;
  await act(async () => {
    one = writes.run(() => first.promise);
    two = writes.run(queued);
  });
  await act(async () => { writes.switchTo(B); setBanner("Current order needs attention"); });
  await act(async () => { first.resolve({ orderId: A }); await Promise.all([one, two]); });
  expect(queued).toHaveBeenCalledWith(A);
  expect(visible).toBe(B);
  expect(banner).toBe("Current order needs attention");
});

it("keeps a queued retry on the original new sale after creation fails and another order opens", async () => {
  await show(null);
  const first = deferred<{ orderId: OrderId }>();
  const retry = vi.fn(async (id: OrderId | undefined) => { expect(id).toBeUndefined(); return { orderId: A }; });
  const next = vi.fn(async (id: OrderId | undefined) => ({ orderId: id! }));
  let one!: Promise<boolean>;
  let two!: Promise<boolean>;
  let three!: Promise<boolean>;
  await act(async () => {
    one = writes.run(() => first.promise);
    two = writes.run(retry);
    three = writes.run(next);
  });
  await act(async () => { writes.switchTo(B); setBanner("B error"); });
  await act(async () => { first.reject(new Error("Creation failed")); await Promise.all([one, two, three]); });
  expect(retry).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(A);
  expect(visible).toBe(B);
  expect(banner).toBe("B error");
});

it("still reports and clears errors for writes on the visible sale", async () => {
  await show(A);
  await act(async () => { await writes.run(async () => { throw new Error("Try this order again"); }); });
  expect(banner).toBe("Try this order again");
  await act(async () => { await writes.run(async () => null); });
  expect(banner).toBe("");
});
