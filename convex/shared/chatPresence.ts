export const ACTIVE_CHAT_WINDOW_MS = 90_000;

/**
 * How recently presence must have been written for `touchSession` to skip a redundant heartbeat
 * write. A beat that arrives just inside the throttle is skipped, so the worst-case gap between
 * two actual writes is throttle + heartbeat interval (30s): 45s + 30s = 75s, which leaves 15s of
 * timer/network slack below ACTIVE_CHAT_WINDOW_MS (90s). `isChatSessionActive` therefore returns
 * the same answer it would under always-write. Keep throttle + 30s well below the window.
 */
export const PRESENCE_WRITE_THROTTLE_MS = 45_000;

export function isChatSessionActive(
	session: {
		lastSeenAt?: number;
		lastOpenedAt?: number;
		lastClosedAt?: number;
	},
	now = Date.now()
) {
	const lastSeenAt = session.lastSeenAt ?? 0;
	const lastOpenedAt = session.lastOpenedAt ?? 0;
	const lastClosedAt = session.lastClosedAt ?? 0;

	return lastOpenedAt > lastClosedAt && now - lastSeenAt <= ACTIVE_CHAT_WINDOW_MS;
}
