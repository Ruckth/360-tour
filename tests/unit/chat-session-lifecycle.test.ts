// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "@/components/chat/useChatSession";
import { SESSION_ID_STORAGE_KEY } from "@/components/chat/session/message-cache";

const mocks = vi.hoisted(() => {
  const translate = (key: string) => key;
  const search = new URLSearchParams();
  const unsubscribe = vi.fn();
  const client = { watchQuery: vi.fn(() => ({ onUpdate: () => unsubscribe, localQueryResult: () => undefined })) };
  return {
    translate, search, client, unsubscribe,
    create: vi.fn(), transcript: vi.fn(), ask: vi.fn(), touch: vi.fn(),
    claim: vi.fn(), reusable: vi.fn(),
    router: { replace: vi.fn(), prefetch: vi.fn() },
  };
});
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => mocks.translate }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useSearchParams: () => mocks.search, useRouter: () => mocks.router }));
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => mocks.client }));
vi.mock("@/components/chat/ChatContext", () => ({ useChatPageContext: () => null }));
vi.mock("@/lib/react/convex-api", () => ({
  createChatSession: mocks.create, touchChatSession: mocks.touch,
  getChatMessages: mocks.transcript, askConcierge: mocks.ask,
  getReusableChatSession: mocks.reusable, claimChatBrowserHandoff: mocks.claim,
  listLiveProperties: async () => [], getNextChatSuggestions: async () => [],
  markChatSuggestionsShown: async () => undefined, markChatSuggestionClicked: async () => undefined,
  closeChatSession: async () => undefined, createChatBrowserHandoff: async () => "handoff",
  identifyChatVisitor: async () => undefined,
}));

let root: Root | null;
let chat: ReturnType<typeof useChatSession>;
function Harness() {
  const value = useChatSession({ mode: "page", contactEmail: "test@example.com", whatsappNumber: "123" });
  useEffect(() => { chat = value; }, [value]);
  return null;
}
async function mount() {
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => { root!.render(createElement(Harness)); });
}
async function unmount() {
  await act(async () => { root?.unmount(); root = null; });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.search.delete("handoff");
  vi.clearAllMocks();
  mocks.create.mockResolvedValue("session-one");
  mocks.touch.mockResolvedValue(undefined);
  mocks.reusable.mockResolvedValue(null);
  mocks.transcript.mockResolvedValue([]);
  mocks.ask.mockRejectedValue(new Error("disconnected"));
});
afterEach(async () => {
  await unmount();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("public chat lifecycle", () => {
  it("clears pending keyboard focus and blur probes on unmount", async () => {
    await mount();
    await act(async () => {
      chat.focusFooterInput("composer");
      chat.clearFooterFocusAfterBlur();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not persist a session created after unmount", async () => {
    const creation = deferred<string>();
    mocks.create.mockReturnValue(creation.promise);
    await mount();
    expect(mocks.create).toHaveBeenCalled();
    await unmount();
    await act(async () => { creation.resolve("late-session"); });
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(mocks.client.watchQuery).not.toHaveBeenCalled();
  });

  it("clears recovery waits and subscriptions on unmount", async () => {
    await mount();
    expect(chat.chatInputDisabled).toBe(false);
    let pending!: Promise<void>;
    await act(async () => { pending = chat.sendMessage("What is the airport pickup policy?"); });
    const requests = mocks.transcript.mock.calls.length;
    expect(requests).toBeGreaterThan(0);
    await unmount();
    await pending;
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.transcript).toHaveBeenCalledTimes(requests);
  });

  it("drops a late answer after restart without replacing the new transcript", async () => {
    const answer = deferred<{ response: string; model: string }>();
    mocks.ask.mockReturnValue(answer.promise);
    await mount();
    let pending!: Promise<void>;
    await act(async () => { pending = chat.sendMessage("old question"); });
    mocks.create.mockResolvedValue("session-two");
    await act(async () => { await chat.restartChat(); });
    await act(async () => { answer.resolve({ response: "stale answer", model: "test" }); await pending; });
    expect(chat.messages).toEqual([]);
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe("session-two");
  });

  it("does not consume a late handoff or navigate after unmount", async () => {
    const claim = deferred<string>();
    mocks.search.set("handoff", "one-time-test-token");
    mocks.claim.mockReturnValue(claim.promise);
    await mount();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    await unmount();
    await act(async () => { claim.resolve("late-handoff-session"); });
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.touch).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
  });
});
