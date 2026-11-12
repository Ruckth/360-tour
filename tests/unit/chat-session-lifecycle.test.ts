// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "@/components/chat/useChatSession";
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { getStoredGuestToken, storeGuestToken, SESSION_ID_STORAGE_KEY } from "@/components/chat/session/message-cache";

const mocks = vi.hoisted(() => {
  const translate = (key: string) => key;
  const search = new URLSearchParams();
  const unsubscribe = vi.fn();
  const watches: Array<{ name: string; update?: () => void; error?: Error }> = [];
  const client = { watchQuery: vi.fn((ref: FunctionReference<"query">) => {
    const watch: (typeof watches)[number] = { name: getFunctionName(ref) };
    watches.push(watch);
    return {
      onUpdate: (update: () => void) => { watch.update = update; return unsubscribe; },
      localQueryResult: () => { if (watch.error) throw watch.error; return undefined; },
    };
  }) };
  return {
    translate, search, client, unsubscribe, watches,
    create: vi.fn(), transcript: vi.fn(), ask: vi.fn(), touch: vi.fn(),
    claim: vi.fn(),
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
  claimChatBrowserHandoff: mocks.claim,
  listLiveProperties: async () => [], getNextChatSuggestions: async () => [],
  markChatSuggestionsShown: async () => undefined, markChatSuggestionClicked: async () => undefined,
  closeChatSession: async () => undefined, createChatBrowserHandoff: async () => "handoff",
  identifyChatVisitor: async () => undefined,
}));

let root: Root | null;
let chat: ReturnType<typeof useChatSession>;
function Harness({ initialDraft }: { initialDraft?: string }) {
  const value = useChatSession({ mode: "page", initialDraft, contactEmail: "test@example.com", whatsappNumber: "123" });
  useEffect(() => { chat = value; }, [value]);
  return null;
}
async function mount(initialDraft?: string) {
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => { root!.render(createElement(Harness, { initialDraft })); });
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
  mocks.watches.length = 0;
  mocks.search.delete("handoff");
  vi.clearAllMocks();
  mocks.create.mockResolvedValue("session-one");
  mocks.touch.mockResolvedValue(undefined);
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


it("keeps a service question as an editable draft without sending it on session creation", async () => {
  await mount("I'd like to know about Thai Massage.");
  expect(chat.input).toBe("I'd like to know about Thai Massage.");
  expect(mocks.ask).not.toHaveBeenCalled();
  expect(chat.messages).toEqual([]);
  await act(async () => { chat.setInput("Can two people book a massage?"); });
  expect(chat.input).toBe("Can two people book a massage?");
  expect(mocks.ask).not.toHaveBeenCalled();
});


it.each(['chat:getMessages', 'chat:getSession'])('recovers an open chat after INVALID_GUEST_TOKEN from %s', async (name) => {
  await mount();
  storeGuestToken('session-one', 'expired-token');
  const creation = deferred<string>();
  mocks.create.mockReturnValueOnce(creation.promise);
  const watch = mocks.watches.find(item => item.name === name)!;
  const otherWatch = mocks.watches.find(item => item.name !== name)!;
  await act(async () => {
    watch.error = new ConvexError({ code: 'INVALID_GUEST_TOKEN', message: 'Expired or deleted session' });
    otherWatch.error = watch.error;
    watch.update!();
    otherWatch.update!();
  });
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBeNull();
  expect(getStoredGuestToken('session-one')).toBeUndefined();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  await act(async () => { creation.resolve('session-two'); });
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('session-two');
  expect(chat.chatInputDisabled).toBe(false);
  mocks.ask.mockResolvedValue({ response: 'Fresh reply' });
  await act(async () => { await chat.sendMessage('New question'); });
  expect(mocks.ask).toHaveBeenLastCalledWith(mocks.client, expect.objectContaining({ sessionId: 'session-two', userMessage: 'New question' }));
  expect(chat.messages.at(-1)?.content).toBe('Fresh reply');
});

it('removes the old token on restart and failed hydration', async () => {
  localStorage.setItem(SESSION_ID_STORAGE_KEY, 'stale-session');
  storeGuestToken('stale-session', 'stale-token');
  mocks.touch.mockRejectedValueOnce(new ConvexError({ code: 'INVALID_GUEST_TOKEN' }));
  await mount();
  expect(getStoredGuestToken('stale-session')).toBeUndefined();
  storeGuestToken('session-one', 'old-token');
  mocks.create.mockResolvedValue('session-two');
  await act(async () => { await chat.restartChat(); });
  expect(getStoredGuestToken('session-one')).toBeUndefined();
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('session-two');
});


it.each(['touch', 'ask'] as const)('recovers invalid guest credentials during %s and keeps the unsent draft', async (operation) => {
  await mount();
  storeGuestToken('session-one', 'expired-token');
  mocks.create.mockResolvedValueOnce('session-two');
  mocks[operation].mockRejectedValueOnce(new ConvexError({ code: 'INVALID_GUEST_TOKEN' }));
  await act(async () => { await chat.sendMessage('Please help with my stay'); });
  expect(getStoredGuestToken('session-one')).toBeUndefined();
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('session-two');
  expect(chat.input).toBe('Please help with my stay');
  expect(chat.chatInputDisabled).toBe(false);
  mocks.ask.mockResolvedValue({ response: 'Happy to help' });
  await act(async () => { await chat.sendMessage(chat.input); });
  expect(chat.messages.at(-1)?.content).toBe('Happy to help');
});

it('keeps the current session on unrelated subscription errors', async () => {
  await mount();
  const watch = mocks.watches.find(item => item.name === 'chat:getMessages')!;
  await act(async () => {
    watch.error = new Error('Temporary transport failure');
    watch.update!();
  });
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('session-one');
  expect(mocks.create).toHaveBeenCalledTimes(1);
});


it('drops late credential recovery after a restart', async () => {
  await mount();
  const creation = deferred<string>();
  mocks.create.mockReturnValueOnce(creation.promise);
  mocks.ask.mockRejectedValueOnce(new ConvexError({ code: 'INVALID_GUEST_TOKEN' }));
  let pending!: Promise<void>;
  await act(async () => { pending = chat.sendMessage('old question'); });
  expect(chat.input).toBe('old question');
  mocks.create.mockResolvedValueOnce('restart-session');
  await act(async () => { await chat.restartChat(); });
  await act(async () => { creation.resolve('late-recovery-session'); await pending; });
  expect(localStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe('restart-session');
  expect(chat.input).toBe('');
  expect(chat.messages).toEqual([]);
});
