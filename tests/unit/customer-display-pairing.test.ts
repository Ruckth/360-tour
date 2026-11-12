// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from "convex/server";
import { NextIntlClientProvider } from "next-intl";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/display/en.json";
import { CustomerDisplay } from "@/components/display/CustomerDisplay";

type Pending = { status: "pending"; token: string; code: string; expiresAt: number };
const pendingCode = (token: string, expiresAt = Date.now() + 600_000): Pending => ({ status: "pending", token, code: "ABC234", expiresAt });

const mutations = vi.hoisted(() => ({
  "pos/displays:claimLink": vi.fn<(args: object) => Promise<{ ok: true; token: string } | { ok: false; code: "LINK_INVALID" }>>(),
  "pos/displays:startPairing": vi.fn<(args: object) => Promise<Pending | { status: "active" }>>(),
  "pos/displays:heartbeat": vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => mutations[getFunctionName(ref) as keyof typeof mutations],
  // Pending tokens show their code; the claimed device token shows the welcome screen.
  useQuery: (_ref: unknown, args: "skip" | { token: string }) =>
    args === "skip" ? undefined : args.token.startsWith("pending") ? { state: "pending", code: "ABC234" } : { state: "idle", businessName: "Auralis Cove Retreat" },
  useConvex: () => ({
    connectionState: () => ({ hasEverConnected: false, isWebSocketConnected: false }),
    subscribeToConnectionState: () => () => undefined,
  }),
}));
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => ({}) }));

/** A promise resolved from the test, for responses that arrive later. */
function later<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve: (value: T) => act(async () => resolve(value)) };
}

let root: Root;
const claims = () => mutations["pos/displays:claimLink"].mock.calls;
const codeRequests = () => mutations["pos/displays:startPairing"].mock.calls;
const storedToken = () => window.localStorage.getItem("display-token");
const open = (hash: string) =>
  act(async () => {
    window.history.replaceState(null, "", `/display${hash}`);
    root.render(createElement(NextIntlClientProvider, { locale: "en", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>, createElement(CustomerDisplay)));
  });
const navigate = (hash: string) =>
  act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  for (const mutation of Object.values(mutations)) mutation.mockReset();
  mutations["pos/displays:claimLink"].mockResolvedValue({ ok: true, token: "device-token" });
  mutations["pos/displays:startPairing"].mockImplementation(async () => pendingCode("pending-token"));
  window.localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("customer display pairing links", () => {
  it("claims a link in the address on load and clears it from the address", async () => {
    await open("#pair=first-secret");
    expect(claims()).toEqual([[{ secret: "first-secret", deviceName: "Customer display", previousToken: undefined }]]);
    expect(window.location.hash).toBe("");
    expect(codeRequests()).toHaveLength(0);
  });

  it("claims a link sent to a display window that is already open, once, retiring its code", async () => {
    await open("");
    expect(codeRequests()).toHaveLength(1);
    await navigate("#pair=later-secret&name=This%20computer");
    expect(claims()).toEqual([[{ secret: "later-secret", deviceName: "This computer", previousToken: "pending-token" }]]);
    expect(window.location.hash).toBe("");
    await navigate("#pair=later-secret&name=This%20computer");
    expect(claims()).toHaveLength(1);
    expect(storedToken()).toBe("device-token");
  });
});

describe("customer display pairing sequence", () => {
  it("keeps a claimed token when the code expires while the claim is in flight", async () => {
    mutations["pos/displays:startPairing"].mockImplementationOnce(async () => pendingCode("pending-old", Date.now() + 1_000));
    await open("");
    const claim = later<{ ok: true; token: string }>();
    mutations["pos/displays:claimLink"].mockReturnValueOnce(claim.promise);
    await navigate("#pair=secret");
    // The code's expiry passes mid-claim: no new code is requested.
    await wait(2_000);
    expect(codeRequests()).toHaveLength(1);
    await claim.resolve({ ok: true, token: "device-token" });
    await wait(60_000);
    expect(storedToken()).toBe("device-token");
    expect(codeRequests()).toHaveLength(1);
  });

  it("ignores a code refresh that was in flight when a claim started", async () => {
    mutations["pos/displays:startPairing"].mockImplementationOnce(async () => pendingCode("pending-old", Date.now() + 1_000));
    await open("");
    const refresh = later<Pending>();
    mutations["pos/displays:startPairing"].mockReturnValueOnce(refresh.promise);
    await wait(1_500);
    expect(codeRequests()).toHaveLength(2);
    await navigate("#pair=secret");
    await refresh.resolve(pendingCode("pending-new"));
    expect(storedToken()).toBe("device-token");
  });

  it("keeps a valid link's token when a used link arrives before it is claimed", async () => {
    await open("");
    const first = later<{ ok: true; token: string }>();
    mutations["pos/displays:claimLink"].mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: false, code: "LINK_INVALID" });
    await navigate("#pair=valid-a");
    await navigate("#pair=expired-b");
    expect(window.location.hash).toBe("");
    // Claims run one at a time, in order.
    expect(claims()).toHaveLength(1);
    await first.resolve({ ok: true, token: "device-a" });
    expect(claims()).toHaveLength(2);
    expect(claims()[1][0]).toMatchObject({ secret: "expired-b", previousToken: "device-a" });
    await wait(60_000);
    expect(storedToken()).toBe("device-a");
    expect(codeRequests()).toHaveLength(1);
  });

  it("resumes code pairing only once a claim fails", async () => {
    mutations["pos/displays:startPairing"].mockImplementationOnce(async () => pendingCode("pending-old", Date.now() + 1_000));
    await open("");
    const claim = later<{ ok: false; code: "LINK_INVALID" }>();
    mutations["pos/displays:claimLink"].mockReturnValueOnce(claim.promise);
    await navigate("#pair=used-secret");
    await wait(2_000);
    expect(codeRequests()).toHaveLength(1);
    await claim.resolve({ ok: false, code: "LINK_INVALID" });
    await wait(0);
    expect(codeRequests()).toHaveLength(2);
    expect(storedToken()).toBe("pending-token");
    expect(document.body.textContent).toContain("That pairing link has expired or was already used.");
  });
});

describe("customer display connection", () => {
  it("shows Reconnecting as soon as the browser goes offline, and clears it when it is back", async () => {
    window.localStorage.setItem("display-token", "device-token");
    const onLine = vi.spyOn(window.navigator, "onLine", "get");
    await open("");
    expect(document.body.textContent).toContain("Welcome");
    expect(document.body.textContent).not.toContain("Reconnecting");

    onLine.mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(document.body.textContent).toContain("Reconnecting");

    onLine.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(document.body.textContent).not.toContain("Reconnecting");
    onLine.mockRestore();
  });
});
