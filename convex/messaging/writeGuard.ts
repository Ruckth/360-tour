import type { Doc } from '../_generated/dataModel';

/** Runs inside the write transaction, so takeover/deadline races cannot bypass it. */
export function assertChatWriteAllowed(session: Doc<'conversations'>, deadlineAt?: number) {
	if (session.aiPaused) throw new Error('AI replies are paused: staff took over this chat');
	if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new Error('AI turn deadline exceeded');
}
