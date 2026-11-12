"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from 'convex/_generated/api';
import { ConvexError } from 'convex/values';
import { useOptionalConvex } from '@/lib/react/convex';
import { closeChatSession, touchChatSession } from '@/lib/react/convex-api';
import { captureForBooking } from '@/lib/marketing/capture';
import { clearStoredSessionId, getOrCreateVisitorId, getStoredGuestToken, getStoredSessionId, setStoredSessionId, storeGuestToken } from './credentials';
import { startSessionHeartbeat, HEARTBEAT_MS } from './heartbeat';
import type { Id } from 'convex/_generated/dataModel';

export function getBrowserChatMetadata() {
  return { currentPath: `${window.location.pathname}${window.location.search}`, referrer: document.referrer || undefined,
    userAgent: navigator.userAgent, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, browserLanguage: navigator.languages?.join(', ') || navigator.language,
    screenSize: `${window.screen.width}x${window.screen.height}`, viewportSize: `${window.innerWidth}x${window.innerHeight}`, platform: navigator.platform };
}
export type GuestCredentials = { sessionId: Id<'conversations'>; guestToken: string };
export function invalidGuest(error: unknown) {
  return error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'code' in error.data && error.data.code === 'INVALID_GUEST_TOKEN';
}
export function useGuestSession(propertySlug: string | undefined, open: boolean, handoffToken: string | null, onClaimed: () => void) {
  const convex = useOptionalConvex();
  const [credentials, setCredentials] = useState<GuestCredentials | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const activeRequest = useRef<Promise<GuestCredentials | null> | null>(null);
  const sessionScope = useRef<AbortController | null>(null);
  const claimed = useRef<string | null>(null);
  const create = useCallback(async (signal: AbortSignal) => {
    if (!convex) return null;
    const result = await convex.mutation(api.chat.createSession, { propertySlug, channel: 'web', visitorId: getOrCreateVisitorId(), ...getBrowserChatMetadata(), marketing: captureForBooking() });
    if (signal.aborted) return null;
    storeGuestToken(result.sessionId, result.guestToken);
    return result;
  }, [convex, propertySlug]);
  const ensureSession = useCallback((): Promise<GuestCredentials | null> => {
    if (!convex) return Promise.resolve(null);
    if (sessionScope.current?.signal.aborted) { sessionScope.current = new AbortController(); activeRequest.current = null; }
    if (activeRequest.current) return activeRequest.current;
    const scope = sessionScope.current ??= new AbortController();
    const operation = async () => {
      let id = credentials?.sessionId ?? getStoredSessionId();
      if (handoffToken && claimed.current !== handoffToken) {
        claimed.current = handoffToken;
        const handoff = await convex.mutation(api.chat.claimBrowserHandoff, { token: handoffToken });
        if (scope.signal.aborted) return null;
        id = handoff?.sessionId ?? null;
        if (handoff) storeGuestToken(handoff.sessionId, handoff.guestToken);
        onClaimed();
      }
      let next: GuestCredentials | null = null;
      if (id && getStoredGuestToken(id)) {
        try {
          await touchChatSession(convex, { sessionId: id, propertySlug, ...getBrowserChatMetadata(), isOpen: true });
          next = { sessionId: id as Id<'conversations'>, guestToken: getStoredGuestToken(id)! };
        } catch (error) {
          if (!invalidGuest(error)) throw error;
          clearStoredSessionId(id);
        }
      }
      if (!next) next = await create(scope.signal);
      if (scope.signal.aborted) return null;
      if (next) { setStoredSessionId(next.sessionId); setCredentials(previous => previous?.sessionId === next.sessionId && previous.guestToken === next.guestToken ? previous : next); }
      setReady(true); setError(false);
      return next;
    };
    const pending = operation().catch(error => { if (!scope.signal.aborted) { setReady(true); setError(true); } throw error; });
    activeRequest.current = pending;
    void pending.finally(() => { if (activeRequest.current === pending) activeRequest.current = null; }).catch(() => undefined);
    return pending;
  }, [convex, credentials, create, handoffToken, onClaimed, propertySlug]);
  useEffect(() => {
    if (!convex) { setReady(true); return; }
    if (open) void ensureSession().catch(() => undefined);
  }, [convex, open, ensureSession]);
  useEffect(() => {
    if (!open || !convex) return;
    return startSessionHeartbeat({ intervalMs: HEARTBEAT_MS, touch: () => { void ensureSession().catch(() => undefined); } });
  }, [convex, open, ensureSession]);
  useEffect(() => () => { sessionScope.current?.abort(); }, []);
  const restartSession = useCallback(async () => {
    sessionScope.current?.abort(); sessionScope.current = new AbortController(); activeRequest.current = null;
    const old = credentials?.sessionId ?? getStoredSessionId();
    // Construct this authenticated request before removing the old per-session credential.
    if (old && convex) void closeChatSession(convex, { sessionId: old }).catch(() => undefined);
    setCredentials(null); setReady(false); setError(false); clearStoredSessionId(old);
    const scope = sessionScope.current;
    const pending = create(scope.signal).then(next => {
      if (!scope.signal.aborted && next) { setStoredSessionId(next.sessionId); setCredentials(next); }
      return next;
    });
    // The open-session effect shares this creation, including across slow network responses.
    activeRequest.current = pending;
    try { await pending; }
    finally {
      if (activeRequest.current === pending) activeRequest.current = null;
      if (!scope.signal.aborted) setReady(true);
    }
  }, [convex, create, credentials]);
  const recoverInvalidSession = useCallback(async (error: unknown) => {
    if (!invalidGuest(error)) return false;
    await restartSession(); return true;
  }, [restartSession]);
  return { credentials, ready, error, ensureSession, restartSession, recoverInvalidSession };
}
