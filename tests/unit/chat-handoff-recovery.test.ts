// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatHandoff } from "@/components/chat/session/useChatHandoff";
import { storeGuestToken } from "@/components/chat/session/credentials";
import type { GuestCredentials } from "@/components/chat/session/useGuestSession";
import type { Id } from "convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), search: new URLSearchParams(), router: { replace: vi.fn() } }));
vi.mock("convex/react", () => ({ useConvex: () => mocks }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => mocks.search }));

let root: Root;
let node: HTMLDivElement;
function Harness({ ensureSession }: { ensureSession: () => Promise<GuestCredentials | null> }) {
  const handoff = useChatHandoff("page", true, ensureSession);
  return createElement("button", { disabled: !handoff.browserGateUrl }, handoff.browserGateUrl);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 LINE/14.0");
  window.location.href = "http://localhost:3000/chat";
  localStorage.clear();
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["session", "handoff"])("offers tokenless browser recovery when %s preparation never settles", async (pendingStep) => {
  let finishSession!: (value: GuestCredentials) => void;
  const session = new Promise<GuestCredentials>((resolve) => { finishSession = resolve; });
  const credentials = { sessionId: "guest-session" as Id<"conversations">, guestToken: "guest-secret" };
  storeGuestToken(credentials.sessionId, credentials.guestToken);
  mocks.mutation.mockImplementation(() => new Promise(() => {}));
  const ensureSession = vi.fn(() => pendingStep === "session" ? session : Promise.resolve(credentials));
  await act(async () => root.render(createElement(Harness, { ensureSession })));
  const button = node.querySelector("button")!;
  await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
  expect(button.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(button.disabled).toBe(false);
  const url = new URL(button.textContent!);
  expect(url.searchParams.get("external")).toBe("1");
  expect(url.searchParams.has("handoff")).toBe(false);
  expect(url.toString()).not.toContain(credentials.guestToken);
  await act(async () => { finishSession(credentials); });
  expect(mocks.mutation).toHaveBeenCalledTimes(pendingStep === "handoff" ? 1 : 0);
});
