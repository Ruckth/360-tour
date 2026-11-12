// @vitest-environment happy-dom
import { convexTest } from "convex-test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "convex/_generated/api";
import schema from "convex/schema";
import { useShowOrderOnDisplay } from "@/components/admin/useShowOrderOnDisplay";

/**
 * H1-03, end to end: the real publishing hook, mounted in React (StrictMode included), writing to a
 * convex-test backend, and the display's `current` read as the guest's screen would see it.
 */

const modules = import.meta.glob("../../convex/**/*.ts");
const HERE = "checkout-here-0001";
const MINUTE = 60_000;

const backend = vi.hoisted(() => ({
  call: null as null | ((ref: FunctionReference<"mutation">, args: unknown) => Promise<unknown>),
  pending: new Set<Promise<unknown>>(),
  calls: [] as { name: string; args: Record<string, unknown> }[],
  mutations: new Map<string, (args: unknown) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    let mutation = backend.mutations.get(name);
    if (!mutation) {
      mutation = (args: unknown) => {
        backend.calls.push({ name, args: args as Record<string, unknown> });
        const result = backend.call!(ref, args);
        backend.pending.add(result);
        void result.finally(() => backend.pending.delete(result)).catch(() => undefined);
        return result;
      };
      backend.mutations.set(name, mutation);
    }
    return mutation;
  },
}));
vi.mock("@/components/admin/useDisplayDriver", () => ({
  useDisplayDriver: () => ({ clientId: HERE, driver: "here", displays: [{ _id: "display-1", name: "iPad", lastSeenAt: null }] }),
}));

let root: Root;
let t: ReturnType<typeof convexTest>;
let token: string;
let orderId: string;

function Publisher({ order }: { order: string | null }) {
  useShowOrderOnDisplay(order);
  return null;
}

/** Runs React effects and every mutation they sent, as the browser and server would. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.allSettled([...backend.pending]);
    });
  }
}
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await t.finishInProgressScheduledFunctions();
  await settle();
}
const current = () => t.query(api.pos.displays.current, { token });
const render = async (element: Parameters<Root["render"]>[0]) => {
  await act(async () => root.render(element));
  await settle();
};
const unmount = async () => {
  await act(async () => root.unmount());
  await settle();
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-01T03:00:00.000Z"));
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: "admin@example.com", tokenIdentifier: "admin" });
  backend.call = (ref, args) => admin.mutation(ref, args as never);
  backend.calls = [];
  backend.mutations.clear();
  const { secret } = await admin.mutation(api.pos.displays.createPairLink, { clientId: HERE });
  const claim = await t.mutation(api.pos.displays.claimLink, { secret });
  if (!claim.ok) throw new Error("pairing failed");
  token = claim.token;
  const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: "Anna Lee" });
  ({ orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: "extra", name: "Massage", price: 120000 } }));
  await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId: orderId as never, customerId });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  await Promise.allSettled([...backend.pending]);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("clears the guest's screen when the checkout unmounts (another page, sign-out)", async () => {
  await render(createElement(Publisher, { order: orderId }));
  expect(await current()).toMatchObject({ state: "order", customerFirstName: "Anna" });
  await unmount();
  expect(await current()).toMatchObject({ state: "idle" });
});

it("survives StrictMode's mount, cleanup and remount, and keeps the order up while the tab renews", async () => {
  await render(createElement(StrictMode, null, createElement(Publisher, { order: orderId })));
  const shown = await current();
  expect(shown).toMatchObject({ state: "order", customerFirstName: "Anna" });
  const activeAt = shown.state === "order" ? shown.activeAt : 0;
  // StrictMode's first lease was released, and never the one now on screen.
  const leases = (name: string) => backend.calls.filter((call) => call.name === name).map((call) => call.args.leaseId);
  const published = leases("pos/displays:showOrder").at(-1);
  expect(published).toEqual(expect.any(String));
  expect(leases("pos/displays:releaseDisplay")).toHaveLength(1);
  expect(leases("pos/displays:releaseDisplay")).not.toContain(published);

  for (let i = 0; i < 5; i++) await wait(MINUTE);
  // Renewals keep the order shown but are not customer activity: the 30-minute idle still counts from the publish.
  expect(await current()).toMatchObject({ state: "order", activeAt });
  expect(new Set(leases("pos/displays:renewDriverLease"))).toEqual(new Set([published]));

  await unmount();
  expect(await current()).toMatchObject({ state: "idle" });
});

it("clears the guest's screen once a closed or crashed tab stops renewing, with no cleanup", async () => {
  await render(createElement(Publisher, { order: orderId }));
  expect(await current()).toMatchObject({ state: "order" });
  // The browser is gone: nothing the page tries to send reaches the server, cleanup included.
  backend.call = () => Promise.reject(new Error("offline"));
  await wait(MINUTE);
  expect(await current()).toMatchObject({ state: "order" });
  await wait(MINUTE);
  expect(await current()).toMatchObject({ state: "idle" });
});

it("shows the order again when staff come back to checkout", async () => {
  await render(createElement(Publisher, { order: orderId }));
  await unmount();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render(createElement(Publisher, { order: orderId }));
  expect(await current()).toMatchObject({ state: "order" });
});
