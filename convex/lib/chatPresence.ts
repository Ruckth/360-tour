export const ACTIVE_CHAT_WINDOW_MS = 90_000;

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
