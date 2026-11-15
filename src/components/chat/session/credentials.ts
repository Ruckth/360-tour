import type { Id } from 'convex/_generated/dataModel';
export const VISITOR_ID_STORAGE_KEY = "sv_chat_visitor_id";
export const SESSION_ID_STORAGE_KEY = "sv_chat_session_id";
export function getStoredSessionId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_ID_STORAGE_KEY) as Id<"conversations"> | null;
}

/** Credentials are scoped to the session, so a stale request cannot use a newer token. */
export function getStoredGuestToken(sessionId: string) {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(`${SESSION_ID_STORAGE_KEY}:token:${sessionId}`) ?? undefined;
}

export function storeGuestToken(sessionId: string, guestToken: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${SESSION_ID_STORAGE_KEY}:token:${sessionId}`, guestToken);
}

export function setStoredSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
}

export function clearStoredSessionId(sessionId = getStoredSessionId()) {
  if (typeof window === "undefined") return;
  const storedId = getStoredSessionId();
  for (const id of new Set([sessionId, storedId])) {
    if (id) window.localStorage.removeItem(`${SESSION_ID_STORAGE_KEY}:token:${id}`);
  }
  window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
}

export function getOrCreateVisitorId() {
  if (typeof window === "undefined") return undefined;

  const existing = window.localStorage.getItem(VISITOR_ID_STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, id);
  return id;
}

