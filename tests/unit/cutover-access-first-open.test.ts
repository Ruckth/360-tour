import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { cutoverAccess, resetPinnedAccess, type PayDeskTransport } from "@/components/checkout/pay-desk-backend";
import { rememberTill } from "@/components/checkout/pay-desk";

/*
 * PR #93 round 2, blocker 1: a manager opens Approvals from Settings in a fresh tab on a till
 * already admitted at checkout. The first access answer pins the cutover revision; acknowledging
 * returns the till this device already has. Neither changes React state, and the server's answer to
 * the first arguments never changes, so the panel stayed on loading until something else rendered.
 * This transport re-renders only when an answer changes, as Convex does.
 */

const TILL = "till-front-desk";
const REVISION = 3;
let root: Root;
let acknowledged = false;
let acknowledgements = 0;
const answers = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;

function serverAccess(args: { tillId?: string; loadedRevision?: number }) {
  const switches = { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" } as const;
  return {
    settingsRevision: 7, switches, canSell: { products: false, vouchers: false, sessionPackages: false, mixedPackages: false },
    paymentsMode: "attempts" as const, paused: false, cutoverRevision: REVISION,
    tillReady: args.loadedRevision === REVISION && args.tillId === TILL && acknowledged,
  };
}
/** Re-run every subscribed query; notify only when an answer changed. */
function rerun() {
  let changed = false;
  for (const [key, value] of answers) {
    const next = serverAccess(JSON.parse(key));
    if (JSON.stringify(next) !== JSON.stringify(value)) { answers.set(key, next); changed = true; }
  }
  if (changed) { version++; listeners.forEach((fn) => fn()); }
}
const transport: PayDeskTransport = {
  useQuery: (<F extends FunctionReference<"query">>(ref: F, args: unknown) => {
    useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version);
    expect(getFunctionName(ref)).toBe("commerce/settings:getAccess");
    const { deviceKey: _device, ...rest } = args as { deviceKey: string };
    void _device;
    const key = JSON.stringify(rest);
    if (!answers.has(key)) {
      answers.set(key, undefined);
      setTimeout(() => { answers.set(key, serverAccess(rest)); version++; listeners.forEach((fn) => fn()); }, 5);
    }
    return answers.get(key);
  }) as PayDeskTransport["useQuery"],
  useMutation: (() => async () => {
    acknowledgements++;
    acknowledged = true;
    setTimeout(rerun, 5);
    return { tillId: TILL, revision: REVISION, acknowledgedAt: Date.now() };
  }) as PayDeskTransport["useMutation"],
};

const useAccess = cutoverAccess(transport);
function Probe() {
  const access = useAccess();
  return createElement("p", null, access ? `${access.paymentsMode} · ready ${access.tillReady}` : "loading");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.setItem("checkout.deviceKey", "front-desk-ipad-0000000000000001");
  answers.clear();
  acknowledged = false;
  acknowledgements = 0;
  resetPinnedAccess();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 20; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); };

it("admits a fresh Settings tab on a till admitted at checkout, with nothing else rendering", async () => {
  // The device was admitted at checkout earlier: localStorage already names its till.
  rememberTill(TILL as never);
  await act(async () => root.render(createElement(Probe)));
  expect(document.body.textContent).toBe("loading");
  await settle();
  expect(document.body.textContent).toBe("attempts · ready true");
  expect(acknowledgements).toBe(1);
});

it("admits a device seen for the first time once its acknowledgement names the till", async () => {
  await act(async () => root.render(createElement(Probe)));
  await settle();
  expect(document.body.textContent).toBe("attempts · ready true");
  expect(acknowledgements).toBe(1);
});
