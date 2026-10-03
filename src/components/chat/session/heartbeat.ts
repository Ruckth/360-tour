/**
 * Session heartbeat scheduler.
 *
 * Owns the `touchSession` timer and the visibility/focus listeners that keep a
 * guest's presence fresh while the chat is open.
 *
 * Presence semantics (kept consistent with the admin side — see
 * `convex/lib/chatPresence.ts`, `isChatSessionActive` + `ACTIVE_CHAT_WINDOW_MS`):
 *
 *   - "online" means `lastSeenAt` is within the admin active window
 *     (ACTIVE_CHAT_WINDOW_MS = 90s) AND the session is open. While the tab is
 *     VISIBLE we touch every HEARTBEAT_MS (30s), comfortably inside the window.
 *   - A HIDDEN tab stops heartbeating. Once no touch lands for longer than the
 *     admin window the session reads as "away" — the guest is no longer actively
 *     watching, so admins should see that.
 *   - Resuming (visibilitychange -> visible, or window focus) sends an IMMEDIATE
 *     touch so the guest flips back to "online" without waiting for the next tick.
 *
 * The scheduler is deliberately framework-agnostic: the clock and the touch
 * callback are injected so it can be driven with vi fake timers and a fake
 * client, and so the hook keeps ownership of what a "touch" actually does.
 */

export const HEARTBEAT_MS = 30_000;

export type HeartbeatClock = {
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  isHidden: () => boolean;
  addVisibilityListener: (handler: () => void) => void;
  removeVisibilityListener: (handler: () => void) => void;
  addFocusListener: (handler: () => void) => void;
  removeFocusListener: (handler: () => void) => void;
};

export type HeartbeatOptions = {
  intervalMs?: number;
  /** Called whenever a heartbeat should be sent. Suppressed while the tab is hidden. */
  touch: () => void;
  clock?: HeartbeatClock;
};

export function createBrowserHeartbeatClock(): HeartbeatClock {
  return {
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (id) => window.clearInterval(id),
    isHidden: () =>
      typeof document !== "undefined" && document.visibilityState === "hidden",
    addVisibilityListener: (handler) =>
      document.addEventListener("visibilitychange", handler),
    removeVisibilityListener: (handler) =>
      document.removeEventListener("visibilitychange", handler),
    addFocusListener: (handler) => window.addEventListener("focus", handler),
    removeFocusListener: (handler) =>
      window.removeEventListener("focus", handler),
  };
}

/**
 * Start the heartbeat. Returns a cleanup function that clears the interval and
 * removes every listener — call it on close/restart/unmount so no timer or
 * subscription leaks.
 *
 * Behavior:
 *   - Interval fires every `intervalMs`; a tick while the tab is hidden is
 *     SUPPRESSED (no touch), which is what lets a backgrounded tab age out to
 *     "away".
 *   - When the tab becomes visible (or the window regains focus) an immediate
 *     touch is sent, so resuming is instant rather than waiting up to one tick.
 */
export function startSessionHeartbeat({
  intervalMs = HEARTBEAT_MS,
  touch,
  clock = createBrowserHeartbeatClock(),
}: HeartbeatOptions): () => void {
  const intervalId = clock.setInterval(() => {
    if (clock.isHidden()) return;
    touch();
  }, intervalMs);

  const onResume = () => {
    if (clock.isHidden()) return;
    touch();
  };

  clock.addVisibilityListener(onResume);
  clock.addFocusListener(onResume);

  return () => {
    clock.clearInterval(intervalId);
    clock.removeVisibilityListener(onResume);
    clock.removeFocusListener(onResume);
  };
}
