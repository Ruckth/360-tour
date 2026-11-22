// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
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
  "pos/displays:createPairLink": vi.fn(async () => ({ secret: "secret", expiresAt: Date.now() + 600_000 })),
  "pos/displays:takeDisplay": vi.fn(async () => null),
  "pos/displays:revoke": vi.fn(async () => null),
  "pos/displays:approveCode": vi.fn<(args: { code: string; clientId: string }) => Promise<{ displayId: string; name: string }>>(),
}));

type Driver = { clientId: string; displays: Array<{ _id: string; name: string; lastSeenAt: number | null }>; driver: "here" | "elsewhere" | "none" };
// Another checkout tab drives the paired iPad, unless a test says otherwise.
const ELSEWHERE: Driver = { clientId: "tab-here", displays: [{ _id: "display-1", name: "iPad", lastSeenAt: null }], driver: "elsewhere" };
const driverState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => mutations[getFunctionName(ref) as keyof typeof mutations],
}));
vi.mock("@/components/admin/useDisplayDriver", () => ({ useDisplayDriver: () => driverState.current }));

let root: Root;
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.includes(label)) as HTMLButtonElement;
const buttons = (label: string) => [...document.querySelectorAll("button")].filter((el) => el.textContent?.trim() === label);
const render = (orderId: string | null | undefined) => act(async () => root.render(createElement(CustomerDisplayControl, { orderId })));
const openDialog = async (orderId: string | null | undefined, trigger = "Display ·") => {
  await render(orderId);
  await act(async () => button(trigger).click());
};
/** Types into a React-controlled input. */
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const dialog = () => document.querySelector('[role="dialog"]');
const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label) as HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mutation of Object.values(mutations)) mutation.mockClear();
  mutations["pos/displays:approveCode"].mockReset();
  driverState.current = ELSEWHERE;
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
  it("creates no pairing link until staff ask for one (H1-07)", async () => {
    await openDialog(null);
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
    await act(async () => button("Pair a different display").click());
    expect(document.querySelector('[role="tabpanel"]')).toBeTruthy();
    expect(mutations["pos/displays:createPairLink"]).not.toHaveBeenCalled();
    expect(qrRender).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Display link"]')).toBeNull();
    await act(async () => button("Create link").click());
    expect(mutations["pos/displays:createPairLink"]).toHaveBeenCalledExactlyOnceWith({ clientId: "tab-here" });
    const link = document.querySelector<HTMLInputElement>('[aria-label="Display link"]')!.value;
    expect(link).toContain("#pair=secret");
    await vi.waitFor(() => {
      expect(document.querySelector("svg[data-qr-value]")?.getAttribute("data-qr-value")).toBe(link);
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    try {
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith(link);
      expect(document.querySelector('[aria-label="Copied"]')).toBeTruthy();
    } finally {
      writeText.mockRestore();
    }
  });

  it("takes the display over with this tab's order", async () => {
    await openDialog("k17order0001");
    await act(async () => button("Show this checkout on the display").click());
    expect(mutations["pos/displays:takeDisplay"]).toHaveBeenCalledWith({ clientId: "tab-here", orderId: "k17order0001" });
  });

  it("waits to take over while a booking link is still opening its order", async () => {
    await openDialog(undefined);
    expect(button("Show this checkout on the display").disabled).toBe(true);
    expect(document.body.textContent).toContain("Wait for the booking's order to open first.");
  });

  it("says so when a display can't be disconnected", async () => {
    mutations["pos/displays:revoke"].mockRejectedValueOnce(new Error("Not authorized"));
    await openDialog(null);
    await act(async () => button("Disconnect").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Not authorized");
    expect(button("Disconnect").disabled).toBe(false);
  });

  it("leads with the paired display's status, below an urgent take-over, and keeps setup behind Pair a different display", async () => {
    await openDialog("k17order0001");
    const text = dialog()!.textContent!;
    expect(text).toContain("iPad");
    expect(text).toContain("Not seen yet");
    expect(text).toContain("Showing another checkout");
    // Take-over comes before the status card.
    expect(text.indexOf("Show this checkout on the display")).toBeLessThan(text.indexOf("Not seen yet"));
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    // Pairing again is reached before the immediate Disconnect.
    const order = [...dialog()!.querySelectorAll("button")].map((el) => el.textContent?.trim());
    expect(order.indexOf("Pair a different display")).toBeLessThan(order.indexOf("Disconnect"));
    await act(async () => button("Pair a different display").click());
    expect(document.activeElement).toBe(tab("Send link"));
    expect(button("Pair a different display")).toBeUndefined();
    expect(dialog()!.textContent).toContain("Opening the link on another display disconnects iPad.");
    await act(async () => tab("Enter code").click());
    expect(dialog()!.textContent).toContain("Pairing disconnects iPad.");
    await act(async () => tab("This computer").click());
    expect(dialog()!.textContent).toContain("Opening it disconnects iPad.");
    expect(mutations["pos/displays:createPairLink"]).not.toHaveBeenCalled();
  });

  it("shows when an offline display was last seen and that this checkout drives it, without inviting a re-pair", async () => {
    driverState.current = { clientId: "tab-here", displays: [{ _id: "display-1", name: "Front iPad", lastSeenAt: Date.now() - 5 * 60_000 }], driver: "here" };
    await openDialog(null);
    const text = dialog()!.textContent!;
    expect(text).toContain("Offline · last seen 5 minutes ago");
    expect(text).toContain("Showing this checkout");
    expect(text).toContain("It reconnects by itself.");
    expect(text).not.toContain("isn't following this checkout");
  });

  it("opens straight onto setup with one Close and no replacement warning when nothing is paired", async () => {
    driverState.current = { clientId: "tab-here", displays: [], driver: "none" };
    await openDialog(null, "Connect display");
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(dialog()!.textContent).not.toContain("disconnects");
    expect(dialog()!.textContent).not.toContain("Disconnect");
    expect(buttons("Close")).toHaveLength(1);
    expect(dialog()!.textContent).not.toMatch(/Not now|Done/);
    await act(async () => buttons("Close")[0].click());
    expect(dialog()).toBeNull();
    expect(mutations["pos/displays:createPairLink"]).not.toHaveBeenCalled();
  });

  it("pairs only a normalized six-character code, keeps the display on a failed code, and Done closes", async () => {
    driverState.current = { clientId: "tab-here", displays: [], driver: "none" };
    await openDialog(null, "Connect display");
    await act(async () => tab("Enter code").click());
    const input = dialog()!.querySelector<HTMLInputElement>("input")!;
    await type(input, "ab-12");
    expect(button("Pair")!.disabled).toBe(true);
    await act(async () => input.form!.requestSubmit());
    expect(mutations["pos/displays:approveCode"]).not.toHaveBeenCalled();
    mutations["pos/displays:approveCode"].mockRejectedValueOnce(new ConvexError({ code: "CODE_EXPIRED", message: "That code has expired. Check the display for a new code" }));
    await type(input, "ab c-234");
    expect(button("Pair")!.disabled).toBe(false);
    await act(async () => button("Pair")!.click());
    expect(mutations["pos/displays:approveCode"]).toHaveBeenLastCalledWith({ code: "ABC234", clientId: "tab-here" });
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("That code has expired. Check the display for a new code");
    expect(button("Done")).toBeUndefined();
    mutations["pos/displays:approveCode"].mockResolvedValueOnce({ displayId: "display-2", name: "Front iPad" });
    await act(async () => button("Pair")!.click());
    expect(dialog()!.textContent).toContain("Paired with Front iPad");
    expect(buttons("Done")).toHaveLength(1);
    expect(buttons("Close")).toHaveLength(0);
    await act(async () => button("Done")!.click());
    expect(dialog()).toBeNull();
  });

  it("ends a link pairing on Paired once the link is used, without offering the used link again", async () => {
    await openDialog(null);
    await act(async () => button("Pair a different display").click());
    await act(async () => button("Create link").click());
    expect(document.querySelector('[aria-label="Display link"]')).toBeTruthy();
    // The display opened the link: the old iPad is replaced by the new one, and this tab drives it.
    driverState.current = { clientId: "tab-here", displays: [{ _id: "display-2", name: "Front iPad", lastSeenAt: Date.now() }], driver: "here" };
    await render(null);
    expect(dialog()!.textContent).toContain("Paired with Front iPad");
    expect(dialog()!.textContent).toContain("It now shows the order open at this checkout.");
    expect(document.querySelector('[aria-label="Display link"]')).toBeNull();
    expect(qrRender).toHaveBeenCalledOnce();
    expect(mutations["pos/displays:createPairLink"]).toHaveBeenCalledOnce();
  });

  it("disconnects with the plain Disconnect button and no confirmation", async () => {
    await openDialog(null);
    await act(async () => button("Disconnect").click());
    expect(mutations["pos/displays:revoke"]).toHaveBeenCalledExactlyOnceWith({ displayId: "display-1" });
  });
});


it("renders the QR once through 60 countdown ticks, updates it once for a new URL, and still expires the link", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
  await openDialog(null);
  await act(async () => button("Pair a different display").click());
  await act(async () => button("Create link").click());
  expect(qrRender).toHaveBeenCalledOnce();
  const initial = document.querySelector('[role="tabpanel"]')!.textContent;
  for (let second = 0; second < 60; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(qrRender).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="tabpanel"]')!.textContent).not.toBe(initial);
  expect(document.body.textContent).toContain("9 minutes");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.disabled).toBe(false);
  mutations["pos/displays:createPairLink"].mockResolvedValueOnce({ secret: "replacement", expiresAt: Date.now() + 60_000 });
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

it("keeps the display link and copy action when the QR module fails to load", async () => {
  vi.resetModules();
  vi.doMock("react-qr-code", () => { throw new Error("QR chunk unavailable"); });
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const { CustomerDisplayControl: Control } = await import("@/components/admin/CustomerDisplayDialog");
    await act(async () => root.render(createElement(Control, { orderId: null })));
    await act(async () => button("Display ·").click());
    await act(async () => button("Pair a different display").click());
    await act(async () => button("Create link").click());

    await vi.waitFor(() => expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe("QR unavailable. Copy the link."));
    const link = document.querySelector<HTMLInputElement>('[aria-label="Display link"]')!.value;
    expect(link).toContain("#pair=secret");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(link);
    expect(document.querySelector('[aria-label="Copied"]')).toBeTruthy();
  } finally {
    writeText.mockRestore();
    vi.doUnmock("react-qr-code");
  }
});
