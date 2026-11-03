// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerDisplayControl } from "@/components/admin/CustomerDisplayDialog";

const qrRender = vi.hoisted(() => vi.fn());
vi.mock("react-qr-code", () => ({ default: (props: { value: string }) => {
  qrRender(props);
  return createElement("svg", { "data-qr-value": props.value });
} }));

const mutations = vi.hoisted(() => ({
  "displays:createPairLink": vi.fn(async () => ({ secret: "secret", expiresAt: Date.now() + 600_000 })),
  "displays:takeDisplay": vi.fn(async () => null),
  "displays:revoke": vi.fn(async () => null),
  "displays:approveCode": vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => mutations[getFunctionName(ref) as keyof typeof mutations],
}));
// Another checkout tab drives the paired iPad.
vi.mock("@/components/admin/useDisplayDriver", () => ({
  useDisplayDriver: () => ({ clientId: "tab-here", displays: [{ _id: "display-1", name: "iPad", lastSeenAt: null }], driver: "elsewhere" }),
}));

let root: Root;
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(label)) as HTMLButtonElement;
const openDialog = async (orderId: string | null | undefined) => {
  await act(async () => root.render(createElement(CustomerDisplayControl, { orderId })));
  await act(async () => button("on another checkout").click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mutation of Object.values(mutations)) mutation.mockClear();
  qrRender.mockClear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("customer display dialog", () => {
  it("takes the display over with this tab's order", async () => {
    await openDialog("k17order0001");
    await act(async () => button("Show this checkout on the display").click());
    expect(mutations["displays:takeDisplay"]).toHaveBeenCalledWith({ clientId: "tab-here", orderId: "k17order0001" });
  });

  it("waits to take over while a booking link is still opening its order", async () => {
    await openDialog(undefined);
    expect(button("Show this checkout on the display").disabled).toBe(true);
    expect(document.body.textContent).toContain("Wait for the booking's order to open first.");
  });

  it("says so when a display can't be disconnected", async () => {
    mutations["displays:revoke"].mockRejectedValueOnce(new Error("Not authorized"));
    await openDialog(null);
    await act(async () => button("Disconnect").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Not authorized");
    expect(button("Disconnect").disabled).toBe(false);
  });
});


it("renders the QR once through 60 countdown ticks, updates it once for a new URL, and still expires the link", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
  await openDialog(null);
  expect(qrRender).toHaveBeenCalledOnce();
  const initial = document.querySelector('[role="tabpanel"]')!.textContent;
  for (let second = 0; second < 60; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(qrRender).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="tabpanel"]')!.textContent).not.toBe(initial);
  expect(document.body.textContent).toContain("9 minutes");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.disabled).toBe(false);
  mutations["displays:createPairLink"].mockResolvedValueOnce({ secret: "replacement", expiresAt: Date.now() + 60_000 });
  await act(async () => button("New link").click());
  expect(qrRender).toHaveBeenCalledTimes(2);
  expect(qrRender.mock.calls[1][0].value).toContain("#pair=replacement");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Display link"]')!.value).toContain("#pair=replacement");
  await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.disabled).toBe(true);
  expect(button("Link expired · New link")).toBeTruthy();
  expect(qrRender).toHaveBeenCalledTimes(2);
});
