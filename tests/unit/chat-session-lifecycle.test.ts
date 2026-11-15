// @vitest-environment happy-dom
import { act, createElement, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { useChatSession } from '@/components/chat/useChatSession';
import { getStoredGuestToken, getStoredSessionId } from '@/components/chat/session/credentials';
const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), touch: vi.fn(), search: new URLSearchParams(), router: { replace: vi.fn() },
  rows: [] as Array<{ _id: string; role: 'user' | 'assistant'; content: string }>, listeners: new Set<() => void>(),
  session: { aiPaused: false },
}));
vi.mock('next-intl', () => { const translate = (key: string) => key; return { useLocale: () => 'en', useTranslations: () => translate }; });
vi.mock('next/navigation', () => ({ usePathname: () => '/chat', useSearchParams: () => mocks.search, useRouter: () => mocks.router }));
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), ...(() => { const client = { mutation: (ref: FunctionReference<'mutation'>, args: unknown) => getFunctionName(ref) === 'messaging/chat:touchSession' ? mocks.touch(args) : ['messaging/chat:createSession','messaging/chat:sendMessage','messaging/chat:claimBrowserHandoff'].includes(getFunctionName(ref)) ? mocks.mutation(ref,args) : Promise.resolve(null), query: async () => [] }; return { useConvex: () => client }; })(), useQuery: (ref: FunctionReference<'query'>, args: unknown) => useSyncExternalStore(
  listener => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
  () => args === 'skip' ? undefined : getFunctionName(ref) === 'messaging/chat:getMessages' ? mocks.rows : mocks.session,
) }));
vi.mock('@/components/chat/ChatContext', () => ({ useChatPageContext: () => null }));

let root: Root | null, chat: ReturnType<typeof useChatSession>;
function Harness({ initialDraft }: { initialDraft?: string }) {
  const value = useChatSession({ mode: 'page', initialDraft, contactEmail: 'test@example.com', whatsappNumber: '123' });
  useEffect(() => { chat = value; }, [value]); return null;
}
async function mount(initialDraft?: string) {
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(createElement(Harness, { initialDraft })));
}
async function unmount() { await act(async () => { root?.unmount(); root = null; }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function publish(rows: typeof mocks.rows) { await act(async () => { mocks.rows = rows; for (const listener of mocks.listeners) listener(); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  mocks.rows = []; mocks.session = { aiPaused: false }; mocks.listeners.clear(); mocks.search.delete('handoff');
  mocks.touch.mockResolvedValue(undefined);
  mocks.mutation.mockImplementation(async (ref: FunctionReference<'mutation'>) => getFunctionName(ref) === 'messaging/chat:createSession' ? { sessionId: 'session-one', guestToken: 'token-one' } : { eventId: 'event', userMessageId: 'message', duplicate: false });
});
afterEach(async () => { await unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('renders connected transcripts only from subscription updates and never stores a transcript cache', async () => {
  await mount();
  await act(async () => chat.sendMessage('Hello'));
  expect(chat.messages).toEqual([]);
  await publish([{ _id: 'u1', role: 'user', content: 'Hello' }]); expect(chat.isTyping).toBe(true);
  await publish([{ _id: 'u1', role: 'user', content: 'Hello' }, { _id: 'a1', role: 'assistant', content: 'Server reply' }]);
  expect(chat.messages.map(message => message.content)).toEqual(['Hello', 'Server reply']); expect(chat.isTyping).toBe(false);
  expect(Object.keys(localStorage).some(key => key.startsWith('sv_chat_messages:'))).toBe(false);
  expect(getStoredGuestToken('session-one')).toBe('token-one');
});
it('retries an ambiguous admission with the same client message identifier and preserves the draft', async () => {
  await mount();
  mocks.mutation.mockRejectedValueOnce(new Error('connection dropped'));
  await act(async () => chat.sendMessage('Keep this draft'));
  expect(chat.input).toBe('Keep this draft'); expect(chat.messages).toEqual([]);
  const first = mocks.mutation.mock.calls.find(([ref]) => getFunctionName(ref) === 'messaging/chat:sendMessage')![1];
  await act(async () => chat.sendMessage('Keep this draft'));
  const calls = mocks.mutation.mock.calls.filter(([ref]) => getFunctionName(ref) === 'messaging/chat:sendMessage');
  expect(calls.at(-1)![1].clientMessageId).toBe(first.clientMessageId);
  expect(chat.input).toBe('');
});
it('does not persist a session created after unmount', async () => {
  const late = deferred<{ sessionId: string; guestToken: string }>(); mocks.mutation.mockReturnValueOnce(late.promise);
  await mount(); await unmount(); await act(async () => late.resolve({ sessionId: 'late-session', guestToken: 'late-token' }));
  expect(getStoredSessionId()).toBeNull(); expect(getStoredGuestToken('late-session')).toBeUndefined();
});
it('keeps a service question as an editable draft without sending it on session creation', async () => {
  await mount('Can I book a massage?'); expect(chat.input).toBe('Can I book a massage?');
  expect(mocks.mutation.mock.calls.some(([ref]) => getFunctionName(ref) === 'messaging/chat:sendMessage')).toBe(false);
});
it('does not consume a late handoff or navigate after unmount', async () => {
  mocks.search.set('handoff', 'one-time'); const late = deferred<null>(); mocks.mutation.mockReturnValueOnce(late.promise);
  await mount(); await unmount(); await act(async () => late.resolve(null)); expect(mocks.router.replace).not.toHaveBeenCalled();
});
it('removes the old token on restart and drops the earlier pending admission result', async () => {
  await mount(); const pending = deferred<unknown>(); mocks.mutation.mockReturnValueOnce(pending.promise);
  let send: Promise<void>; await act(async () => { send = chat.sendMessage('Old question'); });
  mocks.mutation.mockResolvedValueOnce({ sessionId: 'session-two', guestToken: 'token-two' });
  await act(async () => chat.restartChat());
  await act(async () => pending.resolve({ eventId: 'old-event' })); await send!;
  expect(getStoredGuestToken('session-one')).toBeUndefined(); expect(getStoredSessionId()).toBe('session-two'); expect(chat.messages).toEqual([]);
});
it('clears viewport timers and subscriptions on unmount', async () => {
  await mount(); expect(mocks.listeners.size).toBeGreaterThan(0); await unmount(); expect(mocks.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('shares one slow session creation between restart and the open-session effect', async () => {
  await mount();
  const late = deferred<{ sessionId: string; guestToken: string }>(); mocks.mutation.mockReturnValueOnce(late.promise);
  let restarting: Promise<void>;
  await act(async () => { restarting = chat.restartChat(); });
  expect(mocks.mutation.mock.calls.filter(([ref]) => getFunctionName(ref) === 'messaging/chat:createSession')).toHaveLength(2); // initial + restart
  await act(async () => late.resolve({ sessionId: 'session-two', guestToken: 'token-two' })); await restarting!;
  expect(getStoredSessionId()).toBe('session-two'); expect(getStoredGuestToken('session-one')).toBeUndefined();
});
